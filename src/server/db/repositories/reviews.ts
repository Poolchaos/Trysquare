/**
 * Review persistence.
 *
 * The one rule this module exists to enforce: a review's status changes only
 * through `transitionReview`, which checks the state machine first and writes
 * conditionally on the status it read. Every other update in here leaves
 * status alone.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { newId, nowIso } from "@/lib/ids";
import type { EngineMode, ReviewProfile, ReviewStage } from "@/lib/domain/enums";
import {
  ACTIVE_REVIEW_STATUSES,
  type ReviewStatus,
  assertReviewTransition,
  reviewStatusSchema,
} from "@/lib/domain/state-machines";
import type { Db } from "../client";
import { reviews } from "../schema";
import { parseJsonColumn, serialiseJsonColumn } from "./json";

export class ReviewNotFoundError extends Error {
  constructor(readonly reviewId: string) {
    super(`No review with id "${reviewId}".`);
    this.name = "ReviewNotFoundError";
  }
}

/**
 * Raised when a status write loses a race: the row moved on between the check
 * and the update, so the update is discarded rather than clobbering it.
 */
export class ConcurrentReviewUpdateError extends Error {
  constructor(
    readonly reviewId: string,
    readonly expected: ReviewStatus,
  ) {
    super(
      `Review "${reviewId}" was no longer in "${expected}" when the status write ran. ` +
        `Another writer changed it first; nothing was overwritten.`,
    );
    this.name = "ConcurrentReviewUpdateError";
  }
}

export type Review = typeof reviews.$inferSelect;

export interface CreateReviewInput {
  projectId: string;
  fromBranch: string;
  fromCommit: string;
  intoBranch: string;
  intoCommit: string;
  mergeBaseCommit: string;
  model: string;
  profileId: ReviewProfile;
  engineMode: EngineMode;
  linked?: {
    projectId: string;
    fromBranch: string;
    fromCommit: string;
    intoBranch: string;
    intoCommit: string;
    mergeBaseCommit: string;
  };
}

