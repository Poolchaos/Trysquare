/**
 * Unified diff parsing.
 *
 * This is the most safety-critical pure function in the app: the coverage
 * ledger is seeded from its output, so a file or hunk this parser misses is a
 * file or hunk the review will never look at and never report as missing.
 * It is therefore deliberately literal, handles the awkward cases explicitly
 * (renames, deletions, binaries, mode-only changes, quoted paths, omitted
 * hunk counts), and refuses to guess.
 */

import type { ChangeType } from "@/lib/domain/enums";

export interface ParsedHunk {
  /** Position within its file, starting at 0. Matches ledger_hunks.hunkIndex. */
  hunkIndex: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The text after the closing @@, which git fills with the enclosing scope. */
  section: string;
  /** The hunk body, including its leading space, plus, or minus markers. */
  lines: string[];
}

export interface ParsedFile {
  /** Path after the change. For a deletion, the path that was removed. */
  path: string;
  /** Only set for renames and copies. */
  oldPath?: string;
  changeType: ChangeType;
  /** Binary files have no hunks; git does not emit line-level changes for them. */
  isBinary: boolean;
  /** True when only the file mode changed, so there is nothing to read. */
  isModeChangeOnly: boolean;
  oldMode?: string;
  newMode?: string;
  hunks: ParsedHunk[];
  addedLines: number;
  removedLines: number;
}

