/**
 * The TypeScript template (RT-3): what the importer reads from it, held here
 * so a retitled rule or section cannot quietly change which files a rule is
 * put to. The bar itself is held by the shelf's reader.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themesForPath } from "@/lib/rulesets/compose";
import { importProtocol } from "@/lib/rulesets/import";

const { ruleset, coverage } = importProtocol(
  readFileSync(fileURLToPath(new URL("../../templates/typescript.md", import.meta.url)), "utf8"),
);

describe("the TypeScript template", () => {
  it("is nine rules, every line of it a rule's or a directive's", () => {
    expect(coverage.unmapped).toEqual([]);
    expect(ruleset.rules.map((rule) => [rule.code, rule.severity, rule.group])).toEqual([
      ["21", "WARNING", "Escapes from the type checker"],
      ["22", "CRITICAL", "Escapes from the type checker"],
      ["23", "WARNING", "Escapes from the type checker"],
      ["24", "WARNING", "Escapes from the type checker"],
      ["25", "CRITICAL", "Promises"],
      ["26", "CRITICAL", "Promises"],
      ["27", "WARNING", "Types the code does not check"],
      ["28", "WARNING", "Types the code does not check"],
      ["29", "CRITICAL", "Types the code does not check"],
    ]);
  });

  it("puts its rules on types to TypeScript files, and its two on promises to JavaScript too", () => {
    // On a model that takes rules file by file, a rule is put to the files
    // its tags fit. A rule on the type checker has nothing to say of a .js
    // file; a promise nobody waits for is the same fault in either.
    const tags = Object.fromEntries(ruleset.rules.map((rule) => [rule.code, rule.tags]));
    for (const code of ["21", "22", "23", "24", "27", "28", "29"]) {
      expect(tags[code], `rule ${code}`).toEqual(["typescript"]);
    }
    for (const code of ["25", "26"]) expect(tags[code], `rule ${code}`).toEqual(["async"]);
    expect(themesForPath("src/orders/save.ts")).toEqual(
      expect.arrayContaining(["typescript", "async"]),
    );
    expect(themesForPath("scripts/sync.mjs")).toContain("async");
    expect(themesForPath("scripts/sync.mjs")).not.toContain("typescript");
  });

  it("gives each rule the sweep patterns its table names", () => {
    expect(
      Object.fromEntries(
        ruleset.rules
          .filter((rule) => rule.sweepPatterns.length > 0)
          .map((rule) => [rule.code, rule.sweepPatterns.length]),
      ),
    ).toEqual({ 21: 2, 22: 2, 23: 2, 24: 2, 26: 1 });
  });

  it("says its scope, its severities and its sweeps where the app looks for them", () => {
    expect(
      ruleset.directives
        .filter((directive) => directive.section !== "philosophy")
        .map((directive) => [directive.title, directive.section]),
    ).toEqual([
      ["Review scope", "scope"],
      ["Severity levels", "severity_model"],
      ["Mechanical sweeps", "procedure"],
    ]);
  });
});
