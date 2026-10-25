/**
 * The mechanical sweeps.
 *
 * Attention fails; a regex does not. Every rule that carries sweep patterns
 * has them run over the added lines of the change before any model sees it,
 * and each hit must later be dispositioned. This is deliberately app code
 * rather than something the model is asked to do, for two reasons: a model
 * asked to grep will sometimes report having grepped, and a sweep that finds
 * nothing must be distinguishable from a sweep that never ran.
 *
 * Implemented in Node rather than by shelling out to a search tool, because
 * such a tool is not guaranteed to exist and a sweep that silently returns
 * nothing when its binary is missing would break the coverage guarantee while
 * looking green.
 */

import type { RepoRole } from "@/lib/domain/enums";
import { addedLineNumbers, type ParsedFile } from "@/lib/git/diff";

export interface SweepRule {
  code: string;
  /**
   * Regex sources, read as literal text when they are not valid regexes.
   * Either way the pattern runs, and which way is recorded, never silent.
   */
  sweepPatterns: readonly string[];
}

export interface SweepTarget {
  repo: RepoRole;
  file: ParsedFile;
}

export interface SweepHit {
  ruleCode: string;
  pattern: string;
  repo: RepoRole;
  path: string;
  /** Line number in the post-change file, which is what a finding cites. */
  line: number;
  excerpt: string;
}

export interface SweepProblem {
  ruleCode: string;
  pattern: string;
  reason: string;
}

export interface SweepOutcome {
  hits: SweepHit[];
  /**
   * Patterns that could not be run. Non-empty means the sweep was incomplete,
   * which the pipeline treats as a failure rather than a warning.
   */
  problems: SweepProblem[];
  /**
   * Patterns that ran as literal text because they do not compile as regular
   * expressions. Real protocols write sweep patterns as code fragments, and a
   * fragment like `new Date(` is an unterminated group to the regex engine.
   * The author's intent, find this text, is unambiguous and runnable, so
   * running it beats refusing the review; recorded so the run says which
   * patterns were read that way.
   */
  ranAsLiteral: { ruleCode: string; pattern: string }[];
  patternsRun: number;
  linesScanned: number;
}

/** Excerpts are trimmed so a minified line cannot flood the ledger. */
const MAX_EXCERPT = 200;

/**
 * A pattern as something runnable, preferring the author's regex.
 *
 * Escaping every metacharacter always yields a compilable expression, so the
 * null branch is a boundary rather than a path reachable today. It stays
 * because `runSweeps` must not silently drop a pattern if this ever changes.
 */
function compile(pattern: string): { regex: RegExp; literal: boolean } | null {
  try {
    // No global flag: each line is tested independently, and a stateful regex
    // would skip every other match through lastIndex.
    return { regex: new RegExp(pattern), literal: false };
  } catch {
    // Not a regex. Read it as the text it is rather than refusing the review.
  }
  try {
    return { regex: new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), literal: true };
  } catch {
    return null;
  }
}

/**
 * Runs every rule's patterns over the added lines of every changed file.
 *
 * Only added lines are swept, matching the protocol's scope rule: a review
 * judges what the change introduced, not what was already there.
 */
export function runSweeps(
  targets: readonly SweepTarget[],
  rules: readonly SweepRule[],
): SweepOutcome {
  const hits: SweepHit[] = [];
  const problems: SweepProblem[] = [];
  const ranAsLiteral: { ruleCode: string; pattern: string }[] = [];
  let patternsRun = 0;
  let linesScanned = 0;

  const compiled: { ruleCode: string; pattern: string; regex: RegExp }[] = [];
  for (const rule of rules) {
    for (const pattern of rule.sweepPatterns) {
      const result = compile(pattern);
      if (!result) {
        problems.push({
          ruleCode: rule.code,
          pattern,
          reason: "the pattern could not be run, even as literal text",
        });
        continue;
      }
      if (result.literal) ranAsLiteral.push({ ruleCode: rule.code, pattern });
      compiled.push({ ruleCode: rule.code, pattern, regex: result.regex });
      patternsRun += 1;
    }
  }

  for (const target of targets) {
    // A binary file has no lines to sweep; a deletion adds none.
    if (target.file.isBinary) continue;

    for (const hunk of target.file.hunks) {
      for (const added of addedLineNumbers(hunk)) {
        linesScanned += 1;
        // One hit per rule and line, named by the first pattern that matched:
        // a hit is dispositioned by path, line and rule, so a second pattern
        // of the same rule seeded a hit no answer could reach, and the
        // review failed its audit after the whole run (audit finding 11).
        const hitBy = new Set<string>();
        for (const { ruleCode, pattern, regex } of compiled) {
          if (hitBy.has(ruleCode) || !regex.test(added.text)) continue;
          hitBy.add(ruleCode);
          hits.push({
            ruleCode,
            pattern,
            repo: target.repo,
            path: target.file.path,
            line: added.line,
            excerpt: added.text.trim().slice(0, MAX_EXCERPT),
          });
        }
      }
    }
  }

  return { hits, problems, ranAsLiteral, patternsRun, linesScanned };
}

export class SweepIncompleteError extends Error {
  constructor(readonly problems: readonly SweepProblem[]) {
    super(
      `${problems.length} sweep pattern(s) could not be run, so the mechanical pass was ` +
        `incomplete: ${problems.map((p) => `${p.ruleCode} (${p.pattern})`).join(", ")}. ` +
        `A partial sweep must not be mistaken for a clean one.`,
    );
    this.name = "SweepIncompleteError";
  }
}

/**
 * Fails when any pattern could not be run.
 *
 * A sweep that skipped a pattern found fewer hits, and fewer hits looks
 * exactly like cleaner code. The run stops instead.
 */
export function assertSweepComplete(outcome: SweepOutcome): void {
  if (outcome.problems.length > 0) throw new SweepIncompleteError(outcome.problems);
}
