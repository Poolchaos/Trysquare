/**
 * Live progress for one review.
 *
 * The Node runtime is required, not preferred: the manager holds an open
 * SQLite handle and spawns processes, neither of which the edge runtime can do.
 */

import { jobManager } from "@/server/jobs/manager";
import { reviewEventStream } from "@/server/jobs/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return reviewEventStream(jobManager(), id, request);
}
