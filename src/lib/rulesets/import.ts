/**
 * Importing a review protocol written as markdown.
 *
 * The guarantee this module exists to provide: every line of the source
 * document ends up inside exactly one record. A rule the importer skipped is
 * a rule the review will never apply while still reporting that it applied the
 * whole protocol, which is the same silent-gap failure the coverage ledger
 * exists to prevent, one level up.
 *
 * That guarantee is checked rather than asserted. `importProtocol` returns a
 * coverage report naming every unmapped line, and `exportProtocol` regenerates
 * the document from the records so a round trip can be diffed against the
 * original.
 */

import type { DirectiveSection, Severity } from "@/lib/domain/enums";
import type { ImportedDirective, ImportedRule, ImportedRuleset } from "./model";

export interface ImportCoverage {
  totalLines: number;
  mappedLines: number;
  /** Lines that reached no record. Any at all means the import is incomplete. */
  unmapped: { line: number; text: string }[];
  ruleCount: number;
  directiveCount: number;
}

export interface ImportResult {
  ruleset: ImportedRuleset;
  coverage: ImportCoverage;
}

export class DuplicateRuleCodeError extends Error {
  constructor(readonly code: string) {
    super(
      `The protocol declares rule "${code}" more than once. A duplicate code makes a ` +
        `finding ambiguous about which rule it violates, so the import is refused.`,
    );
    this.name = "DuplicateRuleCodeError";
  }
}

/** A heading line: level, text, and where it was. */
interface Heading {
  level: number;
  text: string;
  line: number;
}

/** `### 2a. Silent Fallback` is a rule; `### Step 1: Inventory` is not. */
const RULE_HEADING = /^([0-9]+[a-z]?)\.\s+(.+)$/;

/**
 * Which directive section a heading belongs to.
 *
 * Ordered, because a heading like "Review Output Format" matches both output
 * and scope keywords and the first match should win.
 */
const SECTION_KEYWORDS: { section: DirectiveSection; patterns: RegExp[] }[] = [
  { section: "prime_directive", patterns: [/prime directive/i, /trust nothing/i] },
  { section: "severity_model", patterns: [/severity/i] },
  { section: "output_format", patterns: [/finding format/i, /output/i, /report format/i] },
  {
    section: "procedure",
    patterns: [/procedure/i, /execution/i, /sweeps?/i, /checklist/i, /steps?/i],
  },
  { section: "scope", patterns: [/scope/i, /what to review/i, /files to ignore/i] },
  { section: "philosophy", patterns: [/philosophy/i, /mindset/i, /thoroughness/i, /purpose/i] },
  { section: "domain_knowledge", patterns: [/domain/i, /glossary/i, /background/i] },
];

export function classifyDirective(headingText: string): DirectiveSection {
  for (const { section, patterns } of SECTION_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(headingText))) return section;
  }
  return "philosophy";
}

/** Tags inferred from the group heading a rule sits under. */
const TAG_KEYWORDS: { tag: string; pattern: RegExp }[] = [
  { tag: "react", pattern: /react|frontend|component|hook/i },
  { tag: "typescript", pattern: /typing|type|typescript/i },
  { tag: "database", pattern: /database|firestore|sql|query|persistence/i },
  { tag: "async", pattern: /async|concurrency|promise|lifecycle/i },
  { tag: "security", pattern: /security|auth|secret/i },
  { tag: "testing", pattern: /test/i },
  { tag: "numeric", pattern: /numeric|money|currency|arithmetic/i },
  { tag: "organisation", pattern: /organis|organiz|structure|naming|hygiene/i },
];

