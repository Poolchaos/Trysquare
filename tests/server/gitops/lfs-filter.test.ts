/**
 * A reviewed repository can mark files for Git LFS, and a person with git-lfs
 * set up carries a smudge filter in their own git config that downloads each
 * such file on checkout, from a host the repository's .lfsconfig may name. A
 * review's checkout reads the file as its pointer (lib/git/opaque) and asks no
 * host for it (D-237).
 *
 * The filter here is a stand-in that leaves a mark when git runs it, so the
 * test needs no git-lfs installed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addWorktree, worktreeBaseline } from "@/server/gitops/worktree";

const POINTER = [
  "version https://git-lfs.github.com/spec/v1",
  "oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
  "size 12345",
  "",
].join("\n");

const forGitConfig = (path: string) => path.replaceAll("\\", "/");

describe("a review's checkout of a repository that uses Git LFS", () => {
  let root: string;
  let clone: string;
  let commit: string;
  let mark: string;
  let previous: string | undefined;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "trysquare-lfs-"));
    const source = join(root, "source");
    const run = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", source]);
    writeFileSync(join(source, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
    writeFileSync(join(source, "asset.bin"), POINTER);
    run(["add", "."], source);
    run(
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "asset"],
      source,
    );
    commit = run(["rev-parse", "HEAD"], source);
    clone = join(root, "clone.git");
    execFileSync("git", ["clone", "--bare", "--quiet", source, clone]);

    // The person's own config, as git-lfs writes it: a filter git must run.
    mark = join(root, "the-filter-ran");
    const filter = join(root, "smudge.mjs");
    writeFileSync(
      filter,
      [
        'import { appendFileSync } from "node:fs";',
        `appendFileSync(${JSON.stringify(mark)}, "ran\\n");`,
        'process.stdout.write("THE DOWNLOADED FILE\\n");',
        "",
      ].join("\n"),
    );
    const config = join(root, "global.gitconfig");
    writeFileSync(
      config,
      `[filter "lfs"]\n\tsmudge = \\"${forGitConfig(process.execPath)}\\" \\"${forGitConfig(filter)}\\"\n\trequired = true\n`,
    );
    previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = config;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    rmSync(root, { recursive: true, force: true });
  });

  it("holds the pointer, and never runs the filter that would fetch the file", async () => {
    const worktree = join(root, "worktree");
    await addWorktree(clone, worktree, commit);

    expect(readFileSync(join(worktree, "asset.bin"), "utf8")).toBe(POINTER);
    expect(existsSync(mark), "the person's LFS filter ran").toBe(false);
  });

  it("reads that checkout as the commit, again without the filter", async () => {
    const baseline = await worktreeBaseline(join(root, "worktree"));

    expect(baseline.changes).toEqual([]);
    expect(existsSync(mark), "the person's LFS filter ran").toBe(false);
  });
});
