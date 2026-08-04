/**
 * The diff parser is tested against output from a real git, not hand-written
 * patches. Hand-written fixtures encode what the author believes git emits;
 * only real output catches the cases where that belief is wrong.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addedLineNumbers,
  addedLinesOf,
  formatHunkHeader,
  hunkForLine,
  parseUnifiedDiff,
  removedLinesOf,
  summariseDiff,
  unquoteGitPath,
  type ParsedFile,
} from "@/lib/git/diff";

let repo: string;
let diffText: string;
let parsed: ParsedFile[];

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
}

function fileOf(path: string): ParsedFile {
  const found = parsed.find((f) => f.path === path);
  if (!found) throw new Error(`No parsed file for "${path}". Got: ${parsed.map((f) => f.path)}`);
  return found;
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "trysquare-diff-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "Test"]);

  // Baseline containing every file the change set will disturb.
  writeFileSync(
    join(repo, "modified.ts"),
    Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n",
  );
  writeFileSync(join(repo, "deleted.ts"), "export const gone = true;\n");
  writeFileSync(join(repo, "renamed-from.ts"), "export const stable = 1;\n");
  writeFileSync(join(repo, "mode-only.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(join(repo, "no-newline.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "binary.bin"), Buffer.from([0, 1, 2, 3, 4, 0, 255]));
  git(["add", "-A"]);
  git(["commit", "-qm", "baseline"]);
  const base = git(["rev-parse", "HEAD"]).trim();

  // One change of each awkward kind.
  const modified = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  modified[2] = "line 2 CHANGED";
  modified[30] = "line 30 CHANGED";
  writeFileSync(join(repo, "modified.ts"), modified.join("\n") + "\n");

  rmSync(join(repo, "deleted.ts"));
  git(["mv", "renamed-from.ts", "renamed-to.ts"]);
  chmodSync(join(repo, "mode-only.sh"), 0o755);
  writeFileSync(join(repo, "no-newline.ts"), "export const a = 1;\nexport const b = 2;");
  writeFileSync(join(repo, "binary.bin"), Buffer.from([9, 9, 9, 9, 9, 9, 9, 9]));
  writeFileSync(join(repo, "added.ts"), "export const fresh = 1;\n");
  // A non-ASCII name, which git quotes with octal escapes by default.
  writeFileSync(join(repo, "café.ts"), "export const accented = true;\n");

  git(["add", "-A"]);
  git(["commit", "-qm", "the change set"]);

  diffText = git(["diff", "-M", `${base}...HEAD`]);
  parsed = parseUnifiedDiff(diffText);
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("parsing real git output", () => {
  it("finds every changed file, including the awkward ones", () => {
    expect(parsed.map((f) => f.path).sort()).toEqual(
      [
        "added.ts",
        "binary.bin",
        "café.ts",
        "deleted.ts",
        "mode-only.sh",
        "modified.ts",
        "no-newline.ts",
        "renamed-to.ts",
      ].sort(),
    );
  });

  it("classifies each change type correctly", () => {
    expect(fileOf("added.ts").changeType).toBe("added");
    expect(fileOf("deleted.ts").changeType).toBe("deleted");
    expect(fileOf("renamed-to.ts").changeType).toBe("renamed");
    expect(fileOf("modified.ts").changeType).toBe("modified");
  });

  it("keeps the previous path of a rename, so its history can be read", () => {
    expect(fileOf("renamed-to.ts").oldPath).toBe("renamed-from.ts");
  });

  it("splits a modification into one hunk per changed region", () => {
    const file = fileOf("modified.ts");
    expect(file.hunks).toHaveLength(2);
    expect(file.hunks[0]!.hunkIndex).toBe(0);
    expect(file.hunks[1]!.hunkIndex).toBe(1);
    // The second hunk starts well after the first, near line 31.
    expect(file.hunks[1]!.newStart).toBeGreaterThan(file.hunks[0]!.newStart + 5);
  });

  it("marks a binary file as binary and gives it no hunks", () => {
    const file = fileOf("binary.bin");
    expect(file.isBinary).toBe(true);
    expect(file.hunks).toHaveLength(0);
  });

  it("records a mode-only change as a file with no hunks", () => {
    const file = fileOf("mode-only.sh");
    expect(file.hunks).toHaveLength(0);
    expect(file.isModeChangeOnly).toBe(true);
    expect(file.oldMode).toBe("100644");
    expect(file.newMode).toBe("100755");
  });

  it("decodes a quoted non-ASCII path rather than leaving it escaped", () => {
    // Left escaped, the review would look for a file that does not exist.
    expect(parsed.some((f) => f.path.includes("\\"))).toBe(false);
    expect(fileOf("café.ts").changeType).toBe("added");
  });

  it("handles a missing trailing newline without losing the line", () => {
    const file = fileOf("no-newline.ts");
    const added = file.hunks.flatMap((h) => addedLinesOf(h));
    expect(added).toContain("export const b = 2;");
    // The "\ No newline" marker is not a content line.
    expect(added.some((l) => l.startsWith("\\"))).toBe(false);
  });

  it("counts added and removed lines without counting hunk headers", () => {
    const file = fileOf("modified.ts");
    expect(file.addedLines).toBe(2);
    expect(file.removedLines).toBe(2);
  });

  it("summarises the whole change set", () => {
    const stats = summariseDiff(parsed);
    expect(stats.files).toBe(8);
    expect(stats.binaryFiles).toBe(1);
    expect(stats.hunks).toBeGreaterThanOrEqual(6);
  });
});

describe("line numbering", () => {
  it("maps added lines to their real line numbers in the new file", () => {
    const file = fileOf("modified.ts");
    const hunk = file.hunks[0]!;
    const added = addedLineNumbers(hunk);
    expect(added).toHaveLength(1);
    // "line 2" is the third line of the file, so 1-indexed line 3.
    expect(added[0]).toEqual({ line: 3, text: "line 2 CHANGED" });
  });

  it("reads the removed side of a hunk", () => {
    const removed = removedLinesOf(fileOf("modified.ts").hunks[0]!);
    expect(removed).toEqual(["line 2"]);
  });

  it("numbers a whole new file from its first line", () => {
    const added = addedLineNumbers(fileOf("added.ts").hunks[0]!);
    expect(added[0]).toEqual({ line: 1, text: "export const fresh = 1;" });
  });
});

describe("edge cases", () => {
  it("treats an empty diff as no changes rather than an error", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n  ")).toEqual([]);
  });

  it("reads a hunk header whose counts are omitted as one line each", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "index 111..222 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -7 +7 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const [file] = parseUnifiedDiff(patch);
    const hunk = file!.hunks[0]!;
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newLines).toBe(1);
    expect(hunk.oldStart).toBe(7);
  });

  it("keeps the section context git puts after the hunk header", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@ export function calculateTotal() {",
      "-old",
      "+new",
      "",
    ].join("\n");
    expect(parseUnifiedDiff(patch)[0]!.hunks[0]!.section).toBe(
      "export function calculateTotal() {",
    );
  });

  it("does not confuse a diff of a file whose contents look like a diff", () => {
    const patch = [
      "diff --git a/doc.md b/doc.md",
      "--- a/doc.md",
      "+++ b/doc.md",
      "@@ -1,3 +1,4 @@",
      " Example:",
      "+diff --git a/fake b/fake",
      "+@@ -1 +1 @@",
      " end",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(patch);
    // The nested text is content of doc.md, not a second file.
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("doc.md");
    expect(files[0]!.addedLines).toBe(2);
  });
});

describe("path unquoting", () => {
  it("leaves an ordinary path alone", () => {
    expect(unquoteGitPath("src/app/page.tsx")).toBe("src/app/page.tsx");
  });

  it("decodes octal escapes for non-ASCII bytes", () => {
    expect(unquoteGitPath('"caf\\303\\251.ts"')).toBe("café.ts");
  });

  it("decodes escaped quotes, backslashes, and control characters", () => {
    expect(unquoteGitPath('"a\\"b.ts"')).toBe('a"b.ts');
    expect(unquoteGitPath('"a\\\\b.ts"')).toBe("a\\b.ts");
    expect(unquoteGitPath('"a\\tb.ts"')).toBe("a\tb.ts");
  });
});

describe("finding the hunk a citation falls in", () => {
  it("picks the hunk containing a line, not merely the first one", () => {
    // The confirmation screen shows this beside the finding, so picking the
    // wrong hunk would put a person's decision next to unrelated code.
    const file = fileOf("modified.ts");
    const late = hunkForLine(file, file.hunks[1]!.newStart + 1);
    expect(late?.hunkIndex).toBe(1);

    const early = hunkForLine(file, file.hunks[0]!.newStart + 1);
    expect(early?.hunkIndex).toBe(0);
  });

  it("gives a deletion the one hunk it has, whatever line is cited", () => {
    // Git emits a deleted file as a single hunk covering all of it, so there
    // is no second candidate to choose wrongly and no old-side special case
    // to write. This pins that assumption: if git ever splits a deletion,
    // the second citation below stops matching the first.
    const file = fileOf("deleted.ts");
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0]!.newLines).toBe(0);
    expect(hunkForLine(file, 1)?.hunkIndex).toBe(0);
    expect(hunkForLine(file, 500)?.hunkIndex).toBe(0);
  });

  it("falls back to the first hunk for a line outside every hunk", () => {
    // A line the change did not touch still sits in a changed file, and the
    // change is more use to a reader than an empty pane.
    expect(hunkForLine(fileOf("modified.ts"), 999)?.hunkIndex).toBe(0);
  });

  it("has nothing to show for a file with no hunks", () => {
    expect(hunkForLine(fileOf("binary.bin"), 1)).toBeUndefined();
    expect(hunkForLine(fileOf("mode-only.sh"), 1)).toBeUndefined();
  });

  it("writes back the header git would have written", () => {
    // The header is rendered verbatim above the hunk, so it has to be the
    // real one rather than a plausible-looking reconstruction.
    const hunk = fileOf("modified.ts").hunks[0]!;
    expect(diffText).toContain(formatHunkHeader(hunk));
  });
});
