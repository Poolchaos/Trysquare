/**
 * What an empty findings list says (D-224, review round 13): said of the
 * review as it stands, never of a run that has not happened or as stopped
 * when it finished.
 */

import { describe, expect, it } from "vitest";
import { REVIEW_STATUSES } from "@/lib/domain/state-machines";
import { emptyFindings } from "@/lib/review/empty-findings";

describe("an empty findings list", () => {
  it("says a review that finished with nothing to report accounted for every hunk", () => {
    // A run that finishes waits on a person even with no findings; it read
    // as stopped (review round 13).
    for (const status of ["awaiting_confirmation", "complete"] as const) {
      expect(emptyFindings(status, false, false).text).toBe(
        "Every hunk was accounted for and nothing survived verification.",
      );
    }
  });

  it("says nothing of hunks before a review has run", () => {
    expect(emptyFindings("draft", false, false).text).toBe(
      "Findings appear once the review has run.",
    );
    expect(emptyFindings("draft", false, true).text).toBe(
      "Findings appear once the review has run.",
    );
    // A resume waiting its turn has run in part.
    expect(emptyFindings("paused_limit", false, true).text).toBe(
      "Findings appear once the review has run on.",
    );
  });

  it("says a run in progress is still looking", () => {
    for (const status of ["running", "verifying"] as const) {
      expect(emptyFindings(status, true, false).title).toBe("Nothing reported yet");
    }
  });

  it("says a review that stopped short reported none before it stopped", () => {
    for (const status of ["paused_limit", "interrupted", "failed", "cancelled"] as const) {
      expect(emptyFindings(status, false, false).text).toBe(
        "None were reported before the review stopped.",
      );
    }
  });

  it("has a sentence for every status", () => {
    for (const status of REVIEW_STATUSES) {
      expect(emptyFindings(status, false, false).text).not.toBe("");
    }
  });
});
