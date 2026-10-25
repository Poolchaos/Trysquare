/**
 * Cloning, fetching, and reading refs.
 *
 * Clones are bare. A bare clone has no working tree, so there is no checkout
 * for the app or a model to modify even by accident; reviews get their own
 * detached worktrees instead (see worktree.ts).
 */

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseUnifiedDiff, type ParsedFile } from "@/lib/git/diff";
import { validateGitUrl } from "@/lib/git/url";
import { git, GitCommandError, gitSucceeds, toLines } from "./run";

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

/**
 * Each clone's fetch in progress, and the one that runs after it, which every
 * caller asking meanwhile shares.
 *
 * On globalThis rather than in a module-level constant: the built app holds
 * two copies of this module, the job manager's in the instrumentation bundle
 * and the routes', and a queue each let a review's fetch run beside a
 * route's (review of the D-147 fixes).
 */
const FETCHES_KEY = Symbol.for("trysquare.gitops.fetch-queue");

interface FetchQueue {
  running: Promise<void>;
  next?: Promise<void>;
}

interface FetchesHolder {
  [FETCHES_KEY]?: Map<string, FetchQueue>;
}

const fetches = ((globalThis as FetchesHolder)[FETCHES_KEY] ??= new Map());

/**
 * Fetches every branch into a clone, one fetch at a time per clone.
 *
 * Two at once into one bare clone, after a branch moved on the remote, failed
 * one of them with "cannot lock ref" (D-147). A Refresh on the new review
 * screen starts two into a clone, the branch list's and the pre-flight's,
 * and a review's start or resume can add a third.
 *
 * A caller that asks while a fetch runs gets the fetch after it, which has
 * not started, so it starts after the caller asked, as pinning needs (D-27).
 * Callers asking meanwhile share that one: each queued its own, so a
 * pre-flight the screen had dropped still made the newest wait behind it
 * (review of the D-147 fixes). A failed fetch is passed on only to the
 * callers that shared it.
 */
export function fetchAll(repoDir: string): Promise<void> {
  const key = resolve(repoDir);
  const queue = fetches.get(key);
  if (queue === undefined) return beginFetch(key, repoDir);
  queue.next ??= queue.running.catch(() => undefined).then(() => beginFetch(key, repoDir));
  return queue.next;
}

function beginFetch(key: string, repoDir: string): Promise<void> {
  const running = git(["fetch", "--all", "--prune", "--quiet"], {
    cwd: repoDir,
    timeoutMs: 600_000,
  }).then(() => undefined);
  fetches.set(key, { running });
  void running
    .catch(() => undefined)
    .then(() => {
      const queue = fetches.get(key);
      if (queue?.running === running && queue.next === undefined) fetches.delete(key);
    });
  return running;
}

/**
 * The repository's own default branch, read from what the remote advertises
 * rather than guessed from a list of likely names.
 */
