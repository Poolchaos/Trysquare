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
import { basename, extname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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
 * Targets that legitimately do not exist on a fresh checkout.
 *
 * `review/` is gitignored by design (its evidence lives only on the machine
 * that produced it), so CI has no such directory and requiring it made the
 * gate red on every push while green on every workstation. An absent
 * optional target is skipped by name; a present one is scanned in full.
 */
const OPTIONAL_TARGETS = new Set(["review"]);

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
  {
    // A carriage return is allowed only as the first half of a CRLF line end.
    // One mid-line came from a scripted edit that read `\r` in `C:\repo` as
    // an escape, and the path rendered as two lines nobody could copy.
    name: "A carriage return may only end a line",
    pattern: /\r(?!$)/,
  },
];

/**
 * CLAUDE.md section 8: all database access goes through repositories. Two
 * routes queried the tables themselves until 5.10 (audit A6), which no gate
 * could see, and the first form of this check matched only the two import
 * spellings they used (D-136). Read per file, not per line, because an
 * import that prettier wraps spans lines and `import type` is on the first.
 *
 * Outside src/server/db/, nothing imports drizzle, better-sqlite3, the schema
 * or the client for its values, at load or at run time, or calls the
 * database handle. A type import is allowed: a module that hands `db` to a
 * repository names its type.
 */
const REPOSITORY_LAW =
  "Database access goes through src/server/db/repositories, not drizzle, the schema, the client or the handle";
const DB_MODULE = /^(?:drizzle-orm(?:\/.*)?|better-sqlite3)$|\/db\/(?:schema|client)(?:\.ts)?$/;
const DB_HANDLE_CALL =
  /\bdb\s*\.\s*(?:select|insert|update|delete|query|run|all|get|values|transaction|\$client)\b/g;

/** Files that own a database handle rather than query one, and why. */
const DB_OWNERS = new Map([
  ["src/server/runtime.ts", "creates the app's database and closes it on shutdown"],
  ["src/server/data-dir-lock.ts", "keeps its own lock database, which is not the app's"],
]);

function repositoryLawLines(path, text) {
  if (!path.startsWith("src/") || path.startsWith("src/server/db/") || DB_OWNERS.has(path)) {
    return [];
  }
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const lines = [];
  for (const match of text.matchAll(
    /\b(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']/g,
  )) {
    if (!match[1] && DB_MODULE.test(match[2])) lines.push(lineOf(match.index));
  }
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    if (DB_MODULE.test(match[1])) lines.push(lineOf(match.index));
  }
  for (const match of text.matchAll(DB_HANDLE_CALL)) lines.push(lineOf(match.index));
  return lines;
}

/**
 * The job manager on globalThis was built by the instrumentation bundle's
 * copy of the server modules, and the routes share another, so an error the
 * manager threw was never `instanceof` a class a route or the handler held:
 * refusals meant as 404s and 409s went out as 500s (D-139, D-140). So in the
 * HTTP layer, and in any file that imports the runtime or the job modules, an
 * error is known by the name its class sets: `instanceof`, or a constructor
 * or prototype comparison, is kept for the platform's own classes, of which
 * there is one copy. Outside the manager's module nothing names its error
 * classes at all. Read from TypeScript's own parse of each file, so a string,
 * a comment, a regex or a template is never taken for code, nor code for one
 * (D-141, D-142).
 */
const BOUNDARY_LAW =
  "In the HTTP layer and the importers of the runtime and job modules, an app error is known by its name (isNamed), not its class";
const MANAGER_ERRORS_LAW =
  "The job manager's error classes are named only in its own module; elsewhere, match the name";
const MANAGER_PATH = "src/server/jobs/manager.ts";
const MANAGER_ERRORS = new Set(
  [...readFileSync(join(ROOT, MANAGER_PATH), "utf8").matchAll(/export class (\w+Error)\b/g)].map(
    (match) => match[1],
  ),
);
// Found none, the rule would check nothing and say it was clean.
if (MANAGER_ERRORS.size === 0) {
  console.error(
    `check-style: no error classes found in ${MANAGER_PATH}; the gate is misconfigured.`,
  );
  process.exit(2);
}

/** Files that use the manager from its own copy of the modules, and why. */
const SAME_COPY_AS_MANAGER = new Map([
  [
    "src/instrumentation-node.ts",
    "builds the runtime, so the manager and the lock errors it catches are its own copy's",
  ],
]);

const SOURCE = /\.(?:ts|tsx|mts)$/;

/** A class the platform defines once for the process, which is any global constructor. */
/**
 * A class the platform defines once for the process: a global constructor
 * the file neither imports nor declares. An app class may share a global's
 * name, and the text alone took it for the global (D-143).
 */
function isPlatformClass(node, ownNames) {
  return (
    ts.isIdentifier(node) &&
    /^[A-Z]/.test(node.text) &&
    typeof globalThis[node.text] === "function" &&
    !ownNames.has(node.text)
  );
}

