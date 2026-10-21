#!/usr/bin/env node
/**
 * Leak gate: fail if anything git would publish contains private material.
 *
 * This repository is designed to sit alongside private working material
 * (customer or employer protocols, real rulesets) in `docs/private/`, which
 * is gitignored. A single .gitignore line is not a control: it is one typo,
 * one `git add -f`, or one relocated file away from publishing a client's
 * document. CLAUDE.md's meta-rule says every quality rule that CAN be an
 * executable gate becomes one, so this is that gate.
 *
 * It inspects the files git actually tracks or has staged, not the working
 * tree, because those are the ones that can reach a remote.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Paths that must never be published, however they got staged. Naming these
 * files in prose is fine and necessary; committing them is not.
 */
const FORBIDDEN_PATHS = [
  { pattern: /(^|\/)private\//, why: "file inside a private directory" },
  { pattern: /(^|\/)REVIEW_PROTOCOL\.md$/i, why: "the private protocol document itself" },
];

/**
 * Content markers that must never appear in a published file. Kept
 * deliberately narrow: a gate that cries wolf gets ignored, so this lists
 * identifiers that are genuinely proprietary or personal, not the names of
 * files that are merely excluded. Extend it when new private material with
 * new identifiers enters the working tree.
 */
const FORBIDDEN_CONTENT = [
  { pattern: /sally[-\s]?pos/i, why: "private product name" },
  { pattern: /pos-core/i, why: "private package name" },
  { pattern: /popiadesk|peelgrims/i, why: "other private project names" },
  { pattern: /\bSAL-\d+\b/, why: "internal tracker identifier" },
  { pattern: /v2-app-location-/i, why: "internal deployed function identifier" },
  { pattern: /[a-z0-9._%+-]+@(?:proton|gmail|outlook|hotmail)\.[a-z]{2,}/i, why: "personal email" },
];

/**
 * Names that must not be published and must not be written here either, so
 * they are kept as the sha256 of their words, lowercased and joined by one
 * space. Each line is split into words at anything but a letter, digit or
 * hyphen, so a slash, a backslash or spaces between them all read alike, and
 * every run of one to three words is hashed and looked up. The maintainer's
 * private working trees were once named by a literal pattern in this file,
 * which this file's own exemption let through (reviews of the D-154 and
 * D-155 fixes).
 */
const FORBIDDEN_HASHED = new Map([
  ["ea86cfe70e64286053a80145909029fdd7a115debcade1be945a6770588844c2", "private working tree name"],
  ["f8bfaff353fff3e6dca1733ca371960c1585d28d7e880cacf91b1757af7ccfbe", "private working tree name"],
  ["e8a32f7a5f6d42e1e1c4a4ce73b6d2b60cecaf2e5d0e94c5936055272d508c9e", "private working tree name"],
]);
const HASHED_RUN = 3;

function hashedNameIn(line) {
  const words = line
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= HASHED_RUN && start + length <= words.length; length += 1) {
      const run = words.slice(start, start + length).join(" ");
      const why = FORBIDDEN_HASHED.get(createHash("sha256").update(run).digest("hex"));
      if (why !== undefined) return why;
    }
  }
  return undefined;
}

/**
 * The real home directory leaks the machine's username, so it is forbidden.
 * Invented paths in tests (/home/someone) are not, which is why this is
 * derived at runtime rather than matching any /home/<name>/ shape.
 */
const REAL_HOME = homedir();

/**
 * Windows writes one home three ways: `C:\Users\name` natively, `C:/Users/name`
 * from Node and most tools, and `/c/Users/name` from Git Bash. Matching only
 * the first let the other two through, and its paths ignore case, so the
 * comparison does too there.
 */
const CASE_BLIND = process.platform === "win32";
const HOME_FORMS = (() => {
  if (!CASE_BLIND) return [REAL_HOME];
  const forward = REAL_HOME.replace(/\\/g, "/");
  const msys = forward.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  return [REAL_HOME, forward, msys].map((form) => form.toLowerCase());
})();

/** Files whose job is to define the markers, so they legitimately contain them. */
const SELF_REFERENTIAL = new Set(["scripts/check-no-private.mjs"]);

/** Binary or generated files that are not prose and would produce noise. */
const SKIP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".ico", ".sqlite", ".lock"]);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

let files;
try {
  const tracked = git(["ls-files"]).split("\n");
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split("\n");
  // A new file that is neither tracked nor staged yet is still a file about
  // to be committed, and checking only the first two let a private product
  // name through: the gate was run before `git add`, saw nothing, and passed.
  // `--exclude-standard` keeps the genuinely ignored out, which is what
  // `docs/private/` and `review/` rely on.
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n");
  files = [...new Set([...tracked, ...staged, ...untracked])].filter(Boolean);
} catch (error) {
  console.error("check-no-private: could not ask git which files are publishable.");
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(2);
}

if (files.length === 0) {
  // Before the first commit nothing is tracked. That is not a pass: it means
  // the gate has nothing to check, and saying "clean" would be a false green.
  console.error("check-no-private: git listed no files at all, so nothing was checked.");
  process.exit(2);
}

const violations = [];

for (const file of files) {
  if (SELF_REFERENTIAL.has(file)) continue;

  const dot = file.lastIndexOf(".");
  if (dot !== -1 && SKIP_EXTENSIONS.has(file.slice(dot).toLowerCase())) continue;

  for (const { pattern, why } of FORBIDDEN_PATHS) {
    if (pattern.test(file)) {
      violations.push(`${file}: must never be committed (${why})`);
    }
  }

  let contents;
  try {
    if (!statSync(file).isFile()) continue;
    contents = readFileSync(file, "utf8");
  } catch (error) {
    // Tracked but deleted from the working tree: there is nothing left to
    // publish. Any other failure is a file this gate did not read.
    if (error.code === "ENOENT") continue;
    violations.push(`${file}: could not be read, so it was not checked (${error.code})`);
    continue;
  }

  contents.split("\n").forEach((line, index) => {
    for (const { pattern, why } of FORBIDDEN_CONTENT) {
      if (pattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${why}\n    ${line.trim().slice(0, 160)}`);
      }
    }
    const hashed = hashedNameIn(line);
    if (hashed !== undefined) {
      violations.push(`${file}:${index + 1}: ${hashed}\n    ${line.trim().slice(0, 160)}`);
    }
    const comparable = CASE_BLIND ? line.toLowerCase() : line;
    if (HOME_FORMS.some((form) => comparable.includes(form))) {
      violations.push(
        `${file}:${index + 1}: this machine home directory path\n    ${line.trim().slice(0, 160)}`,
      );
    }
  });
}

if (violations.length > 0) {
  console.error(
    `check-no-private: ${violations.length} violation(s). These must not be published.`,
  );
  for (const violation of violations) console.error(violation);
  process.exit(1);
}

console.log(`check-no-private: clean (${files.length} publishable files checked).`);
