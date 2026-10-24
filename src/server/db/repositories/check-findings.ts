/**
 * What a project's own checks found in a review (WP-I, D-197). Made from the
 * checks' result each time a review prepares, as code findings are made
 * from the stages' answers, so a resume does not add a second copy.
 */

import { and, eq, sql } from "drizzle-orm";
import { assertFindingTransition, findingStatusSchema } from "@/lib/domain/state-machines";
import { newId, nowIso } from "@/lib/ids";
import type { Db } from "../client";
import { severityOfGrade } from "@/lib/review/design";
import { checkFindings, reviews } from "../schema";
import { OpenQuestionNotConfirmableError, ReviewNotDecidingError } from "./findings";

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

export class CheckFindingNotFoundError extends Error {
  constructor(readonly checkFindingId: string) {
    super(`No finding from a project's own checks has the id "${checkFindingId}".`);
    this.name = "CheckFindingNotFoundError";
  }
}

export function requireCheckFinding(db: Db, id: string): CheckFinding {
  const row = db.select().from(checkFindings).where(eq(checkFindings.id, id)).get();
  if (row === undefined) throw new CheckFindingNotFoundError(id);
  return row;
}

/**
 * A person's decision, on the same transitions as a code finding's: only
 * one proven reaches the report, and only while the review waits on them.
 */
function decide(
  db: Db,
  id: string,
  to: "confirmed" | "dismissed",
  patch: Partial<typeof checkFindings.$inferInsert> = {},
): CheckFinding {
  const row = requireCheckFinding(db, id);
  const status =
    db.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, row.reviewId)).get()
      ?.status ?? "missing";
  if (status !== "awaiting_confirmation") throw new ReviewNotDecidingError(row.reviewId, status);
  const from = findingStatusSchema.parse(row.status);
  if (to === "confirmed" && from === "open_question") throw new OpenQuestionNotConfirmableError(id);
  assertFindingTransition(from, to);
  const result = db
    .update(checkFindings)
    .set({ ...patch, status: to, decidedAt: nowIso() })
    .where(and(eq(checkFindings.id, id), eq(checkFindings.status, from)))
    .run();
  if (result.changes === 0) {
    throw new Error(`Finding "${id}" changed status concurrently; nothing was overwritten.`);
  }
  return requireCheckFinding(db, id);
}

export function confirmCheckFinding(db: Db, id: string): CheckFinding {
  return decide(db, id, "confirmed");
}

export function dismissCheckFinding(db: Db, id: string, reason: string): CheckFinding {
  if (reason.trim() === "") {
    throw new Error("A dismissal needs a reason: it is the record of why it was left out.");
  }
  return decide(db, id, "dismissed", {
    dismissReason: reason,
    dismissedFrom: requireCheckFinding(db, id).status,
  });
}

/** Proven or open, so waiting on a person, which a review completes only without. */
export function listUndecidedCheckFindings(db: Db, reviewId: string): CheckFinding[] {
  return listCheckFindings(db, reviewId).filter(
    (row) => row.status === "verified" || row.status === "open_question",
  );
}

/**
 * A screenshot the first grader graded C or D (WP-I step 4): a candidate,
 * until the second grader has looked at it too.
 */
export function recordDesignCandidate(
  db: Db,
  reviewId: string,
  graded: { name: string; screenshotPath: string; grade: "C" | "D"; whatIsOff: string },
): CheckFinding {
  const row = {
    id: newId(),
    reviewId,
    kind: "design",
    step: null,
    command: null,
    exitCode: null,
    timedOut: false,
    logPath: null,
    screenshotPath: graded.screenshotPath,
    grade: graded.grade,
    severity: severityOfGrade(graded.grade),
    issue: `The screen ${graded.name} is graded ${graded.grade}.`,
    evidence: graded.whatIsOff,
    status: "candidate",
    verificationNote: null,
    dismissReason: null,
    dismissedFrom: null,
    createdAt: nowIso(),
    decidedAt: null,
  };
  db.insert(checkFindings).values(row).run();
  return row;
}

/** The second grader's word on a candidate, on the code findings' transitions. */
export function settleDesignCandidate(
  db: Db,
  id: string,
  to: "verified" | "open_question",
  note: string,
): CheckFinding {
  const from = findingStatusSchema.parse(requireCheckFinding(db, id).status);
  assertFindingTransition(from, to);
  const result = db
    .update(checkFindings)
    .set({ status: to, verificationNote: note })
    .where(and(eq(checkFindings.id, id), eq(checkFindings.status, from)))
    .run();
  if (result.changes === 0) {
    throw new Error(`Finding "${id}" changed status concurrently; nothing was overwritten.`);
  }
  return requireCheckFinding(db, id);
}
