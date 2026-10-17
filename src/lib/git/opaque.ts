/**
 * Changes whose content is not in the diff, and so not in the review.
 *
 * A submodule pointer names a commit in another repository, and a Git LFS
 * file in the repository is a pointer to content stored somewhere else. The
 * review reads only the pointer, and used to say nothing about it (4.23):
 * these are found so the run can say what it did not read.
 */

import type { ParsedFile } from "./diff";

export interface OpaqueChanges {
  /** Submodules whose pointer the change moved, adds or removes. */
  submodules: string[];
  /** Files stored as Git LFS pointers. */
  lfsPointers: string[];
}

const SUBMODULE_MODE = "160000";
const SUBPROJECT_LINE = /^[+-]Subproject commit [0-9a-f]{7,64}/;
const LFS_SPEC_LINE = /^[+-]version https:\/\/git-lfs\.github\.com\/spec\/v1$/;

export function opaqueChanges(files: readonly ParsedFile[]): OpaqueChanges {
  const submodules: string[] = [];
  const lfsPointers: string[] = [];
  for (const file of files) {
    const lines = file.hunks.flatMap((hunk) => hunk.lines);
    const isSubmodule =
      file.newMode === SUBMODULE_MODE ||
      file.oldMode === SUBMODULE_MODE ||
      lines.some((line) => SUBPROJECT_LINE.test(line));
    if (isSubmodule) submodules.push(file.path);
    else if (lines.some((line) => LFS_SPEC_LINE.test(line))) lfsPointers.push(file.path);
  }
  return { submodules, lfsPointers };
}
