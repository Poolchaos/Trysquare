/**
 * Fetches into one clone, one at a time (D-147).
 *
 * A Refresh on the new review screen reads the branches, asks the pre-flight
 * again and reads a ticked dependency's branches, and each runs a fetch. Two
 * at once into one bare clone, after a branch moved on the remote, failed
 * one of them with "cannot lock ref": the screen then said the remote could
 * not be reached, or replaced the pre-flight with git's error.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloneBare, fetchAll } from "@/server/gitops/repo";

let root: string;
let source: string;
let clone: string;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
const git = (args: string[], cwd: string) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

function commit(message: string) {
  writeFileSync(join(source, "file.txt"), `${message}\n`, "utf8");
  git(["add", "file.txt"], source);
  git(["commit", "--quiet", "-m", message], source);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-fetch-queue-"));
  source = join(root, "source");
  clone = join(root, "clone.git");
  execFileSync("git", ["init", "--quiet", "-b", "main", source], { env });
  commit("first");
  await cloneBare(pathToFileURL(source).href, clone);
}, 60_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("fetches into one clone", () => {
  it("run one after another, so neither fails when a branch has moved", async () => {
    for (let round = 0; round < 5; round += 1) {
      commit(`moved ${round}`);
      const results = await Promise.allSettled([fetchAll(clone), fetchAll(clone), fetchAll(clone)]);
      const failed = results.filter((result) => result.status === "rejected");
      expect(failed.map((result) => String((result as PromiseRejectedResult).reason))).toEqual([]);
      expect(git(["rev-parse", "main"], clone)).toBe(git(["rev-parse", "main"], source));
    }
  }, 120_000);

  it("wait for each other from another copy of the module", async () => {
    // The built app has two: the job manager's, in the instrumentation
    // bundle, fetches for a review's start, and the routes share another
    // (review of the D-147 fixes, as D-139 found for the manager).
    vi.resetModules();
    const other = await import("@/server/gitops/repo");
    expect(other.fetchAll).not.toBe(fetchAll);
    for (let round = 0; round < 5; round += 1) {
      commit(`moved again ${round}`);
      const results = await Promise.allSettled([fetchAll(clone), other.fetchAll(clone)]);
      const failed = results.filter((result) => result.status === "rejected");
      expect(failed.map((result) => String((result as PromiseRejectedResult).reason))).toEqual([]);
    }
  }, 120_000);

  it("still fetch after one fails, and pass on that one's failure", async () => {
    const elsewhere = join(root, "not-a-clone");
    const first = fetchAll(elsewhere);
    const second = fetchAll(clone);
    await expect(first).rejects.toThrow();
    await expect(second).resolves.toBeUndefined();
  }, 60_000);
});
