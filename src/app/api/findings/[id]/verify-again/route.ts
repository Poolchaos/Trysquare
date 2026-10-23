/**
 * Verifies an open question again: one new request, in a fresh session, held
 * to S5's checks (proof-and-steps plan, WP-D2).
 *
 * A paid request, so refused unless the page said so first, and answered
 * when the request is: one stage under the stage timeout, which a closed tab
 * aborts. The job manager counts it against the reviews at once, as they
 * share one usage limit, and stops it with a drain (review round 2).
 */

import { z } from "zod";
import {
  billingNotShown,
  billingShownSchema,
  cliNotReady,
  cliReadiness,
} from "@/server/cli-readiness";
import { failed, handler, isNamed, ok, readJson } from "@/server/api/respond";
import { assertCanVerifyAgain } from "@/server/review/service";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  billingShown: billingShownSchema,
  costShown: z.literal(true, "the page says what verifying again costs before sending it"),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir, manager } = runtime();
    const { id } = await context.params;
    const input = await readJson(request, body);
    try {
      assertCanVerifyAgain(db, id, dataDir);
      const readiness = await cliReadiness(db);
      if (readiness.refusal) throw cliNotReady(readiness);
      const unshown = billingNotShown(readiness, input.billingShown);
      if (unshown !== null) throw unshown;
      return ok(await manager.verifyAgain(id, request.signal));
    } catch (error) {
      if (isNamed(error, "ReviewNotDecidingError")) return failed(error, 409);
      // The request's own failures, said for what they are: the server did
      // not fail (review round 2, F4).
      if (isNamed(error, "StageFailedError")) {
        const { errorClass } = error as { errorClass?: unknown };
        return failed(error, errorClass === "limit" ? 429 : 503);
      }
      if (isNamed(error, "ZodError") || isNamed(error, "VerdictsMismatchError")) {
        return Response.json(
          {
            error: `The verifier's answer could not be used, so the finding is still an open question: ${error instanceof Error ? error.message : String(error)}`,
            code: "VerifierAnswerUnusable",
          },
          { status: 502 },
        );
      }
      throw error;
    }
  });
}
