import { describe, expect, it } from "vitest";
import {
  CONTEXT_BUDGET_FRACTION,
  budgetFor,
  estimateTokens,
  fitsBudget,
  splitToFit,
} from "@/lib/review/budget";

describe("estimating size", () => {
  it("approximates four characters per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("rounds up, so a partial token is never treated as free", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("")).toBe(0);
  });

  it("leaves headroom in the window for the reply and the files read", () => {
    expect(budgetFor(1000)).toBe(800);
    expect(CONTEXT_BUDGET_FRACTION).toBeLessThan(1);
  });

  it("judges a composed prompt against the budget, not the whole window", () => {
    // 100 tokens of system plus 100 of user is 200, over a budget of 160.
    const text = "a".repeat(400);
    expect(fitsBudget(text, text, 200)).toBe(false);
    expect(fitsBudget(text, text, 1000)).toBe(true);
  });
});

const item = (key: string, tokens: number) => ({ key, estimatedTokens: tokens });

describe("splitting work to fit", () => {
  it("keeps everything in one group when it all fits", () => {
    const result = splitToFit([item("a", 10), item("b", 10)], 100);
    expect(result.groups).toEqual([[item("a", 10), item("b", 10)]]);
    expect(result.oversized).toEqual([]);
  });

  it("starts a new group when the next item would overflow", () => {
    const result = splitToFit([item("a", 60), item("b", 60), item("c", 10)], 100);
    expect(result.groups.map((group) => group.map((entry) => entry.key))).toEqual([
      ["a"],
      ["b", "c"],
    ]);
  });

  it("subtracts the fixed overhead from every group's budget", () => {
    // 100 budget minus 80 of system prompt leaves 20 per request.
    const result = splitToFit([item("a", 15), item("b", 15)], 100, 80);
    expect(result.groups).toHaveLength(2);
  });

  it("preserves order, so the same change set always splits the same way", () => {
    const items = [item("a", 40), item("b", 40), item("c", 40), item("d", 40)];
    const first = splitToFit(items, 100).groups.map((g) => g.map((e) => e.key));
    const second = splitToFit(items, 100).groups.map((g) => g.map((e) => e.key));
    expect(first).toEqual(second);
    expect(first).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("sends an item too large to fit, and names it", () => {
    // Deciding here not to review it would be the one thing that must not
    // happen; being told by the model that it is too large is recoverable.
    const result = splitToFit([item("small", 10), item("huge", 500)], 100);
    expect(result.oversized.map((entry) => entry.key)).toEqual(["huge"]);
    expect(result.groups.flat().map((entry) => entry.key)).toEqual(["small", "huge"]);
  });

  it("never drops an item, whatever the sizes", () => {
    const items = [item("a", 5), item("b", 500), item("c", 5), item("d", 500), item("e", 5)];
    const result = splitToFit(items, 50);
    expect(result.groups.flat().map((entry) => entry.key)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("handles an empty list without producing an empty group", () => {
    expect(splitToFit([], 100)).toEqual({ groups: [], oversized: [] });
  });

  it("still makes progress when the overhead exceeds the budget", () => {
    // A pathological configuration must not produce a zero-size budget and
    // loop, or silently drop everything.
    const result = splitToFit([item("a", 1), item("b", 1)], 10, 100);
    expect(result.groups.flat()).toHaveLength(2);
  });
});
