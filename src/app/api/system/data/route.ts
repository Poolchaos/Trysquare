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
import { deleteProject, listProjects } from "@/server/db/repositories/projects";
import { listActiveReviews, listReviewsForProject } from "@/server/db/repositories/reviews";
import { listRulesets } from "@/server/db/repositories/rulesets";
import { rulesets } from "@/server/db/schema";
import { deleteReviewEntirely } from "@/server/review/service";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { removeRepo } from "@/server/gitops/repo";

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
    for (const project of projects) {
      deleteProject(db, project.id);
      if (project.clonePath) await removeRepo(dirname(project.clonePath));
    }

    const rulesetRows = listRulesets(db);
    for (const row of rulesetRows) db.delete(rulesets).where(eq(rulesets.id, row.id)).run();

    return ok({
      deleted: { projects: projects.length, reviews, rulesets: rulesetRows.length },
      kept: { exports: exportsDir(dataDir) },
    });
  });
}
