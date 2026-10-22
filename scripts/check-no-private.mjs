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
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { hashedNamesIn } from "./lib/hashed-names.mjs";

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
  { pattern: /\bSAL-\d+\b/, why: "internal tracker identifier" },
  { pattern: /v2-app-location-/i, why: "internal deployed function identifier" },
  { pattern: /[a-z0-9._%+-]+@(?:proton|gmail|outlook|hotmail)\.[a-z]{2,}/i, why: "personal email" },
];

/**
 * Names that must not be published and must not be written here either, so
 * they are kept as the sha256 of their words, lowercased and joined by one
 * space; scripts/lib/hashed-names.mjs says how a file is read for them. The
 * maintainer's private working trees were once named by a literal pattern in
 * this file, which this file's own exemption let through (reviews of the
 * D-154 and D-155 fixes). Two or more words each: a name of one word would
 * stop the gate on every use of that word, so the probe check below refuses
 * one (review of the D-157 fixes).
 */
const FORBIDDEN_HASHED = new Map([
  ["89c5769c84f1e5a050f6aacde3d8e2eb91bc82b32ecb2280ed8beae918cf4242", "private working tree name"],
  ["bb1849bfd3e2f298d45e4f82aaf7fef14fc2f4a2187261c8c86a5f359a7d80fb", "private working tree name"],
  ["e8a32f7a5f6d42e1e1c4a4ce73b6d2b60cecaf2e5d0e94c5936055272d508c9e", "private working tree name"],
  // The private product, package and project names, once literal patterns
  // here, which this public file then named itself (D-169).
  ["97f82ca8295114008af2d539f36de0afe2f1149ca77999f1da34b54aeac70859", "private product name"],
  ["2e22bbb787db240dc91ee2a73ef40285c86de7466a1d1dd878e672ecf85e61e0", "private package name"],
]);

/**
 * Names of one word, each coined, so no ordinary use of the word trips it,
 * which is what the probe check's refusal of one word guards against. Listed
 * apart, so a name meant as two words that matched as one is still refused
 * (D-171).
 */
const FORBIDDEN_HASHED_WORDS = new Map([
  ["76b7cbb1111bab53d9ea036c919d07be3d5c46950f57b0bd19b6fed0661e43a9", "private product name"],
  ["bd2c6db0b77d64004f36235cabda8a3d096d6167348db705c7c68ca5991bb27a", "private project name"],
  ["f64061477969dfbec4b81434e96736116fe89fc3208d6825bfc30bbee7cb0571", "private project name"],
]);

const ALL_HASHED = new Map([...FORBIDDEN_HASHED, ...FORBIDDEN_HASHED_WORDS]);

// A mistyped hash matches nothing and says nothing, and a gate that silently
// finds nothing is worse than none (review of the D-156 fixes).
for (const digest of ALL_HASHED.keys()) {
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    console.error(`check-no-private: "${digest}" is not a sha256 hash, so it would match nothing.`);
    process.exit(1);
  }
}

/**
 * Where the maintainer keeps the hashed names written out, in the gitignored
 * docs/private/, each hash must still find its name there, or one that
 * stopped matching would pass in silence. Absent on CI, which has no private
 * material, so the check is the maintainer's machine's.
 */
const HASHED_PROBE = "docs/private/hashed-names-probe.txt";

/** Each run's matching hash, or null, worked out once: most runs recur across the tree. */
const hashedAnswers = new Map();

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

/**
 * Files whose job is to define the literal markers, so they legitimately
 * contain them. Exempt from that list alone: exempt from every check, this
 * file once carried private names past the gate (review of the D-156 fixes).
 */
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
  const definesMarkers = SELF_REFERENTIAL.has(file);

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

  const lines = contents.split("\n");
  for (const { line, why } of hashedNamesIn(contents, ALL_HASHED, hashedAnswers)) {
    violations.push(`${file}:${line + 1}: ${why}\n    ${lines[line].trim().slice(0, 160)}`);
  }
  lines.forEach((line, index) => {
    for (const { pattern, why } of definesMarkers ? [] : FORBIDDEN_CONTENT) {
      if (pattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${why}\n    ${line.trim().slice(0, 160)}`);
      }
    }
    const comparable = CASE_BLIND ? line.toLowerCase() : line;
    if (HOME_FORMS.some((form) => comparable.includes(form))) {
      violations.push(
        `${file}:${index + 1}: this machine home directory path\n    ${line.trim().slice(0, 160)}`,
      );
    }
  });
}

if (existsSync(HASHED_PROBE)) {
  const hits = hashedNamesIn(readFileSync(HASHED_PROBE, "utf8"), ALL_HASHED, hashedAnswers);
  for (const digest of ALL_HASHED.keys()) {
    const own = hits.filter((hit) => hit.digest === digest);
    const oneWord = FORBIDDEN_HASHED_WORDS.has(digest);
    if (own.length === 0) {
      violations.push(`${HASHED_PROBE}: hash ${digest.slice(0, 12)}... no longer finds its name`);
    } else if (!oneWord && own.some((hit) => hit.words === 1)) {
      violations.push(
        `${HASHED_PROBE}: hash ${digest.slice(0, 12)}... is one word, which every use of it would trip`,
      );
    } else if (oneWord && own.some((hit) => hit.words !== 1)) {
      violations.push(
        `${HASHED_PROBE}: hash ${digest.slice(0, 12)}... is listed as one word but found as more`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    `check-no-private: ${violations.length} violation(s). These must not be published.`,
  );
  for (const violation of violations) console.error(violation);
  process.exit(1);
}

console.log(`check-no-private: clean (${files.length} publishable files checked).`);
