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
  it("does not offer the ultracode tier", () => {
    // It lets the session spawn its own workflows, which turns one unattended
    // review into an unbounded amount of someone else's usage.
    expect(SELECTABLE_REVIEW_EFFORTS).not.toContain("max");
    expect(isSelectableEffort("max")).toBe(false);
  });

  it("still offers every other tier, rather than narrowing to one", () => {
    expect([...SELECTABLE_REVIEW_EFFORTS]).toEqual(["low", "medium", "high"]);
  });

  it("still parses a review that was created at the withdrawn tier", () => {
    // The row outlives the rule. A schema that rejected it would make an old
    // review unreadable rather than merely un-repeatable.
    expect(REVIEW_EFFORTS).toContain("max");
    expect(reviewEffortSchema.parse("max")).toBe("max");
  });
});
