/**
 * The two things the top bar needs, and for the dashboard, which polls it
 * too, the id and status of each review in flight.
 *
 * The bar polls every four seconds on every screen, and it was asking the
 * full reviews list for it: every review of every project, a merged-branch
 * check across all of them, and now a finding tally too, all to decide
 * whether to draw one chip. This answers the same question with two indexed
 * reads, one of them joining the project's name.
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
    // flight, so the chip follows it rather than the column. One running
    // comes before one paused at the usage limit: found first, a pause
    // nobody resumed hid the run going on now (the seventeenth grade, AE1).
    const active =
      inFlight.find((row) => manager.isRunning(row.id)) ??
      inFlight.find((row) => row.status === "paused_limit") ??
      null;

    // For the dashboard, which reads its scoreboard again when this changes.
    // `active` is one review: with two running at once, the other stopped
    // or paused and nothing in the answer changed.
    const inFlightSaid = inFlight
      .map((row) => `${row.id}:${row.status}`)
      .sort()
      .join(",");

    return ok({ active, inFlight: inFlightSaid, awaiting: countAwaitingConfirmation(db) });
  });
}
