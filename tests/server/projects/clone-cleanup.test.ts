/**
 * The clean-up a clone does when its project was deleted under it. Deleting
 * a project mid-clone answers success and leaves this to remove the
 * directory (4845d0d), so a removal that fails here is the last word on a
 * directory left behind. It was swallowed (review of 5.11 to 5.13, D-137).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import { createProject, deleteProject } from "@/server/db/repositories/projects";
import { cloneProjectInBackground } from "@/server/projects/clone";
import { makeTestDb, type TestDb } from "../db/helpers";

vi.mock("@/server/gitops/repo", async (original) => ({
  ...(await original<typeof import("@/server/gitops/repo")>()),
  removeRepo: vi.fn(async () => {
    throw new Error("EBUSY: resource busy or locked, rmdir 'repo.git'");
  }),
}));

let ctx: TestDb;
let db: Db;
let root: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  root = mkdtempSync(join(tmpdir(), "trysquare-clone-cleanup-"));
});

afterEach(() => {
  ctx.cleanup();
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it("says so on stderr when the directory of a deleted project will not go", async () => {
  const project = createProject(db, {
    name: "deleted-mid-clone",
    gitUrl: "file:///tmp/does-not-matter.git",
    defaultBranch: "main",
    clonePath: "",
  });
  deleteProject(db, project.id);
  const said = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    cloneProjectInBackground(
      db,
      project.id,
      "file:///tmp/never-reached.git",
      join(root, "projects", project.id, "repo.git"),
    ),
  ).resolves.toBeUndefined();

  expect(said).toHaveBeenCalled();
  expect(String(said.mock.calls[0]?.join(" "))).toContain("EBUSY");
});
