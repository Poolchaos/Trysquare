/**
 * The record of every request a review made to a model.
 *
 * This is both the audit trail and the resume mechanism. A stage that
 * succeeded stored its answer here against the hash of the prompt it
 * answered, so a resumed run can replay that answer instead of paying for the
 * stage again. It follows that these rows must be written by exactly one
 * place, or two writers would disagree about what a stage actually returned;
 * that place is the checkpointing runner.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { newId, nowIso } from "@/lib/ids";
import type { ReviewStage, StageErrorClass, StageStatus } from "@/lib/domain/enums";
import type { Db } from "../client";
import { reviews, stageExecutions } from "../schema";

export type StageExecution = typeof stageExecutions.$inferSelect;

/** Stages whose sessions chain, so a resume can rejoin the conversation. */
const CHAINED_STAGES: readonly ReviewStage[] = [
  "s1_risk",
  "s2_comprehension",
  "s3_adversarial",
  "s4_deletions",
];

export interface RecordAttemptInput {
  reviewId: string;
  stage: ReviewStage;
  promptHash: string;
  attempt: number;
  status: StageStatus;
  sessionId?: string | null;
  /** Present only on a succeeded attempt; it is what a replay returns. */
  outputJson?: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    costEquivalentUsd: number;
  };
  errorClass?: StageErrorClass | null;
  errorText?: string | null;
  logPath?: string | null;
  startedAt?: string;
  endedAt?: string | null;
}

export function recordAttempt(db: Db, input: RecordAttemptInput): StageExecution {
  const now = nowIso();
  const row = {
    id: newId(),
    reviewId: input.reviewId,
    stage: input.stage,
    attempt: input.attempt,
    promptHash: input.promptHash,
    sessionId: input.sessionId ?? null,
    status: input.status,
    outputJson: input.outputJson ?? null,
    inputTokens: input.usage?.inputTokens ?? 0,
    cacheCreationTokens: input.usage?.cacheCreationTokens ?? 0,
    cacheReadTokens: input.usage?.cacheReadTokens ?? 0,
    outputTokens: input.usage?.outputTokens ?? 0,
    costEquivalentUsd: input.usage?.costEquivalentUsd ?? 0,
    errorClass: input.errorClass ?? null,
    errorText: input.errorText ?? null,
    logPath: input.logPath ?? null,
    startedAt: input.startedAt ?? now,
    endedAt: input.endedAt === undefined ? now : input.endedAt,
  };
  db.insert(stageExecutions).values(row).run();
  return row;
}

/**
 * The stored answer for a request, if there is one.
 *
 * Matched on the prompt hash rather than the stage alone, so a resumed run
 * only replays an answer to the same question. A stage whose prompt changed,
 * because the change set or the ruleset did, is a different request and runs
 * live.
 */
export function latestSucceeded(
  db: Db,
  reviewId: string,
  stage: ReviewStage,
  promptHash: string,
): StageExecution | undefined {
  return db
    .select()
    .from(stageExecutions)
    .where(
      and(
        eq(stageExecutions.reviewId, reviewId),
        eq(stageExecutions.stage, stage),
        eq(stageExecutions.promptHash, promptHash),
        eq(stageExecutions.status, "succeeded"),
      ),
    )
    .orderBy(desc(stageExecutions.startedAt), desc(stageExecutions.id))
    .all()
    .find((row) => row.outputJson !== null);
}

/**
 * Marks a stage's stored answers as rejected, so a resume asks again.
 *
 * A stage row is written as succeeded the moment the engine returns valid
 * JSON, but the pipeline can still reject that answer against the ledger. A
 * rejected answer left as succeeded would be replayed byte for byte on every
 * resume, re-rejected the same way, and the review could never recover
 * without being deleted and paid for again. The row keeps its output and
 * usage; only its standing changes, with the rejection recorded on it.
 */
export function rejectSucceededAnswers(
  db: Db,
  reviewId: string,
  stage: ReviewStage,
  reason: string,
): number {
  return db
    .update(stageExecutions)
    .set({ status: "failed", errorClass: "invalid_output", errorText: reason })
    .where(
      and(
        eq(stageExecutions.reviewId, reviewId),
        eq(stageExecutions.stage, stage),
        eq(stageExecutions.status, "succeeded"),
      ),
    )
    .run().changes;
}

