/**
 * Resolution of every path the app owns on disk.
 *
 * Pure functions only: no filesystem access, so the layout is unit-testable
 * and the rules in docs/01-ARCHITECTURE.md section 5 are enforced in one
 * place rather than restated at each call site.
 */

import { join } from "node:path";

export const DATA_DIR_ENV_VAR = "TRYSQUARE_DATA";

/**
 * Only what this module reads. Narrower than NodeJS.ProcessEnv so callers and
 * tests can pass a plain object without satisfying the whole environment.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Relative to the user's home directory when the env var is unset. */
const DEFAULT_DATA_SUBPATH = [".local", "share", "trysquare"] as const;

/**
 * The root of everything the app stores. An explicit env var wins so a user
 * can point the app at another disk without moving their home directory.
 */
export function resolveDataDir(env: EnvLike, homeDir: string): string {
  const override = env[DATA_DIR_ENV_VAR]?.trim();
  if (override) return override;
  return join(homeDir, ...DEFAULT_DATA_SUBPATH);
}

export function dbPath(dataDir: string): string {
  return join(dataDir, "db.sqlite");
}

/** Bare clone: there is no working tree to accidentally modify. */
export function projectRepoDir(dataDir: string, projectId: string): string {
  return join(dataDir, "projects", projectId, "repo.git");
}

export function runDir(dataDir: string, reviewId: string): string {
  return join(dataDir, "runs", reviewId);
}

/**
 * Parent of the review's checkout(s). A single-repo review checks out into
 * this directory; a linked review creates one subdirectory per repo slug so
 * both trees are readable from one working directory.
 */
export function worktreeRootDir(dataDir: string, reviewId: string): string {
  return join(runDir(dataDir, reviewId), "worktree");
}

export function worktreeRepoDir(dataDir: string, reviewId: string, repoSlug: string): string {
  return join(worktreeRootDir(dataDir, reviewId), repoSlug);
}

export function bundleDir(dataDir: string, reviewId: string): string {
  return join(runDir(dataDir, reviewId), "bundle");
}

export function logsDir(dataDir: string, reviewId: string): string {
  return join(runDir(dataDir, reviewId), "logs");
}

export function exportsDir(dataDir: string): string {
  return join(dataDir, "exports");
}
