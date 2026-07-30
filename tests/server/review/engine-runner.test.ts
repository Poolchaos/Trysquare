import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StageOutputUnreadableError,
  createEngineRunner,
  extractJsonObject,
} from "@/server/review/engine-runner";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "trysquare-runner-"));
  // The repair scenario counts calls in a file, since each invocation is a
  // separate process. Keyed to this test's directory so nothing collides.
  process.env.FAKE_CLAUDE_COUNTER = join(workDir, "calls.txt");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_COUNTER;
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_RESULT;
  delete process.env.FAKE_CLAUDE_RESULT_2;
  delete process.env.FAKE_CLAUDE_RECORD;
  delete process.env.FAKE_CLAUDE_RECORD_2;
});

describe("getting JSON out of a model's answer", () => {
  it("reads a bare object", () => {
    const result = extractJsonObject('{"files": []}');
    expect(result).toEqual({ ok: true, value: { files: [] } });
  });

  it("reads an object inside a json code fence", () => {
    const result = extractJsonObject('```json\n{"a": 1}\n```');
    expect(result.ok && result.value).toEqual({ a: 1 });
  });

  it("reads an object inside an unlabelled fence", () => {
    const result = extractJsonObject('```\n{"a": 1}\n```');
    expect(result.ok && result.value).toEqual({ a: 1 });
  });

  it("reads an object with prose around it", () => {
    const result = extractJsonObject('Here is my answer:\n\n{"a": 1}\n\nHope that helps.');
    expect(result.ok && result.value).toEqual({ a: 1 });
  });

  it("does not end the object at a brace inside a string", () => {
    // Code excerpts and regex patterns routinely contain braces, and a naive
    // scan would truncate the answer at the first one.
    const answer = '{"pattern": "function () { return 1; }", "n": 2}';
    const result = extractJsonObject(answer);
    expect(result.ok && result.value).toEqual({ pattern: "function () { return 1; }", n: 2 });
  });

  it("handles an escaped quote inside a string", () => {
    const result = extractJsonObject('{"quote": "he said \\"hi\\" }", "n": 1}');
    expect(result.ok && result.value).toEqual({ quote: 'he said "hi" }', n: 1 });
  });

  it("reads nested objects and arrays whole", () => {
    const answer = '{"findings": [{"path": "a.ts", "meta": {"deep": true}}]}';
    const result = extractJsonObject(answer);
    expect(result.ok && result.value).toEqual({
      findings: [{ path: "a.ts", meta: { deep: true } }],
    });
  });

  it("reports a failure rather than guessing at unparsable output", () => {
    // A partially understood answer is more dangerous than none.
    expect(extractJsonObject("I could not complete this task.")).toEqual({
      ok: false,
      reason: "no JSON object was found in the answer",
    });
    expect(extractJsonObject("")).toEqual({ ok: false, reason: "the answer was empty" });
  });

  it("reports malformed JSON as malformed, naming the parse error", () => {
    const result = extractJsonObject('{"a": 1,}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("did not parse");
  });

  it("does not mistake an unterminated object for a complete one", () => {
    expect(extractJsonObject('{"a": 1').ok).toBe(false);
  });
});

function makeRunner(overrides: Partial<Parameters<typeof createEngineRunner>[0]> = {}) {
  return createEngineRunner({
    worktreeRoot: workDir,
    logsDir: join(workDir, "logs"),
    model: "claude-fable-5[1m]",
    timeoutMs: 10_000,
    directives: [],
    rules: [],
    claudePath: FAKE_CLI,
    ...overrides,
  });
}

describe("driving the CLI", () => {
  it("returns the parsed stage output", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "json-result";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ files: [] });

    const runner = makeRunner();
    const response = await runner.run({
      stage: "s1_risk",
      systemPrompt: "system",
      prompt: "classify",
    });

    expect(response.output).toEqual({ files: [] });
    expect(response.sessionId).not.toBe("");
    expect(response.usage?.inputTokens).toBeGreaterThan(0);
  });

  it("fails the stage when the answer is not JSON", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "json-result";
    process.env.FAKE_CLAUDE_RESULT = "I was unable to complete the review.";

    const runner = makeRunner();
    await expect(
      runner.run({ stage: "s1_risk", systemPrompt: "system", prompt: "classify" }),
    ).rejects.toThrow(StageOutputUnreadableError);
  });

  it("keeps one session across the stages that build on each other", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "json-result";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ files: [] });

    const recordPath = join(workDir, "record.json");
    const runner = makeRunner();

    await runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" });
    const session = runner.chainSessionId();
    expect(session).toBeDefined();

    process.env.FAKE_CLAUDE_RECORD = recordPath;
    await runner.run({ stage: "s2_comprehension", systemPrompt: "s", prompt: "p" });

    const record = JSON.parse((await import("node:fs")).readFileSync(recordPath, "utf8")) as {
      args: string[];
    };
    expect(record.args).toContain("--resume");
    expect(record.args[record.args.indexOf("--resume") + 1]).toBe(session);
    delete process.env.FAKE_CLAUDE_RECORD;
  });

  it("runs verification in a fresh session, with no sight of the earlier reasoning", async () => {
    // A verifier that can see the argument for a finding is not an
    // independent check on it.
    process.env.FAKE_CLAUDE_SCENARIO = "json-result";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({
      findings: [],
      clearedHunks: [],
      sweepDispositions: [],
    });

    const runner = makeRunner();
    await runner.run({ stage: "s3_adversarial", systemPrompt: "s", prompt: "p" });

    const recordPath = join(workDir, "record-verify.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ verdicts: [] });
    await runner.run({ stage: "s5_verification", systemPrompt: "s", prompt: "p" });

    const record = JSON.parse((await import("node:fs")).readFileSync(recordPath, "utf8")) as {
      args: string[];
    };
    expect(record.args).not.toContain("--resume");
    delete process.env.FAKE_CLAUDE_RECORD;
  });

  it("refuses a stage whose toolset was wider than requested", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "extra-tools";

    const runner = makeRunner();
    await expect(runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" })).rejects.toThrow(
      /granted tools this stage did not allow/,
    );
  });

  it("reports usage for every attempt, including ones that failed to parse", async () => {
    // Usage was spent whatever the answer said, and a run that hides the cost
    // of its failures understates what the review actually used.
    process.env.FAKE_CLAUDE_SCENARIO = "json-result";
    process.env.FAKE_CLAUDE_RESULT = "not json";

    const seen: { stage: string; attempt: number; usage: { inputTokens: number } }[] = [];
    const runner = makeRunner({ onStageComplete: (info) => seen.push(info) });

    await expect(
      runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" }),
    ).rejects.toThrow();
    // The first answer and the one repair attempt both cost tokens.
    expect(seen.map((entry) => entry.attempt)).toEqual([1, 2]);
    for (const entry of seen) expect(entry.usage.inputTokens).toBeGreaterThan(0);
  });

  it("passes the composed system prompt through when one is not supplied", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "json-result";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ files: [] });

    const recordPath = join(workDir, "record-compose.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;

    const runner = makeRunner();
    await runner.run({ stage: "s1_risk", systemPrompt: "", prompt: "p" });

    const record = JSON.parse((await import("node:fs")).readFileSync(recordPath, "utf8")) as {
      args: string[];
    };
    const systemPrompt = record.args[record.args.indexOf("--system-prompt") + 1] ?? "";
    expect(systemPrompt).toContain("code review under a fixed protocol");
    expect(systemPrompt).toContain("Answer with a single JSON object");
    delete process.env.FAKE_CLAUDE_RECORD;
  });
});

