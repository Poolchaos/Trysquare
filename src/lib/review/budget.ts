/**
 * Fitting a stage's work inside the model's context window.
 *
 * A prompt that overflows is not a smaller review, it is a failed request, and
 * the tempting fix (send less) is the one thing that must never happen
 * silently. So when the work does not fit, it is split into more requests and
 * the split is recorded. Nothing is dropped, and if a single file is too large
 * to fit on its own that is reported rather than quietly truncated.
 */

/**
 * Rough token count.
 *
 * Four characters per token is the usual English approximation and is close
 * enough for a budget decision. It is deliberately an estimate: the point is
 * to split before the model refuses, not to predict the count exactly, so the
 * threshold below leaves headroom rather than relying on precision here.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * How much of the window a single request may plan to use.
 *
 * The remainder is headroom for the model's own reply, for the files it
 * chooses to read with its tools, and for the estimate being an estimate.
 */
export const CONTEXT_BUDGET_FRACTION = 0.8;

export function budgetFor(contextWindow: number): number {
  return Math.floor(contextWindow * CONTEXT_BUDGET_FRACTION);
}

export interface SizedItem {
  /** Identity of the thing being packed, usually a file path. */
  key: string;
  estimatedTokens: number;
}

export interface SplitResult<T extends SizedItem> {
  groups: T[][];
  /**
   * Items that do not fit even alone. They are still sent, in a group of
   * their own, and named here so the run can say what it was not confident
   * about rather than appearing to have reviewed it normally.
   */
  oversized: T[];
}

/**
 * Packs items into groups that each fit the budget.
 *
 * Greedy and order-preserving, so the same change set always splits the same
 * way and a review is reproducible. An item larger than the whole budget gets
 * its own group and is reported: sending it and being told it is too large is
 * strictly better than deciding here not to review it.
 */
export function splitToFit<T extends SizedItem>(
  items: readonly T[],
  budget: number,
  overheadTokens = 0,
): SplitResult<T> {
  const available = Math.max(budget - overheadTokens, 1);
  const groups: T[][] = [];
  const oversized: T[] = [];

  let current: T[] = [];
  let currentTokens = 0;

  for (const item of items) {
    if (item.estimatedTokens > available) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
        currentTokens = 0;
      }
      groups.push([item]);
      oversized.push(item);
      continue;
    }

    if (currentTokens + item.estimatedTokens > available && current.length > 0) {
      groups.push(current);
      current = [item];
      currentTokens = item.estimatedTokens;
      continue;
    }

    current.push(item);
    currentTokens += item.estimatedTokens;
  }

  if (current.length > 0) groups.push(current);
  return { groups, oversized };
}

/** True when a composed prompt is expected to fit. */
export function fitsBudget(
  systemPrompt: string,
  userPrompt: string,
  contextWindow: number,
): boolean {
  return estimateTokens(systemPrompt) + estimateTokens(userPrompt) <= budgetFor(contextWindow);
}
