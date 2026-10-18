/** Everything a review page needs in one read. */

import { listFindings } from "@/server/db/repositories/findings";
import { getProject } from "@/server/db/repositories/projects";
import { stageDurationMedians } from "@/server/db/repositories/stage-executions";
import { requireReview } from "@/server/db/repositories/reviews";
import { deleteReviewEntirely, ReviewStillRunningError } from "@/server/review/service";
import { detectMerged } from "@/server/review/merged";
import { failed, handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, manager } = runtime();
    const { id } = await context.params;
    const review = requireReview(db, id);
    await detectMerged(db, [review]);
    // The project this review belongs to, so the deepest screen in the app
    // has a way back up. Without it the review page named neither its
    // project nor a route to one.
    const project = getProject(db, review.projectId);
    return ok({
      ...manager.snapshot(id),
      findings: listFindings(db, id),
      project: project ? { id: project.id, name: project.name } : null,
      // What this machine has actually measured for this model, so a stage in
      // flight can say what it usually takes instead of only that it is still
      // going. Empty until a stage has been timed enough times to mean it.
      stageMedians: Object.fromEntries(stageDurationMedians(db, review.model)),
    });
  });
}

/**
 * Removes a review and everything it produced except its exports.
 *
 * Refused while it is running, because a review with a live subprocess needs
 * cancelling first: deleting the row would orphan the process rather than stop
 * it. A review merely waiting in the queue is taken out of it here, since the
 * queue holds ids and the scheduler would otherwise reach for a row that is
 * gone.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir, manager } = runtime();
    const { id } = await context.params;

    try {
      manager.dequeue(id);
      await deleteReviewEntirely(db, id, dataDir);
    } catch (error) {
      if (error instanceof ReviewStillRunningError) return failed(error, 409);
      throw error;
    }
    return ok({ removed: id });
  });
}
