#!/usr/bin/env node
/**
 * Dead-export gate: fail when production code exports something nothing in
 * production uses.
 *
 * An export with no consumer is surface nobody exercises: it drifts from the
 * code around it and reads as a promise the app keeps. The sweeps that found
 * them by hand (U12, D-54) left nothing to stop the next one, and ESLint's
 * unused-variable rule cannot see across files and only warns. So this is
 * that gate (T19, MVP 7.1).
 *
 * Production is src/ and scripts/. A use from the tests does not count: an
 * export only a test reaches is kept alive by its test alone. Every
 * identifier in production is resolved, through imports and re-exports, to
 * the declaration it names, so a use in its own file counts, and an export
 * used there alone is not dead, only wider than it needs to be.
 *
 * Next.js calls some exports by their names, which no file imports, so a
 * route's handlers, a page's default and its settings, the proxy and the
 * instrumentation hook are named below as used. So are the few seams kept
 * for the tests alone, each with why: a test alone does not keep an export
 * alive unless it is written down here.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const PRODUCTION = ["src", "scripts"];
const SOURCE = /\.(ts|tsx|mts|mjs)$/;

/** Names Next.js reads from a file it loads by its path, by where that file is. */
// A segment's config, read from a route, a page or a layout alike.
const SEGMENT_CONFIG = [
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "generateStaticParams",
];
const FRAMEWORK = [
  {
    file: /^src\/app\/(.*\/)?route\.(ts|js)$/,
    names: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", ...SEGMENT_CONFIG],
  },
  {
    file: /^src\/app\/(.*\/)?(page|layout|default|loading|error|not-found|global-error|template)\.(tsx|ts|jsx|js)$/,
    names: [
      "default",
      "metadata",
      "viewport",
      "generateMetadata",
      "generateViewport",
      ...SEGMENT_CONFIG,
    ],
  },
  {
    file: /^src\/app\/(.*\/)?(opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(tsx|ts|jsx|js)$/,
    names: [
      "default",
      "alt",
      "size",
      "contentType",
      "generateImageMetadata",
      "generateSitemaps",
      ...SEGMENT_CONFIG,
    ],
  },
  { file: /^src\/proxy\.ts$/, names: ["proxy", "config"] },
  { file: /^src\/instrumentation\.ts$/, names: ["register", "onRequestError"] },
  { file: /^src\/instrumentation-client\.ts$/, names: ["onRouterTransitionStart"] },
];

/** Exported for the tests alone, deliberately, and why. */
const TEST_SEAMS = [
  {
    file: "src/server/runtime.ts",
    name: "closeRuntime",
    why: "a test closes the database before deleting its data directory, which Windows refuses while it is open",
  },
];

function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (SOURCE.test(entry) && !entry.endsWith(".d.ts") && !entry.endsWith(".d.mts")) {
      out.push(full);
    }
  }
  return out;
}

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config,
  ts.sys,
  ROOT,
);
const production = PRODUCTION.flatMap((dir) => filesUnder(join(ROOT, dir)));
const program = ts.createProgram(production, { ...parsed.options, allowJs: true, noEmit: true });
const checker = program.getTypeChecker();

const posix = (file) => relative(ROOT, file).split(sep).join("/");
const productionSet = new Set(production.map(posix));

/**
 * Marks a symbol used, and every import and re-export it reaches the
 * declaration through, one step at a time, so a re-export is used only when
 * something comes through it (review of the 7.1 changes). Returns the
 * declaration.
 */
function markUsed(symbol) {
  let current = symbol;
  for (;;) {
    used.add(current);
    if (!(current.flags & ts.SymbolFlags.Alias)) return current;
    const next = checker.getImmediateAliasedSymbol(current);
    if (next === undefined || next === current) return current;
    current = next;
  }
}

// A script's declaration file is production too: a type it declares may be
// used there alone.
const visited = (file) =>
  productionSet.has(file) || productionSet.has(file.replace(/\.d\.mts$/, ".mjs"));

const used = new Set();
for (const source of program.getSourceFiles()) {
  if (!visited(posix(source.fileName))) continue;
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      // A declaration's own name is not a use of it; a shorthand property's
      // is, of the value it is named for.
      const declaring =
        parent &&
        !ts.isShorthandPropertyAssignment(parent) &&
        "name" in parent &&
        parent.name === node &&
        ts.isDeclaration(parent);
      // Nor is the name a re-export or an import is spelled with: what that
      // binds is counted where it is used.
      const binding =
        parent &&
        (ts.isExportSpecifier(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent));
      if (!declaring && !binding) {
        // { schema } names the value schema, not a property of that name.
        const symbol =
          parent && ts.isShorthandPropertyAssignment(parent)
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node);
        if (symbol) {
          const target = markUsed(symbol);
          // A namespace handed on whole, as the schema is to drizzle, uses
          // every export in it; one read a property at a time is judged by
          // the properties.
          const readThrough =
            parent && ts.isPropertyAccessExpression(parent) && parent.expression === node;
          if (target.flags & ts.SymbolFlags.ValueModule && !readThrough) {
            for (const each of checker.getExportsOfModule(target)) markUsed(each);
          }
        }
      }
      // A destructured name, as in const { addWorktree } = await import(...),
      // uses the property it is taken from: its later uses name the local.
      if (
        parent &&
        ts.isBindingElement(parent) &&
        parent.name === node &&
        ts.isObjectBindingPattern(parent.parent)
      ) {
        const key = parent.propertyName ?? node;
        const property = checker
          .getTypeAtLocation(parent.parent)
          .getProperty(ts.isIdentifier(key) ? key.text : key.getText());
        if (property) markUsed(property);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const dead = [];
for (const source of program.getSourceFiles()) {
  const file = posix(source.fileName);
  if (!productionSet.has(file)) continue;
  // A script with a declaration file beside it is imported through that
  // file, so its exports are judged there.
  const declared = program.getSourceFile(source.fileName.replace(/\.mjs$/, ".d.mts"));
  const moduleSymbol = checker.getSymbolAtLocation(declared ?? source);
  if (!moduleSymbol) continue;
  const called = FRAMEWORK.filter((rule) => rule.file.test(file)).flatMap((rule) => rule.names);
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    if (called.includes(exported.name)) continue;
    if (TEST_SEAMS.some((seam) => seam.file === file && seam.name === exported.name)) continue;
    if (used.has(exported)) continue;
    const declaration = exported.declarations?.[0];
    const line = declaration
      ? declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1
      : 0;
    dead.push(`${file}:${line}: ${exported.name} is exported, and nothing in production uses it`);
  }
}

if (dead.length > 0) {
  console.error(`check-dead-exports: ${dead.length} export(s) with no production consumer.`);
  for (const entry of dead.sort()) console.error(entry);
  console.error("Delete each, or use it; a test alone does not keep an export alive.");
  process.exit(1);
}
console.log(`check-dead-exports: clean (${production.length} production files checked).`);
