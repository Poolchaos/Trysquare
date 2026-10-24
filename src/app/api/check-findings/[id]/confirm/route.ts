/**
 * A person accepting what a project's own checks found (WP-I, D-197): a
 * failing test, or a screenshot graded C or D. Into the report, as a code
 * finding goes, only by this.
 */

import { confirmCheckFinding } from "@/server/db/repositories/check-findings";
import { failed, handler, isNamed, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    try {
      return ok({ checkFinding: confirmCheckFinding(runtime().db, id) });
    } catch (error) {
      if (isNamed(error, "ReviewNotDecidingError")) return failed(error, 409);
      throw error;
    }
  });
}
