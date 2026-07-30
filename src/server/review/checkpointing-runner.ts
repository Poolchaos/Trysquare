/**
 * The layer that makes a resumed review cheap and honest.
 *
 * A review is a sequence of expensive questions. When one is interrupted, by a
 * usage limit, a crash, or the user, the answers already given are still good:
 * they were answered about pinned commits that cannot move. This wrapper sits
 * between the pipeline and the engine and remembers them.
 *
 * Two things make that safe rather than merely fast.
 *
 * A stored answer is found by the hash of the question, not by the name of the
 * stage. If the change set, the ruleset, or the batching moved, the question is
 * different and the stage runs live. Replaying an answer to a question nobody
 * asked would be worse than paying to ask again.
 *
 * This is also the only writer of `stage_executions` rows and the only caller
 * of `addReviewUsage`. Two writers would eventually disagree about what a
 * stage returned or what it cost, and the usage figure is the number the user
 * makes decisions with.
 */

import { createHash } from "node:crypto";
import type { ReviewStage, StageErrorClass } from "@/lib/domain/enums";
import { nowIso } from "@/lib/ids";
import type { Db } from "../db/client";
import { addReviewUsage } from "../db/repositories/reviews";
import {
  latestChainedSession,
  latestSucceeded,
  nextAttemptNumber,
  recordAttempt,
} from "../db/repositories/stage-executions";
import { StageFailedError } from "../engine/headless";
import { StageOutputUnreadableError } from "./engine-runner";
import type { StageRequest, StageResponse, StageRunner } from "./pipeline";

/** Stages that share one session, and so can rejoin it after an interruption. */
const CHAINED_STAGES: readonly ReviewStage[] = [
  "s1_risk",
  "s2_comprehension",
  "s3_adversarial",
  "s4_deletions",
];

export interface StageUsage {
  inputTokens: number;
  outputTokens: number;
  costEquivalentUsd: number;
}

export interface AttemptReport {
  stage: ReviewStage;
  sessionId: string;
  attempt: number;
  usage: StageUsage;
}

export interface CheckpointingRunnerOptions {
  db: Db;
  reviewId: string;
  /** The engine runner's `run`, or anything else that answers a stage. */
  inner: StageRunner;
  /** Called before a stage is actually asked, so the UI can follow along. */
  onLiveAttempt?: ((stage: ReviewStage) => void) | undefined;
  /** Called instead when a stored answer is replayed, which costs nothing. */
  onReplay?: ((stage: ReviewStage) => void) | undefined;
  /** Where log files for a stage are written, recorded on the row. */
  logPathFor?: ((stage: ReviewStage) => string) | undefined;
}

export interface CheckpointingRunner {
  run: StageRunner;
  /**
   * Wire this to the engine runner's `onStageComplete`.
   *
   * The engine makes more than one call for a stage it has to ask twice, and
   * each one costs tokens whether or not its answer was usable. Reporting them
   * here is what keeps the recorded usage equal to what was actually spent.
   */
  noteAttempt: (report: AttemptReport) => void;
}

/**
 * The identity of a question.
 *
 * The system prompt is part of it, not just the user prompt: it carries the
 * rules the stage is judging against, so two stages with identical prompts and
 * different rules are different questions. The plan called for hashing the
 * stage and prompt alone; including the system prompt costs nothing and closes
 * the case where a ruleset edit would otherwise replay an answer given under
 * the old rules.
 */
export function promptHashFor(request: {
  stage: ReviewStage;
  systemPrompt: string;
  prompt: string;
}): string {
  return createHash("sha256")
    .update(`${request.stage}\n${request.systemPrompt}\n${request.prompt}`)
    .digest("hex");
}

