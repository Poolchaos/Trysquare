/**
 * The remedy a refused project delete offers: remove its reviews first.
 *
 * Bulk and explicit, never implicit: deleting a project must not silently
 * discard review history (02), so the refusal names the count and this route
 * is the two-step answer. It removes every review that blocks the delete,
 * owned and linked both, because a linked review would block it just the
 * same. An active review refuses the whole bulk rather than being killed
 * mid-run.
 */

import { ACTIVE_REVIEW_STATUSES } from "@/lib/domain/state-machines";
import { listReviewsReferencing, requireProject } from "@/server/db/repositories/projects";
import { deleteReviewEntirely } from "@/server/review/service";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir, manager } = runtime();
    const { id } = await context.params;
    requireProject(db, id);

    const rows = listReviewsReferencing(db, id);
    const active = rows.find((row) =>
      (ACTIVE_REVIEW_STATUSES as readonly string[]).includes(row.status),
    );
    if (active) {
      throw Response.json(
        {
          error:
            `Review ${active.id} is ${active.status.replace(/_/g, " ")}. ` +
            `Cancel it before deleting this project's reviews.`,
          code: "ReviewStillRunning",
        },
        { status: 409 },
      );
    }

    for (const row of rows) {
      // Out of the queue first: the scheduler holds ids, and one pointing at
      // a deleted row would strand every review behind it.
      manager.dequeue(row.id);
      await deleteReviewEntirely(db, row.id, dataDir);
    }
    return ok({ deleted: rows.length });
  });
}
