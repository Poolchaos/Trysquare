import { describe, expect, it } from "vitest";
import { runSummary } from "@/lib/review/run-summary";

describe("the note a finished run leaves", () => {
  it("counts a quotation-check kill once, not also as a refutation (review of 4.24 to 4.27)", () => {
    // Three findings whose quotations all failed used to read "3 refuted" and
    // "3 discarded by the quotation check" at once.
    expect(
      runSummary(4, {
        candidatesRaised: 5,
        verified: 1,
        killed: 4,
        killedByQuoteCheck: 3,
        openQuestions: 0,
      }),
    ).toBe(
      "Reviewed 4 changed file(s): 5 candidate(s) raised, 1 verified, 1 refuted, 0 left open, " +
        "3 discarded by the quotation check.",
    );
  });
});
