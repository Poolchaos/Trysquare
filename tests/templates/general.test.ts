/**
 * The General template (RT-2): what the importer reads from it, held here so
 * a retitled rule or section cannot quietly change which files a rule is put
 * to. The bar itself is held by the shelf's reader.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themesForPath } from "@/lib/rulesets/compose";
import { importProtocol } from "@/lib/rulesets/import";

const { ruleset, coverage } = importProtocol(
  readFileSync(fileURLToPath(new URL("../../templates/general.md", import.meta.url)), "utf8"),
);

describe("the General template", () => {
  it("is twelve rules, every line of it a rule's or a directive's", () => {
    expect(coverage.unmapped).toEqual([]);
    expect(ruleset.rules.map((rule) => [rule.code, rule.severity, rule.group])).toEqual([
      ["1", "CRITICAL", "Failures"],
      ["2", "CRITICAL", "Failures"],
      ["3", "WARNING", "Failures"],
      ["4", "CRITICAL", "Boundaries"],
      ["5", "CRITICAL", "Boundaries"],
      ["6", "CRITICAL", "Boundaries"],
      ["7", "WARNING", "Resources"],
      ["8", "WARNING", "Proof"],
      ["9", "CRITICAL", "Proof"],
      ["10", "WARNING", "Leftovers"],
      ["11", "WARNING", "Leftovers"],
      ["12", "CRITICAL", "Removals"],
    ]);
  });

  it("puts every rule to every file, and the rule on weakened tests to test files", () => {
    // A title or a section that names a technology narrows a rule to that
    // technology's files on a model that takes the rules file by file. A
    // credential in a YAML file is still a credential.
    const tags = Object.fromEntries(ruleset.rules.map((rule) => [rule.code, rule.tags]));
    const { 9: weakened, ...rest } = tags;
    expect(weakened).toEqual(["testing"]);
    expect(new Set(Object.values(rest).flat())).toEqual(new Set(["general"]));
    expect(themesForPath("deploy/values.yaml")).toContain("general");
    expect(themesForPath("tests/pricing/discount.test.ts")).toContain("testing");
  });

  it("gives each rule the sweep patterns its table names, none of them holding a pipe", () => {
    expect(
      Object.fromEntries(
        ruleset.rules
          .filter((rule) => rule.sweepPatterns.length > 0)
          .map((rule) => [rule.code, rule.sweepPatterns.length]),
      ),
    ).toEqual({ 1: 1, 5: 4, 6: 2, 9: 2, 10: 2, 11: 2 });
    // A table cell cannot hold one: the row would give its rule no pattern.
    expect(
      ruleset.rules.flatMap((rule) => rule.sweepPatterns).filter((p) => p.includes("|")),
    ).toEqual([]);
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
