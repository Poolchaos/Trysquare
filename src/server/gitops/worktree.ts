/**
 * Review worktrees.
 *
 * A review reads code from a detached worktree pinned to the exact commit it
 * is reviewing. Detached because there is no branch to accidentally advance,
 * and pinned because a review must describe one state of the code even if
 * someone pushes to the branch while it runs.
 *
 * The app never writes inside a worktree. `assertWorktreeClean` is the check
 * that this held, and it is run after a pipeline rather than assumed.
 */

import { mkdir, rm } from "node:fs/promises";
import { git, toLines } from "./run";

export class WorktreeModifiedError extends Error {
  constructor(
    readonly worktreeDir: string,
    readonly changes: readonly string[],
  ) {
    super(
      `The review worktree at ${worktreeDir} was modified, which must never happen: ` +
        `${changes.join(", ")}. Reviewed code is read-only.`,
    );
    this.name = "WorktreeModifiedError";
  }
}

/**
 * Creates a detached checkout of one commit.
 *
 * `--detach` avoids creating a branch, and `--force` is deliberately not used:
 * if the path is already a worktree, that is a bug worth surfacing rather than
 * overwriting somebody else's running review.
 */
export async function addWorktree(
  repoDir: string,
  worktreeDir: string,
  commit: string,
): Promise<void> {
  await mkdir(worktreeDir, { recursive: true });
  await git(["worktree", "add", "--detach", "--quiet", worktreeDir, commit], {
    cwd: repoDir,
    timeoutMs: 300_000,
  });
}

/**
 * Removes a worktree and its administrative entry.
 *
 * `--force` is used here, unlike on creation: by this point the review is over
 * and any stray file is being discarded on purpose, not silently overwritten.
 */
export async function removeWorktree(repoDir: string, worktreeDir: string): Promise<void> {
  try {
    await git(["worktree", "remove", "--force", worktreeDir], { cwd: repoDir });
  } catch {
    // The directory may already be gone, or never have been registered.
    await rm(worktreeDir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], { cwd: repoDir }).catch(() => undefined);
}

/** Lists what a worktree considers modified, untracked, or staged. */
export async function worktreeChanges(worktreeDir: string): Promise<string[]> {
  const output = await git(["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: worktreeDir,
  });
  return toLines(output);
}

/**
 * Fails if anything in the worktree changed.
 *
 * This is the executable form of "the app never writes into reviewed code".
 * It runs after a review rather than being trusted, because the guarantee is
 * only worth what the check is worth.
 */
export async function assertWorktreeClean(worktreeDir: string): Promise<void> {
  const changes = await worktreeChanges(worktreeDir);
  if (changes.length > 0) throw new WorktreeModifiedError(worktreeDir, changes);
}

/** The commit a worktree is pinned to, read back rather than remembered. */
export async function worktreeCommit(worktreeDir: string): Promise<string> {
  const output = await git(["rev-parse", "HEAD"], { cwd: worktreeDir });
  return output.trim();
}
