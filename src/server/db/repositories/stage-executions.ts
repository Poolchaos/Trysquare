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
import { stageExecutions } from "../schema";

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
  usage?: { inputTokens: number; outputTokens: number; costEquivalentUsd: number };
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

/** Everything this review has asked, oldest first, for the timeline. */
export function listForReview(db: Db, reviewId: string): StageExecution[] {
  return db
    .select()
    .from(stageExecutions)
    .where(eq(stageExecutions.reviewId, reviewId))
    .orderBy(asc(stageExecutions.startedAt), asc(stageExecutions.id))
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
    outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
    costEquivalentUsd: rows.reduce((total, row) => total + row.costEquivalentUsd, 0),
    liveAttempts: rows.length,
  };
}
