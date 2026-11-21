/**
 * The React template (RT-4): what the importer reads from it, held here so a
 * retitled rule or section cannot quietly change which files a rule is put
 * to. The bar itself is held by the shelf's reader.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themesForPath } from "@/lib/rulesets/compose";
import { importProtocol } from "@/lib/rulesets/import";

const { ruleset, coverage } = importProtocol(
  readFileSync(fileURLToPath(new URL("../../templates/react.md", import.meta.url)), "utf8"),
);

describe("the React template", () => {
  it("is eight rules, every line of it a rule's or a directive's", () => {
    expect(coverage.unmapped).toEqual([]);
    expect(ruleset.rules.map((rule) => [rule.code, rule.severity, rule.group])).toEqual([
      ["1", "CRITICAL", "Hooks"],
      ["2", "CRITICAL", "Hooks"],
      ["3", "WARNING", "Hooks"],
      ["4", "WARNING", "Hooks"],
      ["5", "WARNING", "Component state"],
      ["6", "CRITICAL", "Component state"],
      ["7", "WARNING", "Components people use"],
      ["8", "CRITICAL", "Components people use"],
    ]);
  });

  it("puts every rule to the files that hold components, and to no other", () => {
    // On a model that takes rules file by file, a rule is put to the files
    // its tags fit: a rule on hooks has nothing to say of a plain module.
    expect(new Set(ruleset.rules.flatMap((rule) => rule.tags))).toEqual(new Set(["react"]));
    expect(themesForPath("src/components/OrderRow.tsx")).toContain("react");
    expect(themesForPath("src/orders/save.ts")).not.toContain("react");
  });

  it("gives each rule the sweep patterns its table names", () => {
    expect(
      Object.fromEntries(
        ruleset.rules
          .filter((rule) => rule.sweepPatterns.length > 0)
          .map((rule) => [rule.code, rule.sweepPatterns.length]),
      ),
    ).toEqual({ 2: 1, 7: 2, 8: 2 });
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
