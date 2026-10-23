/**
 * Verifies an open question again: one new request, in a fresh session, held
 * to S5's checks (proof-and-steps plan, WP-D2).
 *
 * A paid request, so refused unless the page said so first, and answered
 * when the request is: one stage under the stage timeout, which a closed tab
 * aborts. Run as a job instead, it would need the queue and a stream for one
 * question a person is waiting on.
 */

import { z } from "zod";
import { configuredClaudePath } from "@/server/cli-path";
import {
  billingNotShown,
  billingShownSchema,
  cliNotReady,
  cliReadiness,
} from "@/server/cli-readiness";
import { failed, handler, isNamed, ok, readJson } from "@/server/api/respond";
import { assertCanVerifyAgain, verifyAgain } from "@/server/review/service";
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
    const { db, dataDir } = runtime();
    const { id } = await context.params;
    const input = await readJson(request, body);
    try {
      assertCanVerifyAgain(db, id, dataDir);
      const readiness = await cliReadiness(db);
      if (readiness.refusal) throw cliNotReady(readiness);
      const unshown = billingNotShown(readiness, input.billingShown);
      if (unshown !== null) throw unshown;
      return ok(
        await verifyAgain(db, id, {
          dataDir,
          claudePath: configuredClaudePath(db),
          signal: request.signal,
        }),
      );
    } catch (error) {
      if (isNamed(error, "ReviewNotDecidingError")) return failed(error, 409);
      throw error;
    }
  });
}
