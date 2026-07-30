/**
 * Cloning, fetching, and reading refs.
 *
 * Clones are bare. A bare clone has no working tree, so there is no checkout
 * for the app or a model to modify even by accident; reviews get their own
 * detached worktrees instead (see worktree.ts).
 */

import { rm } from "node:fs/promises";
import { validateGitUrl } from "@/lib/git/url";
import { git, gitSucceeds, toLines } from "./run";

export interface BranchInfo {
  name: string;
  commit: string;
  /** Commit subject, so a branch list is readable without a second call. */
  subject: string;
  committedAt: string;
  isRemote: boolean;
}

/**
 * Clones into a bare repository. Fetches everything, including all branches,
 * because the user picks the branch pair after the clone exists.
 */
export async function cloneBare(gitUrl: string, destination: string): Promise<void> {
  const url = validateGitUrl(gitUrl);
  // "--" separates options from operands, so a URL can never be read as a flag.
  await git(["clone", "--bare", "--quiet", "--", url, destination], { timeoutMs: 600_000 });
  // A bare clone only tracks the default branch by default; widen it so every
  // branch is fetchable and listable.
  await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"], { cwd: destination });
  await fetchAll(destination);
}

export async function fetchAll(repoDir: string): Promise<void> {
  await git(["fetch", "--all", "--prune", "--quiet"], { cwd: repoDir, timeoutMs: 600_000 });
}

/**
 * The repository's own default branch, read from what the remote advertises
 * rather than guessed from a list of likely names.
 */
export async function detectDefaultBranch(repoDir: string): Promise<string> {
  try {
    const head = await git(["symbolic-ref", "--short", "HEAD"], { cwd: repoDir });
    const name = head.trim();
    if (name !== "") return name;
  } catch {
    // Fall through: a bare clone can have a detached or missing HEAD.
  }

  for (const candidate of ["main", "master", "develop", "trunk"]) {
    if (
      await gitSucceeds(["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], {
        cwd: repoDir,
      })
    ) {
      return candidate;
    }
  }

  const branches = await listBranches(repoDir);
  const first = branches[0];
  if (!first) throw new Error(`Repository at ${repoDir} has no branches.`);
  return first.name;
}

const BRANCH_FORMAT = [
  "%(refname:short)",
  "%(objectname)",
  "%(committerdate:iso-strict)",
  "%(contents:subject)",
].join("\x1f");

export async function listBranches(repoDir: string): Promise<BranchInfo[]> {
  const output = await git(
    ["for-each-ref", "--sort=-committerdate", `--format=${BRANCH_FORMAT}`, "refs/heads/"],
    { cwd: repoDir },
  );

  return toLines(output).map((line) => {
    const [name = "", commit = "", committedAt = "", ...subjectParts] = line.split("\x1f");
    return {
      name,
      commit,
      committedAt,
      subject: subjectParts.join("\x1f"),
      isRemote: false,
    };
  });
}

export async function resolveCommit(repoDir: string, ref: string): Promise<string> {
  const output = await git(["rev-parse", "--verify", `${ref}^{commit}`], { cwd: repoDir });
  return output.trim();
}

/**
 * The commit the two branches diverged from. Reviews diff against this rather
 * than against the target branch tip, so unrelated commits landing on the
 * target while a review runs do not appear as changes in this branch.
 */
export async function mergeBase(repoDir: string, a: string, b: string): Promise<string> {
  const output = await git(["merge-base", a, b], { cwd: repoDir });
  return output.trim();
}

export interface DivergenceCounts {
  ahead: number;
  behind: number;
}

export async function divergence(
  repoDir: string,
  branch: string,
  compareTo: string,
): Promise<DivergenceCounts> {
  const output = await git(["rev-list", "--left-right", "--count", `${compareTo}...${branch}`], {
    cwd: repoDir,
  });
  const [behindRaw = "0", aheadRaw = "0"] = output.trim().split(/\s+/);
  return { ahead: Number(aheadRaw), behind: Number(behindRaw) };
}

/** True once the target branch contains the reviewed commit, i.e. it merged. */
export async function isAncestor(repoDir: string, commit: string, of: string): Promise<boolean> {
  return gitSucceeds(["merge-base", "--is-ancestor", commit, of], { cwd: repoDir });
}

export async function diffText(repoDir: string, base: string, head: string): Promise<string> {
  return git(
    [
      "diff",
      // Detect renames and copies so a moved file is reviewed as a move.
      "-M",
      "-C",
      // Full context is not needed; the app reads whole files from the worktree.
      "--unified=3",
      "--no-color",
      `${base}..${head}`,
    ],
    { cwd: repoDir },
  );
}

/** The contents of a file at a commit, used to build the pre-change copies. */
export async function fileAtCommit(
  repoDir: string,
  commit: string,
  path: string,
): Promise<string | null> {
  try {
    return await git(["show", `${commit}:${path}`], { cwd: repoDir });
  } catch {
    // The file did not exist at that commit, which is normal for an addition.
    return null;
  }
}

export async function removeRepo(repoDir: string): Promise<void> {
  await rm(repoDir, { recursive: true, force: true });
}
