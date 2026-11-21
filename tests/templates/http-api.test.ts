/**
 * The HTTP API and database template (RT-5): what the importer reads from
 * it, held here so a retitled rule or section cannot quietly change which
 * files a rule is put to. The bar itself is held by the shelf's reader.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themesForPath } from "@/lib/rulesets/compose";
import { importProtocol } from "@/lib/rulesets/import";

const { ruleset, coverage } = importProtocol(
  readFileSync(fileURLToPath(new URL("../../templates/http-api.md", import.meta.url)), "utf8"),
);

describe("the HTTP API and database template", () => {
  it("is eight rules, every line of it a rule's or a directive's", () => {
    expect(coverage.unmapped).toEqual([]);
    expect(ruleset.rules.map((rule) => [rule.code, rule.severity, rule.group])).toEqual([
      ["41", "CRITICAL", "Who is asking"],
      ["42", "CRITICAL", "Who is asking"],
      ["43", "CRITICAL", "What the request carries"],
      ["44", "CRITICAL", "What the request carries"],
      ["45", "WARNING", "What the request carries"],
      ["46", "CRITICAL", "Reads and writes"],
      ["47", "WARNING", "Reads and writes"],
      ["48", "CRITICAL", "Reads and writes"],
    ]);
  });

  it("puts every rule to every file, whatever the endpoint is written in", () => {
    // A title that names a technology narrows its rule on a model that
    // takes rules file by file: "SQL" or "query" in a title would keep the
    // rule on statements from a handler that builds one inline, and "auth"
    // would keep the rules on who is asking from a handler not in
    // JavaScript.
    expect(new Set(ruleset.rules.flatMap((rule) => rule.tags))).toEqual(new Set(["general"]));
    expect(themesForPath("app/handlers/orders.py")).toEqual(["general"]);
  });

  it("gives each rule the sweep patterns its table names", () => {
    expect(
      Object.fromEntries(
        ruleset.rules
          .filter((rule) => rule.sweepPatterns.length > 0)
          .map((rule) => [rule.code, rule.sweepPatterns.length]),
      ),
    ).toEqual({ 44: 1, 45: 1, 46: 2 });
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
