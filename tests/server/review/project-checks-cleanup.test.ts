/**
 * Removing a project's throwaway copy after its checks (audit finding S3):
 * a copy that will not go, held by something on Windows, is said and left
 * for a later run, not allowed to throw away the run that just finished,
 * nor to hide the error of one that failed. With them, what the run notes
 * say of the commands, which the same stand-in for the run reaches.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checksDir } from "@/lib/paths";
import { NO_CHECKS } from "@/lib/projects/checks";
import { readRunNotes, requireReview } from "@/server/db/repositories/reviews";
import { makeTestDb, seedProject, seedReview, type TestDb } from "../db/helpers";

const { removeThrowawayCopy, runProjectChecks } = vi.hoisted(() => ({
  removeThrowawayCopy: vi.fn<(dir: string) => Promise<void>>(),
  runProjectChecks: vi.fn(),
}));

vi.mock("@/server/gitops/copy", () => ({
  makeThrowawayCopy: async (_clone: string, _commit: string, copyDir: string) => {
    mkdirSync(copyDir, { recursive: true });
  },
  removeThrowawayCopy,
}));
vi.mock("@/server/projectrun/run", () => ({ runProjectChecks }));

const { describeCommand, runChecksForReview } = await import("@/server/review/project-checks");

const HELD = Object.assign(new Error("EBUSY: resource busy or locked, rmdir 'copy'"), {
  code: "EBUSY",
});

let ctx: TestDb;
let dataDir: string;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  reviewId = seedReview(ctx.db, seedProject(ctx.db).id).id;
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-checks-cleanup-"));
  removeThrowawayCopy.mockReset().mockRejectedValue(HELD);
  runProjectChecks.mockReset();
});

afterEach(() => {
  ctx.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

const asked = () => ({
  reviewId,
  dataDir,
  clonePath: join(dataDir, "clone.git"),
  commit: "a".repeat(40),
  checks: { ...NO_CHECKS, enabled: true, testCommand: "npm test" },
});

const FINISHED = {
  commands: [
    {
      step: "tests",
      command: "npm test",
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      durationMs: 1200,
      logPath: "tests.log",
      tail: "",
    },
  ],
  screenshots: [],
  screenshotsLeft: [],
  screenshotsScaled: [],
};

describe("a throwaway copy that will not be removed", () => {
  it("is tried again by a resume that keeps the finished run's result", async () => {
    // Review round 12: the note promised the next run would remove it, and
    // a resume on the same commit returned the kept result before any did.
    runProjectChecks.mockResolvedValue(FINISHED);
    await runChecksForReview(ctx.db, asked());
    removeThrowawayCopy.mockClear().mockResolvedValue(undefined);
    await runChecksForReview(ctx.db, asked());
    expect(runProjectChecks).toHaveBeenCalledTimes(1);
    expect(removeThrowawayCopy).toHaveBeenCalledWith(join(checksDir(dataDir, reviewId), "copy"));
  });

  it("leaves the finished run standing, and says where the copy is", async () => {
    runProjectChecks.mockResolvedValue({
      commands: [
        {
          step: "tests",
          command: "npm test",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          durationMs: 1200,
          logPath: join(dataDir, "tests.log"),
          tail: "",
        },
      ],
      screenshots: [],
      screenshotsLeft: [],
      screenshotsScaled: [],
    });
    const result = await runChecksForReview(ctx.db, asked());
    expect(result.commands.map((command) => command.exitCode)).toEqual([0]);
    const notes = readRunNotes(requireReview(ctx.db, reviewId)).map((note) => note.message);
    expect(notes.some((note) => note.startsWith("The throwaway copy at "))).toBe(true);
    expect(notes.some((note) => note.includes("EBUSY"))).toBe(true);
  });

  it("does not hide the error of a run that failed before it", async () => {
    runProjectChecks.mockRejectedValue(new Error("the commands could not start"));
    await expect(runChecksForReview(ctx.db, asked())).rejects.toThrow(
      "the commands could not start",
    );
  });
});

describe("what the run notes say of the project's commands", () => {
  const ended = {
    step: "tests" as const,
    command: "npm test",
    exitCode: null,
    timedOut: false,
    cancelled: false,
    durationMs: 1200,
    logPath: "/runs/checks/logs/tests.log",
    tail: "",
  };

  it("says a command that ended with no exit code had none", () => {
    // It read "failed with exit code null": a shell that never started, or a
    // signal the app did not send, leaves no code to name.
    expect(describeCommand(ended)).toBe(
      "Tests (npm test) ended with no exit code after 1.2s: it could not be started, or a " +
        "signal stopped it; its output is in /runs/checks/logs/tests.log.",
    );
    expect(describeCommand({ ...ended, exitCode: 1 })).toBe(
      "Tests (npm test) failed with exit code 1 in 1.2s; its output is in " +
        "/runs/checks/logs/tests.log.",
    );
  });

  it("says no PNG was found, not that the e2e saved no screenshot", async () => {
    // Only .png files are looked for, so an e2e that saved its screenshots
    // in another format saved some, and none was found.
    removeThrowawayCopy.mockReset().mockResolvedValue(undefined);
    runProjectChecks.mockResolvedValue({
      ...FINISHED,
      commands: [{ ...ended, step: "e2e", command: "npm run e2e", exitCode: 0 }],
    });
    await runChecksForReview(ctx.db, {
      ...asked(),
      checks: {
        ...NO_CHECKS,
        enabled: true,
        e2eCommand: "npm run e2e",
        screenshotDir: "e2e/shots",
      },
    });
    const notes = readRunNotes(requireReview(ctx.db, reviewId)).map((note) => note.message);
    expect(notes).toContain(
      "No PNG screenshot was found in e2e/shots, so the design was not checked.",
    );
  });
});
