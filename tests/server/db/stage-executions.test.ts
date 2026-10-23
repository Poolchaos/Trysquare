import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import {
  latestChainedSession,
  latestSucceeded,
  listForReview,
  nextAttemptNumber,
  recordAttempt,
  stageDurationMedians,
  usageTotals,
} from "@/server/db/repositories/stage-executions";
import { createReview } from "@/server/db/repositories/reviews";
import { makeTestDb, seedProject, seedReview, type TestDb } from "./helpers";

let ctx: TestDb;
let db: Db;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = seedReview(db, seedProject(db).id).id;
});

afterEach(() => ctx.cleanup());

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costEquivalentUsd: 0.5,
};

describe("replaying a stage", () => {
  it("finds the stored answer for the same request", () => {
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "hash-a",
      attempt: 1,
      status: "succeeded",
      sessionId: "session-1",
      outputJson: JSON.stringify({ files: [] }),
      usage,
    });

    const found = latestSucceeded(db, reviewId, "s1_risk", "hash-a");
    expect(found?.outputJson).toBe(JSON.stringify({ files: [] }));
    expect(found?.sessionId).toBe("session-1");
  });

  it("does not replay an answer to a different question", () => {
    // A prompt that changed is a different request, and answering it with
    // yesterday's answer would be worse than paying for it again.
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "hash-a",
      attempt: 1,
      status: "succeeded",
      outputJson: "{}",
    });
    expect(latestSucceeded(db, reviewId, "s1_risk", "hash-b")).toBeUndefined();
  });

  it("does not replay a failed attempt", () => {
    recordAttempt(db, {
      reviewId,
      stage: "s3_adversarial",
      promptHash: "hash-a",
      attempt: 1,
      status: "failed",
      errorClass: "invalid_output",
      errorText: "shape was wrong",
    });
    expect(latestSucceeded(db, reviewId, "s3_adversarial", "hash-a")).toBeUndefined();
  });

  it("does not replay a succeeded row that stored no answer", () => {
    // Belt and braces: a row without an output cannot stand in for one.
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "hash-a",
      attempt: 1,
      status: "succeeded",
      outputJson: null,
    });
    expect(latestSucceeded(db, reviewId, "s1_risk", "hash-a")).toBeUndefined();
  });

  it("prefers the newest answer when a stage was run more than once", () => {
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "hash-a",
      attempt: 1,
      status: "succeeded",
      outputJson: JSON.stringify({ generation: "first" }),
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "hash-a",
      attempt: 2,
      status: "succeeded",
      outputJson: JSON.stringify({ generation: "second" }),
      startedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(latestSucceeded(db, reviewId, "s1_risk", "hash-a")?.outputJson).toContain("second");
  });

  it("keeps one review's answers away from another's", () => {
    const other = seedReview(db, seedProject(db, "other").id).id;
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "hash-a",
      attempt: 1,
      status: "succeeded",
      outputJson: "{}",
    });
    expect(latestSucceeded(db, other, "s1_risk", "hash-a")).toBeUndefined();
  });
});

describe("rejoining the earlier conversation", () => {
  it("returns the session of the most recent chained stage", () => {
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "a",
      attempt: 1,
      status: "succeeded",
      sessionId: "early",
      outputJson: "{}",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    recordAttempt(db, {
      reviewId,
      stage: "s3_adversarial",
      promptHash: "b",
      attempt: 1,
      status: "succeeded",
      sessionId: "later",
      outputJson: "{}",
      startedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(latestChainedSession(db, reviewId)).toBe("later");
  });

  it("ignores the verification session, which is deliberately separate", () => {
    // Verification runs cold on purpose; resuming into it would undo the
    // independence the whole stage exists for.
    recordAttempt(db, {
      reviewId,
      stage: "s2_comprehension",
      promptHash: "a",
      attempt: 1,
      status: "succeeded",
      sessionId: "chained",
      outputJson: "{}",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    recordAttempt(db, {
      reviewId,
      stage: "s5_verification",
      promptHash: "b",
      attempt: 1,
      status: "succeeded",
      sessionId: "verification",
      outputJson: "{}",
      startedAt: "2026-01-03T00:00:00.000Z",
    });

    expect(latestChainedSession(db, reviewId)).toBe("chained");
  });

  it("has no session to offer before anything has run", () => {
    expect(latestChainedSession(db, reviewId)).toBeUndefined();
  });
});

describe("the record of what a review spent", () => {
  it("sums usage across every attempt, including failed ones", () => {
    // A failed attempt cost tokens too, and a total that omits them
    // understates the run.
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "a",
      attempt: 1,
      status: "failed",
      usage,
      errorClass: "invalid_output",
    });
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "a",
      attempt: 2,
      status: "succeeded",
      usage,
      outputJson: "{}",
    });

    expect(usageTotals(db, reviewId)).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costEquivalentUsd: 1,
      liveAttempts: 2,
    });
  });

  it("counts nothing for a review that has not run", () => {
    expect(usageTotals(db, reviewId).liveAttempts).toBe(0);
  });

  it("numbers the next attempt from what came before", () => {
    expect(nextAttemptNumber(db, reviewId, "s1_risk", "a")).toBe(1);
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "a",
      attempt: 1,
      status: "failed",
    });
    expect(nextAttemptNumber(db, reviewId, "s1_risk", "a")).toBe(2);
    // A different request starts its own numbering.
    expect(nextAttemptNumber(db, reviewId, "s1_risk", "b")).toBe(1);
  });

  it("lists attempts oldest first, for a timeline that reads in order", () => {
    recordAttempt(db, {
      reviewId,
      stage: "s2_comprehension",
      promptHash: "b",
      attempt: 1,
      status: "succeeded",
      outputJson: "{}",
      startedAt: "2026-01-02T00:00:00.000Z",
    });
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "a",
      attempt: 1,
      status: "succeeded",
      outputJson: "{}",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(listForReview(db, reviewId).map((row) => row.stage)).toEqual([
      "s1_risk",
      "s2_comprehension",
    ]);
  });

  it("goes with the review when the review is deleted", async () => {
    recordAttempt(db, {
      reviewId,
      stage: "s1_risk",
      promptHash: "a",
      attempt: 1,
      status: "succeeded",
      outputJson: "{}",
    });
    const { deleteReview } = await import("@/server/db/repositories/reviews");
    deleteReview(db, reviewId);
    expect(listForReview(db, reviewId)).toEqual([]);
  });
});

