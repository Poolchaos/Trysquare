/** Everything a review page needs in one read. */

import { listFindings } from "@/server/db/repositories/findings";
import { requireReview } from "@/server/db/repositories/reviews";
import { deleteReviewEntirely } from "@/server/review/service";
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
    await detectMerged(db, [requireReview(db, id)]);
    return ok({ ...manager.snapshot(id), findings: listFindings(db, id) });
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
      return failed(error, 409);
    }
    return ok({ removed: id });
  });
}
