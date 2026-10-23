/**
 * A human rejecting a finding, and saying why.
 *
 * The reason is the point. A dismissal without one leaves no record of
 * whether the engine was wrong or the reviewer was in a hurry, and those two
 * are the difference between a prompt that needs fixing and one that does not.
 */

import { z } from "zod";
import { dismissFinding, requireFinding } from "@/server/db/repositories/findings";
import { failed, handler, isNamed, ok, readJson } from "@/server/api/respond";
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
    try {
      const { db, manager } = runtime();
      // Not while its paid verify-again is out: the answer would land nowhere.
      manager.assertNotVerifyingAgain(requireFinding(db, id).reviewId, id);
      return ok({ finding: dismissFinding(db, id, reason) });
    } catch (error) {
      if (isNamed(error, "ReviewNotDecidingError")) return failed(error, 409);
      throw error;
    }
  });
}
