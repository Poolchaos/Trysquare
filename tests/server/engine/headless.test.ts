/**
 * Engine tests run against a fake CLI, so they are hermetic and consume no
 * model usage. The fake's output shapes were copied from a real transcript,
 * so it fails the way the real binary fails.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READ_ONLY_TOOLS } from "@/lib/engine/command";
import { contextWindowOf, usageOf } from "@/lib/engine/events";
import {
  StageFailedError,
  assertToolsAreReadOnly,
  runStage,
  type StageRunOptions,
} from "@/server/engine/headless";
import { readAuthStatus } from "@/server/engine/probe";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "trysquare-engine-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_RECORD;
});

function run(scenario: string, overrides: Partial<StageRunOptions> = {}) {
  process.env.FAKE_CLAUDE_SCENARIO = scenario;
  return runStage({
    prompt: "review this change",
    systemPrompt: "You are a reviewer.",
    model: "claude-fable-5[1m]",
    outputFormat: "stream-json",
    cwd: workDir,
    timeoutMs: 10_000,
    logPath: join(workDir, "logs", "stage.log"),
    claudePath: FAKE_CLI,
    ...overrides,
  });
}

describe("running a stage", () => {
  it("returns the result, session id, and granted tools", async () => {
    const outcome = await run("success");
    expect(outcome.result.is_error).toBe(false);
    expect(outcome.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(outcome.toolsGranted).toEqual([...READ_ONLY_TOOLS]);
  });

  it("reports usage and the context window the model actually had", async () => {
    const outcome = await run("success");
    expect(usageOf(outcome.result)).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      // Reported separately by the CLI, and carried through rather than
      // folded into the input count or dropped.
      cacheCreationTokens: 300,
      cacheReadTokens: 2000,
      costEquivalentUsd: 0.0042,
    });
    expect(contextWindowOf(outcome.result)).toBe(1_000_000);
  });

  it("streams events to the caller as they arrive", async () => {
    const seen: string[] = [];
    await run("tool-use", { onEvent: (e) => seen.push(e.kind) });
    expect(seen).toContain("init");
    expect(seen).toContain("tool-use");
    expect(seen).toContain("result");
  });

  it("writes a transcript that survives the process", async () => {
    const outcome = await run("success");
    const log = readFileSync(join(workDir, "logs", "stage.log"), "utf8");
    expect(log).toContain("--system-prompt");
    expect(log).toContain(outcome.sessionId);
  });

  it("surfaces live rate-limit state before anything fails", async () => {
    const outcome = await run("rate-limit-warning");
    expect(outcome.rateLimit).toMatchObject({
      status: "allowed_warning",
      limitType: "five_hour",
      resetsAt: 1785408600,
    });
  });

  it("reassembles an event split across stream chunks", async () => {
    // A chunk boundary can fall mid-object; buffering is not optional.
    const outcome = await run("split-lines");
    expect(outcome.result.is_error).toBe(false);
  });

  it("ignores an event type it has never seen rather than failing the review", async () => {
    const outcome = await run("unknown-event");
    expect(outcome.result.is_error).toBe(false);
  });
});

describe("failure handling", () => {
  it("treats exiting zero with no result as a failure", async () => {
    // The dangerous case: a naive runner reads exit code 0 and reports an
    // empty review as a clean one.
    await expect(run("no-result")).rejects.toThrow(StageFailedError);
    await expect(run("no-result")).rejects.toThrow(/before producing a result/);
  });

  it("treats an error result as a failure even though the process exited zero", async () => {
    await expect(run("error-result")).rejects.toThrow(/reported an error: it broke/);
  });

  it("classifies a usage limit separately so the review can pause and resume", async () => {
    try {
      await run("limit-reached");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StageFailedError);
      expect((error as StageFailedError).errorClass).toBe("limit");
      expect((error as Error).message).toContain("usage limit");
    }
  });

  it("carries the reset time out of a limit failure when the CLI reports one", async () => {
    // Without this the pause has no end in sight and reads like a hang. The
    // CLI announces the limit state before it exits, so the value is there to
    // be kept.
    try {
      await run("limit-reached-with-reset");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as StageFailedError).detail.resetsAt).toBe(1785408600);
    }
  });

  it("leaves the reset time absent when the CLI did not say", async () => {
    try {
      await run("limit-reached");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as StageFailedError).detail.resetsAt).toBeUndefined();
    }
  });

  it("refuses a transcript with a hole in it", async () => {
    // A line that will not parse means output was lost; the results that did
    // arrive cannot be trusted to be all of them.
    try {
      await run("malformed");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as StageFailedError).errorClass).toBe("invalid_output");
      expect((error as Error).message).toContain("not valid JSON");
    }
  });

  it("treats a hang as a failure rather than waiting it out", async () => {
    try {
      await run("hang", { timeoutMs: 300 });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as StageFailedError).errorClass).toBe("timeout");
    }
  });

  it("reports a missing CLI clearly instead of silently doing nothing", async () => {
    try {
      await run("success", { claudePath: "/nonexistent/claude" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as StageFailedError).errorClass).toBe("spawn");
      expect((error as Error).message).toContain("Could not start");
    }
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    const promise = run("hang", { timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    try {
      await promise;
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as StageFailedError).errorClass).toBe("cancelled");
    }
  });
});

describe("the read-only guarantee", () => {
  it("passes when the CLI grants exactly the requested tools", async () => {
    const outcome = await run("success");
    expect(() => assertToolsAreReadOnly(outcome.toolsGranted, READ_ONLY_TOOLS)).not.toThrow();
  });

  it("fails when the CLI reports a wider toolset than was asked for", async () => {
    // The init event is the evidence: the claim is checked, not trusted.
    const outcome = await run("extra-tools");
    expect(() => assertToolsAreReadOnly(outcome.toolsGranted, READ_ONLY_TOOLS)).toThrow(
      /granted tools this stage did not allow: Bash, Edit/,
    );
  });
});

describe("what the engine actually invokes", () => {
  it("removes inherited session markers, or the CLI refuses to run nested", async () => {
    const recordPath = join(workDir, "record.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    process.env.CLAUDECODE = "1";
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
    try {
      await run("success");
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      expect(record.sawSessionMarker).toBe(false);
      expect(record.env.CLAUDECODE).toBeNull();
    } finally {
      delete process.env.CLAUDECODE;
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
    }
  });

  it("isolates the run from the reviewed repository's own configuration", async () => {
    const recordPath = join(workDir, "record.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    await run("success");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));

    // Verified against the real CLI: without these a repository's own
    // CLAUDE.md changes the reviewer's behaviour.
    const settingSourcesIndex = record.args.indexOf("--setting-sources");
    expect(settingSourcesIndex).toBeGreaterThan(-1);
    expect(record.args[settingSourcesIndex + 1]).toBe("user");
    expect(record.args).toContain("--strict-mcp-config");
  });

  it("passes a full model id, never a short alias", async () => {
    const recordPath = join(workDir, "record.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    await run("success");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const modelIndex = record.args.indexOf("--model");
    expect(record.args[modelIndex + 1]).toBe("claude-fable-5[1m]");
  });

  it("runs in the review worktree", async () => {
    const recordPath = join(workDir, "record.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    await run("success");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    expect(record.cwd).toBe(workDir);
  });

  it("resumes an existing session when asked", async () => {
    const recordPath = join(workDir, "record.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    await run("success", { resumeSessionId: "abc-123" });
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    expect(record.args).toContain("--resume");
    expect(record.args[record.args.indexOf("--resume") + 1]).toBe("abc-123");
  });
});

describe("transcript failures", () => {
  it("does not crash the process when the transcript cannot be written", async () => {
    // A stream error with no handler becomes an uncaught exception, which in
    // the running app would take down the server rather than fail one stage.
    // Writing to a path that is a directory fails deterministically.
    const outcome = await run("success", { logPath: workDir });

    expect(outcome.result.is_error).toBe(false);
    expect(outcome.transcriptError).toBeDefined();
  });
});

describe("reading the sign-in status", () => {
  it("answers rather than throwing when the CLI prints something unexpected", async () => {
    // This reads whatever binary TRYSQUARE_CLAUDE_PATH names. A status check
    // whose whole job is to answer a question calmly must not throw because
    // the thing it asked printed a stream of events instead of JSON.
    process.env.FAKE_CLAUDE_SCENARIO = "success";
    await expect(readAuthStatus({ claudePath: FAKE_CLI })).resolves.toEqual({
      loggedIn: false,
      usesSubscription: false,
    });
  }, 30_000);
});
