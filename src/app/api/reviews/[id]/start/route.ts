/**
 * Starts or resumes a review.
 *
 * Returns as soon as the review is scheduled rather than when it finishes: a
 * review takes minutes, and the page watches the event stream for the rest.
 */

import { z } from "zod";
import { rulesetTierSchema } from "@/lib/domain/enums";
import { loadRuleset, readReviewSnapshot, requireRuleset } from "@/server/db/repositories/rulesets";
import { handler, ok, readJson } from "@/server/api/respond";
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
    const input = await readJson(request, body).catch(() => ({ rulesetId: undefined }));

    // A resumed review already carries its frozen ruleset and must not be
    // handed a different one.
    let ruleset;
    try {
      readReviewSnapshot(db, id);
    } catch {
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

    const state = manager.start(id, ...(ruleset ? [{ ruleset }] : []));
    return ok({ state, snapshot: manager.snapshot(id) });
  });
}
