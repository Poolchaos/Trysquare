/**
 * The scheduler, driven end to end.
 *
 * A local tool with one account still needs a scheduler, and the parts worth
 * proving are the ones a user would notice going wrong: two reviews started at
 * once must not both run, cancel must actually stop something, and what the
 * browser is told must never contradict what the database says.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";
import { isResumableReview, type ReviewStatus } from "@/lib/domain/state-machines";
import { logsDir, worktreeRootDir } from "@/lib/paths";
import { SHUTDOWN } from "@/lib/domain/shutdown";
import type { Db } from "@/server/db/client";
import { createProject, setCloneStatus } from "@/server/db/repositories/projects";
import {
  createReview,
  deleteReview,
  readRunNotes,
  requireReview,
  transitionReview,
} from "@/server/db/repositories/reviews";
import { SETTING_KEYS, writeSetting } from "@/server/db/repositories/settings";
import { models, projects } from "@/server/db/schema";
import {
  JobManager,
  ReviewAlreadyStartedError,
  ReviewBeingDeletedError,
  ReviewNotStartableError,
} from "@/server/jobs/manager";
import type { ReviewEvent } from "@/server/jobs/bus";
import { listFindingsByStatus } from "@/server/db/repositories/findings";
import { VerifyAgainUnavailableError } from "@/server/review/service";
import {
  answerSequence,
  buildIdealStageOutputs,
  candidateToken,
  verdictAnswer,
  writeAnswersDir,
  type VerdictByLine,
} from "../../helpers/ideal-answers";
import { buildFixture, type SeededFixture } from "../../helpers/seeded-fixture";
import { makeTestDb, type TestDb } from "../db/helpers";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
).ruleset;

const RULESET = { imported: PROTOCOL, name: "Example protocol", tier: "global" as const };

let fixture: SeededFixture;
let ctx: TestDb;
let db: Db;
let dataDir: string;
let manager: JobManager;
let projectId: string;

beforeAll(async () => {
  fixture = await buildFixture();
}, 180_000);

afterAll(() => fixture?.cleanup());

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-manager-"));
  manager = new JobManager();
  manager.init({ db, dataDir, claudePath: FAKE_CLI });

  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = join(dataDir, "answers");
  process.env.FAKE_CLAUDE_COUNTER = join(dataDir, "calls.txt");
  writeIdealAnswers();

  projectId = createProject(db, {
    name: "app",
    gitUrl: "git@example.com:acme/app.git",
    defaultBranch: "main",
    clonePath: fixture.appClone,
  }).id;
});

afterEach(async () => {
  await manager.drain();
  ctx.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_DIR;
  delete process.env.FAKE_CLAUDE_COUNTER;
  delete process.env.FAKE_CLAUDE_FAIL_AT;
});

function writeIdealAnswers(): void {
  const outputs = buildIdealStageOutputs({
    files: fixture.appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
    manifest: {
      ...fixture.manifest,
      defects: fixture.manifest.defects.filter((defect) => defect.kind !== "cross-repo"),
    },
    worktreeRoot: fixture.referenceRoot,
    rules: PROTOCOL.rules,
  });
  // Twice over: the fake hands out answers in one sequence per directory, and
  // a test that runs two reviews needs enough for both.
  const sequence = answerSequence(outputs);
  writeAnswersDir(join(dataDir, "answers"), [...sequence, ...sequence]);
}

/** Reviews share one project, because a project is one clone of one remote. */
function seedReview(): string {
  return createReview(db, {
    projectId,
    fromBranch: "feature/rename-prefs",
    fromCommit: fixture.appHead,
    intoBranch: "main",
    intoCommit: fixture.appBase,
    mergeBaseCommit: fixture.appBase,
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
  }).id;
}

const start = (reviewId: string) => manager.start(reviewId, { ruleset: RULESET });