describe("the order a timeline reads in", () => {
  it("keeps one call's rows in attempt order, whatever their ids sort like", () => {
    // Every row a single call writes shares one startedAt, and ULIDs are not
    // monotonic inside a millisecond: the second of two generated in the same
    // millisecond sorts before the first about half the time. Ordering by id
    // returned them at random, which passed locally and failed in CI.
    const startedAt = "2026-07-31T10:00:00.000Z";
    for (const attempt of [1, 2, 3]) {
      recordAttempt(db, {
        reviewId,
        stage: "s1_risk",
        promptHash: "same-question",
        attempt,
        status: attempt === 3 ? "failed" : "succeeded",
        outputJson: attempt === 3 ? null : "{}",
        startedAt,
      });
    }

    expect(listForReview(db, reviewId).map((row) => row.attempt)).toEqual([1, 2, 3]);
  });
});

describe("how long a stage usually takes here", () => {
  /** A timed attempt whose duration is exactly what is asked for. */
  function timed(id: string, stage: string, seconds: number) {
    const startedAt = new Date("2026-08-17T10:00:00.000Z").toISOString();
    const endedAt = new Date(Date.parse(startedAt) + seconds * 1000).toISOString();
    recordAttempt(db, {
      reviewId: id,
      stage: stage as Parameters<typeof recordAttempt>[1]["stage"],
      promptHash: `hash-${stage}-${seconds}`,
      attempt: 1,
      status: "succeeded",
      usage,
      startedAt,
      endedAt,
    });
  }

  it("says nothing until it has seen the stage enough times to mean it", () => {
    // An average of one is not an average, and a run in progress is a bad
    // place to learn that the number on the screen came from a single sample.
    timed(reviewId, "s1_risk", 10);
    timed(reviewId, "s1_risk", 20);
    expect(stageDurationMedians(db, "claude-fable-5[1m]").has("s1_risk")).toBe(false);

    timed(reviewId, "s1_risk", 30);
    expect(stageDurationMedians(db, "claude-fable-5[1m]").get("s1_risk")).toBe(20_000);
  });

  it("leaves out one finding verified again, which is not the stage's usual work", () => {
    // A one-finding verification is seconds where the stage over a whole
    // change set is minutes, and pulled the stage's estimate down.
    for (const seconds of [100, 110, 120]) timed(reviewId, "s5_verification", seconds);
    for (const seconds of [5, 6, 7]) {
      recordAttempt(db, {
        reviewId,
        stage: "s5_verification",
        promptHash: `again-${seconds}`,
        attempt: 1,
        status: "succeeded",
        usage,
        findingId: "F1",
        startedAt: "2026-08-17T10:00:00.000Z",
        endedAt: new Date(Date.parse("2026-08-17T10:00:00.000Z") + seconds * 1000).toISOString(),
      });
    }
    expect(stageDurationMedians(db, "claude-fable-5[1m]").get("s5_verification")).toBe(110_000);
  });

  it("takes the middle sample, so one stalled stage cannot move it", () => {
    // The mean of these is 155s, which no run has ever taken. The median is
    // 20s, which three of them did.
    timed(reviewId, "s2_comprehension", 10);
    timed(reviewId, "s2_comprehension", 20);
    timed(reviewId, "s2_comprehension", 30);
    timed(reviewId, "s2_comprehension", 620);

    expect(stageDurationMedians(db, "claude-fable-5[1m]").get("s2_comprehension")).toBe(25_000);
  });

  it("keeps one model's timings out of another's", () => {
    // A haiku stage and a fable stage are not the same work, and one median
    // over both would describe neither.
    const other = createReview(db, {
      projectId: seedProject(db, "other").id,
      fromBranch: "feature/x",
      fromCommit: "a".repeat(40),
      intoBranch: "main",
      intoCommit: "b".repeat(40),
      mergeBaseCommit: "c".repeat(40),
      model: "claude-haiku-4-5-20251001",
      profileId: "mechanical-only",
      engineMode: "headless",
    }).id;

    for (const seconds of [10, 10, 10]) timed(reviewId, "s3_adversarial", seconds);
    for (const seconds of [90, 90, 90]) timed(other, "s3_adversarial", seconds);

    expect(stageDurationMedians(db, "claude-fable-5[1m]").get("s3_adversarial")).toBe(10_000);
    expect(stageDurationMedians(db, "claude-haiku-4-5-20251001").get("s3_adversarial")).toBe(
      90_000,
    );
  });

  it("ignores an attempt that never finished, rather than timing it to now", () => {
    for (const seconds of [10, 10, 10]) timed(reviewId, "s4_deletions", seconds);
    recordAttempt(db, {
      reviewId,
      stage: "s4_deletions",
      promptHash: "hash-open",
      attempt: 2,
      status: "running",
      usage,
      endedAt: null,
    });

    expect(stageDurationMedians(db, "claude-fable-5[1m]").get("s4_deletions")).toBe(10_000);
  });
});
