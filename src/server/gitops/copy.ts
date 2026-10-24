/**
 * A throwaway copy of one commit, where a project's own commands run (WP-I,
 * D-191). A clone of the project's clone, not a worktree of it: a worktree
 * registers itself in the clone, and the commands in it install, build and
 * write, so the copy shares nothing with the clone a review reads, nor with
 * the review's own read-only worktree.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./run";

export async function makeThrowawayCopy(
  repoDir: string,
  commit: string,
  copyDir: string,
): Promise<void> {
  await mkdir(copyDir, { recursive: true });
  // No hook of the person's runs on the checkout, as in addWorktree; the
  // project's own commands may run its hooks later, in the copy.
  const noHooks = await mkdtemp(join(tmpdir(), "trysquare-no-hooks-"));
  try {
    // No hardlinks into the clone's objects, and no remote back to it, so
    // nothing a project's scripts do in the copy, a push say, reaches the
    // clone a review reads (review round 7).
    await git(["clone", "--quiet", "--no-checkout", "--no-hardlinks", repoDir, copyDir], {
      timeoutMs: 300_000,
    });
    await git(["remote", "remove", "origin"], { cwd: copyDir });
    await git(["-c", `core.hooksPath=${noHooks}`, "checkout", "--quiet", "--detach", commit], {
      cwd: copyDir,
      timeoutMs: 300_000,
    });
  } finally {
    await rm(noHooks, { recursive: true, force: true });
  }
}

/**
 * Removed with retries: on Windows a process the commands left running can
 * hold a file in it for a moment after the tree is killed (EBUSY, EPERM).
 */
export async function removeThrowawayCopy(copyDir: string): Promise<void> {
  await rm(copyDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
