/**
 * The throwaway copy a project's own commands run in (WP-I, step 2), against
 * real git: the commit's files, and nothing it does reaching the clone a
 * review reads.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneBare, resolveBranch } from "@/server/gitops/repo";
import { makeThrowawayCopy, removeThrowawayCopy } from "@/server/gitops/copy";

let root: string;
let cloneDir: string;
let featureCommit: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-copy-"));
  const origin = join(root, "origin");
  execFileSync("git", ["init", "-q", "-b", "main", origin]);
  writeFileSync(join(origin, "app.ts"), "export const version = 1;\n");
  git(["add", "-A"], origin);
  git(["commit", "-qm", "initial"], origin);
  git(["checkout", "-qb", "feature/totals"], origin);
  writeFileSync(join(origin, "app.ts"), "export const version = 2;\n");
  git(["add", "-A"], origin);
  git(["commit", "-qm", "version two"], origin);
  git(["checkout", "-q", "main"], origin);
  cloneDir = join(root, "clone.git");
  await cloneBare(origin, cloneDir);
  featureCommit = await resolveBranch(cloneDir, "feature/totals");
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

describe("a throwaway copy", () => {
  it("holds the commit's files, detached at it", async () => {
    const copyDir = join(root, "copy-at-feature");
    await makeThrowawayCopy(cloneDir, featureCommit, copyDir);
    expect(readFileSync(join(copyDir, "app.ts"), "utf8")).toBe("export const version = 2;\n");
    expect(git(["rev-parse", "HEAD"], copyDir).trim()).toBe(featureCommit);
    expect(git(["status", "--porcelain"], copyDir)).toBe("");
  });

  it("shares nothing the commands can change with the clone a review reads", async () => {
    const copyDir = join(root, "copy-written");
    await makeThrowawayCopy(cloneDir, featureCommit, copyDir);
    const refsBefore = git(["for-each-ref"], cloneDir);
    // What an install and a build do: write files, and commit in the copy.
    writeFileSync(join(copyDir, "built.js"), "built");
    git(["add", "-A"], copyDir);
    git(["commit", "-qm", "written in the copy"], copyDir);
    expect(git(["for-each-ref"], cloneDir)).toBe(refsBefore);
    expect(git(["worktree", "list", "--porcelain"], cloneDir)).not.toContain("copy-written");
    expect(git(["rev-parse", "--is-bare-repository"], cloneDir).trim()).toBe("true");
    // No way back: no remote to push to, and no object file shared.
    expect(git(["remote"], copyDir).trim()).toBe("");
    const objects = readdirSync(join(copyDir, ".git", "objects"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(objects.length).toBeGreaterThan(0);
    expect(objects.filter((file) => statSync(file).nlink > 1)).toEqual([]);
  });

  it("is removed whole", async () => {
    const copyDir = join(root, "copy-removed");
    await makeThrowawayCopy(cloneDir, featureCommit, copyDir);
    await removeThrowawayCopy(copyDir);
    expect(existsSync(copyDir)).toBe(false);
  });
});
