/**
 * Starts or resumes a review.
 *
 * Returns as soon as the review is scheduled rather than when it finishes: a
 * review takes minutes, and the page watches the event stream for the rest.
 */

import { z } from "zod";
import { rulesetTierSchema } from "@/lib/domain/enums";
import { hasReviewSnapshot, loadRuleset, requireRuleset } from "@/server/db/repositories/rulesets";
import { appendRunNote, requireReview } from "@/server/db/repositories/reviews";
import { handler, ok, readOptionalJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";
import {
  billingNote,
  billingNotShown,
  billingShownSchema,
  cliNotReady,
  cliReadiness,
} from "@/server/cli-readiness";

export const dynamic = "force-dynamic";

const body = z.object({
  rulesetId: z.string().min(1).optional(),
  billingShown: billingShownSchema,
});

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

    const review = requireReview(db, id);

    // A resumed review already carries its frozen ruleset and must not be
    // handed a different one.
    let ruleset;
    if (hasReviewSnapshot(db, id)) {
      // Refused, not ignored: the review keeps the ruleset frozen onto it,
      // and one sent now was dropped without a word (D-138).
      if (input.rulesetId !== undefined) {
        throw Response.json(
          {
            error:
              "This review is already frozen with its ruleset, so it cannot be started with another.",
            code: "RulesetFrozen",
          },
          { status: 409 },
        );
      }
    } else {
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

    // A review that cannot run, or a ruleset for one already running or in
    // line, is refused by the manager and answered 409 by the handler: asked
    // first, so such a press is answered for what it is, and one on a review
    // already running or in line starts nothing, so it asks the CLI nothing
    // and notes nothing (review of the D-162 fixes).
    const options = ruleset ? [{ ruleset }] : [];
    const judged = manager.judge(id, ...options);

    // Asked again as it starts, as at create: a Resume, a draft's own Start
    // and every review a restart left waiting come here, and a CLI that
    // signed out since failed them at their first stage with nothing said
    // (MVP 6.2, review of the 6.2 changes). The interactive engine starts no
    // CLI.
    const readiness =
      judged === "startable" && review.engineMode === "headless" ? await cliReadiness(db) : null;
    if (readiness?.refusal) throw cliNotReady(readiness);
    const unshown = readiness === null ? null : billingNotShown(readiness, input.billingShown);
    if (unshown !== null) throw unshown;

    const state = manager.start(id, ...options);
    // Noted as each run starts, not once at create: a Resume bills too. Not
    // when another press started it while the CLI was asked.
    const note =
      readiness === null || state === "already-running"
        ? null
        : billingNote(readiness.cli, state === "queued");
    if (note !== null) appendRunNote(db, id, { kind: "note", message: note });
    return ok({ state, snapshot: manager.snapshot(id) });
  });
}
