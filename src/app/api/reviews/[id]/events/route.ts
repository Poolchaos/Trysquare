/**
 * Live progress for one review.
 *
 * The Node runtime is required, not preferred: the manager holds an open
 * SQLite handle and spawns processes, neither of which the edge runtime can do.
 */

import { reviewEventStream } from "@/server/jobs/stream";
import { runtime as appRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  // Through runtime() like every other handler, so a stream opened as the
  // first request after a restart still finds an initialised manager.
  return reviewEventStream(appRuntime().manager, id, request);
}
