/**
 * Imports a protocol document as a ruleset.
 *
 * The importer refuses anything it cannot reproduce byte for byte, so a
 * document that would have been silently truncated is rejected here with the
 * reason rather than becoming a ruleset that quietly checks less than it says.
 */

import { z } from "zod";
import { importProtocol } from "@/lib/rulesets/import";
import { rulesetTierSchema } from "@/lib/domain/enums";
import { saveImportedRuleset } from "@/server/db/repositories/rulesets";
import { created, handler, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  name: z.string().trim().min(1),
  tier: rulesetTierSchema,
  markdown: z.string().min(1),
  sourceDoc: z.string().optional(),
});

export function POST(request: Request): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const input = await readJson(request, body);
    const { ruleset: imported, coverage } = importProtocol(input.markdown);
    if (imported.rules.length === 0) {
      // A review judged against nothing comes back clean, and reads exactly
      // like a review that found nothing wrong.
      throw Response.json(
        {
          error:
            "That document produced no rules, so a review using it would check nothing " +
            "and report a clean result. Check the rule headings match the expected format.",
          code: "EmptyRuleset",
        },
        { status: 400 },
      );
    }

    // D-48: a line the importer could not place is a line the reviews would
    // silently not check. Blocked with the lines named, so the author fixes
    // the document rather than trusting a ruleset that dropped part of it.
    const lost = coverage.unmapped.filter((entry) => entry.text.trim() !== "");
    if (lost.length > 0) {
      throw Response.json(
        {
          error:
            `${lost.length} line(s) of that document do not belong to any rule or ` +
            `directive, so importing it would silently drop them.`,
          code: "UnmappedLines",
          unmapped: lost,
        },
        { status: 400 },
      );
    }

    const saved = saveImportedRuleset(db, {
      name: input.name,
      tier: input.tier,
      imported,
      ...(input.sourceDoc === undefined ? {} : { sourceDoc: input.sourceDoc }),
    });

    return created({
      ...saved,
      rules: imported.rules.length,
      directives: imported.directives.length,
      // The fidelity report, so the screen can say "every line accounted for"
      // with the numbers that prove it rather than as reassurance.
      fidelity: {
        totalLines: coverage.totalLines,
        mappedLines: coverage.mappedLines,
      },
    });
  });
}
