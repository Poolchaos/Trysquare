/**
 * Starts or resumes a review.
 *
 * Returns as soon as the review is scheduled rather than when it finishes: a
 * review takes minutes, and the page watches the event stream for the rest.
 */

import { z } from "zod";
import { rulesetTierSchema } from "@/lib/domain/enums";
import { hasReviewSnapshot, loadRuleset, requireRuleset } from "@/server/db/repositories/rulesets";
import { requireReview } from "@/server/db/repositories/reviews";
import { failed, handler, ok, readOptionalJson } from "@/server/api/respond";
import { ReviewNotStartableError } from "@/server/jobs/manager";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({ rulesetId: z.string().min(1).optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, manager } = runtime();
    const { id } = await context.params;
    // A resume sends no body. A ruleset id that is malformed is refused for
    // what it is: dropped, it was answered "Choose a ruleset", as though the
    // request had named none (5.8, A8).
    const input = await readOptionalJson(request, body);

    requireReview(db, id);

    // A resumed review already carries its frozen ruleset and must not be
    // handed a different one.
    let ruleset;
    if (!hasReviewSnapshot(db, id)) {
      if (!input.rulesetId) {
        throw Response.json(
          { error: "Choose a ruleset before starting this review.", code: "RulesetRequired" },
          { status: 400 },
        );
      }
      const row = requireRuleset(db, input.rulesetId);
      ruleset = {
        imported: loadRuleset(db, input.rulesetId),
        name: row.name,
        tier: rulesetTierSchema.parse(row.tier),
      };
    }

    try {
      const state = manager.start(id, ...(ruleset ? [{ ruleset }] : []));
      return ok({ state, snapshot: manager.snapshot(id) });
    } catch (error) {
      if (error instanceof ReviewNotStartableError) return failed(error, 409);
      throw error;
    }
  });
}
