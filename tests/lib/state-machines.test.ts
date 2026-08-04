import { describe, expect, it } from "vitest";
import {
  ACTIVE_REVIEW_STATUSES,
  FINDING_STATUSES,
  IllegalTransitionError,
  REVIEW_STATUSES,
  RESUMABLE_REVIEW_STATUSES,
  assertFindingTransition,
  assertReviewTransition,
  canTransitionFinding,
  canTransitionReview,
} from "@/lib/domain/state-machines";

describe("review status machine", () => {
  it("walks the happy path from draft to complete", () => {
    const path = ["draft", "running", "verifying", "awaiting_confirmation", "complete"] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      const from = path[i]!;
      const to = path[i + 1]!;
      expect(canTransitionReview(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("cannot skip verification on the way to the report", () => {
    expect(canTransitionReview("running", "awaiting_confirmation")).toBe(false);
    expect(canTransitionReview("running", "complete")).toBe(false);
    expect(canTransitionReview("verifying", "complete")).toBe(false);
  });

  it("allows every interruption from an active status", () => {
    for (const active of ACTIVE_REVIEW_STATUSES) {
      for (const interruption of ["paused_limit", "interrupted", "failed", "cancelled"] as const) {
        expect(canTransitionReview(active, interruption), `${active} -> ${interruption}`).toBe(
          true,
        );
      }
    }
  });

  it("resumes a paused or interrupted review back into running", () => {
    for (const resumable of RESUMABLE_REVIEW_STATUSES) {
      expect(canTransitionReview(resumable, "running")).toBe(true);
    }
  });

  it("does not let a resumed review re-enter confirmation without running again", () => {
    expect(canTransitionReview("interrupted", "awaiting_confirmation")).toBe(false);
    expect(canTransitionReview("paused_limit", "verifying")).toBe(false);
  });

  it("treats complete and cancelled as final", () => {
    for (const terminal of ["complete", "cancelled"] as const) {
      for (const status of REVIEW_STATUSES) {
        expect(canTransitionReview(terminal, status), `${terminal} -> ${status}`).toBe(false);
      }
    }
  });

  it("lets a failed review run again, and nothing else", () => {
    // Failure used to be final, which meant the only recovery from a broken
    // stage was starting over and paying for every stage again. Resuming
    // replays the answered ones from their checkpoints (D-50).
    for (const status of REVIEW_STATUSES) {
      expect(canTransitionReview("failed", status), `failed -> ${status}`).toBe(
        status === "running",
      );
    }
  });

  it("cannot interrupt a review that is waiting on a human", () => {
    expect(canTransitionReview("awaiting_confirmation", "paused_limit")).toBe(false);
    expect(canTransitionReview("awaiting_confirmation", "interrupted")).toBe(false);
    expect(canTransitionReview("awaiting_confirmation", "cancelled")).toBe(true);
  });

  it("never allows a status to transition to itself", () => {
    for (const status of REVIEW_STATUSES) {
      expect(canTransitionReview(status, status), `${status} -> itself`).toBe(false);
    }
  });

  it("throws a message naming what was allowed", () => {
    expect(() => assertReviewTransition("draft", "complete")).toThrow(IllegalTransitionError);
    expect(() => assertReviewTransition("draft", "complete")).toThrow(/running, cancelled/);
    expect(() => assertReviewTransition("complete", "running")).toThrow(/final/);
  });

  it("accepts a legal transition silently", () => {
    expect(() => assertReviewTransition("draft", "running")).not.toThrow();
  });
});

describe("finding status machine", () => {
  it("lets verification decide a candidate's fate", () => {
    const fates = ["verified", "killed", "open_question"] as const;
    for (const status of FINDING_STATUSES) {
      expect(canTransitionFinding("candidate", status), `candidate -> ${status}`).toBe(
        (fates as readonly string[]).includes(status),
      );
    }
  });

  it("requires verification before a human can confirm", () => {
    expect(canTransitionFinding("candidate", "confirmed")).toBe(false);
    expect(canTransitionFinding("candidate", "dismissed")).toBe(false);
    expect(canTransitionFinding("verified", "confirmed")).toBe(true);
  });

  it("lets an open question be resolved either way by a human", () => {
    expect(canTransitionFinding("open_question", "confirmed")).toBe(true);
    expect(canTransitionFinding("open_question", "dismissed")).toBe(true);
  });

  it("keeps a killed finding dead so it cannot be revived into a report", () => {
    for (const status of FINDING_STATUSES) {
      expect(canTransitionFinding("killed", status), `killed -> ${status}`).toBe(false);
    }
  });

  it("treats a decided finding as final", () => {
    for (const decided of ["confirmed", "dismissed"] as const) {
      for (const status of FINDING_STATUSES) {
        expect(canTransitionFinding(decided, status), `${decided} -> ${status}`).toBe(false);
      }
    }
  });

  it("throws on an illegal transition", () => {
    expect(() => assertFindingTransition("killed", "verified")).toThrow(IllegalTransitionError);
    expect(() => assertFindingTransition("verified", "confirmed")).not.toThrow();
  });
});
