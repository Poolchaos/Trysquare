/**
 * Composing what a review stage is told, and planning how the work is divided
 * when a model cannot take it all at once.
 *
 * The rule that governs this module: how the work is divided adapts to the
 * model, what must be accounted for never does. A weaker model gets more,
 * smaller requests. Where a rule genuinely should not apply to a file, that
 * omission is recorded with a reason rather than simply not happening, so a
 * narrowed review is never indistinguishable from a complete one.
 */

import type { ReviewProfile, ReviewStage } from "@/lib/domain/enums";
import type { ImportedDirective, ImportedRule } from "./model";

/** Rules are grouped into themes when a model cannot hold them all at once. */
export const RULE_THEMES = [
  "typescript",
  "react",
  "async",
  "database",
  "security",
  "numeric",
  "testing",
  "organisation",
  "general",
] as const;

export type RuleTheme = (typeof RULE_THEMES)[number];

/**
 * The identity of a rule/file pair.
 *
 * Defined once and used by everything that produces or consumes coverage, so
 * the two sides cannot drift apart. They already did once: a corrupted
 * separator made every key look correct while matching nothing, and the
 * coverage check reported total failure against a plan that was complete.
 */
export function pairKey(ruleCode: string, file: string): string {
  return `${ruleCode}::${file}`;
}

const STAGE_INSTRUCTIONS: Record<ReviewStage, string> = {
  s1_risk:
    "Classify each changed file by the risk categories it touches. Do not report findings yet.",
  s2_comprehension:
    "Explain what each changed file does and why, in your own words. Read every file in the " +
    "execution chain, including files the change did not touch. Report no findings in this " +
    "stage: forming findings before understanding the code is what produces plausible wrong ones.",
  s3_adversarial:
    "For every hunk, walk each rule below explicitly and state whether it applies. Produce " +
    "candidate findings, and for every hunk with no finding give the reason it is clear. A hunk " +
    "you do not mention is treated as unreviewed and will fail the run.",
  s4_deletions:
    "For every deleted or removed block, state what behaviour it provided and who depended on " +
    "it. Removed guards, awaits, cleanups, and error handlers are the highest risk.",
  s5_verification:
    "For each candidate finding, open the cited file, quote the exact lines, and try to refute " +
    "the finding. Look for a guard, default, or narrowing that already handles it. Report the " +
    "line numbers you actually found the code at, not the ones you were given.",
  s6_audit: "Summarise what was reviewed and what was found, for the report.",
};

export function stageInstruction(stage: ReviewStage): string {
  return STAGE_INSTRUCTIONS[stage];
}

/** A compact list of rules, for stages that do not need the full text. */
export function renderRuleIndex(rules: readonly ImportedRule[]): string {
  return rules.map((rule) => `- ${rule.code} (${rule.severity}): ${rule.title}`).join("\n");
}

/**
 * One rule, verbatim.
 *
 * The author's own wording reaches the model unchanged. Summarising a rule to
 * save tokens would quietly change what is being checked.
 */
export function renderRule(rule: ImportedRule): string {
  const parts = [
    `### Rule ${rule.code}: ${rule.title}`,
    ``,
    `Severity: ${rule.severity}`,
    ``,
    rule.ruleText,
  ];
  if (rule.violationExample) parts.push(``, `Violation example:`, ``, rule.violationExample);
  if (rule.correctPattern) parts.push(``, `Correct pattern:`, ``, rule.correctPattern);
  if (rule.detection) parts.push(``, `How to detect it:`, ``, rule.detection);
  if (rule.notes) parts.push(``, `Why it matters:`, ``, rule.notes);
  return parts.join("\n");
}

export function renderDirectives(directives: readonly ImportedDirective[]): string {
  return directives
    .map((directive) => `## ${directive.title}\n\n${directive.contentMd}`)
    .join("\n\n");
}

export interface ComposeOptions {
  directives: readonly ImportedDirective[];
  rules: readonly ImportedRule[];
  stage: ReviewStage;
  /** Full rule text is sent only where the stage needs to apply the rules. */
  includeFullRules: boolean;
  /** Appended verbatim; the schema the stage must answer with. */
  outputContract: string;
}

export function composeSystemPrompt(options: ComposeOptions): string {
  const ruleSection = options.includeFullRules
    ? options.rules.map(renderRule).join("\n\n")
    : `The full text of each rule is applied in the adversarial stage. For reference:\n\n${renderRuleIndex(options.rules)}`;

  return [
    "You are performing a code review under a fixed protocol. Follow it exactly.",
    "",
    "# Protocol",
    "",
    renderDirectives(options.directives),
    "",
    "# Rules",
    "",
    ruleSection,
    "",
    "# This stage",
    "",
    stageInstruction(options.stage),
    "",
    "# Output",
    "",
    options.outputContract,
  ].join("\n");
}

/** Which technologies a file could plausibly involve, from its path. */
export function themesForPath(path: string): RuleTheme[] {
  const themes = new Set<RuleTheme>(["general"]);
  if (/\.(ts|tsx|mts|cts)$/.test(path)) themes.add("typescript");
  if (/\.(tsx|jsx)$/.test(path)) themes.add("react");
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
    themes.add("async");
    themes.add("numeric");
    themes.add("organisation");
    themes.add("security");
  }
  if (/test|spec/.test(path)) themes.add("testing");
  if (/(repository|repositories|db|database|sql|query|model)/i.test(path)) themes.add("database");
  return [...themes];
}

