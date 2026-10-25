/**
 * A stage settles only once its log is closed (CI run 40218250308): on
 * Windows an open file keeps its folder, and a caller removing the run's
 * folder next failed with ENOTEMPTY. The log's close is held back here, so
 * a stage that settles before it is seen to on every platform.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const closes = vi.hoisted(() => ({ done: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
      const stream = actual.createWriteStream(...args);
      const emit = stream.emit.bind(stream) as (event: string, ...rest: unknown[]) => boolean;
      (stream as unknown as { emit: typeof emit }).emit = (event, ...rest) => {
        if (event !== "close") return emit(event, ...rest);
        setTimeout(() => {
          closes.done += 1;
          emit("close", ...rest);
        }, 200);
        return true;
      };
      return stream;
    },
  };
});

const { runStage } = await import("@/server/engine/headless");

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));
let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "trysquare-log-closed-"));
  closes.done = 0;
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.FAKE_CLAUDE_SCENARIO;
});

describe("a stage's log", () => {
  it("is closed before the stage settles", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "success";
    await runStage({
      prompt: "review this change",
      systemPrompt: "You are a reviewer.",
      model: "claude-fable-5[1m]",
      outputFormat: "stream-json",
      cwd: workDir,
      timeoutMs: 10_000,
      logPath: join(workDir, "logs", "stage.log"),
      claudePath: FAKE_CLI,
    });
    expect(closes.done).toBe(1);
  });
});
