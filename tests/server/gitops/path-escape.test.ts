/**
 * A repository can hold tree entries git never writes to a checkout, and a
 * path is only ever used here by joining it onto a directory. These build
 * such entries with git's own plumbing, the way a hostile branch would, and
 * drive the real bundle builder over them (MVP-PLAN 4.8).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnsafeRepoPathError } from "@/lib/git/repo-path";
import { buildBundle } from "@/server/gitops/bundle";

let root: string;
let repo: string;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};
const git = (args: string[], input?: string) =>
  execFileSync("git", args, { cwd: repo, env, encoding: "utf8", input }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trysquare-escape-"));
  repo = join(root, "deep", "er", "repo.git");
  execFileSync("git", ["init", "-q", "--bare", repo]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A commit whose tree holds exactly these entries, built without a checkout. */
function commitWithTree(entries: string, parent?: string): string {
  const tree = git(["mktree"], entries);
  return git(["commit-tree", tree, "-m", "x", ...(parent ? ["-p", parent] : [])]);
}

function blob(text: string): string {
  return git(["hash-object", "-w", "--stdin"], text);
}

/** Every file under a directory, so a write outside the bundle is visible. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function bundleOf(base: string, head: string) {
  return buildBundle({
    bundleDir: join(root, "deep", "er", "runs", "r1", "bundle"),
    repos: [
      { role: "primary", slug: "app", repoDir: repo, mergeBaseCommit: base, headCommit: head },
    ],
  });
}

describe("a deleted file whose path would leave the bundle", () => {
  it("is refused when the name holds backslashes, and nothing is written outside", async () => {
    // The audit's case: git accepts this name, and on Windows path.join
    // treated each backslash as a separator and wrote the blob four levels up.
    const payload = blob("PAYLOAD\n");
    const keep = blob("ok\n");
    const base = commitWithTree(
      `100644 blob ${payload}\t..\\..\\..\\..\\escaped.txt\n100644 blob ${keep}\tkeep.txt\n`,
    );
    const head = commitWithTree(`100644 blob ${keep}\tkeep.txt\n`, base);
    const before = filesUnder(root);

    await expect(bundleOf(base, head)).rejects.toBeInstanceOf(UnsafeRepoPathError);
    const written = filesUnder(root).filter((file) => !before.includes(file));
    expect(written.filter((file) => file.endsWith("escaped.txt"))).toEqual([]);
  });

  it("is refused when the tree holds a directory literally named ..", async () => {
    // The form that escapes on every platform: git stores the entry, warning
    // only in fsck, and the path reads ../x.txt.
    const payload = blob("PAYLOAD\n");
    const inner = git(["mktree"], `100644 blob ${payload}\tx.txt\n`);
    const keep = blob("ok\n");
    const base = commitWithTree(`040000 tree ${inner}\t..\n100644 blob ${keep}\tkeep.txt\n`);
    const head = commitWithTree(`100644 blob ${keep}\tkeep.txt\n`, base);

    await expect(bundleOf(base, head)).rejects.toBeInstanceOf(UnsafeRepoPathError);
    expect(filesUnder(join(root, "deep", "er", "runs")).some((f) => f.endsWith("x.txt"))).toBe(
      false,
    );
  });
});
