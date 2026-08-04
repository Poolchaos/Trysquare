/**
 * The fidelity gate.
 *
 * A rule the importer silently drops is a rule the review never applies while
 * still reporting that it applied the whole protocol. These tests exist to
 * make that impossible, so they check coverage and a verbatim round trip
 * rather than spot-checking a few parsed fields.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DuplicateRuleCodeError,
  classifyDirective,
  exportProtocol,
  fieldAfterLabel,
  importProtocol,
  inferTags,
  parseSeverity,
  parseSweepTable,
} from "@/lib/rulesets/import";

const EXAMPLE_PATH = fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url));
const EXAMPLE = readFileSync(EXAMPLE_PATH, "utf8");

const imported = importProtocol(EXAMPLE);

describe("fidelity", () => {
  it("maps every line of the document to a record", () => {
    // The whole point: nothing in the protocol is invisible to the review.
    expect(imported.coverage.unmapped).toEqual([]);
    expect(imported.coverage.mappedLines).toBe(imported.coverage.totalLines);
  });

  it("round-trips back to the original document byte for byte", () => {
    // A clean diff is proof the import kept everything, including whatever the
    // parser did not understand. Compared against the file as it is on disk,
    // not a trimmed copy: trimming here would weaken the assertion to fit the
    // implementation, which is the failure this whole gate exists to prevent.
    expect(exportProtocol(imported.ruleset)).toBe(EXAMPLE);
  });

  it("names any line it could not place, rather than dropping it quietly", () => {
    const orphan = "# Title\n\n## Section\n\nbody\n";
    const result = importProtocol(orphan);
    expect(result.coverage.unmapped).toEqual([]);

    // A document with content before any heading keeps that content too.
    const withPreamble = "Loose opening line.\n\n# Title\n\nbody\n";
    const preambleResult = importProtocol(withPreamble);
    expect(preambleResult.coverage.unmapped).toEqual([]);
    expect(preambleResult.ruleset.directives[0]?.title).toBe("Preamble");
  });

  it("refuses a protocol that declares the same rule code twice", () => {
    const duplicated =
      "# T\n\n## G\n\n### 1. First\n\n**Rule:** a\n\n### 1. Second\n\n**Rule:** b\n";
    expect(() => importProtocol(duplicated)).toThrow(DuplicateRuleCodeError);
  });

  it("handles an empty document without inventing content", () => {
    const result = importProtocol("");
    expect(result.coverage.unmapped).toEqual([]);
    expect(result.ruleset.rules).toEqual([]);
  });
});

describe("rules", () => {
  const ruleFor = (code: string) => imported.ruleset.rules.find((rule) => rule.code === code);

  it("finds every rule, including lettered ones", () => {
    expect(imported.ruleset.rules.map((rule) => rule.code)).toEqual([
      "1",
      "2",
      "2a",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
    ]);
  });

  it("reads the title and the rule text", () => {
    const rule = ruleFor("1");
    expect(rule?.title).toBe("Unawaited Promise");
    expect(rule?.ruleText).toContain("neither awaited nor");
  });

  it("keeps the violation example and the correct pattern as written", () => {
    const rule = ruleFor("3");
    expect(rule?.violationExample).toContain("payload as User");
    expect(rule?.correctPattern).toContain("userSchema.parse");
    // Code fences are preserved so the model sees the example as code.
    expect(rule?.violationExample).toContain("```ts");
  });

  it("reads severity, mapping ERROR onto CRITICAL", () => {
    expect(ruleFor("1")?.severity).toBe("CRITICAL");
    expect(ruleFor("2")?.severity).toBe("WARNING");
    expect(ruleFor("6")?.severity).toBe("NITPICK");
    expect(parseSeverity("**Severity:** ERROR")).toBe("CRITICAL");
  });

  it("defaults an unlabelled rule to warning rather than dropping it", () => {
    expect(parseSeverity("no severity here")).toBe("WARNING");
  });

  it("keeps detection hints and rationale separately", () => {
    const rule = ruleFor("3");
    expect(rule?.detection).toContain("outside the program");
    expect(rule?.notes).toContain("stops checking");
  });

  it("tags a rule from the section it appears under", () => {
    expect(ruleFor("3")?.tags).toContain("typescript");
    expect(ruleFor("5")?.tags).toContain("async");
    expect(ruleFor("8")?.tags).toContain("numeric");
  });

  it("attaches the sweep patterns that name each rule", () => {
    // The sweep is deterministic app code; these patterns are its input.
    expect(ruleFor("3")?.sweepPatterns).toEqual(expect.arrayContaining(["as ", "any"]));
    expect(ruleFor("6")?.sweepPatterns).toContain("console\\.");
    expect(ruleFor("8")?.sweepPatterns).toContain("toFixed");
  });

  it("gives a rule with no sweep entry an empty list rather than a guess", () => {
    expect(ruleFor("4")?.sweepPatterns).toEqual([]);
  });

  it("records where each rule came from, so the source can be shown", () => {
    const rule = ruleFor("1")!;
    expect(rule.startLine).toBeGreaterThan(0);
    expect(rule.endLine).toBeGreaterThanOrEqual(rule.startLine);
    expect(EXAMPLE.split("\n")[rule.startLine - 1]).toContain("Unawaited Promise");
  });
});

describe("directives", () => {
  const sections = () => imported.ruleset.directives.map((d) => d.section);

  it("captures the non-rule parts of the protocol", () => {
    expect(sections()).toContain("prime_directive");
    expect(sections()).toContain("scope");
    expect(sections()).toContain("severity_model");
    expect(sections()).toContain("output_format");
    expect(sections()).toContain("procedure");
  });

  it("classifies a heading by what it is about", () => {
    expect(classifyDirective("The Prime Directive")).toBe("prime_directive");
    expect(classifyDirective("Severity Levels")).toBe("severity_model");
    expect(classifyDirective("Finding Format")).toBe("output_format");
    expect(classifyDirective("Mandatory Mechanical Sweeps")).toBe("procedure");
    expect(classifyDirective("Review Scope")).toBe("scope");
    // An unrecognised heading is kept, not discarded.
    expect(classifyDirective("Something Unexpected")).toBe("philosophy");
  });

  it("keeps the prime directive's text intact", () => {
    const prime = imported.ruleset.directives.find((d) => d.section === "prime_directive");
    expect(prime?.contentMd).toContain("Read every file in the execution chain");
  });
});

describe("parsing helpers", () => {
  it("reads a labelled field up to the next label", () => {
    const body = "**Rule:** do the thing\n\n**Severity:** WARNING\n";
    expect(fieldAfterLabel(body, "Rule")).toBe("do the thing");
  });

  it("does not end a field at a bold line inside a code fence", () => {
    const body = [
      "**Violation Example:**",
      "",
      "```ts",
      "// **Note:** not a label",
      "```",
      "",
    ].join("\n");
    expect(fieldAfterLabel(body, "Violation Example")).toContain("not a label");
  });

  it("returns null for a label that is absent", () => {
    expect(fieldAfterLabel("**Rule:** x", "Detection")).toBeNull();
  });

  it("ignores a heading that appears inside a code fence", () => {
    const document = ["# Title", "", "## Group", "", "```md", "### 9. Not a rule", "```", ""].join(
      "\n",
    );
    expect(importProtocol(document).ruleset.rules).toEqual([]);
  });

  it("reads a sweep table into patterns per rule", () => {
    const table = "| `foo` | Rules 1, 2a: something |\n| `bar` | Rule 3 |\n";
    const parsed = parseSweepTable(table);
    expect(parsed.get("1")).toEqual(["foo"]);
    expect(parsed.get("2a")).toEqual(["foo"]);
    expect(parsed.get("3")).toEqual(["bar"]);
  });

  it("falls back to a general tag when no technology is recognisable", () => {
    // Safe direction: the rule reaches every file rather than none.
    expect(inferTags("Miscellaneous", "Something")).toEqual(["general"]);
  });
});
