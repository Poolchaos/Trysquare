/**
 * The fake CLI's scripted mode.
 *
 * The pause and resume tests are only as trustworthy as this is, because they
 * prove things about a run by counting what the fake was asked and what it
 * answered. If the fake miscounted a call, or answered the wrong question
 * quietly, those tests would still pass while proving nothing. So the counting
 * and the failure injection are tested directly here.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StageFailedError, runStage } from "@/server/engine/headless";
import { candidateToken, writeAnswersDir } from "../../helpers/ideal-answers";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

let workDir: string;
let answersDir: string;
let counterPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "trysquare-script-"));
  answersDir = join(workDir, "answers");
  counterPath = join(workDir, "calls.txt");
  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = answersDir;
  process.env.FAKE_CLAUDE_COUNTER = counterPath;
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_DIR;
  delete process.env.FAKE_CLAUDE_COUNTER;
  delete process.env.FAKE_CLAUDE_FAIL_AT;
});

function call(prompt = "review this change") {
  return runStage({
    prompt,
    systemPrompt: "You are a reviewer.",
    model: "claude-fable-5[1m]",
    outputFormat: "stream-json",
    cwd: workDir,
    timeoutMs: 10_000,
    logPath: join(workDir, "logs", "stage.log"),
    claudePath: FAKE_CLI,
  });
}

const callsMade = (): number => Number(readFileSync(counterPath, "utf8"));

/**
 * The answer the fake gave, parsed. Every script-mode call produces one, so
 * a missing result is a failure of the fake rather than something to tolerate.
 */
function answerOf(outcome: { result: { result?: string } }): Record<string, unknown> {
  const text = outcome.result.result;
  if (text === undefined) throw new Error("the fake returned no result text");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("answering a whole pipeline", () => {
  it("gives each call the next answer in the sequence", async () => {
    writeAnswersDir(answersDir, [{ stage: "one" }, { stage: "two" }, { stage: "three" }]);

    const results = [await call(), await call(), await call()];

    expect(results.map((outcome) => answerOf(outcome).stage)).toEqual(["one", "two", "three"]);
    expect(callsMade()).toBe(3);
  });

  it("fails loudly when asked a question the test did not plan for", async () => {
    // A pipeline that made an extra call is a finding in itself, so this must
    // not hang or quietly repeat the last answer.
    writeAnswersDir(answersDir, [{ stage: "one" }]);
    await call();

    await expect(call()).rejects.toBeInstanceOf(StageFailedError);
    await expect(call()).rejects.toThrow(/call 3 wanted .*003\.json, which does not exist/);
  });
});

describe("failing at a chosen call", () => {
  it("fails the way a usage limit does", async () => {
    writeAnswersDir(answersDir, [{ stage: "one" }, { stage: "two" }]);
    process.env.FAKE_CLAUDE_FAIL_AT = "2";

    await call();
    await expect(call()).rejects.toThrow(/usage limit reached/i);
  });

  it("answers the interrupted question when the run comes back", async () => {
    // The point of the whole exercise: a resumed run asks the question that
    // failed, and must get the answer that was waiting for it rather than
    // the one after it.
    writeAnswersDir(answersDir, [{ stage: "one" }, { stage: "two" }, { stage: "three" }]);
    process.env.FAKE_CLAUDE_FAIL_AT = "2";

    expect(answerOf(await call()).stage).toBe("one");
    await expect(call()).rejects.toThrow(/usage limit/i);
    expect(answerOf(await call()).stage).toBe("two");
    expect(answerOf(await call()).stage).toBe("three");
  });

  it("fails once and not again", async () => {
    writeAnswersDir(answersDir, [{ stage: "one" }, { stage: "two" }]);
    process.env.FAKE_CLAUDE_FAIL_AT = "1";

    await expect(call()).rejects.toThrow(/usage limit/i);
    expect(answerOf(await call()).stage).toBe("one");
    expect(answerOf(await call()).stage).toBe("two");
  });
});

describe("naming findings the answer could not know in advance", () => {
  const prompt = (candidates: unknown[]) =>
    `Verify these candidates.\n${JSON.stringify({ candidates }, null, 2)}`;

  it("resolves a placeholder to the id in the question it was asked", async () => {
    writeAnswersDir(answersDir, [
      { verdicts: [{ ref: candidateToken("app/src/a.ts", 12), verdict: "verified" }] },
    ]);

    const outcome = await call(
      prompt([{ ref: "finding-abc", path: "app/src/a.ts", lineStart: 12 }]),
    );

    const verdicts = answerOf(outcome).verdicts as { ref: string }[];
    expect(verdicts[0]?.ref).toBe("finding-abc");
  });

  it("refuses to answer about a place the question never mentioned", async () => {
    // Otherwise a stale placeholder would reach the pipeline verbatim, be
    // matched to no candidate, and look like a reviewer that went silent.
    writeAnswersDir(answersDir, [
      { verdicts: [{ ref: candidateToken("app/src/gone.ts", 3), verdict: "verified" }] },
    ]);

    await expect(
      call(prompt([{ ref: "finding-abc", path: "app/src/a.ts", lineStart: 12 }])),
    ).rejects.toThrow(/was not asked about <<candidate:app\/src\/gone\.ts:3>>/);
  });

  it("leaves an answer with no placeholders exactly as written", async () => {
    const answer = { verdicts: [{ ref: "already-known", verdict: "killed" }] };
    writeAnswersDir(answersDir, [answer]);

    const outcome = await call(prompt([]));
    expect(answerOf(outcome)).toEqual(answer);
  });
});

describe("guarding its own configuration", () => {
  it("refuses to run without an answers directory", async () => {
    delete process.env.FAKE_CLAUDE_DIR;
    await expect(call()).rejects.toThrow(/script scenario needs FAKE_CLAUDE_DIR/);
  });

  it("starts from the first answer when no counter file exists yet", async () => {
    writeAnswersDir(answersDir, [{ stage: "one" }]);
    writeFileSync(counterPath, "not a number");

    expect(answerOf(await call()).stage).toBe("one");
  });
});
