import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATE_RULE_LIMIT, templateBarFailures } from "@/lib/rulesets/template-bar";

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url)),
  "utf8",
);

/** One rule to the bar: every part, and a sweep pattern its own examples bear out. */
function rule(code: string, parts: Partial<Record<Part, string>> = {}): string {
  const text: Record<Part, string> = {
    rule: "**Rule:** Flag a `debugger` statement left in.",
    violation: "**Violation Example:**\n\n```ts\nfunction total() {\n  debugger;\n}\n```",
    correct: "**Correct Pattern:**\n\n```ts\nfunction total() {\n  return 1;\n}\n```",
    detection: "**Detection:** Look for the statement in added lines.",
    severity: "**Severity:** WARNING",
    why:
      "**Why This Matters:** A breakpoint stops the program wherever a debugger is attached. " +
      "Source: [CWE-489: Active Debug Code](https://cwe.mitre.org/data/definitions/489.html), " +
      "read 2026-11-21.",
    ...parts,
  };
  return [`### ${code}. Debugger Left In`, ...Object.values(text).filter((part) => part !== "")]
    .map((part) => `${part}\n`)
    .join("\n");
}
type Part = "rule" | "violation" | "correct" | "detection" | "severity" | "why";

const sweepTable = (pattern: string, code = "1") =>
  `## Mechanical Sweeps\n\n| Sweep for | What a hit means |\n| --- | --- |\n| \`${pattern}\` | Rule ${code} |\n`;

const template = (...blocks: string[]) => `# A template\n\n## Hygiene\n\n${blocks.join("\n")}`;

describe("the bar a ruleset template is held to", () => {
  it("passes a template whose every rule has every part and whose sweeps its own examples bear out", () => {
    expect(templateBarFailures(template(rule("1"), rule("2"), sweepTable("debugger\\b")))).toEqual(
      [],
    );
  });

  it("names each part a rule is missing", () => {
    expect(
      templateBarFailures(
        template(
          rule("1", { rule: "" }),
          rule("2", { violation: "" }),
          rule("3", { correct: "" }),
          rule("4", { detection: "" }),
          rule("5", { severity: "" }),
        ),
      ),
    ).toEqual([
      'Rule 1 has no "**Rule:**" part.',
      'Rule 2 has no "**Violation Example:**" part.',
      'Rule 3 has no "**Correct Pattern:**" part.',
      'Rule 4 has no "**Detection:**" part.',
      'Rule 5 has no "**Severity:**" line naming CRITICAL, WARNING or NITPICK.',
    ]);
  });

  it("holds every rule to a source: a link, and the date it was read", () => {
    const why = (text: string) => ({ why: `**Why This Matters:** ${text}` });
    expect(
      templateBarFailures(
        template(
          rule("1", { why: "" }),
          rule("2", why("It stops the program. Everyone knows that.")),
          rule("3", why("See [CWE-489](https://cwe.mitre.org/data/definitions/489.html).")),
          rule("4", why("CWE-489, read 2026-11-21.")),
          rule(
            "5",
            why("[CWE-489](https://cwe.mitre.org/data/definitions/489.html), read 2026-11-21."),
          ),
        ),
      ),
    ).toEqual([
      'Rule 1 has no "**Why This Matters:**" part.',
      ...["2", "3", "4"].map(
        (code) =>
          `Rule ${code}'s "**Why This Matters:**" part cites no source: it needs a link to one ` +
          'and the date it was read, as "read 2026-11-21".',
      ),
    ]);
  });

  it("refuses a severity the importer would take as another", () => {
    // ERROR imports as CRITICAL and a word it does not know as WARNING: a
    // template says which of the three it means.
    expect(
      templateBarFailures(
        template(
          rule("1", { severity: "**Severity:** ERROR" }),
          rule("2", { severity: "**Severity:** HIGH" }),
        ),
      ),
    ).toEqual([
      'Rule 1 has no "**Severity:**" line naming CRITICAL, WARNING or NITPICK.',
      'Rule 2 has no "**Severity:**" line naming CRITICAL, WARNING or NITPICK.',
    ]);
  });

  it("holds every sweep pattern to its own rule's examples, line by line as a sweep runs", () => {
    expect(templateBarFailures(template(rule("1"), sweepTable("console\\.")))).toEqual([
      "Rule 1's sweep pattern `console\\.` matches no line of its violation example.",
    ]);
    expect(templateBarFailures(template(rule("1"), sweepTable("function")))).toEqual([
      "Rule 1's sweep pattern `function` matches a line of its correct pattern.",
    ]);
    expect(templateBarFailures(template(rule("1"), sweepTable("debugger(")))).toEqual([
      "Rule 1's sweep pattern `debugger(` does not compile as a regular expression.",
    ]);
    // The fence's own line, which names the language, is not code a sweep
    // would meet.
    expect(templateBarFailures(template(rule("1"), sweepTable("ts")))).toEqual([
      "Rule 1's sweep pattern `ts` matches no line of its violation example.",
    ]);
  });

  it("refuses more rules than a template may have, and none", () => {
    const many = Array.from({ length: TEMPLATE_RULE_LIMIT + 1 }, (_, index) =>
      rule(String(index + 1)),
    );
    expect(TEMPLATE_RULE_LIMIT).toBe(15);
    expect(templateBarFailures(template(...many))).toEqual([
      "It has 16 rules, and a template has at most 15.",
    ]);
    expect(templateBarFailures(template(...many.slice(0, 15)))).toEqual([]);
    expect(templateBarFailures("# A template\n\nNo rule here.\n")).toEqual(["It has no rule."]);
  });

  it("refuses a document the importer refuses", () => {
    expect(templateBarFailures(template(rule("1"), rule("1")))).toEqual([
      'The protocol declares rule "1" more than once. A duplicate code makes a finding ' +
        "ambiguous about which rule it violates, so the import is refused.",
    ]);
  });

  it("is not met by the example protocol, which is a fixture for the importer and not a template", () => {
    const failures = templateBarFailures(EXAMPLE);
    expect(failures).toHaveLength(30);
    expect(failures.slice(0, 4)).toEqual([
      'Rule 1\'s "**Why This Matters:**" part cites no source: it needs a link to one and the ' +
        'date it was read, as "read 2026-11-21".',
      'Rule 2 has no "**Why This Matters:**" part.',
      'Rule 2a has no "**Correct Pattern:**" part.',
      'Rule 2a has no "**Why This Matters:**" part.',
    ]);
  });
});
