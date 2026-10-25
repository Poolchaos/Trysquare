/**
 * Removing a project's throwaway copy after its checks (audit finding S3):
 * a copy that will not go, held by something on Windows, is said and left
 * for the next run, not allowed to throw away the run that just finished,
 * nor to hide the error of one that failed.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const { runChecksForReview } = await import("@/server/review/project-checks");

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

describe("a throwaway copy that will not be removed", () => {
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
