/**
 * The danger zone: every project, review and ruleset, gone.
 *
 * Deliberately not a truncate. It walks the same deletion paths the single
 * delete buttons use, so a wipe cannot leave behind the clones and run
 * directories a raw table delete would orphan on disk.
 *
 * Exports are kept. They live outside a review's artifacts precisely because
 * a report is the thing the review was for, and someone clearing out working
 * state is not asking to lose the reports they already wrote. The response
 * says so rather than leaving it to be discovered.
 */

import { exportsDir } from "@/lib/paths";
import { deleteProject, getProject, listProjects } from "@/server/db/repositories/projects";
import { listActiveReviews, listReviewsForProject } from "@/server/db/repositories/reviews";
import { deleteRuleset, listRulesets } from "@/server/db/repositories/rulesets";
import { deleteReviewEntirely } from "@/server/review/service";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";
import { removeProjectFiles } from "@/server/projects/clone";

export const dynamic = "force-dynamic";

export async function DELETE(): Promise<Response> {
  return handler(async () => {
    const { db, dataDir, manager } = runtime();

    // A running review owns a process and a worktree. Deleting its row from
    // under it would orphan both, so the wipe refuses rather than racing.
    const active = listActiveReviews(db);
    if (active.length > 0) {
      throw Response.json(
        {
          error:
            `${active.length} review(s) are still running. Cancel them first: deleting a ` +
            `review while it runs would orphan the process it owns.`,
          code: "ReviewStillRunning",
        },
        { status: 409 },
      );
    }

    const projects = listProjects(db);
    let reviews = 0;
    for (const project of projects) {
      for (const review of listReviewsForProject(db, project.id)) {
        manager.dequeue(review.id);
        await deleteReviewEntirely(db, review.id, dataDir);
        reviews += 1;
      }
    }
    for (const listed of projects) {
      // Read again just before: the deletions above awaited, and a clone may
      // have finished or been tried again since the list was read, which
      // decides whether a failed removal is the clone's to finish (D-137).
      const project = getProject(db, listed.id);
      if (!project) continue;
      deleteProject(db, project.id);
      await removeProjectFiles(dataDir, project);
    }

    const rulesetRows = listRulesets(db);
    for (const row of rulesetRows) deleteRuleset(db, row.id);

    return ok({
      deleted: { projects: projects.length, reviews, rulesets: rulesetRows.length },
      kept: { exports: exportsDir(dataDir) },
    });
  });
}
