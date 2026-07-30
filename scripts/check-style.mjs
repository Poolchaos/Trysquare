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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const TARGETS = [
  "src",
  "tests",
  "e2e",
  "docs",
  "scripts",
  ".github",
  "CLAUDE.md",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
];

/** Private working material is not authored here and is never committed. */
const EXCLUDED_FILES = new Set(["REVIEW_PROTOCOL.md"]);
const EXCLUDED_DIRS = new Set(["node_modules", ".next", "fixtures", "coverage", "private"]);

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".md", ".json"]);

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

  const name = entryPath.slice(entryPath.lastIndexOf("/") + 1);
  if (EXCLUDED_FILES.has(name)) return acc;
  const dot = name.lastIndexOf(".");
  if (dot === -1 || !TEXT_EXTENSIONS.has(name.slice(dot))) return acc;
  acc.push(entryPath);
  return acc;
}

const files = [];
for (const target of TARGETS) {
  collectFiles(join(ROOT, target), files);
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
