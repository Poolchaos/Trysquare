/**
 * The protocol document this ruleset came from.
 *
 * Byte-exact, because every rule's verbatim markdown is stored alongside its
 * parsed fields. Disabled rules are included: the document is the document,
 * and switching a rule off is a choice this app made about applying it, not an
 * edit to what the author wrote.
 */

import { exportProtocol } from "@/lib/rulesets/import";
import { loadRuleset, requireRuleset } from "@/server/db/repositories/rulesets";
import { handler } from "@/server/api/respond";
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
    const ruleset = loadRuleset(db, id);

    // A ruleset started with no document, or emptied of every rule, holds no
    // block (RA-6). Its document would be a file of no bytes, which the
    // importer reads as one directive: not what is stored.
    if (ruleset.rules.length === 0 && ruleset.directives.length === 0) {
      throw Response.json(
        {
          error:
            `"${row.name}" has no rules and no directives, so it has no document to export. ` +
            "Write a rule into it first.",
          code: "NothingToExport",
        },
        { status: 409 },
      );
    }

    return new Response(exportProtocol(ruleset), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${row.name.replace(/[^\w.-]+/g, "-")}.md"`,
      },
    });
  });
}