/** Every name a file imports or declares, at any depth. */
function namesOf(source) {
  const names = new Set();
  const visit = (node) => {
    if (
      (ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** Where the module a specifier names sits, as a repository path, or null for a package. */
function importedPath(path, specifier) {
  if (specifier.startsWith("@/")) return posix.normalize(`src/${specifier.slice(2)}`);
  if (specifier.startsWith(".")) return posix.join(posix.dirname(path), specifier);
  return null;
}

function parsed(path, text) {
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function reachesTheManager(path, source) {
  let reaches = false;
  const visit = (node) => {
    // Every way to name a module: import and export from, import(), and
    // import x = require(); a template with nothing in it is a string too.
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
            ? node.moduleReference.expression
            : undefined;
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const target = importedPath(path, specifier.text)?.replace(/\.(?:ts|js)$/, "");
      if (target === "src/server/runtime" || target?.startsWith("src/server/jobs/")) {
        reaches = true;
      }
    }
    if (!reaches) ts.forEachChild(node, visit);
  };
  visit(source);
  return reaches;
}

function boundaryLines(path, text) {
  if (!path.startsWith("src/") || !SOURCE.test(path) || path === MANAGER_PATH) return [];
  if (SAME_COPY_AS_MANAGER.has(path)) return [];
  const source = parsed(path, text);
  const inScope =
    path.startsWith("src/app/api/") ||
    path.startsWith("src/server/api/") ||
    reachesTheManager(path, source);
  if (!inScope) return [];
  const found = [];
  const ownNames = namesOf(source);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const isNamedRead = (node, name) =>
    (ts.isPropertyAccessExpression(node) && node.name.text === name) ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === name);
  const isConstructorRead = (node) => isNamedRead(node, "constructor");
  // X.prototype, as Object.getPrototypeOf(error) === X.prototype compares it.
  const prototypeOwner = (node) => (isNamedRead(node, "prototype") ? node.expression : undefined);
  const visit = (node) => {
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.InstanceOfKeyword && !isPlatformClass(node.right, ownNames)) {
        found.push(lineOf(node));
      }
      const equality = [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(operator);
      if (equality) {
        const other = isConstructorRead(node.left)
          ? node.right
          : isConstructorRead(node.right)
            ? node.left
            : undefined;
        if (other && !isPlatformClass(other, ownNames)) found.push(lineOf(node));
        const owner = prototypeOwner(node.left) ?? prototypeOwner(node.right);
        if (owner && !isPlatformClass(owner, ownNames)) found.push(lineOf(node));
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "isPrototypeOf" &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "prototype" &&
      !isPlatformClass(node.expression.expression.expression, ownNames)
    ) {
      found.push(lineOf(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function managerErrorLines(path, text) {
  if (!path.startsWith("src/") || !SOURCE.test(path) || path === MANAGER_PATH) return [];
  if (![...MANAGER_ERRORS].some((name) => text.includes(name))) return [];
  const source = parsed(path, text);
  const found = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && MANAGER_ERRORS.has(node.text)) {
      found.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

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
  // review/ is scanned for its authored prose. Its .json files are captured
  // model output (findings, scores): a recording is not subject to the house
  // style, and editing evidence until a gate passes would falsify it.
  // Split on both separators: relative() writes backslashes on Windows.
  if (extname(name) === ".json" && relative(ROOT, entryPath).split(/[\\/]/)[0] === "review") {
    return acc;
  }
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
    if (OPTIONAL_TARGETS.has(target)) {
      console.log(`check-style: optional target '${target}' is absent here; skipped by name.`);
      continue;
    }
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
  // Forward slashes on every platform, so a scoped check matches on Windows.
  const path = relative(ROOT, file).split("\\").join("/");
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const check of CHECKS) {
      if (check.pattern.test(line)) {
        violations.push(`${relative(ROOT, file)}:${index + 1}: ${check.name}\n    ${line.trim()}`);
      }
    }
  });
  for (const line of repositoryLawLines(path, text)) {
    violations.push(`${path}:${line}: ${REPOSITORY_LAW}\n    ${lines[line - 1]?.trim() ?? ""}`);
  }
  for (const line of boundaryLines(path, text)) {
    violations.push(`${path}:${line}: ${BOUNDARY_LAW}\n    ${lines[line - 1]?.trim() ?? ""}`);
  }
  for (const line of managerErrorLines(path, text)) {
    violations.push(`${path}:${line}: ${MANAGER_ERRORS_LAW}\n    ${lines[line - 1]?.trim() ?? ""}`);
  }
}

if (violations.length > 0) {
  console.error(`House style: ${violations.length} violation(s) in ${files.length} files checked.`);
  for (const violation of violations) console.error(violation);
  process.exit(1);
}

console.log(`House style: clean (${files.length} files checked).`);
