/**
 * Changed exported symbols, for linked reviews.
 *
 * When a package and the app that consumes it change together, the dangerous
 * edit is usually a contract change in the package that is only wrong at the
 * consumer: a renamed field, a changed return shape, a new union member with
 * no matching case. The adversarial stage must account for every such symbol,
 * so the app extracts the list deterministically here rather than asking the
 * model to notice them.
 *
 * This is a lexical scan, not a type-aware one. It is deliberately generous:
 * a symbol reported that turns out to be uninteresting costs one disposition,
 * whereas a symbol missed is a contract change nobody checked. Where it is
 * uncertain it includes rather than excludes.
 */

import type { ParsedFile } from "./diff";
import { addedLinesOf, removedLinesOf } from "./diff";

export interface ChangedSymbol {
  name: string;
  /** Repo-relative path of the file that declares it. */
  path: string;
  kind: SymbolKind;
  /** Whether the declaration appeared, disappeared, or was altered. */
  change: "added" | "removed" | "modified";
}

export type SymbolKind =
  "interface" | "type" | "class" | "function" | "const" | "enum" | "default" | "re-export";

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts"];

export function isTypeScriptPath(path: string): boolean {
  return TYPESCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

interface Declaration {
  name: string;
  kind: SymbolKind;
}

/**
 * Patterns for an exported declaration. `export type { X }` and
 * `export { X }` are handled separately because they can carry a list.
 */
const DECLARATION_PATTERNS: { pattern: RegExp; kind: SymbolKind }[] = [
  { pattern: /^\s*export\s+(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { pattern: /^\s*export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: "type" },
  {
    pattern: /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: "class",
  },
  {
    pattern: /^\s*export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: "function",
  },
  { pattern: /^\s*export\s+(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
  {
    pattern: /^\s*export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    kind: "const",
  },
];

const LIST_EXPORT = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/;
const DEFAULT_EXPORT = /^\s*export\s+default\b/;

/** Every exported name a single line declares. */
export function declarationsInLine(line: string): Declaration[] {
  for (const { pattern, kind } of DECLARATION_PATTERNS) {
    const match = pattern.exec(line);
    if (match?.[1]) return [{ name: match[1], kind }];
  }

  const list = LIST_EXPORT.exec(line);
  if (list?.[1]) {
    return list[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .map((entry) => {
        // "Original as Alias" exports the alias.
        const parts = entry.split(/\s+as\s+/);
        const exported = (parts[parts.length - 1] ?? entry).trim();
        return { name: exported.replace(/^type\s+/, ""), kind: "re-export" as SymbolKind };
      })
      .filter((d) => d.name !== "" && /^[A-Za-z_$][\w$]*$/.test(d.name));
  }

  if (DEFAULT_EXPORT.test(line)) return [{ name: "default", kind: "default" }];

  return [];
}

/**
 * The exported symbols touched by a change set.
 *
 * A symbol appearing on both the added and removed side was altered rather
 * than introduced or deleted, which is the most dangerous case for a consumer
 * because it still compiles at the definition site.
 */
export function changedExportedSymbols(files: readonly ParsedFile[]): ChangedSymbol[] {
  const changed: ChangedSymbol[] = [];

  for (const file of files) {
    if (!isTypeScriptPath(file.path) || file.isBinary) continue;

    const added = new Map<string, SymbolKind>();
    const removed = new Map<string, SymbolKind>();
    // Declarations that appear as unchanged context inside a changed hunk.
    // Renaming a field of an exported interface never touches the
    // "export interface X" line itself, so without this the most dangerous
    // contract change of all is invisible: it still compiles where it is
    // declared and only breaks at the consumer.
    const bodyChanged = new Map<string, SymbolKind>();

    for (const hunk of file.hunks) {
      for (const line of addedLinesOf(hunk)) {
        for (const declaration of declarationsInLine(line)) {
          added.set(declaration.name, declaration.kind);
        }
      }
      for (const line of removedLinesOf(hunk)) {
        for (const declaration of declarationsInLine(line)) {
          removed.set(declaration.name, declaration.kind);
        }
      }
      for (const raw of hunk.lines) {
        if (!raw.startsWith(" ")) continue;
        for (const declaration of declarationsInLine(raw.slice(1))) {
          bodyChanged.set(declaration.name, declaration.kind);
        }
      }
      // git puts the enclosing declaration after the @@, which reaches
      // further than the three lines of context.
      for (const declaration of declarationsInLine(hunk.section)) {
        bodyChanged.set(declaration.name, declaration.kind);
      }
    }

    for (const [name, kind] of added) {
      changed.push({
        name,
        path: file.path,
        kind,
        change: removed.has(name) ? "modified" : "added",
      });
    }
    for (const [name, kind] of removed) {
      if (added.has(name)) continue;
      changed.push({ name, path: file.path, kind, change: "removed" });
    }
    for (const [name, kind] of bodyChanged) {
      if (added.has(name) || removed.has(name)) continue;
      changed.push({ name, path: file.path, kind, change: "modified" });
    }
  }

  return changed.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
}
