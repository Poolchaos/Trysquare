/** Stops a running review, or takes a queued one out of the line. */

import { handler, ok } from "@/server/api/respond";
import { requireReview } from "@/server/db/repositories/reviews";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, manager } = runtime();
    const { id } = await context.params;
    // Looked up here rather than left to the manager, whose not-found error is
    // another bundle's class that the handler could not place: a 500 (D-139).
    requireReview(db, id);
    return ok({ cancelled: manager.cancel(id), snapshot: manager.snapshot(id) });
  });
}
