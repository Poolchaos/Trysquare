/**
 * A human accepting a finding.
 *
 * The whole app exists to reach this moment: nothing is reported until a
 * person has said so. No reason is required, because accepting the engine's
 * case adds nothing to it; dismissing does require one.
 *
 * A rewritten comment may travel with the acceptance. The body is optional so
 * the common case stays a bare POST, and so the `c` key does not have to know
 * anything about editing.
 */

import { z } from "zod";
import { confirmFinding } from "@/server/db/repositories/findings";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({ comment: z.string().optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    // A missing or unparseable body means no replacement comment, which is
    // what a keyboard confirm sends.
    const parsed = body.safeParse(await request.json().catch(() => ({})));
    const comment = parsed.success ? parsed.data.comment : undefined;
    return ok({ finding: confirmFinding(runtime().db, id, { comment }) });
  });
}
