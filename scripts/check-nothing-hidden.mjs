#!/usr/bin/env node
/**
 * Fails if any source or test file exists on disk but is invisible to git.
 *
 * This gate exists because of a real failure. `.gitignore` carried an
 * unanchored `review/` line, meant for a scratch directory at the repository
 * root. Unanchored, it matches a directory of that name at any depth, so
 * `src/lib/review/`, `src/server/review/` and both of their test directories
 * were silently excluded. The review engine, which is most of this app, was
 * never pushed. Nothing complained: the tracked subset still compiled, and CI
 * ran the tests that remained and reported them green.
 *
 * That is the shape of the problem worth guarding against. A missing file
 * announces itself; a file the tooling cannot see does not, and every check
 * downstream keeps passing over a codebase with a hole in it.
 */

import { execFileSync } from "node:child_process";

const WATCHED = ["src", "tests", "e2e", "scripts", "drizzle"];

function hiddenFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--", ...WATCHED],
    { encoding: "utf8" },
  );
  return output.split("\n").filter((line) => line.trim() !== "");
}

let hidden;
try {
  hidden = hiddenFiles();
} catch (error) {
  // Not a git repository, or git is unavailable. Nothing to check, and
  // failing here would block anyone working from a plain copy of the source.
  console.log(`check-nothing-hidden: skipped (${error.message.split("\n")[0]})`);
  process.exit(0);
}

if (hidden.length > 0) {
  console.error(
    `check-nothing-hidden: ${hidden.length} file(s) exist but are ignored by git.\n` +
      "These would never reach the repository, and every other gate would keep\n" +
      "passing without them. Check .gitignore for an unanchored pattern: a line\n" +
      'like "review/" matches that directory name at any depth, while "/review/"\n' +
      "matches only the one at the repository root.\n",
  );
  for (const file of hidden.slice(0, 50)) console.error(`  ${file}`);
  if (hidden.length > 50) console.error(`  ... and ${hidden.length - 50} more`);
  process.exit(1);
}

console.log(`check-nothing-hidden: clean (nothing ignored under ${WATCHED.join(", ")}).`);
