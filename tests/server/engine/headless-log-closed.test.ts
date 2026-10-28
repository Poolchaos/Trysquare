/**
 * A stage settles only once its log is closed (CI run 40218250308): on
 * Windows an open file keeps its folder, and a caller removing the run's
 * folder next failed with ENOTEMPTY. The log's close is held back here, so
 * a stage that settles before it is seen to on every platform: one that
 * ran, one the server stopped before it began, and one cancelled mid-run
 * (review round 15).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Counted per test: a close held back by one test landed in the next, and
// one regression read as two.
const closes = vi.hoisted(() => ({ done: 0, test: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
      const stream = actual.createWriteStream(...args);
      const openedIn = closes.test;
      const emit = stream.emit.bind(stream) as (event: string, ...rest: unknown[]) => boolean;
      (stream as unknown as { emit: typeof emit }).emit = (event, ...rest) => {
        if (event !== "close") return emit(event, ...rest);
        setTimeout(() => {
          if (openedIn === closes.test) closes.done += 1;
          emit("close", ...rest);
        }, 200);
        return true;
      };
      return stream;
    },
  };
});

const { runStage, StageFailedError } = await import("@/server/engine/headless");
const { SHUTDOWN } = await import("@/lib/domain/shutdown");

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));
let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "trysquare-log-closed-"));
  closes.done = 0;
  closes.test += 1;
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.FAKE_CLAUDE_SCENARIO;
});

function stage(scenario: string, signal?: AbortSignal) {
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
    ...(signal ? { signal } : {}),
  });
}

/** The closes seen as the stage settled, and why it failed. */
async function failed(running: Promise<unknown>) {
  return running.then(
    () => ({ closes: closes.done, error: undefined }),
    (error: unknown) => ({ closes: closes.done, error }),
  );
}

describe("a stage's log", () => {
  it("is closed before the stage settles", async () => {
    await stage("success");
    expect(closes.done).toBe(1);
  });

  it("is closed before a stage the server stopped first settles", async () => {
    const stopping = new AbortController();
    stopping.abort(SHUTDOWN);
    const settled = await failed(stage("success", stopping.signal));
    expect(settled.error).toBeInstanceOf(StageFailedError);
    expect((settled.error as InstanceType<typeof StageFailedError>).errorClass).toBe("cancelled");
    expect(settled.closes).toBe(1);
  });

  it("is closed before a stage cancelled mid-run settles", async () => {
    const cancel = new AbortController();
    const running = failed(stage("hang", cancel.signal));
    // Cancelled once the CLI has written its first line, so it was running.
    const log = join(workDir, "logs", "stage.log");
    await vi.waitFor(() => expect(readFileSync(log, "utf8")).toContain('"init"'), {
      timeout: 10_000,
    });
    cancel.abort();
    const settled = await running;
    expect((settled.error as InstanceType<typeof StageFailedError>).errorClass).toBe("cancelled");
    expect(settled.closes).toBe(1);
  });
});