/**
 * The session the earlier stages were using, for a run that is resuming.
 *
 * The CLI keeps sessions on disk, so a live stage after several replayed ones
 * can rejoin the conversation the replayed stages had rather than starting
 * cold and re-deriving what the comprehension pass already worked out.
 */
export function latestChainedSession(db: Db, reviewId: string): string | undefined {
  const rows = db
    .select()
    .from(stageExecutions)
    .where(and(eq(stageExecutions.reviewId, reviewId), eq(stageExecutions.status, "succeeded")))
    .orderBy(desc(stageExecutions.startedAt), desc(stageExecutions.id))
    .all();

  return (
    rows.find((row) => row.sessionId !== null && CHAINED_STAGES.includes(row.stage as ReviewStage))
      ?.sessionId ?? undefined
  );
}

/**
 * Everything this review has asked, oldest first, for the timeline.
 *
 * Ordered by attempt within a timestamp, not by id. Every row a single call
 * writes shares one startedAt, and ULIDs are not monotonic inside a
 * millisecond: measured over twenty thousand pairs, the second of two ids
 * generated in the same millisecond sorts before the first almost exactly half
 * the time. Ordering by id therefore returned one call's rows in a random
 * order, which showed up as a test that passed here and failed in CI. Attempt
 * numbers are the real sequence, so they are what the sequence is read from.
 */
export function listForReview(db: Db, reviewId: string): StageExecution[] {
  return db
    .select()
    .from(stageExecutions)
    .where(eq(stageExecutions.reviewId, reviewId))
    .orderBy(asc(stageExecutions.startedAt), asc(stageExecutions.attempt), asc(stageExecutions.id))
    .all();
}

/** How many live attempts a stage has taken, so the next one is numbered. */
export function nextAttemptNumber(
  db: Db,
  reviewId: string,
  stage: ReviewStage,
  promptHash: string,
): number {
  const rows = db
    .select()
    .from(stageExecutions)
    .where(
      and(
        eq(stageExecutions.reviewId, reviewId),
        eq(stageExecutions.stage, stage),
        eq(stageExecutions.promptHash, promptHash),
      ),
    )
    .all();
  return rows.length + 1;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costEquivalentUsd: number;
  liveAttempts: number;
}

/**
 * What the review actually spent.
 *
 * Summed from the rows rather than trusted from a counter, so a replayed
 * stage cannot inflate the total: replays write no row.
 */
export function usageTotals(db: Db, reviewId: string): UsageTotals {
  const rows = listForReview(db, reviewId);
  return {
    inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
    cacheCreationTokens: rows.reduce((total, row) => total + row.cacheCreationTokens, 0),
    cacheReadTokens: rows.reduce((total, row) => total + row.cacheReadTokens, 0),
    outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
    costEquivalentUsd: rows.reduce((total, row) => total + row.costEquivalentUsd, 0),
    liveAttempts: rows.length,
  };
}

/**
 * How long each stage usually takes on this machine, for this model.
 *
 * A run in progress can say more than "still going" without inventing
 * anything: the same stage has been timed on every previous review, and the
 * median of those is a measurement rather than an estimate.
 *
 * Per model, because a haiku stage and a fable stage are not the same work
 * and one median over both would describe neither. The median rather than the
 * mean, because one stage that waited out a rate limit would drag an average
 * somewhere no run has ever been.
 *
 * A stage with fewer than this many timed attempts reports nothing at all. An
 * average of one is not an average, and a wait is a bad place to learn that
 * the number on the screen came from a single sample.
 */
const ENOUGH_SAMPLES = 3;

export function stageDurationMedians(db: Db, model: string): Map<string, number> {
  const rows = db
    .select({
      stage: stageExecutions.stage,
      startedAt: stageExecutions.startedAt,
      endedAt: stageExecutions.endedAt,
    })
    .from(stageExecutions)
    .innerJoin(reviews, eq(stageExecutions.reviewId, reviews.id))
    .where(and(eq(reviews.model, model), eq(stageExecutions.status, "succeeded")))
    .all();

  const byStage = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.endedAt) continue;
    const ms = new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime();
    if (!Number.isFinite(ms) || ms <= 0) continue;
    byStage.set(row.stage, [...(byStage.get(row.stage) ?? []), ms]);
  }

  const medians = new Map<string, number>();
  for (const [stage, samples] of byStage) {
    if (samples.length < ENOUGH_SAMPLES) continue;
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    medians.set(
      stage,
      sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
    );
  }
  return medians;
}
