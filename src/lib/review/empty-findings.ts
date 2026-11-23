/**
 * What a review's findings list says while it has none, by where the review
 * stands. It said every hunk had been accounted for before anything had run
 * (D-224), and then that a review which had finished with nothing to report
 * had stopped (review round 13): a run that finishes waits on a person even
 * with no findings, so that is the commonest state to be in with none.
 *
 * The list is of code findings. Once the project's own checks have found
 * something, which they do before any stage, it says so and where those
 * are: "No findings" beside them was false.
 */

import type { ReviewStatus } from "@/lib/domain/state-machines";

const CHECKS_ABOVE = " What the project's own checks found is above.";

export function emptyFindings(
  status: ReviewStatus,
  running: boolean,
  queued: boolean,
  checksFound = false,
): { title: string; text: string } {
  const yet = checksFound ? "No code findings yet" : "Nothing reported yet";
  const none = checksFound ? "No code findings" : "No findings";
  const appear = checksFound ? "Code findings appear" : "Findings appear";
  const above = checksFound ? CHECKS_ABOVE : "";
  if (running) {
    return {
      title: yet,
      // Listed as candidates from the end of the stage that raised them,
      // before S5 has ruled on one or checked a quotation.
      text: `${appear} once the adversarial or the deletions stage has raised them, before verification. One that verification then refutes, or the quotation check discards, leaves the list.${above}`,
    };
  }
  if (status === "draft") {
    return { title: yet, text: `${appear} once the review has run.${above}` };
  }
  if (queued) {
    return { title: yet, text: `${appear} once the review has run on.${above}` };
  }
  if (status === "awaiting_confirmation" || status === "complete") {
    return {
      title: none,
      text: `Every hunk was accounted for and nothing survived verification.${above}`,
    };
  }
  return { title: none, text: `None were reported before the review stopped.${above}` };
}