describe("deciding what runs now", () => {
  it("runs the first review and makes the second wait", async () => {
    // Two at once would race for one account's rate limit and make both
    // slower, so the default is one.
    const first = seedReview();
    const second = seedReview();

    expect(start(first)).toBe("running");
    expect(start(second)).toBe("queued");
    expect(manager.queueDepth()).toBe(1);
    expect(requireReview(db, second).status).toBe("draft");

    await manager.settled(first);
    // The queued review starts on its own once the slot frees.
    await manager.settled(second);

    expect(requireReview(db, first).status).toBe("awaiting_confirmation");
    expect(requireReview(db, second).status).toBe("awaiting_confirmation");
  }, 240_000);

  it("starts a waiting review as soon as the limit is raised (4.23)", async () => {
    // It used to wait for the running review to finish, however long that
    // took, though the person had just made room for it.
    const first = seedReview();
    const second = seedReview();
    expect(start(first)).toBe("running");
    expect(start(second)).toBe("queued");

    writeSetting(db, SETTING_KEYS.maxConcurrentReviews, 2);
    manager.startQueued();

    expect(manager.isRunning(second)).toBe(true);
    expect(manager.queueDepth()).toBe(0);
    await manager.settled(first);
    await manager.settled(second);
  }, 240_000);

  it("does not start the same review twice", async () => {
    const reviewId = seedReview();
    expect(start(reviewId)).toBe("running");
    expect(manager.start(reviewId)).toBe("already-running");
    await manager.settled(reviewId);
  }, 120_000);

  it("refuses a ruleset for a review already running or waiting, rather than dropping it", async () => {
    // Asked again with a ruleset, a review that was running or in line said
    // so and dropped the ruleset; the start route answered 200, and the run
    // used the one it was started with (D-138).
    const first = seedReview();
    const second = seedReview();
    expect(start(first)).toBe("running");
    expect(start(second)).toBe("queued");
    expect(() => start(first)).toThrow(ReviewAlreadyStartedError);
    expect(() => start(second)).toThrow(ReviewAlreadyStartedError);
    // Without one it still says where it stands.
    expect(manager.start(first)).toBe("already-running");
    expect(manager.start(second)).toBe("queued");
    await manager.settled(first);
    await manager.settled(second);
  }, 240_000);

  it("judges a start as start would, and changes nothing doing so", async () => {
    // The start route asks it before the CLI, so it must agree with start and
    // claim nothing (review of the D-162 fixes, 2cb5541).
    const first = seedReview();
    const second = seedReview();
    expect(manager.judge(first, { ruleset: RULESET })).toBe("startable");
    expect(manager.isRunning(first)).toBe(false);
    expect(manager.queueDepth()).toBe(0);
    expect(start(first)).toBe("running");
    expect(manager.judge(second)).toBe("startable");
    expect(start(second)).toBe("queued");
    expect(manager.judge(first)).toBe("already-running");
    expect(manager.judge(second)).toBe("queued");
    expect(() => manager.judge(second, { ruleset: RULESET })).toThrow(ReviewAlreadyStartedError);
    expect(manager.queueDepth()).toBe(1);
    const cancelled = seedReview();
    transitionReview(db, cancelled, "cancelled");
    expect(() => manager.judge(cancelled)).toThrow(ReviewNotStartableError);
    await manager.settled(first);
    await manager.settled(second);
  }, 240_000);

  it("lets a delete claim only what it does not hold, and starts nothing claimed", async () => {
    // Every delete checked, then awaited the removal of its files, and a
    // start landing between ran on a review whose files and row went from
    // under it (review of the D-165 fixes).
    const first = seedReview();
    const second = seedReview();
    const idle = seedReview();
    expect(start(first)).toBe("running");
    expect(start(second)).toBe("queued");
    expect(manager.beginDelete(first, { evenQueued: true })).toBe(false);
    expect(manager.beginDelete(second, { evenQueued: false })).toBe(false);
    expect(manager.isQueued(second)).toBe(true);
    expect(manager.beginDelete(second, { evenQueued: true })).toBe(true);
    expect(manager.isQueued(second)).toBe(false);

    expect(manager.beginDelete(idle, { evenQueued: false })).toBe(true);
    // A second delete of it is refused, or the first to finish released the
    // other's claim (review of the D-166 fixes).
    expect(manager.beginDelete(idle, { evenQueued: true })).toBe(false);
    expect(() => manager.judge(idle)).toThrow(ReviewBeingDeletedError);
    expect(() => start(idle)).toThrow(ReviewBeingDeletedError);
    manager.endDelete(idle);
    expect(manager.judge(idle, { ruleset: RULESET })).toBe("startable");
    manager.endDelete(second);
    await manager.settled(first);
  }, 240_000);

  it("refuses an id that is not a review at all", () => {
    // Fails here rather than inside a promise nobody is awaiting.
    expect(() => start("not-a-review")).toThrow();
  });

  it("refuses a review that cannot run, before claiming it (4.19)", () => {
    // It used to answer "running" and fail later, inside a run nobody was
    // told about: the page waited on a review that was never going to move.
    const reviewId = seedReview();
    transitionReview(db, reviewId, "cancelled");
    expect(() => start(reviewId)).toThrow(ReviewNotStartableError);
    expect(() => start(reviewId)).toThrow(/is cancelled, which cannot be started or resumed/);
    expect(manager.isRunning(reviewId)).toBe(false);
    expect(manager.queueDepth()).toBe(0);
  });
});

