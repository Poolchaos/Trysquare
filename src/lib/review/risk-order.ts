/**
 * Working the riskiest files first.
 *
 * 03 specifies high-risk-first ordering and S1 has always produced the risk
 * tags for it, but nothing read them back, so the column was written on every
 * review and never used. This is the reader.
 *
 * It changes only the order work is done in, never which work is done: the
 * result is a permutation, and every reconciliation downstream compares sets
 * of hunks, sweep hits and paths rather than sequences. That is what makes
 * this safe to apply to a pipeline whose whole point is that nothing is
 * skipped.
 *
 * The rank is how many distinct categories a file touches. The protocol lists
 * its seven categories without ranking them, so ordering by severity would
 * mean inventing a severity the protocol does not state; how many different
 * kinds of risk one file carries is derivable from what S1 actually answers.
 */

import type { RiskTag } from "@/lib/domain/enums";

export interface RiskRanked {
  path: string;
  riskTags: readonly RiskTag[];
}

/**
 * The paths in the order the later stages should see them.
 *
 * Distinct tags, not tag count: the stage schema puts no uniqueness
 * constraint on the array and the ledger round-trips it verbatim, so a model
 * answering "money, money, money" would otherwise outrank a file genuinely
 * touching two categories. Ties keep the order they arrived in, which the
 * caller passes as the inventory order.
 */
export function riskOrderedPaths(files: readonly RiskRanked[]): string[] {
  return [...files]
    .sort((a, b) => new Set(b.riskTags).size - new Set(a.riskTags).size)
    .map((file) => file.path);
}

/**
 * A comparator that puts any list of things into an order already decided.
 *
 * The same order has to reach two different lists: the entries the prompts
 * are rendered from, and the ledger rows the batch plan is built from.
 *
 * A path the order does not mention sorts last by way of `order.length`
 * rather than `Infinity`, because `Infinity - Infinity` is NaN, and a
 * comparator that returns NaN silently scrambles the array instead of
 * leaving it alone.
 */
export function byRiskOrder<T>(
  order: readonly string[],
  pathOf: (item: T) => string,
): (a: T, b: T) => number {
  const rank = new Map(order.map((path, index) => [path, index] as const));
  return (a, b) => (rank.get(pathOf(a)) ?? order.length) - (rank.get(pathOf(b)) ?? order.length);
}
