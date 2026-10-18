/**
 * Live progress for one review.
 *
 * The Node runtime is required, not preferred: the manager holds an open
 * SQLite handle and spawns processes, neither of which the edge runtime can do.
 */

import { handler } from "@/server/api/respond";
import { requireReview } from "@/server/db/repositories/reviews";
import { reviewEventStream } from "@/server/jobs/stream";
import { runtime as appRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    // Through runtime() like every other handler, so a stream opened as the
    // first request after a restart still finds an initialised manager.
    const { db, manager } = appRuntime();
    // Read before the stream opens: inside it, an unknown review broke the
    // stream after a 200 rather than answering 404 (4.20).
    requireReview(db, id);
    return reviewEventStream(manager, id, request);
  });
}
