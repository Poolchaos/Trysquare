/**
 * Git copies the enclosing line into each hunk header as its scope, so the
 * header holds whatever characters the author wrote there. Real git output,
 * not a hand-written patch, because the point is what git actually emits.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DiffParseError, parseUnifiedDiff } from "@/lib/git/diff";

let repo: string;
const git = (args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "trysquare-hunkhdr-"));
  git(["init", "-q", "-b", "main"]);
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("a hunk header carrying an unusual scope line", () => {
  it.each([
    ["LINE SEPARATOR", " "],
    ["PARAGRAPH SEPARATOR", " "],
  ])("keeps every line of the hunk when the scope holds a %s", (_, character) => {
    const body = Array.from({ length: 12 }, (_unused, i) => `  let v${i} = ${i};`);
    const before = [`function run(input) { // note${character}here`, ...body, "}", ""].join("\n");
    writeFileSync(join(repo, "app.js"), before);
    git(["add", "-A"]);
    git(["commit", "-qm", "base"]);
    const after = before.replace("  let v10 = 10;", "  let v10 = eval(input);");
    writeFileSync(join(repo, "app.js"), after);

    const patch = git(["diff"]);
    // The scope line really is in the header, or this proves nothing.
    expect(patch).toMatch(new RegExp(`@@ [^\\n]*${character}`));

    const [file] = parseUnifiedDiff(patch);
    expect(file?.hunks).toHaveLength(1);
    expect(file?.hunks[0]?.lines).toContain("+  let v10 = eval(input);");
    expect(file?.addedLines).toBe(1);
    git(["checkout", "-q", "--", "app.js"]);
  });
});

describe("a hunk the parser cannot account for", () => {
  it("refuses a header that does not parse rather than dropping its lines", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,two @@",
      "-a",
      "+b",
      "",
    ].join("\n");
    expect(() => parseUnifiedDiff(patch)).toThrow(DiffParseError);
  });
});
