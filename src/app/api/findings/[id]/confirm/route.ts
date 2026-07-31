/**
 * A human accepting a finding.
 *
 * The whole app exists to reach this moment: nothing is reported until a
 * person has said so. No reason is required, because accepting the engine's
 * case adds nothing to it; dismissing does require one.
 */

import { confirmFinding } from "@/server/db/repositories/findings";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    return ok({ finding: confirmFinding(runtime().db, id) });
  });
}
