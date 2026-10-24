/**
 * A person leaving out what a project's own checks found, and saying why
 * (WP-I, D-197): the reason is the record of whether the check was wrong.
 */

import { z } from "zod";
import { dismissCheckFinding } from "@/server/db/repositories/check-findings";
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
      return ok({ checkFinding: dismissCheckFinding(runtime().db, id, reason) });
    } catch (error) {
      if (isNamed(error, "ReviewNotDecidingError")) return failed(error, 409);
      throw error;
    }
  });
}