export class DiffParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Could not parse the diff at line ${line}: ${message}`);
    this.name = "DiffParseError";
  }
}

/**
 * Git quotes a path when it contains control characters, quotes, or non-ASCII
 * bytes (unless core.quotePath is off), using C-style octal escapes. Leaving
 * such a path quoted would mean the review looks for a file that is not there.
 */
export function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;

  const body = raw.slice(1, -1);
  const bytes: number[] = [];

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }

    const next = body[i + 1];
    if (next === undefined) throw new DiffParseError(`dangling escape in path ${raw}`, 0);

    const simple: Record<string, number> = {
      a: 0x07,
      b: 0x08,
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d,
      '"': 0x22,
      "\\": 0x5c,
    };
    const mapped = simple[next];
    if (mapped !== undefined) {
      bytes.push(mapped);
      i += 1;
      continue;
    }

    const octal = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    throw new DiffParseError(`unrecognised escape "\\${next}" in path ${raw}`, 0);
  }

  return Buffer.from(bytes).toString("utf8");
}

/** Strips the a/ or b/ prefix git puts on diff paths. */
function stripPrefix(path: string): string {
  if (path === "/dev/null") return path;
  if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
  return path;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Extracts the path from a `diff --git a/x b/x` line.
 *
 * This is needed because a mode-only change and a binary change emit no `---`
 * or `+++` lines at all, so for those files this header is the only place the
 * path appears. Losing it would drop the file from the inventory entirely.
 *
 * The unquoted form is genuinely ambiguous when a path contains " b/", so the
 * split is chosen as the one where both sides are equal, which holds for every
 * case that reaches here. Renames and copies carry explicit `rename from` and
 * `rename to` headers and do not depend on this.
 */
export function pathFromDiffHeader(line: string): string | null {
  const rest = line.slice("diff --git ".length).trim();
  if (rest === "") return null;

  if (rest.startsWith('"')) {
    // Two quoted paths: find the end of the first, respecting escapes.
    let end = -1;
    for (let i = 1; i < rest.length; i += 1) {
      if (rest[i] === "\\") {
        i += 1;
        continue;
      }
      if (rest[i] === '"') {
        end = i;
        break;
      }
    }
    if (end === -1) return null;
    const second = rest.slice(end + 1).trim();
    const target = second.startsWith('"') ? second : `"${second}"`;
    return stripPrefix(unquoteGitPath(target));
  }

  // Prefer a split where the two sides name the same file.
  for (let i = 0; i + 3 <= rest.length; i += 1) {
    if (!rest.startsWith(" b/", i)) continue;
    const left = rest.slice(0, i);
    const right = rest.slice(i + 1);
    if (stripPrefix(left) === stripPrefix(right)) return stripPrefix(right);
  }

  // No symmetric split: fall back to the last " b/" boundary.
  const lastIndex = rest.lastIndexOf(" b/");
  if (lastIndex === -1) return null;
  return stripPrefix(rest.slice(lastIndex + 1));
}

/**
 * Parses `git diff` output into files and hunks.
 *
 * Accepts the output of a plain `git diff`, including `-M` rename detection.
 * Empty input yields an empty list, which is a legitimate result (a branch
 * with no changes) rather than an error.
 */
export function parseUnifiedDiff(patch: string): ParsedFile[] {
  if (patch.trim() === "") return [];

  const lines = patch.split("\n");
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;
  let currentHunk: ParsedHunk | null = null;
  // Paths taken from the --- and +++ lines, which are more reliable than the
  // "diff --git" line because that line is ambiguous for paths with spaces.
  let headerOldPath: string | null = null;
  let headerNewPath: string | null = null;

  const finishFile = () => {
    if (!current) return;
    // A rename with no hunks still changed the tree; a modification with no
    // hunks means only the mode moved.
    if (current.hunks.length === 0 && !current.isBinary && current.changeType === "modified") {
      if (current.oldMode && current.newMode && current.oldMode !== current.newMode) {
        current.isModeChangeOnly = true;
      }
    }
    files.push(current);
    current = null;
    currentHunk = null;
    headerOldPath = null;
    headerNewPath = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      finishFile();
      current = {
        // Provisional: a mode-only or binary change has no other source for
        // the path. The --- and +++ lines override this when present.
        path: pathFromDiffHeader(line) ?? "",
        changeType: "modified",
        isBinary: false,
        isModeChangeOnly: false,
        hunks: [],
        addedLines: 0,
        removedLines: 0,
      };
      continue;
    }

    if (!current) {
      // Anything before the first "diff --git" is a commit header or noise.
      continue;
    }

    if (line.startsWith("new file mode ")) {
      current.changeType = "added";
      current.newMode = line.slice("new file mode ".length).trim();
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      current.changeType = "deleted";
      current.oldMode = line.slice("deleted file mode ".length).trim();
      continue;
    }
    if (line.startsWith("old mode ")) {
      current.oldMode = line.slice("old mode ".length).trim();
      continue;
    }
    if (line.startsWith("new mode ")) {
      current.newMode = line.slice("new mode ".length).trim();
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.changeType = "renamed";
      current.oldPath = unquoteGitPath(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.changeType = "renamed";
      current.path = unquoteGitPath(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("copy from ")) {
      // A copy is a new file as far as review is concerned: its content is new
      // in this location and nothing is removed.
      current.changeType = "added";
      current.oldPath = unquoteGitPath(line.slice("copy from ".length));
      continue;
    }
    if (line.startsWith("copy to ")) {
      current.path = unquoteGitPath(line.slice("copy to ".length));
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.isBinary = true;
      continue;
    }

    if (line.startsWith("--- ")) {
      const raw = line.slice(4).trim();
      headerOldPath = raw === "/dev/null" ? null : stripPrefix(unquoteGitPath(raw));
      continue;
    }
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      headerNewPath = raw === "/dev/null" ? null : stripPrefix(unquoteGitPath(raw));

      // Resolve the path now that both sides are known.
      if (headerNewPath === null) {
        current.changeType = "deleted";
        if (headerOldPath) current.path = headerOldPath;
      } else if (headerOldPath === null) {
        if (current.changeType !== "added") current.changeType = "added";
        current.path = headerNewPath;
      } else {
        if (current.path === "") current.path = headerNewPath;
        if (headerOldPath !== headerNewPath && current.changeType === "renamed") {
          current.oldPath ??= headerOldPath;
        }
      }
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      // An omitted count means exactly one line, not zero.
      const oldStart = Number(hunkMatch[1]);
      const oldLines = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      const newStart = Number(hunkMatch[3]);
      const newLines = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
      currentHunk = {
        hunkIndex: current.hunks.length,
        oldStart,
        oldLines,
        newStart,
        newLines,
        section: (hunkMatch[5] ?? "").trim(),
        lines: [],
      };
      current.hunks.push(currentHunk);
      continue;
    }

    if (currentHunk) {
      if (line.startsWith("\\")) {
        // "\ No newline at end of file" annotates the previous line.
        currentHunk.lines.push(line);
        continue;
      }
      if (line.startsWith("+")) {
        current.addedLines += 1;
        currentHunk.lines.push(line);
        continue;
      }
      if (line.startsWith("-")) {
        current.removedLines += 1;
        currentHunk.lines.push(line);
        continue;
      }
      if (line.startsWith(" ") || line === "") {
        currentHunk.lines.push(line);
        continue;
      }
      // Anything else ends the hunk body.
      currentHunk = null;
    }
  }

  finishFile();

  for (const file of files) {
    if (file.path === "") {
      throw new DiffParseError(`a file entry has no resolvable path`, 0);
    }
  }

  return files;
}

/** Only the added lines of a hunk, with the leading marker removed. */
export function addedLinesOf(hunk: ParsedHunk): string[] {
  return hunk.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1));
}

/** Only the removed lines of a hunk, with the leading marker removed. */
export function removedLinesOf(hunk: ParsedHunk): string[] {
  return hunk.lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1));
}

/**
 * The line numbers an added line occupies in the post-change file, which is
 * what a finding must cite and what the sweep records as its hit location.
 */
export function addedLineNumbers(hunk: ParsedHunk): { line: number; text: string }[] {
  const result: { line: number; text: string }[] = [];
  let lineNumber = hunk.newStart;
  for (const raw of hunk.lines) {
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      result.push({ line: lineNumber, text: raw.slice(1) });
      lineNumber += 1;
      continue;
    }
    if (raw.startsWith("-")) continue;
    lineNumber += 1;
  }
  return result;
}

export interface DiffStats {
  files: number;
  hunks: number;
  addedLines: number;
  removedLines: number;
  binaryFiles: number;
}

export function summariseDiff(files: readonly ParsedFile[]): DiffStats {
  return {
    files: files.length,
    hunks: files.reduce((n, f) => n + f.hunks.length, 0),
    addedLines: files.reduce((n, f) => n + f.addedLines, 0),
    removedLines: files.reduce((n, f) => n + f.removedLines, 0),
    binaryFiles: files.filter((f) => f.isBinary).length,
  };
}

/**
 * The hunk a cited line falls inside, or the file's first hunk.
 *
 * A finding cites the file as it is after the change, so the match is against
 * the new-file numbering. A deletion has no new numbering at all, and needs
 * no special case: git emits a deleted file as exactly one hunk covering the
 * whole of it (checked against a 200-line deletion: `@@ -1,200 +0,0 @@`), so
 * the fallback is the only answer there is.
 *
 * That fallback is deliberate rather than a shrug: a line outside every hunk
 * still belongs to a changed file, and showing what changed in it is more use
 * than showing nothing. A file with no hunks at all, a binary or a mode
 * change, genuinely has nothing to show.
 */
export function hunkForLine(file: ParsedFile, line: number): ParsedHunk | undefined {
  const containing = file.hunks.find(
    (hunk) => line >= hunk.newStart && line < hunk.newStart + Math.max(hunk.newLines, 1),
  );
  return containing ?? file.hunks[0];
}

/** The `@@` line git would have written for this hunk. */
export function formatHunkHeader(hunk: ParsedHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.section}`;
}
