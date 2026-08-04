#!/usr/bin/env node
/**
 * House style as an executable gate (CLAUDE.md section 7): no em dashes, no
 * emojis in authored code, docs, or user-facing strings.
 *
 * Implemented in Node rather than by shelling out to ripgrep: `rg` is not a
 * real binary in every environment (on this machine it is a shell function
 * from an editor integration, absent in non-interactive scripts), and a gate
 * that silently finds nothing when its tool is missing is worse than no gate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * fileURLToPath, never `URL.pathname`: a repository path containing a space
 * arrives percent-encoded from the URL, so the gate walked a directory that
 * did not exist, found nothing, and failed as misconfigured on a clean tree.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Directories walked in full. Every authored file at the repository root is
 * scanned too, by listing the root rather than naming its files, so a config
 * or a policy document is covered the day it lands.
 */
const TARGET_DIRS = ["src", "tests", "e2e", "docs", "scripts", ".github", "review"];

/**
 * REVIEW_PROTOCOL.md is private working material. The other two are
 * generated. Neither kind is authored here.
 */
const EXCLUDED_FILES = new Set(["REVIEW_PROTOCOL.md", "package-lock.json", "next-env.d.ts"]);
const EXCLUDED_DIRS = new Set(["node_modules", ".next", "fixtures", "coverage", "private"]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".md",
  ".json",
  ".sh",
]);

/**
 * Built from character codes rather than written literally, so this file
 * does not contain the characters it forbids.
 */
const CONTROL_CHARACTERS = new RegExp(
  "[" +
    String.fromCharCode(0) +
    "-" +
    String.fromCharCode(8) +
    String.fromCharCode(11) +
    String.fromCharCode(12) +
    String.fromCharCode(14) +
    "-" +
    String.fromCharCode(31) +
    String.fromCharCode(127) +
    "]",
);

const CHECKS = [
  {
    // Written as an escape, not the literal character, so this file does not
    // trip its own gate.
    name: "Em dashes are not permitted (use periods, commas, or hyphens)",
    pattern: /\u2014/u,
  },
  {
    name: "Emojis are not permitted in code, docs, or user-facing strings",
    pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u,
  },
  {
    // A NUL or stray control character is invisible in an editor and in a
    // diff, but changes what the code does. One was introduced here by a
    // scripted edit and turned a string separator into something that looked
    // right and matched nothing, breaking a coverage check silently.
    name: "Control characters are not permitted in source files",
    pattern: CONTROL_CHARACTERS,
  },
];

function collectFiles(entryPath, acc) {
  let stats;
  try {
    stats = statSync(entryPath);
  } catch {
    return acc;
  }

  if (stats.isDirectory()) {
    for (const child of readdirSync(entryPath)) {
      if (EXCLUDED_DIRS.has(child)) continue;
      collectFiles(join(entryPath, child), acc);
    }
    return acc;
  }

  const name = basename(entryPath);
  if (EXCLUDED_FILES.has(name)) return acc;
  if (!TEXT_EXTENSIONS.has(extname(name))) return acc;
  acc.push(entryPath);
  return acc;
}

const files = [];
for (const target of TARGET_DIRS) {
  const path = join(ROOT, target);
  // A declared target that is not there means the gate is looking in the
  // wrong place, which is how it came to check nothing at all. Missing one
  // directory is not visible in a file count, so it fails here by name.
  if (!existsSync(path)) {
    console.error(
      `check-style: target '${target}' is missing under ${ROOT}; the gate is misconfigured.`,
    );
    process.exit(2);
  }
  collectFiles(path, files);
}
for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isFile()) collectFiles(join(ROOT, entry.name), files);
}

if (files.length === 0) {
  console.error("check-style: found no files to check, which means the gate is misconfigured.");
  process.exit(2);
}

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const check of CHECKS) {
      if (check.pattern.test(line)) {
        violations.push(`${relative(ROOT, file)}:${index + 1}: ${check.name}\n    ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`House style: ${violations.length} violation(s) in ${files.length} files checked.`);
  for (const violation of violations) console.error(violation);
  process.exit(1);
}

console.log(`House style: clean (${files.length} files checked).`);
