/** One ruleset: what it checks, and which of those checks are switched on. */

import { loadRuleset, requireRuleset } from "@/server/db/repositories/rulesets";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const row = requireRuleset(db, id);
    // Everything, disabled included: this screen is where a rule is switched
    // back on, so it cannot show only the ones that are already on.
    const ruleset = loadRuleset(db, id);
    const enabledOnly = loadRuleset(db, id, { enabledOnly: true });
    const enabled = new Set(enabledOnly.rules.map((rule) => rule.code));

    return ok({
      ruleset: {
        id: row.id,
        name: row.name,
        tier: row.tier,
        version: row.version,
        // Provenance: where the document came from and when this edition of
        // it took effect, which is what a report's version number points at.
        sourceDoc: row.sourceDoc,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      directives: ruleset.directives.map((directive) => ({
        section: directive.section,
        title: directive.title,
        // The body verbatim: a directive reaches the prompt as written, so
        // what is shown here is what the model is given.
        contentMd: directive.contentMd,
      })),
      rules: ruleset.rules.map((rule) => ({
        code: rule.code,
        title: rule.title,
        severity: rule.severity,
        tags: rule.tags,
        sweepPatterns: rule.sweepPatterns,
        enabled: enabled.has(rule.code),
      })),
    });
  });
}
