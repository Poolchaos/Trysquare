/**
 * Adding a rule written in the app (RA-3).
 *
 * The body is the rule as the markdown it will be stored as, heading line
 * and all, read by the importer's own parser. A block that is not exactly
 * one rule, or still holds a line of the starting text the editor opens on,
 * is refused before anything is looked up, and nothing of it is saved.
 */

import { z } from "zod";
import { parseNewRuleBlock } from "@/lib/rulesets/rule-edit";
import { addRule } from "@/server/db/repositories/rulesets";
import { created, handler, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  markdown: z.string(),
  version: z.number().int(),
  // The rule this one follows in the ruleset's document. Left out, it
  // follows the last rule.
  after: z.string().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const { markdown, version, after } = await readJson(request, body);
    const read = parseNewRuleBlock(markdown);
    if ("refusal" in read) {
      throw Response.json({ error: read.refusal, code: "RuleTextRefused" }, { status: 400 });
    }
    return created(addRule(db, id, read.rule, after, version));
  });
}