describe("stopping a review", () => {
  it("cancels one that is running", async () => {
    const reviewId = seedReview();
    start(reviewId);
    expect(manager.cancel(reviewId)).toBe(true);

    const outcome = await manager.settled(reviewId);
    expect(outcome?.kind).toBe("cancelled");
    expect(requireReview(db, reviewId).status).toBe("cancelled");
  }, 120_000);

  it("leaves a review the server stopped interrupted, resumable and with its worktree", async () => {
    // A shutdown is not a person's decision to abandon a review. Cancelled is
    // terminal, so stopping the server must not end there.
    process.env.FAKE_CLAUDE_SCENARIO = "hang";
    const reviewId = seedReview();
    // Waits for the CLI's init line in the stage transcript, so the process
    // exists when the server stops: a stage's "started" comes before it spawns.
    start(reviewId);
    const transcript = join(logsDir(dataDir, reviewId), "s1_risk.log");
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (existsSync(transcript) && readFileSync(transcript, "utf8").includes('"init"')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await manager.drain(SHUTDOWN);

    const review = requireReview(db, reviewId);
    expect(review.status).toBe("interrupted");
    expect(isResumableReview(review.status as ReviewStatus)).toBe(true);
    expect(existsSync(worktreeRootDir(dataDir, reviewId))).toBe(true);
  }, 120_000);

  it("takes a queued review out of the line and marks it cancelled", async () => {
    // Dequeueing alone used to leave the row a draft and tell no one, so the
    // screen showed a review still waiting for a slot it would never take. A
    // cancelled queued review must end cancelled, and a watcher must hear it.
    const first = seedReview();
    const second = seedReview();
    start(first);
    start(second);

    const heard: string[] = [];
    manager.subscribe(second, (event) => {
      if (event.kind === "status") heard.push(event.status);
    });

    expect(manager.cancel(second)).toBe(true);
    expect(manager.queueDepth()).toBe(0);
    expect(requireReview(db, second).status).toBe("cancelled");
    expect(heard).toContain("cancelled");

    await manager.settled(first);
    expect(requireReview(db, second).status).toBe("cancelled");
  }, 240_000);

  it("cancels a draft that never started, without deleting its row", () => {
    // Previously the only way to be rid of a draft was to delete it, which on
    // a review that had already run would also discard its findings.
    const reviewId = seedReview();
    expect(manager.cancel(reviewId)).toBe(true);
    expect(requireReview(db, reviewId).status).toBe("cancelled");
  });

  it("drains the queue past a review that was deleted while it waited", async () => {
    // The queue holds ids, not rows. A deleted queued review used to throw
    // from the finally of the run that ended, which escaped as an unhandled
    // rejection and abandoned the loop, stranding every review behind it in a
    // queue nothing would drain again.
    const first = seedReview();
    const doomed = seedReview();
    const third = seedReview();

    start(first);
    start(doomed);
    start(third);
    expect(manager.queueDepth()).toBe(2);

    deleteReview(db, doomed);

    await manager.settled(first);
    // The one behind the hole still runs, which is the whole point.
    await manager.settled(third);
    expect(requireReview(db, third).status).toBe("awaiting_confirmation");
    expect(manager.queueDepth()).toBe(0);
  }, 360_000);

  it("says so when there is nothing to cancel", () => {
    // A review that already ended. The manager asks the state machine rather
    // than keeping its own list, so this is refused for the same reason the
    // database would refuse it.
    const reviewId = seedReview();
    manager.cancel(reviewId);
    expect(requireReview(db, reviewId).status).toBe("cancelled");
    expect(manager.cancel(reviewId)).toBe(false);
  });
});

describe("what a watcher is told", () => {
  it("announces nothing the database does not already say", async () => {
    // The ordering the whole design rests on. If an event arrived before the
    // row it describes, the UI would show a stage as started while the
    // database still said otherwise, and a page reload would undo it.
    const reviewId = seedReview();
    const disagreements: string[] = [];

    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "status") {
        const actual = requireReview(db, reviewId).status;
        if (actual !== event.status) disagreements.push(`${event.status} vs ${actual}`);
      }
      if (event.kind === "stage" && event.phase === "started") {
        const stages = manager.snapshot(reviewId).stages;
        // A started stage may have no row yet, but the review must already be
        // past draft, which is what the listener could act on.
        if (requireReview(db, reviewId).status === "draft") disagreements.push("still draft");
        void stages;
      }
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(disagreements).toEqual([]);
  }, 120_000);

  it("reports the statuses in the order they happened, ending in done", async () => {
    const reviewId = seedReview();
    const seen: string[] = [];
    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "status") seen.push(event.status);
      if (event.kind === "done") seen.push(`done:${event.outcome}`);
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(seen).toEqual(["running", "verifying", "awaiting_confirmation", "done:completed"]);
  }, 120_000);

  it("names every stage as it starts", async () => {
    const reviewId = seedReview();
    const stages: string[] = [];
    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "stage" && event.phase === "started") stages.push(event.stage);
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(stages).toEqual([
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
      "s4_deletions",
      "s5_verification",
      "s5b_second_verification",
    ]);
  }, 120_000);

  it("passes on the run notes the review recorded", async () => {
    const reviewId = seedReview();
    const notes: string[] = [];
    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "note") notes.push(event.note.message);
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(notes.some((note) => note.includes("candidate(s)"))).toBe(true);
  }, 120_000);

  it("tells a watcher when a review could not even start", async () => {
    // No ruleset to freeze. prepareAndRun throws rather than returning an
    // outcome, and a watcher still has to learn that it is over.
    const reviewId = seedReview();
    const seen: ReviewEvent[] = [];
    manager.subscribe(reviewId, (event) => seen.push(event));

    manager.start(reviewId);
    await manager.settled(reviewId);

    const done = seen.find((event) => event.kind === "done");
    expect(done).toMatchObject({ kind: "done", outcome: "failed" });
    expect(requireReview(db, reviewId).status).toBe("draft");
  }, 120_000);

  it("stops telling a listener that unsubscribed", async () => {
    const reviewId = seedReview();
    const seen: ReviewEvent[] = [];
    const off = manager.subscribe(reviewId, (event) => seen.push(event));
    off();

    start(reviewId);
    await manager.settled(reviewId);

    expect(seen).toEqual([]);
    expect(manager.listenerCount(reviewId)).toBe(0);
  }, 120_000);
});

