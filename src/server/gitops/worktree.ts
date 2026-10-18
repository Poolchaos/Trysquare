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

import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { insideRoot } from "@/lib/paths";
import { git, gitBytes, toLines } from "./run";

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

/**
 * Lists what a worktree considers modified, untracked, staged, or written
 * where the repository ignores it. Without `--ignored`, a write under build/
 * or to a .log file went unseen by the end-of-review check (4.26).
 */
export async function worktreeChanges(worktreeDir: string): Promise<string[]> {
  const output = await git(["status", "--porcelain=v1", "--untracked-files=all", "--ignored"], {
    cwd: worktreeDir,
  });
  return toLines(output);
}

/**
 * What a checkout reports changed the moment it is made, and the content of
 * each file it names. A repository whose `.gitattributes` normalises files
 * committed otherwise reads ` M` before anything has touched it (D-107).
 */
export const worktreeBaselineSchema = z.object({
  changes: z.array(z.string()),
  /** sha256 of each named file's bytes, or null for one not on disk. */
  contents: z.record(z.string(), z.string().nullable()),
});
export type WorktreeBaseline = z.infer<typeof worktreeBaselineSchema>;

export class CheckoutMismatchError extends Error {
  constructor(
    readonly worktreeDir: string,
    readonly paths: readonly string[],
  ) {
    super(
      `The checkout at ${worktreeDir} does not hold what its commit holds, even after git's ` +
        `own line-ending and attribute filters: ${paths.join(", ")}. Two paths that differ ` +
        "only in case, on a file system that cannot tell them apart, are one way this happens. " +
        "Every quotation would be checked against the wrong bytes, so the review is refused " +
        "before any stage runs.",
    );
    this.name = "CheckoutMismatchError";
  }
}

/**
 * The baseline for a fresh checkout. A file it names is accepted only when
 * its bytes are what git's checkout filters make of the commit, which is the
 * normalisation case; anything else on disk is not the commit (D-110).
 */
export async function worktreeBaseline(worktreeDir: string): Promise<WorktreeBaseline> {
  const changes = await worktreeChanges(worktreeDir);
  const contents = await contentsOfChanged(worktreeDir);
  const unexplained: string[] = [];
  for (const [path, hash] of Object.entries(contents)) {
    const committed = await gitBytes(["cat-file", "--filters", `HEAD:${path}`], {
      cwd: worktreeDir,
    }).catch(() => null);
    const expected =
      committed === null ? null : createHash("sha256").update(committed).digest("hex");
    if (hash === null || expected !== hash) unexplained.push(path);
  }
  if (unexplained.length > 0) throw new CheckoutMismatchError(worktreeDir, unexplained);
  return { changes, contents };
}

/**
 * Hashes every file status names, read with `-z` because the plain form
 * quotes an unusual name and the quoted text is not a path on disk.
 */
async function contentsOfChanged(worktreeDir: string): Promise<Record<string, string | null>> {
  const output = await git(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"],
    {
      cwd: worktreeDir,
    },
  );
  const entries = output.split("\0").filter((entry) => entry !== "");
  const contents: Record<string, string | null> = {};
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const path = entry.slice(3);
    // A rename or copy is followed by its source path, which is not a file
    // in this checkout.
    if (entry[0] === "R" || entry[0] === "C") index += 1;
    try {
      const bytes = await readFile(insideRoot(worktreeDir, path));
      contents[path] = createHash("sha256").update(bytes).digest("hex");
    } catch {
      contents[path] = null;
    }
  }
  return contents;
}

/**
 * Fails if anything in the worktree changed.
 *
 * This is the executable form of "the app never writes into reviewed code".
 * It runs after a review rather than being trusted, because the guarantee is
 * only worth what the check is worth. Given the baseline taken at checkout,
 * what git reported then is expected, but only with the same content: the
 * status line of a file already reported changed does not move when it is
 * written to again.
 */
export async function assertWorktreeClean(
  worktreeDir: string,
  baseline?: WorktreeBaseline,
): Promise<void> {
  const changes = await worktreeChanges(worktreeDir);
  if (!baseline) {
    if (changes.length > 0) throw new WorktreeModifiedError(worktreeDir, changes);
    return;
  }
  const now = await contentsOfChanged(worktreeDir);
  const problems = [
    ...changes.filter((change) => !baseline.changes.includes(change)),
    ...baseline.changes
      .filter((change) => !changes.includes(change))
      .map((change) => `${change} (reported at checkout, not now)`),
    ...Object.entries(baseline.contents)
      .filter(([path, hash]) => now[path] !== hash)
      .map(([path]) => `${path} (rewritten since checkout)`),
  ];
  if (problems.length > 0) throw new WorktreeModifiedError(worktreeDir, problems);
}

/** The commit a worktree is pinned to, read back rather than remembered. */
export async function worktreeCommit(worktreeDir: string): Promise<string> {
  const output = await git(["rev-parse", "HEAD"], { cwd: worktreeDir });
  return output.trim();
}
