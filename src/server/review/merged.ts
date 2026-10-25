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
import { isAncestor, resolveBranch } from "../gitops/repo";
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

/**
 * Per review, the target branch's tip it was last found not merged at. A
 * review is asked of git again only once that branch has moved: every load
 * of the list spawned git once per review not yet merged, however long the
 * history and however still the branches (audit finding S4). Kept for the
 * server's life; a restart asks each once more.
 */
const notMergedAt = new Map<string, string>();

export async function detectMerged(db: Db, reviews: readonly Review[]): Promise<void> {
  // Each branch's tip read once per look, however many reviews target it.
  const tips = new Map<string, Promise<string | null>>();
  for (const review of reviews) {
    if (review.mergedDetectedAt !== null) continue;
    if (MID_RUN.includes(review.status)) continue;

    try {
      const project = requireProject(db, review.projectId);
      const branch = `${project.clonePath}\0${review.intoBranch}`;
      if (!tips.has(branch)) {
        tips.set(
          branch,
          resolveBranch(project.clonePath, review.intoBranch).catch(() => null),
        );
      }
      const tip = await tips.get(branch);
      if (tip === null || tip === undefined || notMergedAt.get(review.id) === tip) continue;
      // Against the branch it was going into, as it stands now.
      if (await isAncestor(project.clonePath, review.fromCommit, review.intoBranch)) {
        markReviewMerged(db, review.id);
      } else {
        notMergedAt.set(review.id, tip);
      }
    } catch {
      // A clone that has gone missing is not a reason to fail a list. The
      // badge is a convenience; the review is the record.
    }
  }
}
