/**
 * The two things the rail needs, and nothing else.
 *
 * The rail polls every four seconds on every screen, and it was asking the
 * full reviews list for it: every review of every project, a merged-branch
 * check across all of them, and now a finding tally too, all to decide
 * whether to draw one chip. This answers the same question with two indexed
 * reads and no joins.
 */

import { and, eq, inArray } from "drizzle-orm";
import { projects, reviews } from "@/server/db/schema";
import { ACTIVE_REVIEW_STATUSES } from "@/lib/domain/state-machines";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db, manager } = runtime();

    const inFlight = db
      .select({
        id: reviews.id,
        status: reviews.status,
        fromBranch: reviews.fromBranch,
        intoBranch: reviews.intoBranch,
        projectName: projects.name,
        // What the live widget needs to say more than "something is running":
        // which stage, since when, and what it has cost so far.
        currentStage: reviews.currentStage,
        startedAt: reviews.startedAt,
        costEquivalentUsd: reviews.costEquivalentUsd,
      })
      .from(reviews)
      .innerJoin(projects, eq(reviews.projectId, projects.id))
      .where(inArray(reviews.status, [...ACTIVE_REVIEW_STATUSES, "paused_limit"]))
      .all();

    // A row can say running while no process owns it, after a restart the
    // recovery has not reached yet. The manager knows which are genuinely in
    // flight, so the chip follows it rather than the column.
    const active =
      inFlight.find((row) => row.status === "paused_limit" || manager.isRunning(row.id)) ?? null;

    const awaiting = db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.status, "awaiting_confirmation")))
      .all().length;

    return ok({ active, awaiting });
  });
}
