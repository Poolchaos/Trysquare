/**
 * The wrapper that makes a resumed review cheap.
 *
 * Everything here is about one promise: a review that was interrupted does not
 * pay twice. The tests are written so that they fail if it pays twice, if it
 * replays an answer to a question that changed, or if the usage figure stops
 * matching what was actually spent.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { getReview } from "@/server/db/repositories/reviews";
import { listForReview, usageTotals } from "@/server/db/repositories/stage-executions";
import { StageFailedError } from "@/server/engine/headless";
import {
  createCheckpointingRunner,
  promptHashFor,
  type AttemptReport,
  type CheckpointingRunner,
} from "@/server/review/checkpointing-runner";
import { createEngineRunner, StageOutputUnreadableError } from "@/server/review/engine-runner";
import type { StageRequest, StageResponse } from "@/server/review/pipeline";
import { writeAnswersDir } from "../../helpers/ideal-answers";
import { makeTestDb, seedProject, seedReview, type TestDb } from "../db/helpers";

let ctx: TestDb;
let db: Db;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = seedReview(db, seedProject(db).id).id;
});

afterEach(() => ctx.cleanup());

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costEquivalentUsd: 0.5,
};

const ask = (overrides: Partial<StageRequest> = {}): StageRequest => ({
  stage: "s1_risk",
  systemPrompt: "You are a reviewer.",
  prompt: "Assess these files.",
  ...overrides,
});

/**
 * An engine that answers, counting how many times it was actually asked, and
 * reporting attempts the way the real engine runner does.
 */
function fakeEngine(
  answer: (request: StageRequest) => Promise<StageResponse> | StageResponse,
  options: { reportAttempts?: AttemptReport[] } = {},
) {
  const asked: StageRequest[] = [];
  let notify: ((report: AttemptReport) => void) | undefined;

  const inner = async (request: StageRequest): Promise<StageResponse> => {
    asked.push(request);
    for (const report of options.reportAttempts ?? []) notify?.(report);
    return answer(request);
  };

  return {
    inner,
    asked,
    attach(runner: CheckpointingRunner): CheckpointingRunner {
      notify = runner.noteAttempt;
      return runner;
    },
  };
}

