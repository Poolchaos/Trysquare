/** Stops a running review, or takes a queued one out of the line. */

import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { manager } = runtime();
    const { id } = await context.params;
    return ok({ cancelled: manager.cancel(id), snapshot: manager.snapshot(id) });
  });
}
