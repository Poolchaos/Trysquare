/** The rulesets a review can be judged against, and a new one started with no document. */

import { z } from "zod";
import { rulesetTierSchema } from "@/lib/domain/enums";
import {
  createRuleset,
  defaultRulesetId,
  listRulesetSummaries,
} from "@/server/db/repositories/rulesets";
import { created, failed, handler, isNamed, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    return ok({ rulesets: listRulesetSummaries(db), defaultRulesetId: defaultRulesetId(db) });
  });
}

const body = z.object({
  name: z.string().trim().min(1),
  tier: rulesetTierSchema,
});

/**
 * Starts a ruleset from a name and a tier alone (RA-6). It holds no rule
 * until one is written on its page, and a review does not start on it until
 * then.
 */
export function POST(request: Request): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const input = await readJson(request, body);
    try {
      return created(createRuleset(db, input));
    } catch (error) {
      if (isNamed(error, "RulesetNameTakenError")) return failed(error, 409);
      throw error;
    }
  });
}