describe("the repair round", () => {
  it("asks once when the shape is wrong, and accepts the correction", async () => {
    // Refusing to ask would waste a whole stage over a missing field.
    process.env.FAKE_CLAUDE_SCENARIO = "then-valid";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ wrong: "shape" });
    process.env.FAKE_CLAUDE_RESULT_2 = JSON.stringify({ files: [] });

    const attempts: number[] = [];
    const runner = makeRunner({ onStageComplete: (info) => attempts.push(info.attempt) });
    const response = await runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" });

    expect(response.output).toEqual({ files: [] });
    expect(attempts).toEqual([1, 2]);
  });

  it("sums the usage of both attempts, so the cost is not understated", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "then-valid";
    process.env.FAKE_CLAUDE_RESULT = "not json at all";
    process.env.FAKE_CLAUDE_RESULT_2 = JSON.stringify({ files: [] });

    const runner = makeRunner();
    const response = await runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" });
    // The fake reports 100 input tokens per call.
    expect(response.usage?.inputTokens).toBe(200);
  });

  it("does not ask twice: a second failure is final", async () => {
    // Asking again is how a stage turns into an argument that burns budget.
    process.env.FAKE_CLAUDE_SCENARIO = "then-valid";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ wrong: "shape" });
    process.env.FAKE_CLAUDE_RESULT_2 = JSON.stringify({ still: "wrong" });

    const attempts: number[] = [];
    const runner = makeRunner({ onStageComplete: (info) => attempts.push(info.attempt) });

    await expect(runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" })).rejects.toThrow(
      /still did not match the schema/,
    );
    expect(attempts).toEqual([1, 2]);
  });

  it("does not repair an answer that was already valid", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "then-valid";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ files: [] });
    process.env.FAKE_CLAUDE_RESULT_2 = JSON.stringify({ files: [] });

    const attempts: number[] = [];
    const runner = makeRunner({ onStageComplete: (info) => attempts.push(info.attempt) });
    await runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" });
    expect(attempts).toEqual([1]);
  });

  it("names the exact validation problem, so the repair has something to act on", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "then-valid";
    process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ files: [{ path: "a.ts" }] });
    process.env.FAKE_CLAUDE_RESULT_2 = JSON.stringify({ files: [] });

    const recordPath = join(workDir, "record-repair.json");
    process.env.FAKE_CLAUDE_RECORD_2 = recordPath;

    const runner = makeRunner();
    await runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" });

    const record = JSON.parse((await import("node:fs")).readFileSync(recordPath, "utf8")) as {
      args: string[];
    };
    const prompt = record.args[record.args.indexOf("-p") + 1] ?? "";
    expect(prompt).toContain("did not match the required schema");
    expect(prompt).toContain("riskTags");
    expect(prompt).toContain("only fix the shape");
    delete process.env.FAKE_CLAUDE_RECORD_2;
  });

  it("repairs inside the same session, so the analysis is not repeated", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "then-valid";
    process.env.FAKE_CLAUDE_RESULT = "prose only";
    process.env.FAKE_CLAUDE_RESULT_2 = JSON.stringify({ files: [] });

    const recordPath = join(workDir, "record-repair-session.json");
    process.env.FAKE_CLAUDE_RECORD_2 = recordPath;

    const runner = makeRunner();
    await runner.run({ stage: "s1_risk", systemPrompt: "s", prompt: "p" });

    const record = JSON.parse((await import("node:fs")).readFileSync(recordPath, "utf8")) as {
      args: string[];
    };
    expect(record.args).toContain("--resume");
    delete process.env.FAKE_CLAUDE_RECORD_2;
  });
});