export function createCheckpointingRunner(
  options: CheckpointingRunnerOptions,
): CheckpointingRunner {
  const { db, reviewId } = options;

  // Attempts reported by the engine for the call currently in flight. The
  // pipeline asks its questions one at a time, which this asserts rather than
  // assumes: a second concurrent call would mix two stages' attempts together
  // and silently misattribute their cost.
  let pending: AttemptReport[] = [];
  let inFlight: ReviewStage | null = null;

  const noteAttempt = (report: AttemptReport): void => {
    pending.push(report);
  };

  const writeRow = (input: {
    stage: ReviewStage;
    promptHash: string;
    attempt: number;
    status: "succeeded" | "failed";
    sessionId?: string | null;
    outputJson?: string | null;
    usage?: StageUsage;
    errorClass?: StageErrorClass;
    errorText?: string;
    startedAt: string;
  }): void => {
    recordAttempt(db, {
      reviewId,
      stage: input.stage,
      promptHash: input.promptHash,
      attempt: input.attempt,
      status: input.status,
      sessionId: input.sessionId ?? null,
      outputJson: input.outputJson ?? null,
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      errorClass: input.errorClass ?? null,
      errorText: input.errorText ?? null,
      logPath: options.logPathFor?.(input.stage) ?? null,
      startedAt: input.startedAt,
    });
    if (input.usage) addReviewUsage(db, reviewId, input.usage);
  };

  const run = async (request: StageRequest): Promise<StageResponse> => {
    if (inFlight !== null) {
      throw new Error(
        `A ${inFlight} stage is already running; the checkpointing runner answers ` +
          "one question at a time so that each attempt is attributed to the stage that made it.",
      );
    }

    const promptHash = promptHashFor(request);
    const stored = latestSucceeded(db, reviewId, request.stage, promptHash);
    if (stored?.outputJson) {
      // Free, and deliberately silent about usage: replaying an answer spends
      // nothing, and adding its original cost again would inflate the total
      // every time a review was resumed.
      options.onReplay?.(request.stage);
      return {
        output: JSON.parse(stored.outputJson),
        sessionId: stored.sessionId ?? "",
      };
    }

    // A live stage after replayed ones rejoins the conversation the replayed
    // stages had. Without this the first live stage would start cold and
    // re-derive what the comprehension pass already worked out, at full price.
    const resumeSessionId =
      request.resumeSessionId ??
      (CHAINED_STAGES.includes(request.stage) ? latestChainedSession(db, reviewId) : undefined);

    const startedAt = nowIso();
    const firstAttempt = nextAttemptNumber(db, reviewId, request.stage, promptHash);
    pending = [];
    inFlight = request.stage;
    options.onLiveAttempt?.(request.stage);

    try {
      const response = await options.inner({
        ...request,
        ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      });

      // Every attempt but the last was an answer the engine rejected and asked
      // again about. They cost tokens, so they are rows.
      pending.slice(0, -1).forEach((report, index) => {
        writeRow({
          stage: request.stage,
          promptHash,
          attempt: firstAttempt + index,
          status: "failed",
          sessionId: report.sessionId,
          usage: report.usage,
          errorClass: "invalid_output",
          errorText: "The answer did not match the schema and was asked again.",
          startedAt,
        });
      });

      const last = pending[pending.length - 1];
      // A runner that reports no attempts still returns usage on the response;
      // falling back to it keeps the total right either way.
      const finalUsage = last?.usage ?? response.usage;
      writeRow({
        stage: request.stage,
        promptHash,
        attempt: firstAttempt + Math.max(pending.length - 1, 0),
        status: "succeeded",
        sessionId: last?.sessionId ?? response.sessionId,
        outputJson: JSON.stringify(response.output),
        ...(finalUsage === undefined ? {} : { usage: finalUsage }),
        startedAt,
      });

      return response;
    } catch (error) {
      const unreadable = error instanceof StageOutputUnreadableError;

      // An unreadable answer means every call reported back and the last one's
      // answer was the problem, so the last row carries the failure. Any other
      // failure means a call died without reporting, so it gets a row of its
      // own with no usage: the CLI produced no result to take usage from.
      pending.forEach((report, index) => {
        const isLast = index === pending.length - 1;
        writeRow({
          stage: request.stage,
          promptHash,
          attempt: firstAttempt + index,
          status: "failed",
          sessionId: report.sessionId,
          usage: report.usage,
          errorClass: "invalid_output",
          errorText:
            isLast && unreadable
              ? messageOf(error)
              : "The answer did not match the schema and was asked again.",
          startedAt,
        });
      });

      if (!unreadable) {
        writeRow({
          stage: request.stage,
          promptHash,
          attempt: firstAttempt + pending.length,
          status: "failed",
          errorClass: classOf(error),
          errorText: messageOf(error),
          startedAt,
        });
      }

      throw error;
    } finally {
      inFlight = null;
      pending = [];
    }
  };

  return { run, noteAttempt };
}

function classOf(error: unknown): StageErrorClass {
  if (error instanceof StageFailedError) return error.errorClass;
  if (error instanceof StageOutputUnreadableError) return "invalid_output";
  return "unknown";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
