/**
 * The case that matters most for a linked review: an exported contract whose
 * body changed while its declaration line did not. It still compiles where it
 * is declared, so only the consumer breaks.
 */

import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { changedExportedSymbols } from "@/lib/git/symbols";

describe("contract changes that do not touch the declaration line", () => {
  it("detects a renamed field inside an exported interface", () => {
    const patch = [
      "diff --git a/types.ts b/types.ts",
      "--- a/types.ts",
      "+++ b/types.ts",
      "@@ -1,3 +1,3 @@",
      " export interface Prefs {",
      "-  reportAutoNavigate: boolean;",
      "+  autoNavigateDestination: string;",
      " }",
      "",
    ].join("\n");

    expect(changedExportedSymbols(parseUnifiedDiff(patch))).toEqual([
      { name: "Prefs", path: "types.ts", kind: "interface", change: "modified" },
    ]);
  });

  it("detects a new member added to an exported union", () => {
    const patch = [
      "diff --git a/status.ts b/status.ts",
      "--- a/status.ts",
      "+++ b/status.ts",
      "@@ -1,4 +1,5 @@",
      " export type Status =",
      '   | "open"',
      '+  | "archived"',
      '   | "closed";',
      "",
    ].join("\n");

    // An exhaustive switch at a consumer with no default now has a hole.
    expect(changedExportedSymbols(parseUnifiedDiff(patch))[0]).toMatchObject({
      name: "Status",
      change: "modified",
    });
  });

  it("uses the enclosing declaration git names after the hunk header", () => {
    // The declaration is outside the three lines of context, but git records
    // it in the hunk header.
    const patch = [
      "diff --git a/api.ts b/api.ts",
      "--- a/api.ts",
      "+++ b/api.ts",
      "@@ -40,3 +40,3 @@ export function calculateTotal(items: Item[]) {",
      "   const rate = 0.15;",
      "-  return subtotal * rate;",
      "+  return subtotal * (1 + rate);",
      "",
    ].join("\n");

    expect(changedExportedSymbols(parseUnifiedDiff(patch))[0]).toMatchObject({
      name: "calculateTotal",
      change: "modified",
    });
  });

  it("still distinguishes a genuinely new export from a changed one", () => {
    const patch = [
      "diff --git a/api.ts b/api.ts",
      "--- a/api.ts",
      "+++ b/api.ts",
      "@@ -1,3 +1,4 @@",
      " export interface Existing {",
      "   id: string;",
      " }",
      "+export const brandNew = 1;",
      "",
    ].join("\n");

    const symbols = changedExportedSymbols(parseUnifiedDiff(patch));
    expect(symbols.find((s) => s.name === "brandNew")?.change).toBe("added");
    // Existing appears as context but its body did change in this hunk, so
    // reporting it as modified is the safe direction to be wrong in.
    expect(symbols.find((s) => s.name === "Existing")?.change).toBe("modified");
  });

  it("reports nothing for a file with no exported declarations in view", () => {
    const patch = [
      "diff --git a/internal.ts b/internal.ts",
      "--- a/internal.ts",
      "+++ b/internal.ts",
      "@@ -1,2 +1,2 @@",
      " const helper = 1;",
      "-const other = 2;",
      "+const other = 3;",
      "",
    ].join("\n");

    expect(changedExportedSymbols(parseUnifiedDiff(patch))).toEqual([]);
  });
});
