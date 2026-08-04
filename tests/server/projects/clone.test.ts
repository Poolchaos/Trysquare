/**
 * The background clone, driven through its failure paths.
 *
 * The success path is exercised by the routes journey; what is proven here is
 * the contract the route depends on: this function never rejects, because
 * nothing awaits it and an escaped rejection takes the server down. The one
 * realistic way to make it throw is deleting the project mid-clone, which is
 * a race a user can run any day a repository is large enough.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createProject, deleteProject, getProject } from "@/server/db/repositories/projects";
import { cloneProjectInBackground } from "@/server/projects/clone";
import { makeTestDb, type TestDb } from "../db/helpers";

let ctx: TestDb;
let db: Db;
let root: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  root = mkdtempSync(join(tmpdir(), "trysquare-clone-"));
});

afterEach(() => {
  ctx.cleanup();
  rmSync(root, { recursive: true, force: true });
});

function seedProject(): { id: string; clonePath: string } {
  const project = createProject(db, {
    name: "racer",
    gitUrl: "file:///tmp/does-not-matter.git",
    defaultBranch: "main",
    clonePath: "",
  });
  return { id: project.id, clonePath: join(root, "projects", project.id, "repo.git") };
}

it("clones, detects the default branch, and lands ready", async () => {
  const source = join(root, "source.git");
  execFileSync("git", ["init", "--bare", "--quiet", "--initial-branch=trunk", source]);
  const { id, clonePath } = seedProject();

  await cloneProjectInBackground(db, id, `file://${source}`, clonePath);

  const project = getProject(db, id);
  expect(project?.cloneStatus).toBe("ready");
  expect(project?.defaultBranch).toBe("trunk");
});

it("records a clone that failed, with git's own words", async () => {
  const { id, clonePath } = seedProject();

  await cloneProjectInBackground(db, id, `file://${join(root, "nowhere.git")}`, clonePath);

  const project = getProject(db, id);
  expect(project?.cloneStatus).toBe("failed");
  expect(project?.cloneError).toMatch(/nowhere\.git/);
});

it("resolves instead of rejecting when the project was deleted under it", async () => {
  // Before this contract existed, the status write threw ProjectNotFoundError,
  // the catch block's status write threw it again, and the second throw
  // escaped as an unhandled rejection from a promise nobody held.
  const { id, clonePath } = seedProject();
  mkdirSync(clonePath, { recursive: true });
  deleteProject(db, id);

  await expect(
    cloneProjectInBackground(db, id, "file:///tmp/never-reached.git", clonePath),
  ).resolves.toBeUndefined();

  // A project that no longer exists must not keep a repo directory behind.
  expect(existsSync(join(root, "projects", id))).toBe(false);
});
