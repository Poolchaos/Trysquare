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
    // The same clone, so the second waits behind the first: one into another
    // clone never queued, and the test passed with the queue passing a
    // failure on to every fetch behind it (review of the D-147 fixes).
    vi.resetModules();
    vi.doMock("@/server/gitops/run", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/server/gitops/run")>();
      let calls = 0;
      return {
        ...actual,
        git: (...args: Parameters<typeof actual.git>) =>
          (calls += 1) === 1
            ? Promise.reject(new Error("the first fetch fails"))
            : actual.git(...args),
      };
    });
    try {
      const queued = await import("@/server/gitops/repo");
      commit("moved after a failure");
      const first = queued.fetchAll(clone);
      const second = queued.fetchAll(clone);
      await expect(first).rejects.toThrow("the first fetch fails");
      await expect(second).resolves.toBeUndefined();
      expect(git(["rev-parse", "main"], clone)).toBe(git(["rev-parse", "main"], source));
    } finally {
      vi.doUnmock("@/server/gitops/run");
    }
  }, 60_000);
});
