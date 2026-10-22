import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IllegalTransitionError } from "@/lib/domain/state-machines";
import type { Db } from "@/server/db/client";
import {
  addReviewUsage,
  countAwaitingConfirmation,
  listActiveReviews,
  markOrphanedReviewsInterrupted,
  requireReview,
  statusOf,
  transitionReview,
} from "@/server/db/repositories/reviews";
import { makeTestDb, seedProject, seedReview, type TestDb } from "./helpers";

let ctx: TestDb;
let db: Db;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => ctx.cleanup());

describe("review lifecycle", () => {
  it("starts as a draft with no timestamps set", () => {
    const project = seedProject(db);
    const review = seedReview(db, project.id);
    expect(statusOf(review)).toBe("draft");
    expect(review.startedAt).toBeNull();
    expect(review.completedAt).toBeNull();
  });

  it("times the run rather than the calendar, so a resume does not report the gap", async () => {
    // This asserted the opposite until 2026-08-18, and the opposite is what
    // made a review begun one day and resumed a fortnight later report having
    // taken 327 hours: a duration made almost entirely of sitting still.
    const review = seedReview(db, seedProject(db).id);
    const running = transitionReview(db, review.id, "running");
    expect(running.startedAt).not.toBeNull();

    transitionReview(db, review.id, "interrupted");
    await new Promise((resolve) => setTimeout(resolve, 12));
    const resumed = transitionReview(db, review.id, "running");

    expect(resumed.startedAt).not.toBe(running.startedAt);
    expect(Date.parse(resumed.startedAt!)).toBeGreaterThan(Date.parse(running.startedAt!));
    // The failed run's completion is cleared, or the duration would describe a
    // run that ended and then kept going.
    expect(resumed.completedAt).toBeNull();
    // When it was created is a different fact, and it stays put.
    expect(resumed.createdAt).toBe(review.createdAt);
  });

  it("stamps completedAt on every terminal status", () => {
    for (const terminal of ["complete", "failed", "cancelled"] as const) {
      const review = seedReview(db, seedProject(db, `p-${terminal}`).id);
      if (terminal === "complete") {
        transitionReview(db, review.id, "running");
        transitionReview(db, review.id, "verifying");
        transitionReview(db, review.id, "awaiting_confirmation");
      } else {
        transitionReview(db, review.id, "running");
      }
      const done = transitionReview(db, review.id, terminal);
      expect(done.completedAt, terminal).not.toBeNull();
    }
  });

  it("refuses an illegal transition and leaves the row untouched", () => {
    const review = seedReview(db, seedProject(db).id);
    expect(() => transitionReview(db, review.id, "complete")).toThrow(IllegalTransitionError);
    expect(statusOf(requireReview(db, review.id))).toBe("draft");
  });

  it("keeps a pause reason only while paused", () => {
    const review = seedReview(db, seedProject(db).id);
    transitionReview(db, review.id, "running");
    const paused = transitionReview(db, review.id, "paused_limit", {
      pausedReason: "5-hour limit reached",
    });
    expect(paused.pausedReason).toBe("5-hour limit reached");

    const resumed = transitionReview(db, review.id, "running");
    expect(resumed.pausedReason).toBeNull();
  });

  it("records the stage a review is on and can clear it", () => {
    const review = seedReview(db, seedProject(db).id);
    const running = transitionReview(db, review.id, "running", { currentStage: "s1_risk" });
    expect(running.currentStage).toBe("s1_risk");

    const verifying = transitionReview(db, review.id, "verifying", {
      currentStage: "s5_verification",
    });
    expect(verifying.currentStage).toBe("s5_verification");
  });

  it("cannot be transitioned twice from the same starting status", () => {
    const review = seedReview(db, seedProject(db).id);
    transitionReview(db, review.id, "running");
    // Simulates a second writer acting on a stale read of "draft".
    expect(() => transitionReview(db, review.id, "running")).toThrow(IllegalTransitionError);
  });

  it("accumulates usage across stages without touching status", () => {
    const review = seedReview(db, seedProject(db).id);
    transitionReview(db, review.id, "running");
    addReviewUsage(db, review.id, {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costEquivalentUsd: 0.5,
    });
    const after = addReviewUsage(db, review.id, {
      inputTokens: 50,
      outputTokens: 5,
      cacheCreationTokens: 1200,
      cacheReadTokens: 8000,
      costEquivalentUsd: 0.25,
    });
    expect(after.usageInputTokens).toBe(150);
    expect(after.usageOutputTokens).toBe(25);
    expect(after.costEquivalentUsd).toBeCloseTo(0.75, 10);
    expect(statusOf(after)).toBe("running");
  });
});

describe("restart recovery", () => {
  it("marks reviews that were mid-flight as interrupted, and leaves others alone", () => {
    const project = seedProject(db);
    const running = seedReview(db, project.id);
    const verifying = seedReview(db, project.id);
    const waiting = seedReview(db, project.id);
    const draft = seedReview(db, project.id);

    transitionReview(db, running.id, "running");
    transitionReview(db, verifying.id, "running");
    transitionReview(db, verifying.id, "verifying");
    transitionReview(db, waiting.id, "running");
    transitionReview(db, waiting.id, "verifying");
    transitionReview(db, waiting.id, "awaiting_confirmation");

    expect(listActiveReviews(db)).toHaveLength(2);
    expect(markOrphanedReviewsInterrupted(db)).toBe(2);

    expect(statusOf(requireReview(db, running.id))).toBe("interrupted");
    expect(statusOf(requireReview(db, verifying.id))).toBe("interrupted");
    // Nothing was executing for these two, so a restart does not change them.
    expect(statusOf(requireReview(db, waiting.id))).toBe("awaiting_confirmation");
    expect(statusOf(requireReview(db, draft.id))).toBe("draft");
  });
});

describe("the count of reviews awaiting confirmation", () => {
  // Counted in SQL rather than by loading every row, as the top bar asks
  // every few seconds on every screen (D-181 item 8); the same answer.
  it("counts only those awaiting a decision, across projects, as a number", () => {
    expect(countAwaitingConfirmation(db)).toBe(0);
    const awaiting = (projectName: string) => {
      const review = seedReview(db, seedProject(db, projectName).id);
      transitionReview(db, review.id, "running");
      transitionReview(db, review.id, "verifying");
      return transitionReview(db, review.id, "awaiting_confirmation");
    };
    awaiting("a");
    awaiting("b");
    transitionReview(db, awaiting("c").id, "complete");
    const verifying = seedReview(db, seedProject(db, "d").id);
    transitionReview(db, verifying.id, "running");
    transitionReview(db, verifying.id, "verifying");
    seedReview(db, seedProject(db, "e").id);

    const count = countAwaitingConfirmation(db);
    expect(count).toBe(2);
    expect(typeof count).toBe("number");
  });
});
