/**
 * Starting a ruleset from a template on the shelf (RT-1).
 *
 * The ruleset is the person's own copy from then on: nothing updates it when
 * a later release changes the template, so it says which template and which
 * version it started as. A name in use is refused and never replaced.
 */

import { z } from "zod";
import { rulesetTierSchema } from "@/lib/domain/enums";
import {
  RulesetNameTakenError,
  findRulesetByName,
  saveImportedRuleset,
} from "@/server/db/repositories/rulesets";
import { readTemplate } from "@/server/rulesets/shelf";
import { created, failed, handler, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  // Left out, the ruleset takes the template's name.
  name: z.string().trim().min(1).optional(),
  tier: rulesetTierSchema,
});

export function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { slug } = await context.params;
    const input = await readJson(request, body);
    const template = readTemplate(slug);
    if (template === undefined) {
      return Response.json(
        { error: `No template called "${slug}" is on the shelf.`, code: "TemplateNotFound" },
        { status: 404 },
      );
    }

    const name = input.name ?? template.name;
    if (findRulesetByName(db, name)) return failed(new RulesetNameTakenError(name, "new"), 409);

    const from = `the ${template.name} template, version ${template.version}`;
    const saved = saveImportedRuleset(db, {
      name,
      tier: input.tier,
      sourceDoc: from,
      description: `Started from ${from}.`,
      imported: template.imported,
    });
    return created({ rulesetId: saved.rulesetId, version: saved.version });
  });
}
