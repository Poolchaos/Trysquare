/**
 * Engine tests run against a fake CLI, so they are hermetic and consume no
 * model usage. The fake's output shapes were copied from a real transcript,
 * so it fails the way the real binary fails.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
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
import { SHUTDOWN } from "@/lib/domain/shutdown";

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

  it("sends the system prompt in a file beside the transcript, not on the command line", async () => {
    // Windows caps a whole command line at 32,767 characters, and a stage's
    // system prompt grows with the ruleset.
    const systemPrompt = `You are a reviewer.\n${"Rule text. ".repeat(4_000)}`;
    const recordPath = join(workDir, "record-system.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    await run("success", { systemPrompt });

    const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
      args: string[];
      systemPrompt: string | null;
    };
    expect(record.systemPrompt).toBe(systemPrompt);
    expect(record.args).not.toContain("--system-prompt");
    expect(record.args.some((arg) => arg.includes("Rule text."))).toBe(false);
    const file = record.args[record.args.indexOf("--system-prompt-file") + 1] ?? "";
    expect(file.startsWith(join(workDir, "logs", "stage.system-prompt."))).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(systemPrompt);
    delete process.env.FAKE_CLAUDE_RECORD;
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

describe("the evidence the read-only check needs", () => {
  it("fails a stage whose CLI never said which tools it granted", async () => {
    // An empty granted list passes the read-only check, so a missing init
    // event used to mean the check was skipped without anyone knowing.
    const error = await run("no-init").catch((thrown: unknown) => thrown);
    expect((error as StageFailedError).errorClass).toBe("invalid_output");
    expect((error as Error).message).toMatch(/no init event/);
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

  it("refuses a CLI older than the version reviews need, before running anything", async () => {
    // A copy of the fake under another name, so the version answer cached for
    // the shared fake by earlier tests does not stand in for this one.
    const oldCli = join(workDir, "old-claude.mjs");
    copyFileSync(FAKE_CLI, oldCli);
    const recordPath = join(workDir, "record-old.json");
    process.env.FAKE_CLAUDE_VERSION = "2.1.71";
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    try {
      await expect(run("success", { claudePath: oldCli })).rejects.toThrow(
        /version 2\.1\.71; reviews need 2\.1\.301/,
      );
      expect(existsSync(recordPath)).toBe(false);
    } finally {
      delete process.env.FAKE_CLAUDE_VERSION;
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

describe("stopping a stage", () => {
  // The caller deletes the worktree as soon as a stage settles, and Windows
  // will not delete a live process's cwd, so a stage must not settle while its
  // process is still running.
  const pidFile = () => join(workDir, "pid");
  const isRunning = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const startedPid = async () => {
    for (let attempt = 0; attempt < 100 && !existsSync(pidFile()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return Number(readFileSync(pidFile(), "utf8"));
  };

  beforeEach(() => {
    process.env.FAKE_CLAUDE_PID_FILE = pidFile();
  });
  afterEach(() => {
    delete process.env.FAKE_CLAUDE_PID_FILE;
  });

  it("settles a cancel only once the process has exited", async () => {
    const controller = new AbortController();
    const outcome = run("hang", { timeoutMs: 10_000, signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    const pid = await startedPid();
    controller.abort();
    const error = await outcome;

    expect((error as StageFailedError).errorClass).toBe("cancelled");
    expect(isRunning(pid)).toBe(false);
  });

  it("settles a timeout only once the process has exited", async () => {
    const outcome = run("hang", { timeoutMs: 400 }).catch((error: unknown) => error);
    const pid = await startedPid();
    const error = await outcome;

    expect((error as StageFailedError).errorClass).toBe("timeout");
    expect(isRunning(pid)).toBe(false);
  });

  it("kills a CLI that ignores the request to stop", async () => {
    const controller = new AbortController();
    const outcome = run("hang-ignoring-sigterm", {
      timeoutMs: 10_000,
      signal: controller.signal,
      stopGraceMs: 300,
    }).catch((error: unknown) => error);
    const pid = await startedPid();
    const asked = Date.now();
    controller.abort();
    const error = await outcome;

    expect((error as StageFailedError).errorClass).toBe("cancelled");
    expect(isRunning(pid)).toBe(false);
    // Settled by the kill, not by the give-up timer a further 300ms on.
    expect(Date.now() - asked).toBeLessThan(5_000);
  });
});

describe("a stop that arrives before the CLI has started", () => {
  it("starts nothing when the server is shutting down", async () => {
    // The abort listener is attached late, after the version check and the
    // prompt file, so a shutdown in between fired no event. Spawning then
    // would leave a CLI running and spending after the server exits.
    const recordPath = join(workDir, "record-shutdown.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    const controller = new AbortController();
    controller.abort(SHUTDOWN);

    const error = await run("success", { signal: controller.signal }).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as StageFailedError).errorClass).toBe("cancelled");
    expect(existsSync(recordPath)).toBe(false);
  });

  it("still runs a stage a person cancelled in that window, as decided", async () => {
    // The 2026-07-30 W4 decision: the stage in flight completes and is
    // checkpointed, so a cancel loses nothing already paid for.
    const controller = new AbortController();
    controller.abort();
    const outcome = await run("success", { signal: controller.signal });
    expect(outcome.result.is_error).toBe(false);
  });
});

describe("a model alias at launch", () => {
  it("is refused before anything starts, whatever stored it", async () => {
    const recordPath = join(workDir, "record-alias.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    const error = await run("success", { model: "opus" }).catch((thrown: unknown) => thrown);
    expect((error as StageFailedError).errorClass).toBe("spawn");
    expect((error as Error).message).toMatch(/"opus" does not name a single model/);
    expect(existsSync(recordPath)).toBe(false);
  });
});

describe("a launch the operating system refuses", () => {
  it("fails the stage as a spawn failure instead of escaping as a plain error", async () => {
    // A command line over every platform's limit: 32,767 characters for the
    // whole line on Windows, 128KB for one argument on Linux, about 1MB for
    // all of them together on macOS, which ran a 300KB one (CI, 2026-10-16).
    // A full id in form, so the alias check passes it and the OS is what refuses.
    const error = await run("success", { model: `claude-fable-5-${"m".repeat(2_000_000)}` }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(StageFailedError);
    expect((error as StageFailedError).errorClass).toBe("spawn");
    expect((error as Error).message).toContain("Could not start");
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
  it("removes inherited session markers and keeps a person's own settings (D-120)", async () => {
    // A stage run from inside a Claude Code session would otherwise run as
    // that session's child.
    const recordPath = join(workDir, "record.json");
    process.env.FAKE_CLAUDE_RECORD = recordPath;
    const set = {
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_PID: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "a-token",
    };
    // Put back as found: a run started from inside a session has some of
    // these already.
    const previous = Object.fromEntries(Object.keys(set).map((name) => [name, process.env[name]]));
    Object.assign(process.env, set);
    try {
      await run("success");
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      expect(record.claudeVariables).not.toContain("CLAUDECODE");
      expect(record.claudeVariables).not.toContain("CLAUDE_CODE_ENTRYPOINT");
      expect(record.claudeVariables).not.toContain("CLAUDE_PID");
      expect(record.claudeVariables).toContain("CLAUDE_CODE_OAUTH_TOKEN");
      expect(record.env.CLAUDECODE).toBeNull();
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
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
    // Compared as real paths: macOS's temp directory is a symlink into
    // /private, and a process reports where it really is.
    expect(realpathSync.native(record.cwd)).toBe(realpathSync.native(workDir));
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
    // Writing to a path that is a directory fails deterministically. Inside
    // the work directory, so the system prompt file beside it is cleaned up.
    const logPath = join(workDir, "logs-is-a-directory");
    mkdirSync(logPath);
    const outcome = await run("success", { logPath });

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
