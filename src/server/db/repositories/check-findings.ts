/**
 * What a project's own checks found in a review (WP-I, D-197). Made from the
 * checks' result each time a review prepares, as code findings are made
 * from the stages' answers, so a resume does not add a second copy.
 */

import { eq, sql } from "drizzle-orm";
import { newId, nowIso } from "@/lib/ids";
import type { Db } from "../client";
import { checkFindings } from "../schema";

export type CheckFinding = typeof checkFindings.$inferSelect;

const FAILED: Record<string, string> = {
  install: "The install fails on this branch.",
  tests: "The tests fail on this branch.",
  e2e: "The e2e tests fail on this branch.",
};
const TIMED_OUT: Record<string, string> = {
  install: "The install did not finish within its time limit on this branch.",
  tests: "The tests did not finish within their time limit on this branch.",
  e2e: "The e2e tests did not finish within their time limit on this branch.",
};

/**
 * A command that failed, proven by the app itself: its exit code, or its
 * time limit, and its output quoted from the log. A red suite stops the
 * line, so it is critical.
 */
export function recordFailedCommand(
  db: Db,
  reviewId: string,
  failed: {
    step: "install" | "tests" | "e2e";
    command: string;
    exitCode: number | null;
    timedOut: boolean;
    logPath: string;
    tail: string;
  },
): CheckFinding {
  const row = {
    id: newId(),
    reviewId,
    kind: "test",
    step: failed.step,
    command: failed.command,
    exitCode: failed.exitCode,
    timedOut: failed.timedOut,
    logPath: failed.logPath,
    screenshotPath: null,
    grade: null,
    severity: "CRITICAL",
    issue: failed.timedOut ? TIMED_OUT[failed.step]! : FAILED[failed.step]!,
    evidence: failed.tail,
    status: "verified",
    verificationNote: failed.timedOut
      ? "Stopped at its time limit, by the app."
      : `Exited with code ${failed.exitCode}, as the app ran it.`,
    dismissReason: null,
    dismissedFrom: null,
    createdAt: nowIso(),
    decidedAt: null,
  };
  db.insert(checkFindings).values(row).run();
  return row;
}

export function listCheckFindings(db: Db, reviewId: string): CheckFinding[] {
  return (
    db
      .select()
      .from(checkFindings)
      .where(eq(checkFindings.reviewId, reviewId))
      // In the order they were made: ids made in one millisecond do not sort
      // in it (stage-executions.ts says the same of its rows).
      .orderBy(sql`rowid`)
      .all()
  );
}

export function deleteCheckFindingsForReview(db: Db, reviewId: string): void {
  db.delete(checkFindings).where(eq(checkFindings.reviewId, reviewId)).run();
}
