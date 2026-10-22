/**
 * Deleting everything while a review is made in another tab (D-181 item 5).
 *
 * The wipe lists the reviews, deletes them with awaits between, then deletes
 * each project. A review made during those awaits was never listed, so the
 * project's delete refused, unmapped, and the wipe answered a bare 500 half
 * done, with no word of what was already gone. In a file of its own: the
 * mock below applies to the whole file.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const after = vi.hoisted(() => ({ firstDelete: undefined as undefined | (() => void) }));

vi.mock("@/server/review/service", async (original) => {
  const actual = await original<typeof import("@/server/review/service")>();
  return {
    ...actual,
    deleteReviewEntirely: vi.fn(async (...args: Parameters<typeof actual.deleteReviewEntirely>) => {
      await actual.deleteReviewEntirely(...args);
      const hook = after.firstDelete;
      after.firstDelete = undefined;
      hook?.();
    }),
  };
});

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-wipe-race-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

it("stops with a 409 naming what it removed when a review is added mid-wipe", async () => {
  const { runtime } = await import("@/server/runtime");
  const { db } = runtime();
  const { createProject, listProjects } = await import("@/server/db/repositories/projects");
  const { createReview, listReviewsForProject } = await import("@/server/db/repositories/reviews");
  const project = createProject(db, {
    name: "app",
    gitUrl: "git@example.com:acme/app.git",
    defaultBranch: "main",
    clonePath: join(dataDir, "projects", "app", "repo.git"),
  });
  const draft = () =>
    createReview(db, {
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
  draft();
  let added: { id: string } | undefined;
  after.firstDelete = () => {
    added = draft();
  };

  const { DELETE } = await import("@/app/api/system/data/route");
  const stopped = await DELETE();
  expect(stopped.status).toBe(409);
  const body = (await stopped.json()) as {
    code: string;
    error: string;
    deleted: { projects: number; reviews: number; rulesets: number };
  };
  expect(body.code).toBe("ReviewAddedDuringWipe");
  expect(body.deleted).toEqual({ projects: 0, reviews: 1, rulesets: 0 });
  expect(body.error).toContain("Delete everything again");
  // The listed review went; the new one, and its project, stayed.
  expect(listProjects(db).map((row) => row.id)).toEqual([project.id]);
  expect(listReviewsForProject(db, project.id).map((row) => row.id)).toEqual([added!.id]);

  // Run again, it finishes the job.
  const finished = await DELETE();
  expect(finished.status).toBe(200);
  expect(listProjects(db)).toEqual([]);
});
