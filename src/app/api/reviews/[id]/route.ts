/** Everything a review page needs in one read. */

import { listFindings } from "@/server/db/repositories/findings";
import { getProject } from "@/server/db/repositories/projects";
import { stageDurationMedians } from "@/server/db/repositories/stage-executions";
import { requireReview, statusOf } from "@/server/db/repositories/reviews";
import { deleteReviewEntirely } from "@/server/review/service";
import { detectMerged } from "@/server/review/merged";
import { failed, handler, isNamed, ok } from "@/server/api/respond";
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
 *
 * `?unstarted=1` removes it only while it is a draft nobody has started: a
 * queued review keeps the status draft, and read as a draft from the page,
 * one put in line from another tab was removed (review of the D-164 fixes).
 *
 * The manager's claim is held for the whole removal, so nothing starts the
 * review while its files go, and it refuses one whose run is still ending,
 * its row already saying cancelled or failed (review of the D-165 fixes).
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir, manager } = runtime();
    const { id } = await context.params;

    const unstarted = new URL(request.url).searchParams.get("unstarted") === "1";
    const status = statusOf(requireReview(db, id));
    const notUnstarted = Response.json(
      {
        error: "This review is no longer a draft nobody has started, so it was left.",
        code: "NotAnUnstartedDraft",
      },
      { status: 409 },
    );
    if (unstarted && status !== "draft") return notUnstarted;
    if (!manager.beginDelete(id, { evenQueued: !unstarted })) {
      return unstarted
        ? notUnstarted
        : Response.json(
            {
              error:
                "This review is still running, verifying a finding again, ending its run or " +
                "being deleted. Cancel it, or try again in a moment.",
              code: "ReviewStillRunningError",
            },
            { status: 409 },
          );
    }
    try {
      await deleteReviewEntirely(db, id, dataDir);
    } catch (error) {
      if (isNamed(error, "ReviewStillRunningError")) return failed(error, 409);
      throw error;
    } finally {
      manager.endDelete(id);
    }
    return ok({ removed: id });
  });
}
