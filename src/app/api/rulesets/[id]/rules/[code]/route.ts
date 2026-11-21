/**
 * Amending one rule: whether it applies, and how severe a violation is.
 *
 * Either change moves the ruleset's version, because a review's frozen
 * snapshot names it. Without the bump two different sets of rules would share
 * a name and a number, and a report saying which version it used would not
 * identify what the review was actually judged against.
 */

import { z } from "zod";
import { severitySchema } from "@/lib/domain/enums";
import { parseRuleBlock } from "@/lib/rulesets/rule-edit";
import { patchRule, replaceRuleText } from "@/server/db/repositories/rulesets";
import { handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z
  .object({ enabled: z.boolean().optional(), severity: severitySchema.optional() })
  .refine((patch) => patch.enabled !== undefined || patch.severity !== undefined, {
    message: "nothing to change: send enabled, severity, or both",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; code: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id, code } = await context.params;
    const patch = await readJson(request, body);
    // Already decoded by Next, as every route's params are; a second decode
    // would throw on a code holding a % (audit finding 6).
    return ok(patchRule(db, id, code, patch));
  });
}

const edit = z.object({ markdown: z.string(), version: z.number().int() });

/**
 * Saves a rule's text as its markdown, heading line and all (RA-2). A block
 * that is not exactly one rule is refused in the parser's words before
 * anything is looked up, and nothing of it is saved.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; code: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id, code } = await context.params;
    const { markdown, version } = await readJson(request, edit);
    const read = parseRuleBlock(markdown);
    if ("refusal" in read) {
      throw Response.json({ error: read.refusal, code: "RuleTextRefused" }, { status: 400 });
    }
    return ok(replaceRuleText(db, id, code, read.rule, version));
  });
}
