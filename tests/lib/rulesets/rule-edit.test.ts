import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportProtocol, importProtocol } from "@/lib/rulesets/import";
import { parseRuleBlock } from "@/lib/rulesets/rule-edit";

const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
).ruleset;
const FALLBACK = PROTOCOL.rules.find((rule) => rule.code === "2a")!;

const refusalOf = (markdown: string) => {
  const read = parseRuleBlock(markdown);
  return "refusal" in read ? read.refusal : null;
};

describe("a rule edited in the app", () => {
  it("is read as the import read it, from its own block alone", () => {
    const read = parseRuleBlock(FALLBACK.raw);
    if ("refusal" in read) throw new Error(read.refusal);
    // The fields an import fills from the text. Tags and sweep patterns come
    // from the document around a rule, so the save keeps the stored ones.
    expect(read.rule).toMatchObject({
      code: "2a",
      title: FALLBACK.title,
      severity: FALLBACK.severity,
      ruleText: FALLBACK.ruleText,
      violationExample: FALLBACK.violationExample,
      correctPattern: FALLBACK.correctPattern,
      detection: FALLBACK.detection,
      notes: FALLBACK.notes,
      raw: FALLBACK.raw,
    });
  });

  it("keeps every line as written, a Windows line ending aside", () => {
    const edited = `### 2a. Silent Fallback\r\n\r\n**Rule:** Say so.\r\n\r\n**Severity:** CRITICAL\r\n`;
    const read = parseRuleBlock(edited);
    if ("refusal" in read) throw new Error(read.refusal);
    expect(read.rule.raw).toBe(
      "### 2a. Silent Fallback\n\n**Rule:** Say so.\n\n**Severity:** CRITICAL\n",
    );
    expect(read.rule).toMatchObject({ ruleText: "Say so.", severity: "CRITICAL" });
  });

  it("refuses text with no rule heading", () => {
    expect(refusalOf("Never fall back without saying so.")).toBe(
      'No rule heading was found. A rule is one heading of three or more #, a code and a title, for example "### 3. Unchecked Cast", and the text under it.',
    );
    expect(refusalOf("")).toMatch(/^No rule heading was found\./);
  });

  it("refuses text before the heading, which would belong to no rule", () => {
    expect(refusalOf(`A note to self.\n${FALLBACK.raw}`)).toBe(
      "Line 1 comes before the rule's heading, so it would belong to no rule. Start with the heading.",
    );
  });

  it("refuses a heading that is not a rule's, naming its line", () => {
    // Two # is a section of the document, not a rule.
    expect(refusalOf("## 2a. Silent Fallback\n\n**Rule:** Say so.")).toBe(
      'Line 1, "2a. Silent Fallback", is not a rule\'s heading. A rule is one heading of three or more #, a code and a title, for example "### 3. Unchecked Cast", and the text under it.',
    );
    expect(refusalOf(`${FALLBACK.raw}\n#### Exceptions\n\nNone.`)).toMatch(
      /^Line \d+, "Exceptions", is not a rule's heading\./,
    );
  });

  it("refuses a code fence left open, which would take the rules after it", () => {
    const open = "### 2a. Silent Fallback\n\n**Rule:** Say so.\n\n```ts\nconst port = 3000;\n";
    // Why: in the ruleset's document every heading after an open fence reads
    // as code, so the rules after this one would be lines of it.
    const document = exportProtocol({
      ...PROTOCOL,
      rules: PROTOCOL.rules.map((rule) => (rule.code === "2a" ? { ...rule, raw: open } : rule)),
    });
    expect(importProtocol(document).ruleset.rules.map((rule) => rule.code)).toEqual([
      "1",
      "2",
      "2a",
    ]);

    expect(refusalOf(open)).toBe(
      "Line 5 opens a code fence that is never closed, so in the ruleset's document the rules after this one would read as code. Close it with a line of three backticks.",
    );
    // A fence opened and closed is a rule like any other.
    expect(refusalOf(`${open}\`\`\`\n`)).toBeNull();
  });

  it("refuses two rules, by their codes", () => {
    const second = PROTOCOL.rules.find((rule) => rule.code === "4")!;
    expect(refusalOf(`${FALLBACK.raw}\n${second.raw}`)).toBe(
      "This holds 2 rules (2a and 4). One rule is saved at a time.",
    );
    expect(refusalOf(`${FALLBACK.raw}\n${FALLBACK.raw}`)).toBe(
      "This holds rule 2a more than once. One rule is saved at a time.",
    );
  });
});
