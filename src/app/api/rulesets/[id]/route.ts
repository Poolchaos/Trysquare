/** One ruleset: what it checks, and which of those checks are switched on. */

import {
  defaultRulesetId,
  deleteRuleset,
  loadRuleset,
  requireRuleset,
} from "@/server/db/repositories/rulesets";
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
        isDefault: defaultRulesetId(db) === row.id,
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
        // The section of the document the rule sits under, which a new rule
        // is put at the end of (RA-3).
        group: rule.group,
        sweepPatterns: rule.sweepPatterns,
        enabled: enabled.has(rule.code),
        // The rule as the document has it, less the heading the row already
        // shows: its text, examples, detection and why it matters. Empty for
        // a rule that is its heading alone, which with no line break after
        // it came out as the heading again.
        text: rule.raw.split("\n").slice(1).join("\n").trim(),
        // Whole, heading line and all: what the rule's editor opens on, and
        // what a save is compared with (RA-2).
        raw: rule.raw,
      })),
    });
  });
}

/**
 * Deletes one ruleset: its rules and directives, and the default if it was
 * that. A review that ran with it keeps its own copy (D-266). Until this
 * route, a ruleset went only with everything else, from Settings.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, manager } = runtime();
    const { id } = await context.params;
    const row = requireRuleset(db, id);
    if (manager.startsOn(row)) {
      throw Response.json(
        {
          error: `A review waiting for a place will start on "${row.name}" and has not taken its copy of the rules yet. Delete the ruleset once that review has started, or take the review out of the line first.`,
          code: "RulesetAwaited",
        },
        { status: 409 },
      );
    }
    deleteRuleset(db, id);
    return ok({ deleted: id });
  });
}
