/**
 * A review completed, then its checkout could not be removed (MVP 5.6, audit
 * A7). The decision was made and recorded, yet the route answered 500, so
 * the screen said completing had failed.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/review/service", async (original) => ({
  ...(await original<typeof import("@/server/review/service")>()),
  removeReviewWorktrees: vi.fn(async () => {
    throw new Error("EBUSY: resource busy or locked, rmdir 'worktree'");
  }),
}));

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-complete-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

describe("completing a review whose checkout will not go", () => {
  it("answers that it completed, and names the cleanup that failed", async () => {
    const { runtime } = await import("@/server/runtime");
    const { db } = runtime();
    const { createProject } = await import("@/server/db/repositories/projects");
    const { createReview, transitionReview, requireReview, readRunNotes } =
      await import("@/server/db/repositories/reviews");
    const project = createProject(db, {
      name: "app",
      gitUrl: "git@example.com:acme/app.git",
      defaultBranch: "main",
      clonePath: join(dataDir, "app.git"),
    });
    const review = createReview(db, {
      projectId: project.id,
      fromBranch: "feature/x",
      fromCommit: "a".repeat(40),
      intoBranch: "main",
      intoCommit: "b".repeat(40),
      mergeBaseCommit: "c".repeat(40),
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
    });
    for (const status of ["running", "verifying", "awaiting_confirmation"] as const) {
      transitionReview(db, review.id, status);
    }

    const { POST } = await import("@/app/api/reviews/[id]/complete/route");
    const response = await POST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: review.id }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { cleanupError?: string };
    expect(body.cleanupError).toContain("EBUSY");
    expect(requireReview(db, review.id).status).toBe("complete");
    const notes = readRunNotes(requireReview(db, review.id)).map((note) => note.message);
    expect(notes.join(" ")).toContain("could not be removed");
  });
});
