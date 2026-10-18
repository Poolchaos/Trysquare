/**
 * Integration tests against a real git binary and real repositories on disk.
 * Nothing here is mocked: the guarantees being tested are about what git
 * actually does, so a fake would only test my beliefs about it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { opaqueChanges } from "@/lib/git/opaque";
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
  resolveBranch,
  resolveCommit,
} from "@/server/gitops/repo";
import {
  CheckoutMismatchError,
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

function git(args: string[], cwd: string, input?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
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

describe("diff settings that change which lines or entries the diff holds (D-110)", () => {
  // Two more the review of 4.15 found. diff.submodule=log prints a summary
  // instead of a diff section, so the cross-check refused every review that
  // moved a submodule; diff.ignoreSubmodules=all drops the submodule from the
  // diff and the list alike, so it passed with the change left out. And
  // diff.algorithm changes which lines a hunk holds, so what the sweep finds
  // in the same two commits depended on the user's config.
  let clone: string;
  let base: string;
  let head: string;
  let previous: string | undefined;

  const OLD = [
    "#include <stdio.h>",
    "",
    "// Frobs foo heartily",
    "int frobnitz(int foo)",
    "{",
    "    int i;",
    "    for(i = 0; i < 10; i++)",
    "    {",
    '        printf("Your answer is: ");',
    '        printf("%d", foo);',
    "    }",
    "}",
    "",
    "int fact(int n)",
    "{",
    "    if(n > 1)",
    "    {",
    "        return fact(n-1) * n;",
    "    }",
    "    return 1;",
    "}",
    "",
    "int main(int argc, char **argv)",
    "{",
    "    frobnitz(fact(10));",
    "}",
    "",
  ].join("\n");
  const NEW = [
    "#include <stdio.h>",
    "",
    "int fib(int n)",
    "{",
    "    if(n > 2)",
    "    {",
    "        return fib(n-1) + fib(n-2);",
    "    }",
    "    return 1;",
    "}",
    "",
    "// Frobs foo heartily",
    "int frobnitz(int foo)",
    "{",
    "    int i;",
    "    for(i = 0; i < 10; i++)",
    "    {",
    '        printf("%d", foo);',
    "    }",
    "}",
    "",
    "int main(int argc, char **argv)",
    "{",
    "    frobnitz(fib(10));",
    "}",
    "",
  ].join("\n");

  function withGlobalConfig(text: string): void {
    const path = join(root, `global-${text.length}-${Date.now()}.gitconfig`);
    writeFileSync(path, text);
    process.env.GIT_CONFIG_GLOBAL = path;
  }

  beforeAll(async () => {
    previous = process.env.GIT_CONFIG_GLOBAL;
    const origin = join(root, "settings-origin");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    git(["config", "core.autocrlf", "false"], origin);
    writeFileSync(join(origin, "f.c"), OLD);
    git(["add", "f.c"], origin);
    git(["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},sub`], origin);
    git(["commit", "-qm", "old"], origin);
    git(["checkout", "-qb", "feature"], origin);
    writeFileSync(join(origin, "f.c"), NEW);
    git(["add", "f.c"], origin);
    git(["update-index", "--cacheinfo", `160000,${"2".repeat(40)},sub`], origin);
    git(["commit", "-qm", "new"], origin);
    clone = join(root, "settings.git");
    withGlobalConfig("");
    await cloneBare(origin, clone);
    base = await mergeBase(clone, "main", "feature");
    head = await resolveCommit(clone, "feature");
  }, 60_000);

  afterAll(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });

  it("keeps a moved submodule pointer in the diff and the list, whatever they say", async () => {
    withGlobalConfig("[diff]\n\tsubmodule = log\n\tignoreSubmodules = all\n");
    const { files } = await readChangeSet(clone, base, head);
    expect(files.map((file) => file.path).sort()).toEqual(["f.c", "sub"]);
  });

  it("reads the same diff whatever diff.algorithm says", async () => {
    withGlobalConfig("");
    const plain = await diffText(clone, base, head);
    withGlobalConfig("[diff]\n\talgorithm = patience\n");
    expect(await diffText(clone, base, head)).toBe(plain);
  });
});

describe("a Git LFS pointer as git diffs it (D-119 review)", () => {
  const SPEC = "version https://git-lfs.github.com/spec/v1";
  const pointerFor = (oid: string, size: number) => `${SPEC}\noid sha256:${oid}\nsize ${size}\n`;

  it("is named when only its oid and size moved, and a document quoting one is not", async () => {
    // Real diff output, so the three lines of context the detector counts on
    // are git's and not this test's.
    const origin = join(root, "lfs-origin");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    git(["config", "core.autocrlf", "false"], origin);
    writeFileSync(join(origin, "model.bin"), pointerFor("a".repeat(64), 12345));
    writeFileSync(join(origin, "notes.md"), "# Notes\n");
    git(["add", "model.bin", "notes.md"], origin);
    git(["commit", "-qm", "old"], origin);
    git(["checkout", "-qb", "feature"], origin);
    writeFileSync(join(origin, "model.bin"), pointerFor("b".repeat(64), 67890));
    writeFileSync(
      join(origin, "notes.md"),
      `# Notes\n\nA pointer looks like this:\n\n${pointerFor("c".repeat(64), 1)}`,
    );
    git(["add", "model.bin", "notes.md"], origin);
    git(["commit", "-qm", "new"], origin);
    const clone = join(root, "lfs.git");
    await cloneBare(origin, clone);

    const { files } = await readChangeSet(
      clone,
      await mergeBase(clone, "main", "feature"),
      await resolveBranch(clone, "feature"),
    );
    expect(opaqueChanges(files).lfsPointers).toEqual(["model.bin"]);
  });
});

describe("a symlink that became a file (4.25)", () => {
  it("is read as one changed file, as git lists it", async () => {
    // Git prints a typechange as a deletion and an addition at one path,
    // which used to become two ledger rows with one path.
    const origin = join(root, "typechange-origin");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    git(["config", "core.autocrlf", "false"], origin);
    const target = git(["hash-object", "-w", "--stdin"], origin, "target.txt").trim();
    git(["update-index", "--add", "--cacheinfo", `120000,${target},link`], origin);
    git(["commit", "-qm", "old"], origin);
    git(["checkout", "-qb", "feature"], origin);
    const content = git(["hash-object", "-w", "--stdin"], origin, "line one\nline two\n").trim();
    git(["update-index", "--cacheinfo", `100644,${content},link`], origin);
    git(["commit", "-qm", "new"], origin);
    const clone = join(root, "typechange.git");
    await cloneBare(origin, clone);

    const { files } = await readChangeSet(
      clone,
      await mergeBase(clone, "main", "feature"),
      await resolveBranch(clone, "feature"),
    );
    expect(files.map((file) => [file.path, file.changeType])).toEqual([["link", "modified"]]);
    expect(files[0]?.hunks).toHaveLength(2);
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

describe("a tag with a branch's name, there before the clone (D-119 review)", () => {
  // git then shortens the branch to heads/main, which the 4.22 code read as a
  // branch called heads/main: the branch list threw and no review could be
  // started from the screen.
  let clone: string;

  beforeAll(async () => {
    const origin = join(root, "tagged-origin");
    execFileSync("git", ["clone", "-q", originDir, origin]);
    git(["config", "user.email", "test@example.invalid"], origin);
    git(["config", "user.name", "Test"], origin);
    git(["tag", "main", "HEAD"], origin);
    clone = join(root, "tagged-before.git");
    await cloneBare(origin, clone);
  }, 60_000);

  it("lists the branch by its own name", async () => {
    const names = (await listBranches(clone)).map((branch) => branch.name);
    expect(names).toContain("main");
    expect(names).not.toContain("heads/main");
  });

  it("names the default branch by its own name", async () => {
    expect(await detectDefaultBranch(clone)).toBe("main");
  });

  it("measures every listed branch against the default, as the branch list does", async () => {
    const into = await detectDefaultBranch(clone);
    for (const branch of await listBranches(clone)) {
      await expect(divergence(clone, branch.name, into)).resolves.toBeDefined();
    }
  });
});

describe("a tag with a branch's name (4.22)", () => {
  // git resolves a bare name as a tag before a branch, so a tag called main
  // pointing at the feature's tip made the feature look merged into main.
  let tagged: string;
  let mainTip: string;
  let featureTip: string;

  beforeAll(async () => {
    tagged = join(root, "tagged.git");
    await cloneBare(originDir, tagged);
    mainTip = git(["rev-parse", "refs/heads/main"], tagged).trim();
    featureTip = git(["rev-parse", "refs/heads/feature/totals"], tagged).trim();
    git(["tag", "main", featureTip], tagged);
  }, 60_000);

  it("resolves the branch, not the tag", async () => {
    expect(await resolveBranch(tagged, "main")).toBe(mainTip);
    // Already qualified, as a caller holding a full ref might pass it.
    expect(await resolveBranch(tagged, "refs/heads/main")).toBe(mainTip);
  });

  it("does not call a branch merged because a tag of that name holds it", async () => {
    expect(await isAncestor(tagged, featureTip, "main")).toBe(false);
  });

  it("finds the merge base and the distance between the branches themselves", async () => {
    const realBase = git(
      ["merge-base", "refs/heads/main", "refs/heads/feature/totals"],
      tagged,
    ).trim();
    expect(await mergeBase(tagged, "main", "feature/totals")).toBe(realBase);
    expect(await divergence(tagged, "feature/totals", "main")).toEqual({ ahead: 1, behind: 1 });
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

  it("detects a write to a path the repository ignores (4.26)", async () => {
    // git status leaves ignored paths out unless asked, so a write under
    // build/ or to a .log file went unseen by the end-of-review check.
    const origin = join(root, "ignoring-origin");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    git(["config", "core.autocrlf", "false"], origin);
    writeFileSync(join(origin, ".gitignore"), "build/\n*.log\n");
    writeFileSync(join(origin, "app.ts"), "export const a = 1;\n");
    git(["add", ".gitignore", "app.ts"], origin);
    git(["commit", "-qm", "init"], origin);
    const clone = join(root, "ignoring.git");
    await cloneBare(origin, clone);

    const dir = join(root, "wt-ignored");
    await addWorktree(clone, dir, await resolveBranch(clone, "main"));
    const baseline = await worktreeBaseline(dir);
    expect(baseline.changes).toEqual([]);

    mkdirSync(join(dir, "build"));
    writeFileSync(join(dir, "build", "out.js"), "written by the review\n");
    writeFileSync(join(dir, "debug.log"), "written by the review\n");
    await expect(assertWorktreeClean(dir)).rejects.toThrow(/build\/out\.js/);
    await expect(assertWorktreeClean(dir, baseline)).rejects.toThrow(/debug\.log/);

    await removeWorktree(clone, dir);
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

    it("refuses a checkout holding bytes git's own filters do not explain (D-110)", async () => {
      // Only what checkout's filters make of the commit is accepted as the
      // baseline. Anything else on disk at checkout is not the commit, and a
      // review of it would check every quotation against the wrong bytes.
      const dir = join(root, "wt-unexplained");
      await addWorktree(cloneDir, dir, await resolveCommit(cloneDir, "main"));
      writeFileSync(join(dir, "app.ts"), "export const version = 999;\n");
      await expect(worktreeBaseline(dir)).rejects.toThrow(CheckoutMismatchError);
      await expect(worktreeBaseline(dir)).rejects.toThrow(/app\.ts/);
      await removeWorktree(cloneDir, dir);
    });

    it("refuses two paths differing only in case where the file system cannot hold both", async () => {
      // One checks out over the other on Windows and default macOS, so the
      // file named Config.ts holds config.ts's bytes. On a case-sensitive
      // file system both check out and there is nothing to refuse.
      const origin = join(root, "case-origin");
      execFileSync("git", ["init", "-q", "-b", "main", origin]);
      const upper = git(
        ["hash-object", "-w", "--stdin"],
        origin,
        "export const which = 'UPPER';\n",
      );
      const lower = git(
        ["hash-object", "-w", "--stdin"],
        origin,
        "export const which = 'lower';\n",
      );
      git(["update-index", "--add", "--cacheinfo", `100644,${upper.trim()},Config.ts`], origin);
      git(["update-index", "--add", "--cacheinfo", `100644,${lower.trim()},config.ts`], origin);
      git(["commit", "-qm", "two configs"], origin);
      const clone = join(root, "case.git");
      await cloneBare(origin, clone);
      const dir = join(root, "wt-case");
      await addWorktree(clone, dir, await resolveCommit(clone, "main"));

      const caseInsensitive = readFileSync(join(dir, "Config.ts"), "utf8").includes("lower");
      if (caseInsensitive) {
        await expect(worktreeBaseline(dir)).rejects.toThrow(/Config\.ts/);
      } else {
        expect((await worktreeBaseline(dir)).changes).toEqual([]);
      }
      await removeWorktree(clone, dir);
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
