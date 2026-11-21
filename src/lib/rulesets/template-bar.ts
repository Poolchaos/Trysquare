/**
 * The bar a ruleset template is held to before it is offered to anyone
 * (`docs/plans/RULESET-TEMPLATES-PLAN.md`, section 1): the parts of it a
 * program can check.
 *
 * A template is a protocol document, read by the importer as any other. An
 * import takes a rule with no example and a sweep pattern that matches
 * nothing; a template may not, since a person starts a real review from it
 * without having read it.
 */

import { SEVERITIES } from "@/lib/domain/enums";
import { DuplicateRuleCodeError, importProtocol, isFenceLine, severityWord } from "./import";
import type { ImportedRule } from "./model";

/** Every rule is put to the model for every file its tags fit, so a template stays small. */
export const TEMPLATE_RULE_LIMIT = 15;

/**
 * The lines of an example a sweep would meet: those inside its code fences,
 * or all of it where it has none. A fence's own line names a language and is
 * not code.
 */
function codeLines(example: string): string[] {
  const lines = example.split("\n");
  if (!lines.some(isFenceLine)) return lines;
  const inside: string[] = [];
  let open = false;
  for (const line of lines) {
    if (isFenceLine(line)) open = !open;
    else if (open) inside.push(line);
  }
  return inside;
}

function ruleFailures(rule: ImportedRule): string[] {
  const failures: string[] = [];
  const missing = (label: string) => `Rule ${rule.code} has no "**${label}:**" part.`;
  // `ruleText` falls back to the whole body, so the label is looked for.
  if (!/^\s*\*\*Rule:\*\*/m.test(rule.raw)) failures.push(missing("Rule"));
  if (rule.violationExample === null) failures.push(missing("Violation Example"));
  if (rule.correctPattern === null) failures.push(missing("Correct Pattern"));
  if (rule.detection === null) failures.push(missing("Detection"));
  // The importer takes ERROR as CRITICAL and an unknown word as WARNING. A
  // template names the one it means.
  const word = severityWord(rule.raw);
  if (word === null || !SEVERITIES.some((severity) => severity === word)) {
    failures.push(
      `Rule ${rule.code} has no "**Severity:**" line naming ${SEVERITIES.slice(0, -1).join(", ")} or ${SEVERITIES.at(-1)}.`,
    );
  }
  // Nothing in a template is recalled: each rule rests on a source its
  // reader can open. That it is a primary one, and says what the rule says,
  // is read by a person.
  if (rule.notes === null) failures.push(missing("Why This Matters"));
  else if (
    !/\]\(https:\/\/[^)\s]+\)/.test(rule.notes) ||
    !/\bread \d{4}-\d{2}-\d{2}\b/.test(rule.notes)
  ) {
    failures.push(
      `Rule ${rule.code}'s "**Why This Matters:**" part cites no source: it needs a link to one ` +
        'and the date it was read, as "read 2026-11-21".',
    );
  }

  for (const pattern of rule.sweepPatterns) {
    const named = `Rule ${rule.code}'s sweep pattern \`${pattern}\``;
    let regex: RegExp;
    try {
      // As a sweep compiles it, less its fallback to literal text: a
      // template's pattern is meant as the expression it is.
      regex = new RegExp(pattern);
    } catch {
      failures.push(`${named} does not compile as a regular expression.`);
      continue;
    }
    const hits = (example: string) => codeLines(example).some((line) => regex.test(line));
    if (rule.violationExample !== null && !hits(rule.violationExample)) {
      failures.push(`${named} matches no line of its violation example.`);
    }
    if (rule.correctPattern !== null && hits(rule.correctPattern)) {
      failures.push(`${named} matches a line of its correct pattern.`);
    }
  }
  return failures;
}

/** Every way this document falls short of the bar, in words its author can act on. None when it meets it. */
export function templateBarFailures(markdown: string): string[] {
  let read;
  try {
    read = importProtocol(markdown);
  } catch (error) {
    if (error instanceof DuplicateRuleCodeError) return [error.message];
    throw error;
  }
  const { rules } = read.ruleset;
  const lost = read.coverage.unmapped
    .filter((entry) => entry.text.trim() !== "")
    .map((entry) => `Line ${entry.line} belongs to no rule or directive.`);
  if (rules.length === 0) return [...lost, "It has no rule."];
  return [
    ...lost,
    ...(rules.length > TEMPLATE_RULE_LIMIT
      ? [`It has ${rules.length} rules, and a template has at most ${TEMPLATE_RULE_LIMIT}.`]
      : []),
    ...rules.flatMap(ruleFailures),
  ];
}
