/**
 * A human accepting a finding.
 *
 * The whole app exists to reach this moment: nothing is reported until a
 * person has said so. No reason is required, because accepting the engine's
 * case adds nothing to it; dismissing does require one.
 *
 * A rewritten comment may travel with the acceptance. The body is optional so
 * the common case stays a bare POST, and so Shift+C does not have to know
 * anything about editing.
 */

import { z } from "zod";
import { confirmFinding } from "@/server/db/repositories/findings";
import { failed, handler, isNamed, ok, readOptionalJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({ comment: z.string().optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    // No body means no replacement comment. One that is there but malformed
    // is refused: it used to confirm with the engine's words, as though the
    // person had written none (5.8, A8).
    const { comment } = await readOptionalJson(request, body);
    try {
      return ok({ finding: confirmFinding(runtime().db, id, { comment }) });
    } catch (error) {
      if (isNamed(error, "ReviewNotDecidingError")) return failed(error, 409);
      throw error;
    }
  });
}
