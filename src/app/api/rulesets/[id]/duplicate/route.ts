/**
 * Copying a ruleset into another tier.
 *
 * The usual move is promotion: a rule proven on one project becomes a global
 * standard. The copy starts at version 1 with its own history, and carries
 * the toggles as they stand, because what is being promoted is the ruleset
 * as used, not the document as first imported.
 */

import { z } from "zod";
import { rulesetTierSchema } from "@/lib/domain/enums";
import {
  RulesetNameTakenError,
  duplicateRuleset,
  requireRuleset,
} from "@/server/db/repositories/rulesets";
import { created, failed, handler, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  tier: rulesetTierSchema,
  name: z.string().trim().min(1).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const input = await readJson(request, body);
    const source = requireRuleset(db, id);

    try {
      const copy = duplicateRuleset(db, id, {
        tier: input.tier,
        name: input.name ?? `${source.name} (${input.tier})`,
      });
      return created(copy);
    } catch (error) {
      // A name collision is the caller's to resolve, not something to paper
      // over by merging into whatever already holds the name.
      if (error instanceof RulesetNameTakenError) return failed(error, 409);
      throw error;
    }
  });
}
