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
 * The real home directory leaks the machine's username, so it is forbidden.
 * Invented paths in tests (/home/someone) are not, which is why this is
 * derived at runtime rather than matching any /home/<name>/ shape.
 */
const REAL_HOME = homedir();

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
  files = [...new Set([...tracked, ...staged])].filter(Boolean);
} catch (error) {
  console.error("check-no-private: could not ask git which files are publishable.");
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(2);
}

if (files.length === 0) {
  // Before the first commit nothing is tracked. That is not a pass: it means
  // the gate has nothing to check, and saying "clean" would be a false green.
  console.log("check-no-private: no tracked or staged files yet, nothing to check.");
  process.exit(0);
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
  } catch {
    continue;
  }

  contents.split("\n").forEach((line, index) => {
    for (const { pattern, why } of FORBIDDEN_CONTENT) {
      if (pattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${why}\n    ${line.trim().slice(0, 160)}`);
      }
    }
    if (line.includes(REAL_HOME)) {
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
