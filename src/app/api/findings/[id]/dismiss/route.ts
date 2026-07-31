/**
 * A human rejecting a finding, and saying why.
 *
 * The reason is the point. A dismissal without one leaves no record of
 * whether the engine was wrong or the reviewer was in a hurry, and those two
 * are the difference between a prompt that needs fixing and one that does not.
 */

import { z } from "zod";
import { dismissFinding } from "@/server/db/repositories/findings";
import { handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  reason: z.string().trim().min(1, "a dismissal needs a reason"),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    const { reason } = await readJson(request, body);
    return ok({ finding: dismissFinding(runtime().db, id, reason) });
  });
}