export interface RuleBatch {
  /** Rules sent in this request. */
  rules: ImportedRule[];
  /** Files this request covers. */
  files: string[];
  theme?: RuleTheme;
}

export interface ExcludedPair {
  rule: string;
  file: string;
  reason: string;
}

export interface BatchPlan {
  profile: ReviewProfile;
  batches: RuleBatch[];
  /**
   * Rule/file pairs deliberately left out, each with its reason.
   *
   * Narrowing is only legitimate when it is visible, so these are recorded and
   * reported rather than silently not happening.
   */
  excluded: ExcludedPair[];
}

function groupByTheme(rules: readonly ImportedRule[]): Map<RuleTheme, ImportedRule[]> {
  const byTheme = new Map<RuleTheme, ImportedRule[]>();
  for (const rule of rules) {
    for (const tag of rule.tags) {
      const theme = (RULE_THEMES as readonly string[]).includes(tag)
        ? (tag as RuleTheme)
        : "general";
      byTheme.set(theme, [...(byTheme.get(theme) ?? []), rule]);
    }
  }
  return byTheme;
}

function coveredPairs(batches: readonly RuleBatch[]): Set<string> {
  const covered = new Set<string>();
  for (const batch of batches) {
    for (const rule of batch.rules) {
      for (const file of batch.files) covered.add(pairKey(rule.code, file));
    }
  }
  return covered;
}

/**
 * Divides the adversarial work into requests according to the model's profile.
 *
 * full-context sends everything at once. chunked sends every rule against every
 * file, one theme per request. decomposed goes file by file and sends only the
 * themes that file could plausibly involve, which is the only profile that
 * narrows anything, and therefore the only one that records exclusions.
 */
export function planRuleBatches(
  rules: readonly ImportedRule[],
  files: readonly string[],
  profile: ReviewProfile,
): BatchPlan {
  if (profile === "mechanical-only") {
    // Not trusted with judgment, so it is never given a rule to judge against.
    return { profile, batches: [], excluded: [] };
  }

  if (profile === "full-context") {
    return { profile, batches: [{ rules: [...rules], files: [...files] }], excluded: [] };
  }

  const byTheme = groupByTheme(rules);

  if (profile === "chunked") {
    const batches: RuleBatch[] = [];
    for (const [theme, themeRules] of byTheme) {
      batches.push({ rules: themeRules, files: [...files], theme });
    }
    // Every rule still reaches every file; only the request size changes.
    return { profile, batches, excluded: [] };
  }

  const batches: RuleBatch[] = [];
  const skipped: ExcludedPair[] = [];
  for (const file of files) {
    const applicable = themesForPath(file);
    for (const [theme, themeRules] of byTheme) {
      if (applicable.includes(theme)) {
        batches.push({ rules: themeRules, files: [file], theme });
        continue;
      }
      for (const rule of themeRules) {
        skipped.push({
          rule: rule.code,
          file,
          reason: `the ${theme} theme does not apply to this file`,
        });
      }
    }
  }

  // A rule can carry several themes. If any of them applied to a file, the
  // rule was covered there and must not also be reported as excluded.
  const covered = coveredPairs(batches);
  const excluded: ExcludedPair[] = [];
  for (const pair of skipped) {
    if (covered.has(pairKey(pair.rule, pair.file))) continue;
    if (excluded.some((seen) => seen.rule === pair.rule && seen.file === pair.file)) continue;
    excluded.push(pair);
  }

  return { profile, batches, excluded };
}

export class IncompleteRuleCoverageError extends Error {
  constructor(readonly missing: { rule: string; file: string }[]) {
    const shown = missing
      .slice(0, 5)
      .map((pair) => `${pair.rule} against ${pair.file}`)
      .join(", ");
    super(
      `The planned requests neither cover nor account for ${missing.length} rule/file pair(s), ` +
        `for example ${shown}. A profile may divide the work differently, and may narrow it if it ` +
        `records what it left out, but nothing may go unchecked without being named.`,
    );
    this.name = "IncompleteRuleCoverageError";
  }
}

/**
 * Proves the plan accounts for every rule against every file.
 *
 * This is what makes "a weaker model gets more requests, not less scrutiny" a
 * checkable statement rather than an intention. Run before the adversarial
 * stage, so a narrowing bug fails immediately rather than producing a review
 * that quietly skipped a rule.
 */
export function assertBatchesCoverEverything(
  plan: BatchPlan,
  rules: readonly ImportedRule[],
  files: readonly string[],
): void {
  if (plan.profile === "mechanical-only") return;

  const covered = coveredPairs(plan.batches);
  const accountedFor = new Set(plan.excluded.map((pair) => pairKey(pair.rule, pair.file)));

  const missing: { rule: string; file: string }[] = [];
  for (const rule of rules) {
    for (const file of files) {
      const key = pairKey(rule.code, file);
      // Either it was checked, or the plan says in writing why it was not.
      if (!covered.has(key) && !accountedFor.has(key)) missing.push({ rule: rule.code, file });
    }
  }

  if (missing.length > 0) throw new IncompleteRuleCoverageError(missing);

  // Only the narrowing profile is permitted to leave anything out at all.
  if (plan.profile !== "decomposed" && plan.excluded.length > 0) {
    throw new IncompleteRuleCoverageError(plan.excluded);
  }
}
