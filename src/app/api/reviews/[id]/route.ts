/** Everything a review page needs in one read. */

import { listFindings } from "@/server/db/repositories/findings";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, manager } = runtime();
    const { id } = await context.params;
    return ok({ ...manager.snapshot(id), findings: listFindings(db, id) });
  });
}
