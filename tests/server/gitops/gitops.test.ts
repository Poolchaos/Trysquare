/**
 * Integration tests against a real git binary and real repositories on disk.
 * Nothing here is mocked: the guarantees being tested are about what git
 * actually does, so a fake would only test my beliefs about it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import {
  ChangeSetMismatchError,
  checkChangeSet,
  cloneBare,
  detectDefaultBranch,
  diffText,
  divergence,
  fileAtCommit,
  isAncestor,
  listBranches,
  mergeBase,
  readChangeSet,
  resolveCommit,
} from "@/server/gitops/repo";
import {
  WorktreeModifiedError,
  addWorktree,
  assertWorktreeClean,
  removeWorktree,
  worktreeBaseline,
  worktreeChanges,
  worktreeCommit,
} from "@/server/gitops/worktree";

let root: string;
let originDir: string;
let cloneDir: string;

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
  root = mkdtempSync(join(tmpdir(), "trysquare-gitops-"));
  originDir = join(root, "origin");
  cloneDir = join(root, "clone.git");

  execFileSync("git", ["init", "-q", "-b", "main", originDir]);
  git(["config", "user.email", "test@example.invalid"], originDir);
  git(["config", "user.name", "Test"], originDir);

  writeFileSync(join(originDir, "app.ts"), "export const version = 1;\n");
  git(["add", "-A"], originDir);
  git(["commit", "-qm", "initial"], originDir);

  // A feature branch that diverges after one more commit on main.
  git(["checkout", "-qb", "feature/totals"], originDir);
  writeFileSync(join(originDir, "app.ts"), "export const version = 1;\nexport const total = 0;\n");
  writeFileSync(join(originDir, "new-file.ts"), "export const added = true;\n");
  git(["add", "-A"], originDir);
  git(["commit", "-qm", "add totals"], originDir);

  git(["checkout", "-q", "main"], originDir);
  writeFileSync(join(originDir, "unrelated.ts"), "export const other = 1;\n");
  git(["add", "-A"], originDir);
  git(["commit", "-qm", "unrelated work on main"], originDir);

  await cloneBare(originDir, cloneDir);
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("cloning", () => {
  it("produces a bare repository, so there is no checkout to damage", () => {
    const isBare = git(["rev-parse", "--is-bare-repository"], cloneDir).trim();
    expect(isBare).toBe("true");
  });

  it("fetches every branch, not just the default one", async () => {
    const branches = (await listBranches(cloneDir)).map((b) => b.name).sort();
    expect(branches).toEqual(["feature/totals", "main"]);
  });

  it("reports each branch with the commit and subject the UI needs", async () => {
    const branches = await listBranches(cloneDir);
    const feature = branches.find((b) => b.name === "feature/totals");
    expect(feature?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(feature?.subject).toBe("add totals");
    expect(feature?.committedAt).not.toBe("");
  });

  it("detects the default branch from the repository itself", async () => {
    expect(await detectDefaultBranch(cloneDir)).toBe("main");
  });
});

describe("comparing branches", () => {
  it("finds the commit the branches diverged from", async () => {
    const base = await mergeBase(cloneDir, "main", "feature/totals");
    const mainTip = await resolveCommit(cloneDir, "main");
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    // The merge base is the shared ancestor, not the tip of main.
    expect(base).not.toBe(mainTip);
  });

  it("counts how far a branch is ahead and behind", async () => {
    const counts = await divergence(cloneDir, "feature/totals", "main");
    expect(counts).toEqual({ ahead: 1, behind: 1 });
  });

  it("diffs against the merge base, so unrelated work on the target is excluded", async () => {
    const base = await mergeBase(cloneDir, "main", "feature/totals");
    const patch = await diffText(cloneDir, base, "feature/totals");
    const files = parseUnifiedDiff(patch)
      .map((f) => f.path)
      .sort();

    // unrelated.ts landed on main after the split and must not appear.
    expect(files).toEqual(["app.ts", "new-file.ts"]);
  });

  it("knows whether a branch has been merged into the target", async () => {
    const featureTip = await resolveCommit(cloneDir, "feature/totals");
    expect(await isAncestor(cloneDir, featureTip, "main")).toBe(false);

    const base = await mergeBase(cloneDir, "main", "feature/totals");
    expect(await isAncestor(cloneDir, base, "main")).toBe(true);
  });

  it("reads a file as it was before the change, for reviewing deletions", async () => {
    const base = await mergeBase(cloneDir, "main", "feature/totals");
    expect(await fileAtCommit(cloneDir, base, "app.ts")).toBe("export const version = 1;\n");
    // A file that did not exist yet is absent, not an error.
    expect(await fileAtCommit(cloneDir, base, "new-file.ts")).toBeNull();
  });
});

describe("a diff the user's own git config would reshape (D-108)", () => {
  // The app's git reads the user's global config. An external diff tool
  // replaced the whole diff with its own output, so the parser found nothing
  // and the review covered nothing; noprefix stripped the a/ and b/ the
  // parser reads paths by.
  let previous: string | undefined;

  beforeAll(() => {
    const config = join(root, "hostile-global.gitconfig");
    writeFileSync(
      config,
      "[diff]\n\texternal = echo EXTERNAL-TOOL-OUTPUT\n\tnoprefix = true\n\tmnemonicPrefix = true\n",
    );
    previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = config;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });

  it("is still git's own unified diff, with the prefixes the parser reads", async () => {
    const base = await mergeBase(cloneDir, "main", "feature/totals");
    const head = await resolveCommit(cloneDir, "feature/totals");
    const patch = await diffText(cloneDir, base, head);
    expect(patch).not.toContain("EXTERNAL-TOOL-OUTPUT");
    expect(patch).toContain("diff --git a/app.ts b/app.ts");
  });

  it("yields every changed file, checked against git's own list", async () => {
    const base = await mergeBase(cloneDir, "main", "feature/totals");
    const head = await resolveCommit(cloneDir, "feature/totals");
    const { files } = await readChangeSet(cloneDir, base, head);
    expect(files.map((file) => file.path).sort()).toEqual(["app.ts", "new-file.ts"]);
  });
});

describe("a parsed diff that disagrees with git's list of changed files (D-108)", () => {
  const parsed = (...paths: string[]) => paths.map((path) => ({ path }));

  it("is accepted when the two name the same files", () => {
    expect(() => checkChangeSet(parsed("a.ts", "b.ts"), ["b.ts", "a.ts"])).not.toThrow();
  });

  it("is refused when the diff lost a file, naming it", () => {
    // What a reshaped diff looks like from here: fewer files than changed,
    // and a review that would have read as complete.
    expect(() => checkChangeSet(parsed("a.ts"), ["a.ts", "b.ts"])).toThrow(ChangeSetMismatchError);
    expect(() => checkChangeSet(parsed(), ["a.ts", "b.ts"])).toThrow(/b\.ts/);
  });

  it("is refused when the diff names a file git did not list", () => {
    expect(() => checkChangeSet(parsed("a.ts", "x.ts"), ["a.ts"])).toThrow(/x\.ts/);
  });
});

describe("review worktrees", () => {
  it("checks out the exact commit, detached from any branch", async () => {
    const dir = join(root, "wt-detached");
    const commit = await resolveCommit(cloneDir, "feature/totals");
    await addWorktree(cloneDir, dir, commit);

    expect(await worktreeCommit(dir)).toBe(commit);
    // Detached: no branch can be advanced by anything happening in here.
    const branch = git(["branch", "--show-current"], dir).trim();
    expect(branch).toBe("");

    await removeWorktree(cloneDir, dir);
  });

  it("stays pinned even when the branch moves underneath it", async () => {
    const dir = join(root, "wt-pinned");
    const pinned = await resolveCommit(cloneDir, "feature/totals");
    await addWorktree(cloneDir, dir, pinned);

    // Someone pushes to the branch while the review is running.
    git(["checkout", "-q", "feature/totals"], originDir);
    writeFileSync(join(originDir, "late.ts"), "export const late = 1;\n");
    git(["add", "-A"], originDir);
    git(["commit", "-qm", "pushed during the review"], originDir);
    git(["checkout", "-q", "main"], originDir);
    await import("@/server/gitops/repo").then((m) => m.fetchAll(cloneDir));

    // The review still describes the commit it started on.
    expect(await worktreeCommit(dir)).toBe(pinned);
    expect(await resolveCommit(cloneDir, "feature/totals")).not.toBe(pinned);

    await removeWorktree(cloneDir, dir);
  });

  it("reports a clean worktree as clean", async () => {
    const dir = join(root, "wt-clean");
    await addWorktree(cloneDir, dir, await resolveCommit(cloneDir, "main"));

    expect(await worktreeChanges(dir)).toEqual([]);
    await expect(assertWorktreeClean(dir)).resolves.toBeUndefined();

    await removeWorktree(cloneDir, dir);
  });

  it("detects a modified file, which is the guarantee that code is read-only", async () => {
    const dir = join(root, "wt-dirty");
    await addWorktree(cloneDir, dir, await resolveCommit(cloneDir, "main"));

    writeFileSync(join(dir, "app.ts"), "export const version = 999;\n");
    await expect(assertWorktreeClean(dir)).rejects.toThrow(WorktreeModifiedError);

    await removeWorktree(cloneDir, dir);
  });

  it("detects a file that was merely added, not just edits to tracked files", async () => {
    const dir = join(root, "wt-untracked");
    await addWorktree(cloneDir, dir, await resolveCommit(cloneDir, "main"));

    // A model writing a scratch file would be just as much a violation.
    writeFileSync(join(dir, "notes.md"), "scratch\n");
    await expect(assertWorktreeClean(dir)).rejects.toThrow(/notes\.md/);

    await removeWorktree(cloneDir, dir);
  });

  it("supports two repositories checked out side by side for a linked review", async () => {
    const parent = join(root, "linked");
    const appDir = join(parent, "app");
    const coreDir = join(parent, "shared-core");

    await addWorktree(cloneDir, appDir, await resolveCommit(cloneDir, "feature/totals"));
    await addWorktree(cloneDir, coreDir, await resolveCommit(cloneDir, "main"));

    // Both readable from one working directory, which is what the model gets.
    expect(readFileSync(join(appDir, "app.ts"), "utf8")).toContain("total");
    expect(readFileSync(join(coreDir, "unrelated.ts"), "utf8")).toContain("other");
    await assertWorktreeClean(appDir);
    await assertWorktreeClean(coreDir);

    await removeWorktree(cloneDir, appDir);
    await removeWorktree(cloneDir, coreDir);
  });

  describe("a checkout git reports changed before anything touched it (D-107)", () => {
    // A file committed with CRLF, then `* text eol=lf`: git normalises it on
    // checkout, so a fresh worktree already reads ` M`. The end-of-review
    // check failed every such review, after every stage was paid for.
    let normalisingClone: string;

    beforeAll(async () => {
      const origin = join(root, "normalising-origin");
      execFileSync("git", ["init", "-q", "-b", "main", origin]);
      git(["config", "core.autocrlf", "false"], origin);
      writeFileSync(join(origin, "crlf.txt"), "line one\r\nline two\r\n");
      git(["add", "crlf.txt"], origin);
      git(["commit", "-qm", "a file with CRLF"], origin);
      writeFileSync(join(origin, ".gitattributes"), "* text eol=lf\n");
      git(["add", ".gitattributes"], origin);
      git(["commit", "-qm", "normalise line endings"], origin);
      normalisingClone = join(root, "normalising.git");
      await cloneBare(origin, normalisingClone);
    }, 60_000);

    async function freshCheckout(name: string): Promise<string> {
      const dir = join(root, name);
      await addWorktree(normalisingClone, dir, await resolveCommit(normalisingClone, "main"));
      return dir;
    }

    it("is reported changed straight after checkout, which the strict check refuses", async () => {
      const dir = await freshCheckout("wt-normalising-strict");
      expect(await worktreeChanges(dir)).toEqual([" M crlf.txt"]);
      await expect(assertWorktreeClean(dir)).rejects.toThrow(WorktreeModifiedError);
      await removeWorktree(normalisingClone, dir);
    });

    it("passes against what it reported at checkout, when nothing has touched it", async () => {
      const dir = await freshCheckout("wt-normalising-baseline");
      const baseline = await worktreeBaseline(dir);
      expect(baseline.changes).toEqual([" M crlf.txt"]);
      await expect(assertWorktreeClean(dir, baseline)).resolves.toBeUndefined();
      await removeWorktree(normalisingClone, dir);
    });

    it("still catches a write to the file that was already reported changed", async () => {
      // The status line is the same before and after, so only the content
      // recorded at checkout can tell.
      const dir = await freshCheckout("wt-normalising-written");
      const baseline = await worktreeBaseline(dir);
      writeFileSync(join(dir, "crlf.txt"), "line one\nline two\nline three\n");
      await expect(assertWorktreeClean(dir, baseline)).rejects.toThrow(/crlf\.txt/);
      await removeWorktree(normalisingClone, dir);
    });

    it("still catches a new file", async () => {
      const dir = await freshCheckout("wt-normalising-added");
      const baseline = await worktreeBaseline(dir);
      writeFileSync(join(dir, "notes.md"), "scratch\n");
      await expect(assertWorktreeClean(dir, baseline)).rejects.toThrow(/notes\.md/);
      await removeWorktree(normalisingClone, dir);
    });
  });

  it("leaves no worktree registered after removal", async () => {
    const dir = join(root, "wt-removed");
    await addWorktree(cloneDir, dir, await resolveCommit(cloneDir, "main"));
    await removeWorktree(cloneDir, dir);

    const list = git(["worktree", "list"], cloneDir);
    expect(list).not.toContain("wt-removed");
  });
});
