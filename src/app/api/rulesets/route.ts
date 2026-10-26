/** The rulesets a review can be judged against. */

import { defaultRulesetId, listRulesetSummaries } from "@/server/db/repositories/rulesets";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    return ok({ rulesets: listRulesetSummaries(db), defaultRulesetId: defaultRulesetId(db) });
  });
}
