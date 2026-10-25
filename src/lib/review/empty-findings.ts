/**
 * What a review's findings list says while it has none, by where the review
 * stands. It said every hunk had been accounted for before anything had run
 * (D-224), and then that a review which had finished with nothing to report
 * had stopped (review round 13): a run that finishes waits on a person even
 * with no findings, so that is the commonest state to be in with none.
 */

import type { ReviewStatus } from "@/lib/domain/state-machines";

export function emptyFindings(
  status: ReviewStatus,
  running: boolean,
  queued: boolean,
): { title: string; text: string } {
  if (running) {
    return {
      title: "Nothing reported yet",
      text: "Findings appear once the adversarial pass has run and each one has been checked against the file.",
    };
  }
  if (status === "draft") {
    return { title: "Nothing reported yet", text: "Findings appear once the review has run." };
  }
  if (queued) {
    return { title: "Nothing reported yet", text: "Findings appear once the review has run on." };
  }
  if (status === "awaiting_confirmation" || status === "complete") {
    return {
      title: "No findings",
      text: "Every hunk was accounted for and nothing survived verification.",
    };
  }
  return { title: "No findings", text: "None were reported before the review stopped." };
}
