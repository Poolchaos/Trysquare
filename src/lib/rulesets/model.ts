/**
 * The in-memory shape of a ruleset.
 *
 * A rule carries both its parsed fields and the verbatim markdown it came
 * from. The parsed fields drive composition and filtering; the raw markdown is
 * what proves the import lost nothing, and it is what reaches the model, so a
 * rule is never quietly paraphrased into something weaker than the author
 * wrote.
 */

import type { DirectiveSection, Severity } from "@/lib/domain/enums";

export interface SourceSpan {
  /** 1-indexed, inclusive. */
  startLine: number;
  endLine: number;
}

export interface ImportedRule extends SourceSpan {
  /** Protocol numbering, for example "2a". Unique within a ruleset. */
  code: string;
  title: string;
  severity: Severity;
  /** Technology tags, used to narrow which rules reach which file. */
  tags: string[];
  ruleText: string;
  violationExample: string | null;
  correctPattern: string | null;
  detection: string | null;
  /** Everything else the author wrote: rationale, exceptions, examples. */
  notes: string | null;
  /** Regex sources from the sweep table that name this rule. */
  sweepPatterns: string[];
  /** The section heading the rule appeared under. */
  group: string;
  /** Verbatim source, including the heading line. */
  raw: string;
}

export interface ImportedDirective extends SourceSpan {
  section: DirectiveSection;
  title: string;
  contentMd: string;
  raw: string;
}

export interface ImportedRuleset {
  title: string;
  rules: ImportedRule[];
  directives: ImportedDirective[];
}
