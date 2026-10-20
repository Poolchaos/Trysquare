import { execFileSync } from "node:child_process";
import { utimesSync } from "node:fs";

/**
 * Puts a fresh checkout's index back to where an unloaded checkout leaves it:
 * no newer than the files it lists, so git compares their content.
 *
 * Git trusts a file's timestamps once the index is newer than the file, and
 * compares content only while it is not. Straight after a checkout the two
 * share a timestamp; under the gate's load the index was written a tick
 * later, and a file whose committed bytes git's own filters change read
 * clean, so the D-107 tests met a checkout without the case they test. With
 * the index made newer by hand, 10 checkouts of 10 read clean; aged again,
 * 10 of 10 read ` M` (D-150).
 */
export function ageIndex(worktreeDir: string): void {
  const long = new Date("2000-01-01T00:00:00Z");
  utimesSync(indexOf(worktreeDir), long, long);
}

/**
 * The opposite: the index a minute newer than the files, as load leaves it,
 * and as a large checkout does by itself, its files written over many
 * ticks. Git then trusts every file's timestamps (D-151).
 */
export function freshenIndex(worktreeDir: string): void {
  const later = new Date(Date.now() + 60_000);
  utimesSync(indexOf(worktreeDir), later, later);
}

function indexOf(worktreeDir: string): string {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-path", "index"], {
    cwd: worktreeDir,
    encoding: "utf8",
  }).trim();
}
