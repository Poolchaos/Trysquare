/**
 * What a running review tells anyone watching it.
 *
 * The bus carries no state a restart would need. Every durable fact, the
 * status, the stage rows, the run notes, the usage, is written to the database
 * by the service and the checkpointing runner before it is announced here, so
 * a listener that joins late or reconnects after a restart can read the whole
 * truth from the snapshot and lose nothing. That ordering is the point: an
 * event that arrived before the row it describes would let the UI show a stage
 * as finished while the database still says it is running, and reloading the
 * page would appear to undo it.
 *
 * Listeners are untrusted with respect to each other. One that throws must not
 * stop the others from being told, and must not fail the review it is watching.
 */

import type { ReviewStage, StageErrorClass } from "@/lib/domain/enums";
import type { ReviewStatus } from "@/lib/domain/state-machines";
import type { RunNote } from "../db/repositories/reviews";

export interface StageUsage {
  inputTokens: number;
  outputTokens: number;
  costEquivalentUsd: number;
}

export type ReviewEvent =
  | { kind: "status"; status: ReviewStatus; pausedReason?: string | undefined }
  | {
      kind: "stage";
      stage: ReviewStage;
      /** `replayed` costs nothing and spawns nothing; it is not a live call. */
      phase: "started" | "replayed" | "finished" | "failed";
      attempt?: number | undefined;
      usage?: StageUsage | undefined;
      errorClass?: StageErrorClass | undefined;
    }
  | { kind: "engine"; stage: ReviewStage; event: "tool-use" | "text"; detail: string }
  | { kind: "rate-limit"; status: string; resetsAt?: number | undefined }
  | { kind: "note"; note: RunNote }
  | {
      kind: "done";
      outcome: "completed" | "paused" | "cancelled" | "failed";
      reason?: string | undefined;
    };

export type ReviewListener = (event: ReviewEvent) => void;

export interface ReviewBus {
  emit: (reviewId: string, event: ReviewEvent) => void;
  subscribe: (reviewId: string, listener: ReviewListener) => () => void;
  /** How many listeners a review has, so a test can prove unsubscribe worked. */
  listenerCount: (reviewId: string) => number;
}

export function createReviewBus(onListenerError: (error: unknown) => void = () => {}): ReviewBus {
  const listeners = new Map<string, Set<ReviewListener>>();

  return {
    emit(reviewId, event) {
      // Copied before iterating: a listener may unsubscribe itself in response
      // to a done event, and mutating the set mid-iteration would skip whoever
      // came after it.
      for (const listener of [...(listeners.get(reviewId) ?? [])]) {
        try {
          listener(event);
        } catch (error) {
          // A browser that disconnected mid-write must not fail the review.
          onListenerError(error);
        }
      }
    },

    subscribe(reviewId, listener) {
      const forReview = listeners.get(reviewId) ?? new Set<ReviewListener>();
      forReview.add(listener);
      listeners.set(reviewId, forReview);

      return () => {
        const current = listeners.get(reviewId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(reviewId);
      };
    },

    listenerCount(reviewId) {
      return listeners.get(reviewId)?.size ?? 0;
    },
  };
}
