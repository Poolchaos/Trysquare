/**
 * The email this machine's git commits as: `user.email` in the person's
 * global config, read through the files it includes. Not a repository's own
 * config, which is the app's bare clone and sets none, and not the system
 * file, which the app never reads (run.ts).
 */

import { git, GitCommandError } from "./run";

/** Null when no email is set. Throws git's own words when the config cannot be read. */
export async function globalUserEmail(): Promise<string | null> {
  try {
    const email = (await git(["config", "--global", "--includes", "--get", "user.email"])).trim();
    return email === "" ? null : email;
  } catch (error) {
    // Exit 1 is git's "no such key", and what a missing file gives too.
    if (error instanceof GitCommandError && error.exitCode === 1) return null;
    throw error;
  }
}
