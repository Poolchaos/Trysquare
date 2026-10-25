/** Takes a review waiting its turn out of the line; it keeps its status (D-224). */

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
    return ok({ left: manager.leaveQueue(id), snapshot: manager.snapshot(id) });
  });
}
