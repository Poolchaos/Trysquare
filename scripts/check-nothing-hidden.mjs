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

const WATCHED = ["src", "tests", "e2e", "scripts", "drizzle", "docs", ".github"];

/**
 * The repository root's own files too, its configs and verify.sh: one
 * ignored there passed every gate (audit finding 9). A glob pathspec's `*`
 * stops at a slash, so this is the root's files and not its folders, whose
 * build output and dependencies are meant to be ignored.
 */
const ROOT_FILES = ":(glob)*";

/**
 * What is ignored on purpose, each said: files a tool writes (Next's type
 * stub, TypeScript's build info), secrets that must never be committed (an
 * .env.example is meant to be, and is not excused), the private working
 * material .gitignore names, and what a person's global ignore file keeps
 * out of every repository: an operating system's folder files and Claude
 * Code's personal notes (review round 11).
 */
const MEANT_TO_BE_IGNORED = [
  /^next-env\.d\.ts$/,
  /\.tsbuildinfo$/,
  /^\.env(\.(?!example$)[^/]+)?$/,
  /\.(key|pem)$/,
  /^docs\/private\//,
  /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i,
  /^CLAUDE\.local\.md$/,
];

/**
 * git without the variables that change how a pathspec is read: with
 * GIT_LITERAL_PATHSPECS set, the root's `:(glob)*` matched nothing and the
 * check passed having looked at nothing (review round 11).
 */
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^GIT_\w*PATHSPECS$/i.test(name)),
);

function hiddenFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--", ...WATCHED, ROOT_FILES],
    { encoding: "utf8", env: gitEnv },
  );
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((file) => !MEANT_TO_BE_IGNORED.some((meant) => meant.test(file)));
}

let hidden;
try {
  hidden = hiddenFiles();
} catch (error) {
  const detail = String(error.stderr || error.message).trim();
  // Two failures mean there is nothing to check: git is absent (verify.sh
  // requires it, 2026-08-03), or this is a plain copy of the source with no
  // repository, where no ignore rule can keep a file from a push. Any other
  // git failure, a bad config value or a repository git refuses to trust,
  // leaves a real repository unchecked, and that is not a pass.
  if (error.code === "ENOENT" || /not a git repository/i.test(detail)) {
    console.log(`check-nothing-hidden: skipped (${detail.split("\n")[0]})`);
    process.exit(0);
  }
  console.error(`check-nothing-hidden: git could not list ignored files, so nothing was checked.`);
  console.error(detail);
  process.exit(2);
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

console.log(
  `check-nothing-hidden: clean (nothing ignored at the root or under ${WATCHED.join(", ")}).`,
);
