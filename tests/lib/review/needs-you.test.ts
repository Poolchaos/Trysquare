import { describe, expect, it } from "vitest";
import { REVIEW_STATUSES } from "@/lib/domain/state-machines";
import { needsAPerson, needsYouLine } from "@/lib/review/needs-you";

describe("which reviews need a person", () => {
  it("takes one awaiting a decision and every one that goes on only at a Resume", () => {
    // A draft waits on Start and is not a stopped run; cancelled and
    // complete are final; one running wants nothing yet.
    expect(REVIEW_STATUSES.filter(needsAPerson)).toEqual([
      "awaiting_confirmation",
      "paused_limit",
      "interrupted",
      "failed",
    ]);
  });
});

describe("what a Needs you row says", () => {
  it("counts the decisions made of those to make", () => {
    expect(needsYouLine({ status: "awaiting_confirmation", decided: 2, total: 9 })).toBe(
      "2 of 9 decided",
    );
    expect(needsYouLine({ status: "awaiting_confirmation", decided: 0, total: 0 })).toBe(
      "no findings",
    );
  });

  it("says which stop it was and names the button, whatever was found before it", () => {
    const found = { decided: 0, total: 4 };
    // A Resume pressed before the limit clears pauses again, so the row
    // does not say it goes on.
    expect(needsYouLine({ status: "paused_limit", ...found })).toBe(
      "paused at the usage limit: Resume once it clears",
    );
    expect(needsYouLine({ status: "interrupted", ...found })).toBe("interrupted: Resume to go on");
    expect(needsYouLine({ status: "failed", ...found })).toBe("failed: Resume to go on");
  });
});