export async function detectDefaultBranch(repoDir: string): Promise<string> {
  try {
    // The full name with its prefix taken off, never --short: git shortens a
    // branch to heads/main when a tag is also called main, and that is not
    // the branch's name.
    const head = (await git(["symbolic-ref", "HEAD"], { cwd: repoDir })).trim();
    if (head.startsWith("refs/heads/") && head.length > "refs/heads/".length) {
      return head.slice("refs/heads/".length);
    }
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
  // The name under refs/heads/, never refname:short, which becomes heads/main
  // when a tag shares the branch's name.
  "%(refname:lstrip=2)",
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

/**
 * A branch name as git must read it. A bare name is looked up as a tag before
 * a branch, so a tag called main stood in for the branch main, and a feature
 * whose tip it pointed at looked merged (4.22).
 */
function branchRef(branch: string): string {
  return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
}

/** The commit a branch points at, never a tag of the same name. */
export async function resolveBranch(repoDir: string, branch: string): Promise<string> {
  return resolveCommit(repoDir, branchRef(branch));
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
  const output = await git(["merge-base", branchRef(a), branchRef(b)], { cwd: repoDir });
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
  const range = `${branchRef(compareTo)}...${branchRef(branch)}`;
  const output = await git(["rev-list", "--left-right", "--count", range], {
    cwd: repoDir,
  });
  const [behindRaw = "0", aheadRaw = "0"] = output.trim().split(/\s+/);
  return { ahead: Number(aheadRaw), behind: Number(behindRaw) };
}

/**
 * True once `tip` contains the reviewed commit, i.e. it merged. A commit,
 * not a branch name: an answer is kept for the tip it was asked of, and a
 * fetch could move the branch between reading its tip and asking. Throws when
 * git cannot say: only exit 1 means no, and a timeout or a failed spawn read
 * as no was kept until the branch next moved (review round 12).
 */
export async function isAncestor(repoDir: string, commit: string, tip: string): Promise<boolean> {
  try {
    await git(["merge-base", "--is-ancestor", commit, tip], { cwd: repoDir });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) return false;
    throw error;
  }
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
      // Git's own text whatever the user's config says (D-108): an external
      // diff tool replaced the whole diff with its output, a textconv driver
      // rewrites a file's lines, and noprefix or mnemonicPrefix change the
      // a/ and b/ the parser reads paths by.
      "--no-ext-diff",
      "--no-textconv",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      // A moved submodule pointer stays a diff section, never a log summary
      // or nothing at all (D-110).
      "--submodule=short",
      "--ignore-submodules=none",
      // Which lines a hunk holds is git's default, not the user's choice, so
      // the same two commits always make the same hunks and sweep hits.
      "--diff-algorithm=myers",
      "--indent-heuristic",
      "--inter-hunk-context=0",
      `${base}..${head}`,
    ],
    { cwd: repoDir },
  );
}

export class ChangeSetMismatchError extends Error {
  constructor(
    readonly missing: readonly string[],
    readonly unexpected: readonly string[],
  ) {
    const parts = [
      ...(missing.length > 0
        ? [`git lists ${missing.join(", ")} as changed, the diff does not`]
        : []),
      ...(unexpected.length > 0
        ? [`the diff names ${unexpected.join(", ")}, which git does not list`]
        : []),
    ];
    super(
      `The diff and git's own list of changed files disagree: ${parts.join("; ")}. ` +
        "A review of that diff would read as complete over files it never saw, so it is refused.",
    );
    this.name = "ChangeSetMismatchError";
  }
}

/**
 * Refuses a parsed diff that does not name exactly the files git lists as
 * changed. The list comes from `--name-only`, which formatting settings do
 * not touch, so a diff one of them reshaped fails here rather than becoming
 * a review of less than the change (D-108). A setting that drops an entry
 * from both, as diff.ignoreSubmodules does, is overridden on both (D-110).
 */
export function checkChangeSet(
  parsed: readonly { path: string }[],
  listed: readonly string[],
): void {
  const parsedPaths = new Set(parsed.map((file) => file.path));
  const listedPaths = new Set(listed);
  const missing = [...listedPaths].filter((path) => !parsedPaths.has(path));
  const unexpected = [...parsedPaths].filter((path) => !listedPaths.has(path));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new ChangeSetMismatchError(missing, unexpected);
  }
}

/** The diff between two commits, parsed and checked against git's own list. */
export async function readChangeSet(
  repoDir: string,
  base: string,
  head: string,
): Promise<{ patch: string; files: ParsedFile[] }> {
  const patch = await diffText(repoDir, base, head);
  const files = parseUnifiedDiff(patch);
  const listed = await git(
    [
      "diff",
      "--name-only",
      "-z",
      "-M",
      "-C",
      "--no-ext-diff",
      "--ignore-submodules=none",
      `${base}..${head}`,
    ],
    { cwd: repoDir },
  );
  checkChangeSet(
    files,
    listed.split("\0").filter((path) => path !== ""),
  );
  return { patch, files };
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
