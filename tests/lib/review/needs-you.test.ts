import { describe, expect, it } from "vitest";
import { REVIEW_STATUSES } from "@/lib/domain/state-machines";
import { needsAPerson, needsYouKind, needsYouLine } from "@/lib/review/needs-you";

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

describe("a review answered in the person's own session (the twentieth grade, AH3)", () => {
  it("needs them while it runs: each stage waits for its command to be run", () => {
    expect(needsYouKind({ status: "running", engineMode: "interactive" })).toBe("interactive");
    expect(needsYouKind({ status: "verifying", engineMode: "interactive" })).toBe("interactive");
    expect(needsYouLine({ status: "interactive", decided: 0, total: 0 })).toBe(
      "runs in your terminal: its page prints the command to run",
    );
  });

  it("is listed as any review is once it stops or waits on a decision", () => {
    expect(needsYouKind({ status: "failed", engineMode: "interactive" })).toBe("failed");
    expect(needsYouKind({ status: "awaiting_confirmation", engineMode: "interactive" })).toBe(
      "awaiting_confirmation",
    );
  });

  it("does not make a running headless review, a draft or a finished one need anyone", () => {
    expect(needsYouKind({ status: "running", engineMode: "headless" })).toBeNull();
    expect(needsYouKind({ status: "draft", engineMode: "interactive" })).toBeNull();
    expect(needsYouKind({ status: "complete", engineMode: "interactive" })).toBeNull();
  });
});
