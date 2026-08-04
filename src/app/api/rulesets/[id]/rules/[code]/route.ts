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
import { patchRule } from "@/server/db/repositories/rulesets";
import { failed, handler, ok, readJson } from "@/server/api/respond";
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

    try {
      return ok(patchRule(db, id, decodeURIComponent(code), patch));
    } catch (error) {
      return failed(error, 400);
    }
  });
}