export function inferTags(groupHeading: string, ruleTitle: string): string[] {
  const haystack = `${groupHeading} ${ruleTitle}`;
  const tags = TAG_KEYWORDS.filter(({ pattern }) => pattern.test(haystack)).map(({ tag }) => tag);
  // A rule with no recognisable technology applies everywhere, which is the
  // safe direction: it reaches every file rather than none.
  return tags.length > 0 ? tags : ["general"];
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  CRITICAL: "CRITICAL",
  // Some protocols use ERROR as a hard block. Carrying two names for one
  // severity only invites inconsistent reporting.
  ERROR: "CRITICAL",
  WARNING: "WARNING",
  WARN: "WARNING",
  NITPICK: "NITPICK",
  NIT: "NITPICK",
};

export function parseSeverity(body: string): Severity {
  const match = /\*\*Severity:\*\*\s*([A-Za-z]+)/.exec(body);
  const token = match?.[1]?.toUpperCase();
  if (token && SEVERITY_ALIASES[token]) return SEVERITY_ALIASES[token];
  // An unlabelled rule is treated as a warning rather than dropped or
  // promoted: dropping loses a rule, promoting inflates every report.
  return "WARNING";
}

/** Extracts the text of a `**Label:**` block up to the next bold label or heading. */
export function fieldAfterLabel(body: string, label: string): string | null {
  const lines = body.split("\n");
  const startIndex = lines.findIndex((line) => line.trim().startsWith(`**${label}:**`));
  if (startIndex === -1) return null;

  const collected: string[] = [];
  const first = lines[startIndex]!.trim().slice(`**${label}:**`.length).trim();
  if (first !== "") collected.push(first);

  let inFence = false;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    // A new label or heading ends the field, but not while inside a fence,
    // where such text is example content rather than structure.
    if (!inFence && (/^\s*\*\*[A-Z]/.test(line) || /^#{1,6}\s/.test(line))) break;
    collected.push(line);
  }

  const text = collected.join("\n").trim();
  return text === "" ? null : text;
}

/** Parses the mechanical sweep table into patterns keyed by rule code. */
export function parseSweepTable(markdown: string): Map<string, string[]> {
  const byRule = new Map<string, string[]>();
  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 3) continue;

    const patternCell = cells[1] ?? "";
    const meaningCell = cells[2] ?? "";
    const pattern = /`([^`]+)`/.exec(patternCell)?.[1];
    if (!pattern) continue;

    const codes = [...meaningCell.matchAll(/\b([0-9]+[a-z]?)\b/g)].map((m) => m[1]!);
    for (const code of codes) {
      const existing = byRule.get(code) ?? [];
      if (!existing.includes(pattern)) existing.push(pattern);
      byRule.set(code, existing);
    }
  }
  return byRule;
}

function findHeadings(lines: readonly string[]): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (inFence) return;
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    // A "#" inside a fenced block is code, not a heading.
    if (match) headings.push({ level: match[1]!.length, text: match[2]!.trim(), line: index + 1 });
  });
  return headings;
}

/**
 * Parses a protocol document into rules and directives.
 *
 * Blocks partition the document: each heading owns every line from itself up
 * to the next heading of the same or higher level that starts a new block. A
 * rule heading owns its body; a group heading owns only the text before its
 * first rule, so no line is claimed twice and none is dropped.
 */
export function importProtocol(rawMarkdown: string): ImportResult {
  // Line endings are normalised before anything reads the text. A document
  // saved on Windows carries a trailing carriage return on every line, and
  // JavaScript's `.` does not match one, so `/^(#{1,6})\s+(.*)$/` fails on
  // every heading in the file. The document then parses as a single directive
  // with no rules and the import is refused for having no rules, which is
  // true but says nothing about the cause. Found on a real 2,774-line
  // protocol whose 56 rules all vanished this way.
  const markdown = rawMarkdown.replace(/\r\n?/g, "\n");
  const lines = markdown.split("\n");
  const headings = findHeadings(lines);

  const rules: ImportedRule[] = [];
  const directives: ImportedDirective[] = [];
  const claimed = new Array<boolean>(lines.length).fill(false);
  const sweepPatterns = parseSweepTable(markdown);

  const title = headings.find((h) => h.level === 1)?.text ?? "Imported protocol";

  const claim = (startLine: number, endLine: number) => {
    for (let i = startLine - 1; i < endLine; i += 1) claimed[i] = true;
  };
  const textOf = (startLine: number, endLine: number) =>
    lines.slice(startLine - 1, endLine).join("\n");

  /** The heading whose block a rule belongs under, for tagging. */
  let currentGroup = "";

  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const blockEnd = next ? next.line - 1 : lines.length;
    const raw = textOf(heading.line, blockEnd);
    const body = textOf(heading.line + 1, blockEnd);

    const ruleMatch = heading.level >= 3 ? RULE_HEADING.exec(heading.text) : null;

    if (ruleMatch) {
      const code = ruleMatch[1]!;
      if (rules.some((rule) => rule.code === code)) throw new DuplicateRuleCodeError(code);

      const ruleText = fieldAfterLabel(body, "Rule") ?? body.trim();
      const violationExample = fieldAfterLabel(body, "Violation Example");
      const correctPattern = fieldAfterLabel(body, "Correct Pattern");
      const detection = fieldAfterLabel(body, "Detection");
      const notes = fieldAfterLabel(body, "Why This Matters");

      rules.push({
        code,
        title: ruleMatch[2]!.trim(),
        severity: parseSeverity(body),
        tags: inferTags(currentGroup, ruleMatch[2]!),
        ruleText,
        violationExample,
        correctPattern,
        detection,
        notes,
        sweepPatterns: sweepPatterns.get(code) ?? [],
        group: currentGroup,
        raw,
        startLine: heading.line,
        endLine: blockEnd,
      });
      claim(heading.line, blockEnd);
      return;
    }

    if (heading.level <= 2 && heading.level > 1) currentGroup = heading.text;

    // A group heading whose body is empty still becomes a directive, so the
    // heading line itself is never an unmapped line.
    directives.push({
      section: classifyDirective(heading.text),
      title: heading.text,
      contentMd: body.trim(),
      raw,
      startLine: heading.line,
      endLine: blockEnd,
    });
    claim(heading.line, blockEnd);
  });

  // Anything before the first heading is the document preamble.
  const firstHeadingLine = headings[0]?.line;
  if (firstHeadingLine === undefined) {
    if (lines.length > 0) {
      directives.push({
        section: "philosophy",
        title,
        contentMd: markdown.trim(),
        raw: markdown,
        startLine: 1,
        endLine: lines.length,
      });
      claim(1, lines.length);
    }
  } else if (firstHeadingLine > 1) {
    directives.unshift({
      section: "philosophy",
      title: "Preamble",
      contentMd: textOf(1, firstHeadingLine - 1).trim(),
      raw: textOf(1, firstHeadingLine - 1),
      startLine: 1,
      endLine: firstHeadingLine - 1,
    });
    claim(1, firstHeadingLine - 1);
  }

  const unmapped: { line: number; text: string }[] = [];
  claimed.forEach((isClaimed, index) => {
    if (isClaimed) return;
    // A trailing blank line at end of file is an artefact of splitting, not
    // content, so it is not reported as lost.
    if (index === lines.length - 1 && lines[index] === "") {
      claimed[index] = true;
      return;
    }
    unmapped.push({ line: index + 1, text: lines[index] ?? "" });
  });

  return {
    ruleset: { title, rules, directives },
    coverage: {
      totalLines: lines.length,
      mappedLines: claimed.filter(Boolean).length,
      unmapped,
      ruleCount: rules.length,
      directiveCount: directives.length,
    },
  };
}

/**
 * Regenerates the document from the imported records.
 *
 * Blocks are emitted in source order and verbatim, so a clean diff against the
 * original is proof that the import preserved everything. This is the check
 * that stops the importer quietly dropping a rule it did not understand.
 */
export function exportProtocol(ruleset: ImportedRuleset): string {
  const blocks = [...ruleset.rules, ...ruleset.directives].sort(
    (a, b) => a.startLine - b.startLine,
  );
  return blocks.map((block) => block.raw).join("\n");
}