describe("the picture a page loads with", () => {
  it("carries the review, its stages, its usage and its findings", async () => {
    const reviewId = seedReview();
    start(reviewId);
    await manager.settled(reviewId);

    const snapshot = manager.snapshot(reviewId);
    expect(snapshot.review.id).toBe(reviewId);
    expect(snapshot.stages).toHaveLength(6);
    expect(snapshot.usage.inputTokens).toBe(600);
    expect(snapshot.findings.verified).toBeGreaterThan(0);
    expect(snapshot.running).toBe(false);
  }, 120_000);

  it("says a review is running while it is", async () => {
    const reviewId = seedReview();
    start(reviewId);
    expect(manager.snapshot(reviewId).running).toBe(true);
    await manager.settled(reviewId);
    expect(manager.snapshot(reviewId).running).toBe(false);
  }, 120_000);
});

describe("coming back from a restart", () => {
  it("marks a review the last process left running as interrupted", async () => {
    // Nothing survived the restart that could be running it, and until this
    // happens the review can neither be started nor cancelled.
    const reviewId = seedReview();
    transitionReview(db, reviewId, "running");

    const fresh = new JobManager();
    fresh.init({ db, dataDir, claudePath: FAKE_CLI });

    expect(requireReview(db, reviewId).status).toBe("interrupted");
  });

  it("fails a clone the last process left in flight, and leaves settled ones alone", () => {
    // The background task died with the process and nothing restarts it, so
    // the row would say "cloning" forever and the projects screen would poll
    // it forever.
    const seed = (name: string) =>
      createProject(db, {
        name,
        gitUrl: `git@example.com:acme/${name}.git`,
        defaultBranch: "main",
        clonePath: "",
      }).id;
    const strandedId = seed("mid-clone");
    setCloneStatus(db, strandedId, "cloning");
    const readyId = seed("settled");
    setCloneStatus(db, readyId, "cloning");
    setCloneStatus(db, readyId, "ready");

    const fresh = new JobManager();
    fresh.init({ db, dataDir, claudePath: FAKE_CLI });

    const rowOf = (id: string) => db.select().from(projects).where(eq(projects.id, id)).get();
    expect(rowOf(strandedId)?.cloneStatus).toBe("failed");
    expect(rowOf(strandedId)?.cloneError).toMatch(/restarted while this clone was in flight/);
    expect(rowOf(readyId)?.cloneStatus).toBe("ready");
  });

  it("registers the models the app knows how to offer", () => {
    const fresh = new JobManager();
    fresh.init({ db, dataDir, claudePath: FAKE_CLI });
    // Registering is conflict-free, so a second start is not a second set.
    fresh.init({ db, dataDir, claudePath: FAKE_CLI });

    const rows = db.select().from(models).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("resumes a review that was interrupted, keeping what it had", async () => {
    const reviewId = seedReview();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    start(reviewId);
    await manager.settled(reviewId);
    expect(requireReview(db, reviewId).status).toBe("paused_limit");

    delete process.env.FAKE_CLAUDE_FAIL_AT;
    writeFileSync(join(dataDir, "calls.txt"), "2");
    const replayed: string[] = [];
    manager.subscribe(reviewId, (event) => {
      if (event.kind === "stage" && event.phase === "replayed") replayed.push(event.stage);
    });

    manager.resume(reviewId, { ruleset: RULESET });
    await manager.settled(reviewId);

    expect(replayed).toEqual(["s1_risk", "s2_comprehension"]);
    expect(requireReview(db, reviewId).status).toBe("awaiting_confirmation");
  }, 240_000);
});

describe("verifying an open question again (WP-D2, review round 2)", () => {
  /** A finished review whose verifier left its first finding open. */
  async function withAnOpenQuestion(after: (verdict: VerdictByLine) => unknown[] = () => []) {
    const outputs = buildIdealStageOutputs({
      files: fixture.appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
      manifest: {
        ...fixture.manifest,
        defects: fixture.manifest.defects.filter((defect) => defect.kind !== "cross-repo"),
      },
      worktreeRoot: fixture.referenceRoot,
      rules: PROTOCOL.rules,
    });
    const [first, ...rest] = outputs.s5ByLine;
    writeAnswersDir(join(dataDir, "answers"), [
      ...answerSequence({
        ...outputs,
        s5ByLine: [{ ...first!, verdict: "open_question", note: "Could not tell." }, ...rest],
      }),
      ...after(first!),
    ]);
    const reviewId = seedReview();
    start(reviewId);
    await manager.settled(reviewId);
    const [finding] = listFindingsByStatus(db, reviewId, ["open_question"]);
    return { reviewId, findingId: finding!.id };
  }

  /** In flight until its signal or a drain stops it: the CLI never answers. */
  function hold(findingId: string, signal?: AbortSignal) {
    process.env.FAKE_CLAUDE_SCENARIO = "hang";
    const pending = manager.verifyAgain(findingId, signal);
    pending.catch(() => {});
    return pending;
  }

  it("counts against the reviews at once, so a review started meanwhile waits", async () => {
    // Two at once share one usage limit, which is why the setting exists.
    const { findingId } = await withAnOpenQuestion();
    const stop = new AbortController();
    const pending = hold(findingId, stop.signal);

    const other = seedReview();
    expect(start(other)).toBe("queued");

    stop.abort();
    await expect(pending).rejects.toThrow();
    expect(manager.isRunning(other)).toBe(true);
  }, 120_000);

  it("is refused while a review runs, or another is verified again", async () => {
    const { findingId } = await withAnOpenQuestion();
    hold(findingId);
    await expect(manager.verifyAgain(findingId)).rejects.toThrow(VerifyAgainUnavailableError);

    await manager.drain();
    const running = seedReview();
    start(running);
    await expect(manager.verifyAgain(findingId)).rejects.toThrow(/A review is running/);
  }, 120_000);

  it("keeps its review from being decided, completed or deleted meanwhile", async () => {
    // Completing removed the checkout the verifier was reading, and a
    // decision on the finding made the paid answer land nowhere.
    const { reviewId, findingId } = await withAnOpenQuestion();
    hold(findingId);

    expect(() => manager.assertNotVerifyingAgain(reviewId)).toThrow(/being verified again/);
    expect(manager.beginDelete(reviewId, { evenQueued: true })).toBe(false);
    expect(manager.isRunning(reviewId)).toBe(true);
  }, 120_000);

  it("is stopped by a shutdown, the finding left open", async () => {
    const { reviewId, findingId } = await withAnOpenQuestion();
    const pending = hold(findingId);

    await manager.drain(SHUTDOWN);
    await expect(pending).rejects.toThrow();
    expect(listFindingsByStatus(db, reviewId, ["open_question"])).toHaveLength(1);
    expect(() => manager.assertNotVerifyingAgain(reviewId)).not.toThrow();
  }, 120_000);

  it("leaves its call out of the run's stages, its cost on the review", async () => {
    // The panel took the last S5 row for the stage, so a one-finding call's
    // cost, time or failure stood in for the run's (review round 2, F6).
    const { reviewId, findingId } = await withAnOpenQuestion((verdict) => [
      {
        verdicts: [
          verdictAnswer(
            candidateToken(verdict.path, verdict.lineStart),
            verdict,
            verdict.lineStart,
            verdict.path,
          ),
        ],
      },
    ]);
    const before = manager.snapshot(reviewId);

    await expect(manager.verifyAgain(findingId)).resolves.toMatchObject({ status: "verified" });
    const after = manager.snapshot(reviewId);
    expect(after.stages).toEqual(before.stages);
    expect(after.usage.costEquivalentUsd).toBeGreaterThan(before.usage.costEquivalentUsd);
  }, 120_000);

  it("asks nothing for a request already abandoned", async () => {
    // A tab closed before the CLI started still ran it, and paid.
    const { findingId } = await withAnOpenQuestion();
    const gone = new AbortController();
    gone.abort();

    await expect(manager.verifyAgain(findingId, gone.signal)).rejects.toThrow();
    expect(readFileSync(join(dataDir, "calls.txt"), "utf8")).toBe("6");
  }, 120_000);
});

describe("the run directory", () => {
  it("keeps the evidence a completed review produced", async () => {
    const reviewId = seedReview();
    start(reviewId);
    await manager.settled(reviewId);

    expect(existsSync(join(dataDir, "runs", reviewId, "bundle", "inventory.json"))).toBe(true);
  }, 120_000);
});

describe("the CLI a run goes through", () => {
  it("is the path saved in Settings, asked as the run starts, with no restart", async () => {
    // The manager took its path once, when the server started, so a path
    // saved in Settings after that went unused until a restart (6.1, D-152).
    const fresh = new JobManager();
    fresh.init({ db, dataDir });
    writeSetting(db, SETTING_KEYS.claudePath, FAKE_CLI);
    const reviewId = seedReview();
    expect(fresh.start(reviewId, { ruleset: RULESET })).toBe("running");
    await fresh.settled(reviewId);
    const review = requireReview(db, reviewId);
    expect(review.status).toBe("awaiting_confirmation");
    expect(readRunNotes(review).map((note) => note.message)).toContainEqual(
      expect.stringContaining(`Engine: ${FAKE_CLI} (2.1.301`),
    );
    await fresh.drain();
  }, 120_000);
});
