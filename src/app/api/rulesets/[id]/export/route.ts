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

    return new Response(exportProtocol(loadRuleset(db, id)), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${row.name.replace(/[^\w.-]+/g, "-")}.md"`,
      },
    });
  });
}
