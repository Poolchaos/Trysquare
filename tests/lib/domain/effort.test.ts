/**
 * Which effort tiers a person may choose, and which the app must still read.
 *
 * These are two different lists on purpose. Reviews created before the top
 * tier was withdrawn still name it, and a row that stopped parsing would take
 * its whole review with it.
 */

import { describe, expect, it } from "vitest";
import {
  REVIEW_EFFORTS,
  SELECTABLE_REVIEW_EFFORTS,
  isSelectableEffort,
  reviewEffortSchema,
} from "@/lib/domain/enums";

describe("the effort a review runs at", () => {
  it("does not offer the top tier", () => {
    // On cost: up to 5.59 times high per call by the CLI's own index, across
    // every stage of an unattended review (D-125).
    expect(SELECTABLE_REVIEW_EFFORTS).not.toContain("max");
    expect(isSelectableEffort("max")).toBe(false);
  });

  it("still offers every other tier, rather than narrowing to one", () => {
    // xhigh since 4.7, offered only where the model runs it (D-122).
    expect([...SELECTABLE_REVIEW_EFFORTS]).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("still parses a review that was created at the withdrawn tier", () => {
    // The row outlives the rule. A schema that rejected it would make an old
    // review unreadable rather than merely un-repeatable.
    expect(REVIEW_EFFORTS).toContain("max");
    expect(reviewEffortSchema.parse("max")).toBe("max");
  });
});