describe("replaying what has already been answered", () => {
  it("asks the engine once and remembers the answer", async () => {
    const engine = fakeEngine(() => ({ output: { files: [] }, sessionId: "s-1", usage }));
    const runner = engine.attach(createCheckpointingRunner({ db, reviewId, inner: engine.inner }));

    const first = await runner.run(ask());
    const second = await runner.run(ask());

    expect(second.output).toEqual(first.output);
    expect(engine.asked).toHaveLength(1);
  });

  it("survives a restart, because the answer is in the database", async () => {
    // The case that matters: the process died, and a new wrapper over the same
    // review must still know what was already answered.
    const first = fakeEngine(() => ({ output: { answer: "kept" }, sessionId: "s-1", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: first.inner }).run(ask());

    const second = fakeEngine(() => {
      throw new Error("the engine must not be asked again");
    });
    const replayed = await createCheckpointingRunner({
      db,
      reviewId,
      inner: second.inner,
    }).run(ask());

    expect(replayed.output).toEqual({ answer: "kept" });
    expect(second.asked).toHaveLength(0);
  });

  it("charges nothing for a replay", async () => {
    // A resumed review that re-added the cost of every replayed stage would
    // report a total the user never spent, and the total is what they decide
    // with.
    const engine = fakeEngine(() => ({ output: {}, sessionId: "s-1", usage }));
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    await runner.run(ask());
    const afterFirst = usageTotals(db, reviewId);
    await runner.run(ask());
    await runner.run(ask());

    expect(usageTotals(db, reviewId)).toEqual(afterFirst);
    expect(getReview(db, reviewId)?.usageInputTokens).toBe(usage.inputTokens);
  });

  it("asks again when the question changed", async () => {
    // A prompt only changes when the change set, the rules, or the batching
    // did. Answering the new question with the old answer would be a lie the
    // report would carry all the way to the user.
    const engine = fakeEngine((request) => ({
      output: { echoed: request.prompt },
      sessionId: "s-1",
      usage,
    }));
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    await runner.run(ask());
    const second = await runner.run(ask({ prompt: "Assess these other files." }));

    expect(engine.asked).toHaveLength(2);
    expect(second.output).toEqual({ echoed: "Assess these other files." });
  });

  it("asks again when the rules changed, even though the prompt did not", async () => {
    // The rules travel in the system prompt. Two identical questions judged
    // against different rules are different questions.
    const engine = fakeEngine(() => ({ output: {}, sessionId: "s-1", usage }));
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    await runner.run(ask());
    await runner.run(ask({ systemPrompt: "You are a reviewer. Rule 9 was added." }));

    expect(engine.asked).toHaveLength(2);
  });

  it("does not confuse one stage's answer with another's", async () => {
    const engine = fakeEngine((request) => ({
      output: { stage: request.stage },
      sessionId: "s-1",
      usage,
    }));
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    await runner.run(ask());
    const later = await runner.run(ask({ stage: "s2_comprehension" }));

    expect(later.output).toEqual({ stage: "s2_comprehension" });
    expect(engine.asked).toHaveLength(2);
  });

  it("tells the caller which stages were live and which were free", async () => {
    const engine = fakeEngine(() => ({ output: {}, sessionId: "s-1", usage }));
    const live: string[] = [];
    const replayed: string[] = [];
    const runner = createCheckpointingRunner({
      db,
      reviewId,
      inner: engine.inner,
      onLiveAttempt: (stage) => live.push(stage),
      onReplay: (stage) => replayed.push(stage),
    });

    await runner.run(ask());
    await runner.run(ask());

    expect(live).toEqual(["s1_risk"]);
    expect(replayed).toEqual(["s1_risk"]);
  });
});

describe("rejoining the conversation after an interruption", () => {
  it("hands a live chained stage the session the earlier ones used", async () => {
    const first = fakeEngine(() => ({ output: {}, sessionId: "session-abc", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: first.inner }).run(ask());

    const next = fakeEngine(() => ({ output: {}, sessionId: "session-abc", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: next.inner }).run(
      ask({ stage: "s3_adversarial", prompt: "Hunt for defects." }),
    );

    expect(next.asked[0]?.resumeSessionId).toBe("session-abc");
  });

  it("leaves verification cold, which is the point of it", async () => {
    // Verification exists to be an independent check. Resuming it into the
    // session that argued for the findings would undo that entirely.
    const first = fakeEngine(() => ({ output: {}, sessionId: "session-abc", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: first.inner }).run(ask());

    const verify = fakeEngine(() => ({ output: {}, sessionId: "fresh", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: verify.inner }).run(
      ask({ stage: "s5_verification", prompt: "Check these candidates." }),
    );

    expect(verify.asked[0]?.resumeSessionId).toBeUndefined();
  });

  it("does not override a session the caller asked for", async () => {
    const first = fakeEngine(() => ({ output: {}, sessionId: "session-abc", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: first.inner }).run(ask());

    const next = fakeEngine(() => ({ output: {}, sessionId: "x", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: next.inner }).run(
      ask({ stage: "s3_adversarial", prompt: "Hunt.", resumeSessionId: "chosen" }),
    );

    expect(next.asked[0]?.resumeSessionId).toBe("chosen");
  });
});

describe("the record it leaves behind", () => {
  it("records one row per call the engine actually made", async () => {
    const rejected: AttemptReport = {
      stage: "s1_risk",
      sessionId: "s-1",
      attempt: 1,
      usage,
    };
    const engine = fakeEngine(() => ({ output: {}, sessionId: "s-1", usage }), {
      reportAttempts: [rejected, { ...rejected, attempt: 2 }],
    });
    const runner = engine.attach(createCheckpointingRunner({ db, reviewId, inner: engine.inner }));

    await runner.run(ask());

    const rows = listForReview(db, reviewId);
    expect(rows.map((row) => row.status)).toEqual(["failed", "succeeded"]);
    expect(rows[0]?.errorClass).toBe("invalid_output");
    expect(rows[1]?.outputJson).toBe("{}");
  });

  it("counts what a rejected answer cost, because it cost it", async () => {
    const engine = fakeEngine(() => ({ output: {}, sessionId: "s-1", usage }), {
      reportAttempts: [{ stage: "s1_risk", sessionId: "s-1", attempt: 1, usage }],
    });
    const runner = engine.attach(createCheckpointingRunner({ db, reviewId, inner: engine.inner }));

    await runner.run(ask());

    expect(usageTotals(db, reviewId).inputTokens).toBe(usage.inputTokens);
    expect(getReview(db, reviewId)?.usageInputTokens).toBe(usage.inputTokens);
  });

  it("records why a stage failed, and lets the failure through", async () => {
    const engine = fakeEngine(() => {
      throw new StageFailedError("limit", "Claude usage limit reached.");
    });
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    await expect(runner.run(ask())).rejects.toThrow(/usage limit/i);

    const rows = listForReview(db, reviewId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.errorClass).toBe("limit");
    expect(rows[0]?.inputTokens).toBe(0);
  });

  it("leaves nothing to replay after a failure", async () => {
    // The whole design rests on this: a failed stage must be asked again, so
    // it must not look answered.
    const engine = fakeEngine(() => {
      throw new StageFailedError("timeout", "It took too long.");
    });
    await expect(
      createCheckpointingRunner({ db, reviewId, inner: engine.inner }).run(ask()),
    ).rejects.toThrow();

    const retry = fakeEngine(() => ({ output: { second: true }, sessionId: "s-2", usage }));
    const answer = await createCheckpointingRunner({
      db,
      reviewId,
      inner: retry.inner,
    }).run(ask());

    expect(retry.asked).toHaveLength(1);
    expect(answer.output).toEqual({ second: true });
  });

  it("numbers a retried stage's attempts after the ones that failed", async () => {
    const failing = fakeEngine(() => {
      throw new StageFailedError("spawn", "The CLI would not start.");
    });
    await expect(
      createCheckpointingRunner({ db, reviewId, inner: failing.inner }).run(ask()),
    ).rejects.toThrow();

    const engine = fakeEngine(() => ({ output: {}, sessionId: "s-2", usage }));
    await createCheckpointingRunner({ db, reviewId, inner: engine.inner }).run(ask());

    expect(listForReview(db, reviewId).map((row) => row.attempt)).toEqual([1, 2]);
  });

  it("blames an unreadable answer on the call that gave it", async () => {
    // Both calls reported back, so there is no unreported call to record.
    // Adding one would overstate how many times the model was asked.
    const engine = fakeEngine(
      () => {
        throw new StageOutputUnreadableError("s1_risk", "the shape was wrong", "{oops");
      },
      {
        reportAttempts: [
          { stage: "s1_risk", sessionId: "s-1", attempt: 1, usage },
          { stage: "s1_risk", sessionId: "s-1", attempt: 2, usage },
        ],
      },
    );
    const runner = engine.attach(createCheckpointingRunner({ db, reviewId, inner: engine.inner }));

    await expect(runner.run(ask())).rejects.toBeInstanceOf(StageOutputUnreadableError);

    const rows = listForReview(db, reviewId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "failed")).toBe(true);
    expect(rows[1]?.errorText).toMatch(/did not return a JSON object/);
    expect(usageTotals(db, reviewId).inputTokens).toBe(usage.inputTokens * 2);
  });

  it("records the cost of a call that answered before a later one died", async () => {
    const engine = fakeEngine(
      () => {
        throw new StageFailedError("limit", "Claude usage limit reached.");
      },
      { reportAttempts: [{ stage: "s1_risk", sessionId: "s-1", attempt: 1, usage }] },
    );
    const runner = engine.attach(createCheckpointingRunner({ db, reviewId, inner: engine.inner }));

    await expect(runner.run(ask())).rejects.toThrow(/usage limit/i);

    const rows = listForReview(db, reviewId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.inputTokens).toBe(usage.inputTokens);
    expect(rows[1]?.errorClass).toBe("limit");
    expect(rows[1]?.inputTokens).toBe(0);
  });

  it("keeps one call's attempts out of another call's rows", async () => {
    const engine = fakeEngine(() => ({ output: {}, sessionId: "s-1", usage }), {
      reportAttempts: [{ stage: "s1_risk", sessionId: "s-1", attempt: 1, usage }],
    });
    const runner = engine.attach(createCheckpointingRunner({ db, reviewId, inner: engine.inner }));

    await runner.run(ask());
    await runner.run(ask({ stage: "s2_comprehension", prompt: "Summarise." }));

    // Exactly one row each. If the first call's reported attempt were still
    // in the buffer when the second ran, the second stage would carry two.
    const rows = listForReview(db, reviewId);
    expect(rows.filter((row) => row.stage === "s1_risk")).toHaveLength(1);
    expect(rows.filter((row) => row.stage === "s2_comprehension")).toHaveLength(1);
    expect(usageTotals(db, reviewId).inputTokens).toBe(usage.inputTokens * 2);
  });

  it("refuses to answer two questions at once", async () => {
    // The attempt buffer belongs to one call. Two at a time would attribute
    // one stage's cost to another, and the pipeline never does this.
    let release: (() => void) | undefined;
    const engine = fakeEngine(
      () =>
        new Promise<StageResponse>((resolve) => {
          release = () => resolve({ output: {}, sessionId: "s-1", usage });
        }),
    );
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    const first = runner.run(ask());
    await expect(runner.run(ask({ stage: "s2_comprehension" }))).rejects.toThrow(
      /one question at a time/,
    );

    release?.();
    await first;
  });
});

describe("an answer the pipeline rejected", () => {
  it("is struck and asked again, instead of being replayed into the same failure", async () => {
    // The dead loop this exists to prevent: a schema-valid answer is stored as
    // succeeded, the pipeline's reconciliation then refuses it, and without
    // the strike every resume replays the refused answer for free and fails
    // identically forever. The only exit was deleting the review.
    const engine = fakeEngine(() => ({
      output: { attempt: engine.asked.length },
      sessionId: "s-1",
      usage,
    }));
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    await runner.run(ask());
    runner.invalidate("s1_risk", "The stage skipped app/gone.ts.");

    const retried = await runner.run(ask());

    expect(engine.asked).toHaveLength(2);
    expect(retried.output).toEqual({ attempt: 2 });

    const rows = listForReview(db, reviewId);
    expect(rows.map((row) => row.status)).toEqual(["failed", "succeeded"]);
    expect(rows[0]?.errorClass).toBe("invalid_output");
    expect(rows[0]?.errorText).toBe("The stage skipped app/gone.ts.");
  });

  it("strikes only the stage that was rejected", async () => {
    const engine = fakeEngine((request) => ({
      output: { stage: request.stage },
      sessionId: "s-1",
      usage,
    }));
    const runner = createCheckpointingRunner({ db, reviewId, inner: engine.inner });

    await runner.run(ask());
    await runner.run(ask({ stage: "s2_comprehension", prompt: "Summarise." }));
    runner.invalidate("s2_comprehension", "Rejected.");

    // The untouched stage still replays free; only the struck one re-asks.
    await runner.run(ask());
    await runner.run(ask({ stage: "s2_comprehension", prompt: "Summarise." }));

    expect(engine.asked.map((request) => request.stage)).toEqual([
      "s1_risk",
      "s2_comprehension",
      "s2_comprehension",
    ]);
  });
});

describe("the identity of a question", () => {
  it("is the same for the same question", () => {
    expect(promptHashFor(ask())).toBe(promptHashFor(ask()));
  });

  it("changes with the stage, the rules, and the prompt", () => {
    const base = promptHashFor(ask());
    expect(promptHashFor(ask({ stage: "s4_deletions" }))).not.toBe(base);
    expect(promptHashFor(ask({ systemPrompt: "different" }))).not.toBe(base);
    expect(promptHashFor(ask({ prompt: "different" }))).not.toBe(base);
  });

  it("does not change when a session id does", () => {
    // The session a stage happens to resume into is not part of the question.
    const resumed: StageRequest = { ...ask(), resumeSessionId: "x" };
    expect(promptHashFor(ask())).toBe(promptHashFor(resumed));
  });
});

describe("what a resumed run does at the process boundary", () => {
  // The tests above use an in-process engine, which cannot prove the thing
  // that matters most: that a replay spawns nothing at all. These drive the
  // real engine runner against the fake CLI, where a spawn leaves a mark.
  let runDir: string;

  const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));
  const FAKE_SESSION = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "trysquare-ckpt-"));
    writeAnswersDir(join(runDir, "answers"), [{ files: [] }, { files: [] }, { files: [] }]);
    process.env.FAKE_CLAUDE_SCENARIO = "script";
    process.env.FAKE_CLAUDE_DIR = join(runDir, "answers");
    process.env.FAKE_CLAUDE_COUNTER = join(runDir, "calls.txt");
    process.env.FAKE_CLAUDE_RECORD_DIR = join(runDir, "calls");
  });

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true });
    delete process.env.FAKE_CLAUDE_SCENARIO;
    delete process.env.FAKE_CLAUDE_DIR;
    delete process.env.FAKE_CLAUDE_COUNTER;
    delete process.env.FAKE_CLAUDE_RECORD_DIR;
  });

  /**
   * A wrapper over a real engine runner, wired the way the service will wire
   * it. The engine needs somewhere to report attempts before the wrapper that
   * receives them exists, so the callback reaches it through a holder rather
   * than closing over a variable that is not assigned yet.
   */
  function realRunner(): CheckpointingRunner {
    const built: { wrapper?: CheckpointingRunner } = {};
    const engine = createEngineRunner({
      worktreeRoot: runDir,
      logsDir: join(runDir, "logs"),
      model: "claude-fable-5[1m]",
      timeoutMs: 20_000,
      directives: [],
      rules: [],
      claudePath: FAKE_CLI,
      onStageComplete: (info) => built.wrapper?.noteAttempt(info),
    });
    built.wrapper = createCheckpointingRunner({ db, reviewId, inner: engine.run });
    return built.wrapper;
  }

  const spawns = (): number => {
    try {
      return Number(readFileSync(join(runDir, "calls.txt"), "utf8"));
    } catch {
      return 0;
    }
  };

  const argvOf = (call: number): string[] =>
    JSON.parse(
      readFileSync(join(runDir, "calls", `call-${String(call).padStart(3, "0")}.json`), "utf8"),
    ).args as string[];

  it("starts no process at all for a question it has already answered", async () => {
    await realRunner().run(ask());
    expect(spawns()).toBe(1);

    // A different wrapper over a different engine, as a restarted app would
    // have. The only thing they share is the database.
    const answer = await realRunner().run(ask());

    expect(spawns()).toBe(1);
    expect(answer.output).toEqual({ files: [] });
  });

  it("gives a live stage the session the replayed ones were using", async () => {
    // What makes a resume cheap rather than merely correct: the first live
    // stage rejoins the conversation instead of re-deriving it from nothing.
    await realRunner().run(ask());
    await realRunner().run(ask({ stage: "s2_comprehension", prompt: "Summarise them." }));

    expect(spawns()).toBe(2);
    expect(argvOf(1)).not.toContain("--resume");
    expect(argvOf(2)).toContain("--resume");
    expect(argvOf(2)[argvOf(2).indexOf("--resume") + 1]).toBe(FAKE_SESSION);
  });

  it("records the session so a later run can find it", async () => {
    await realRunner().run(ask());
    expect(listForReview(db, reviewId)[0]?.sessionId).toBe(FAKE_SESSION);
  });
});
