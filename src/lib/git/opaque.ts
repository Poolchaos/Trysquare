/**
 * Changes whose content is not in the diff, and so not in the review.
 *
 * A submodule pointer names a commit in another repository, and a Git LFS
 * file in the repository is a pointer to content stored somewhere else. The
 * review reads only the pointer, and used to say nothing about it (4.23):
 * these are found so the run can say what it did not read.
 */

import type { ParsedFile, ParsedHunk } from "./diff";

export interface OpaqueChanges {
  /** Submodules whose pointer the change moved, adds or removes. */
  submodules: string[];
  /** Files that are, or were, Git LFS pointers. */
  lfsPointers: string[];
}

const SUBMODULE_MODE = "160000";
const SUBPROJECT_LINE = /^[+-]Subproject commit [0-9a-f]{7,64}/;

/** https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md */
const LFS_VERSION_LINE = "version https://git-lfs.github.com/spec/v1";
const LFS_KEY_LINE = /^[a-z0-9.-]+ \S+$/;
const LFS_OID_LINE = /^oid sha256:[0-9a-f]{64}$/;
const LFS_SIZE_LINE = /^size \d+$/;
const LFS_MAX_BYTES = 1024;

/**
 * Whether this text is a whole Git LFS pointer: the version line first, then
 * key-value lines that include the oid and the size, and nothing else. A
 * document that quotes a pointer is not one.
 */
export function isLfsPointer(text: string): boolean {
  if (text.length >= LFS_MAX_BYTES) return false;
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    lines[0] === LFS_VERSION_LINE &&
    lines.slice(1).every((line) => LFS_KEY_LINE.test(line)) &&
    lines.some((line) => LFS_OID_LINE.test(line)) &&
    lines.some((line) => LFS_SIZE_LINE.test(line))
  );
}

/**
 * One side of a file, as far as its first hunk shows it, or null when that
 * hunk does not start at the side's first line. Diffs carry three lines of
 * context, so a pointer's hunk holds all of it, whichever lines changed.
 * Taken to the count the header declares: the parser reads the blank line
 * that ends a diff as one more line of context.
 */
function sideFromFirstHunk(hunk: ParsedHunk | undefined, side: "old" | "new"): string | null {
  if (!hunk || (side === "old" ? hunk.oldStart : hunk.newStart) !== 1) return null;
  const dropped = side === "old" ? "+" : "-";
  return hunk.lines
    .filter((line) => !line.startsWith(dropped) && !line.startsWith("\\"))
    .slice(0, side === "old" ? hunk.oldLines : hunk.newLines)
    .map((line) => `${line.slice(1)}\n`)
    .join("");
}

export function opaqueChanges(files: readonly ParsedFile[]): OpaqueChanges {
  const submodules: string[] = [];
  const lfsPointers: string[] = [];
  for (const file of files) {
    const lines = file.hunks.flatMap((hunk) => hunk.lines);
    const isSubmodule =
      file.newMode === SUBMODULE_MODE ||
      file.oldMode === SUBMODULE_MODE ||
      lines.some((line) => SUBPROJECT_LINE.test(line));
    if (isSubmodule) {
      submodules.push(file.path);
      continue;
    }
    // Either side: a file moved into LFS, or out of it, still has content on
    // one side that the diff does not hold.
    const first = file.hunks[0];
    const isPointer = (["old", "new"] as const).some((side) => {
      const text = sideFromFirstHunk(first, side);
      return text !== null && isLfsPointer(text);
    });
    if (isPointer) lfsPointers.push(file.path);
  }
  return { submodules, lfsPointers };
}
