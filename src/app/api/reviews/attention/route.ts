/**
 * The two things the top bar needs, and nothing else.
 *
 * The bar polls every four seconds on every screen, and it was asking the
 * full reviews list for it: every review of every project, a merged-branch
 * check across all of them, and now a finding tally too, all to decide
 * whether to draw one chip. This answers the same question with two indexed
 * reads and no joins.
 */

import { countAwaitingConfirmation, listInFlightReviews } from "@/server/db/repositories/reviews";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db, manager } = runtime();

    const inFlight = listInFlightReviews(db);

    // A row can say running while no process owns it, after a restart the
    // recovery has not reached yet. The manager knows which are genuinely in
    // flight, so the chip follows it rather than the column.
    const active =
      inFlight.find((row) => row.status === "paused_limit" || manager.isRunning(row.id)) ?? null;

    return ok({ active, awaiting: countAwaitingConfirmation(db) });
  });
}