export function createReview(db: Db, input: CreateReviewInput): Review {
  const now = nowIso();
  const row = {
    id: newId(),
    projectId: input.projectId,
    fromBranch: input.fromBranch,
    fromCommit: input.fromCommit,
    intoBranch: input.intoBranch,
    intoCommit: input.intoCommit,
    mergeBaseCommit: input.mergeBaseCommit,
    linkedProjectId: input.linked?.projectId ?? null,
    linkedFromBranch: input.linked?.fromBranch ?? null,
    linkedFromCommit: input.linked?.fromCommit ?? null,
    linkedIntoBranch: input.linked?.intoBranch ?? null,
    linkedIntoCommit: input.linked?.intoCommit ?? null,
    linkedMergeBaseCommit: input.linked?.mergeBaseCommit ?? null,
    model: input.model,
    profileId: input.profileId,
    engineMode: input.engineMode,
    status: "draft" satisfies ReviewStatus,
    currentStage: null,
    pausedReason: null,
    usageInputTokens: 0,
    usageOutputTokens: 0,
    costEquivalentUsd: 0,
    runNotes: "[]",
    mergedDetectedAt: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
  db.insert(reviews).values(row).run();
  return row;
}

export function getReview(db: Db, reviewId: string): Review | undefined {
  return db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
}

export function requireReview(db: Db, reviewId: string): Review {
  const review = getReview(db, reviewId);
  if (!review) throw new ReviewNotFoundError(reviewId);
  return review;
}

/** Parses the stored status, failing loudly if the column holds something unknown. */
export function statusOf(review: Review): ReviewStatus {
  return reviewStatusSchema.parse(review.status);
}

export interface TransitionOptions {
  currentStage?: ReviewStage | null;
  pausedReason?: string | null;
}

/**
 * The only way a review's status changes.
 *
 * The write is conditional on the status that was read, so two writers racing
 * cannot both succeed: the loser gets ConcurrentReviewUpdateError rather than
 * silently overwriting a cancellation or a failure.
 */
export function transitionReview(
  db: Db,
  reviewId: string,
  to: ReviewStatus,
  options: TransitionOptions = {},
): Review {
  const review = requireReview(db, reviewId);
  const from = statusOf(review);
  assertReviewTransition(from, to);

  const now = nowIso();
  const patch: Partial<typeof reviews.$inferInsert> = { status: to };

  if (options.currentStage !== undefined) patch.currentStage = options.currentStage;

  // A pause reason belongs to the pause. Leaving a stale one on a resumed
  // review would show the user an explanation for a state it is no longer in.
  patch.pausedReason = to === "paused_limit" ? (options.pausedReason ?? null) : null;

  if (to === "running" && review.startedAt === null) patch.startedAt = now;
  if (to === "complete" || to === "failed" || to === "cancelled") patch.completedAt = now;

  const updated = db
    .update(reviews)
    .set(patch)
    .where(and(eq(reviews.id, reviewId), eq(reviews.status, from)))
    .run();

  if (updated.changes === 0) throw new ConcurrentReviewUpdateError(reviewId, from);
  return requireReview(db, reviewId);
}

/** Adds a stage's usage to the review totals. Never touches status. */
export function addReviewUsage(
  db: Db,
  reviewId: string,
  usage: { inputTokens: number; outputTokens: number; costEquivalentUsd: number },
): Review {
  const review = requireReview(db, reviewId);
  db.update(reviews)
    .set({
      usageInputTokens: review.usageInputTokens + usage.inputTokens,
      usageOutputTokens: review.usageOutputTokens + usage.outputTokens,
      costEquivalentUsd: review.costEquivalentUsd + usage.costEquivalentUsd,
    })
    .where(eq(reviews.id, reviewId))
    .run();
  return requireReview(db, reviewId);
}

/**
 * Records which stage a running review is on.
 *
 * Deliberately not a transition: moving from one stage to the next is not a
 * change of status, and routing it through the state machine would either
 * invent illegal self-transitions or tempt callers to write status directly.
 */
export function setCurrentStage(db: Db, reviewId: string, stage: ReviewStage | null): void {
  db.update(reviews).set({ currentStage: stage }).where(eq(reviews.id, reviewId)).run();
}

export interface RunNote {
  at: string;
  kind: "batch-split" | "excluded-pairs" | "oversized-prompt" | "note";
  message: string;
}

const runNotesSchema = z.array(
  z.object({
    at: z.string(),
    kind: z.enum(["batch-split", "excluded-pairs", "oversized-prompt", "note"]),
    message: z.string(),
  }),
);

export function readRunNotes(review: Review): RunNote[] {
  return parseJsonColumn("reviews.run_notes", review.runNotes, runNotesSchema);
}

/**
 * Records how a run was carried out.
 *
 * Append-only, because these are the record of what a run did differently:
 * how it split its work, and what a narrowing profile decided not to check.
 * A review that quietly narrowed itself would be indistinguishable from a
 * complete one, so the narrowing is written down here and shown.
 */
export function appendRunNote(db: Db, reviewId: string, note: Omit<RunNote, "at">): void {
  const review = requireReview(db, reviewId);
  const existing = readRunNotes(review);
  existing.push({ ...note, at: nowIso() });
  db.update(reviews)
    .set({ runNotes: serialiseJsonColumn(existing) })
    .where(eq(reviews.id, reviewId))
    .run();
}

export function markReviewMerged(db: Db, reviewId: string, detectedAt = nowIso()): void {
  db.update(reviews).set({ mergedDetectedAt: detectedAt }).where(eq(reviews.id, reviewId)).run();
}

export function listReviewsForProject(db: Db, projectId: string): Review[] {
  return db
    .select()
    .from(reviews)
    .where(eq(reviews.projectId, projectId))
    .orderBy(desc(reviews.createdAt))
    .all();
}

/** History is grouped by branch pair, which is how the UI lists it. */
export function listReviewsForBranchPair(
  db: Db,
  projectId: string,
  fromBranch: string,
  intoBranch: string,
): Review[] {
  return db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.projectId, projectId),
        eq(reviews.fromBranch, fromBranch),
        eq(reviews.intoBranch, intoBranch),
      ),
    )
    .orderBy(desc(reviews.createdAt))
    .all();
}

export function listActiveReviews(db: Db): Review[] {
  return db
    .select()
    .from(reviews)
    .where(inArray(reviews.status, [...ACTIVE_REVIEW_STATUSES]))
    .all();
}

/**
 * Called at startup: a review still marked active cannot be running, because
 * nothing survived the restart that could be running it.
 */
export function markOrphanedReviewsInterrupted(db: Db): number {
  const active = listActiveReviews(db);
  for (const review of active) {
    transitionReview(db, review.id, "interrupted");
  }
  return active.length;
}

export function deleteReview(db: Db, reviewId: string): void {
  db.delete(reviews).where(eq(reviews.id, reviewId)).run();
}
