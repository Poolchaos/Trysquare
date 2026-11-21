/**
 * A rule edited or written in the app, read exactly as an import reads it.
 *
 * The rule is edited as the markdown it is, heading line and all, and the
 * block goes through the importer's own parser as a document of one rule. A
 * form of separate fields would have to rebuild the markdown, and what the
 * model is given would then be the app's wording, not the person's (D-265).
 * Anything that is not exactly one rule, every line of it kept, is refused
 * in words the person can act on.
 */

import { DuplicateRuleCodeError, importProtocol, unclosedFenceLine } from "./import";
import type { ImportedRule } from "./model";

const SHAPE =
  'A rule is one heading of three or more #, a code and a title, for example "### 3. Unchecked Cast", and the text under it.';

/**
 * What a new rule's editor opens on (RA-3) is made of these: the protocol's
 * shape, each part a line to replace. A block still holding one is refused,
 * so none of it reaches a model as a rule.
 */
const STARTING_TEXT = {
  title: "Title of the rule",
  rule: "What a change must not do, in one sentence.",
  violation: "code that breaks the rule",
  correct: "the same code, done right",
  detection: "What to look for in the change.",
};

/** The block a new rule starts from, under the next code after the highest in use. */
export function startingRuleBlock(codes: readonly string[]): string {
  const highest = Math.max(0, ...codes.map((code) => Number.parseInt(code, 10)));
  return [
    `### ${highest + 1}. ${STARTING_TEXT.title}`,
    "",
    `**Rule:** ${STARTING_TEXT.rule}`,
    "",
    "**Violation Example:**",
    "",
    "```",
    STARTING_TEXT.violation,
    "```",
    "",
    "**Correct Pattern:**",
    "",
    "```",
    STARTING_TEXT.correct,
    "```",
    "",
    `**Detection:** ${STARTING_TEXT.detection}`,
    "",
    "**Severity:** WARNING",
    "",
  ].join("\n");
}

/** A new rule's block: one rule as `parseRuleBlock` reads it, none of it the starting text. */
export function parseNewRuleBlock(markdown: string): { rule: ImportedRule } | { refusal: string } {
  const read = parseRuleBlock(markdown);
  if ("refusal" in read) return read;
  const starting = Object.values(STARTING_TEXT);
  const left = read.rule.raw
    .split("\n")
    .findIndex((line) => starting.some((text) => line.includes(text)));
  if (left !== -1) {
    return {
      refusal: `Line ${left + 1} still holds the starting text. Write the rule's own there, or take that part out.`,
    };
  }
  return read;
}

export function parseRuleBlock(markdown: string): { rule: ImportedRule } | { refusal: string } {
  let read;
  try {
    read = importProtocol(markdown);
  } catch (error) {
    if (error instanceof DuplicateRuleCodeError) {
      return {
        refusal: `This holds rule ${error.code} more than once. One rule is saved at a time.`,
      };
    }
    throw error;
  }
  const { rules, directives } = read.ruleset;

  // Whatever is not a rule's block the importer keeps as a directive, so no
  // line is lost: here it is a line that would belong to no rule.
  const stray = directives[0];
  if (stray !== undefined) {
    if (rules.length === 0 && stray.startLine === 1 && !/^#{1,6}\s/.test(markdown)) {
      return { refusal: `No rule heading was found. ${SHAPE}` };
    }
    if (stray.title === "Preamble" && stray.startLine === 1 && !/^#{1,6}\s/.test(markdown)) {
      return {
        refusal:
          "Line 1 comes before the rule's heading, so it would belong to no rule. Start with the heading.",
      };
    }
    return {
      refusal: `Line ${stray.startLine}, "${stray.title}", is not a rule's heading. ${SHAPE}`,
    };
  }

  const lost = read.coverage.unmapped.filter((entry) => entry.text.trim() !== "");
  if (lost.length > 0) {
    return {
      refusal: `Line ${lost[0]!.line} would be lost: it reached no rule. Nothing is saved.`,
    };
  }
  if (rules.length === 0) return { refusal: `No rule heading was found. ${SHAPE}` };
  if (rules.length > 1) {
    const codes = rules.map((rule) => rule.code);
    return {
      refusal: `This holds ${rules.length} rules (${codes.slice(0, -1).join(", ")} and ${codes.at(-1)}). One rule is saved at a time.`,
    };
  }
  const rule = rules[0]!;
  // Read alone the block is one rule either way; in the ruleset's document
  // an open fence would take every rule after this one into it.
  const open = unclosedFenceLine(rule.raw);
  if (open !== null) {
    return {
      refusal: `Line ${open} opens a code fence that is never closed, so in the ruleset's document the rules after this one would read as code. Close it with a line of three backticks.`,
    };
  }
  return { rule };
}
