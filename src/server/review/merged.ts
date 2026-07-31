/**
 * Noticing that a reviewed branch has since merged.
 *
 * Checked when a review is looked at rather than on a timer, because there is
 * no moment a background poll would be right for and a stale badge is worse
 * than a late one. Recorded once: the answer cannot become false again, since
 * the reviewed commit is pinned and an ancestor stays an ancestor.
 *
 * Nothing is deleted automatically. A merged review is exactly the record of
 * how something got merged, and throwing that away on a schedule would be the
 * app deciding what a person's history is worth.
 */

import { ACTIVE_REVIEW_STATUSES } from "@/lib/domain/state-machines";
import { requireProject } from "../db/repositories/projects";
import { markReviewMerged, type Review } from "../db/repositories/reviews";
import { isAncestor } from "../gitops/repo";
import type { Db } from "../db/client";

/**
 * Everything except a review that is running right now.
 *
 * The first draft of this checked only finished reviews, which missed the
 * clearest case there is: a draft of a branch that has since merged is stale
 * before it ever ran, and is exactly what someone would want to delete. A
 * review mid-flight is the only one where the question is noise, because its
 * answer cannot change what the run is already doing.
 */
const MID_RUN: readonly string[] = [...ACTIVE_REVIEW_STATUSES];

export async function detectMerged(db: Db, reviews: readonly Review[]): Promise<void> {
  for (const review of reviews) {
    if (review.mergedDetectedAt !== null) continue;
    if (MID_RUN.includes(review.status)) continue;

    try {
      const project = requireProject(db, review.projectId);
      // Against the branch it was going into, as it stands now.
      if (await isAncestor(project.clonePath, review.fromCommit, review.intoBranch)) {
        markReviewMerged(db, review.id);
      }
    } catch {
      // A clone that has gone missing is not a reason to fail a list. The
      // badge is a convenience; the review is the record.
    }
  }
}
