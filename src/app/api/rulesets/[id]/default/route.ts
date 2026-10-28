/**
 * Whether new reviews start on this ruleset (D-225).
 *
 * Its own route rather than the settings write alone, because stopping means
 * "not this one any more": a plain clear, sent from a page read before
 * another ruleset was made the default, cleared that one (review round 15).
 */

import { defaultRulesetId, requireRuleset } from "@/server/db/repositories/rulesets";
import { SETTING_KEYS, writeSetting } from "@/server/db/repositories/settings";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(_request: Request, context: Params): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    requireRuleset(db, id);
    writeSetting(db, SETTING_KEYS.defaultRulesetId, id);
    return ok({ defaultRulesetId: id });
  });
}

export async function DELETE(_request: Request, context: Params): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    requireRuleset(db, id);
    if (defaultRulesetId(db) === id) writeSetting(db, SETTING_KEYS.defaultRulesetId, null);
    return ok({ defaultRulesetId: defaultRulesetId(db) });
  });
}
