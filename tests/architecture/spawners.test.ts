/**
 * CLAUDE.md section 8, held by a test rather than by memory: only
 * server/gitops spawns git, only server/engine spawns claude, and only
 * server/projectrun spawns a project's own commands (WP-I, D-196). A
 * process started anywhere else is one nobody decided where it runs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const SPAWNERS = ["server/gitops/", "server/engine/", "server/projectrun/"];
const IMPORTS_CHILD_PROCESS =
  /(?:from\s+["'](?:node:)?child_process["']|(?:require|import)\(\s*["'](?:node:)?child_process["']\s*\))/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx|mts|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

describe("where a process may be started", () => {
  it("only in the three modules whose job it is", () => {
    const spawning = sources(SRC)
      .filter((file) => IMPORTS_CHILD_PROCESS.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(spawning.length).toBeGreaterThan(0);
    expect(spawning.filter((file) => !SPAWNERS.some((dir) => file.startsWith(dir)))).toEqual([]);
  });
});
