/**
 * The scoreboard's arithmetic, which is the whole of it.
 *
 * Every figure on that screen is counted from rows this app wrote, so the
 * tests that matter are the ones about what happens when there is nothing to
 * count and what happens to findings other screens deliberately hide.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import {
  confirmFinding,
  createCandidate,
  dismissFinding,
  markKilled,
  markOpenQuestion,
  markVerified,
} from "@/server/db/repositories/findings";
import { confirmCheckFinding, recordFailedCommand } from "@/server/db/repositories/check-findings";
import { readScoreboard } from "@/server/db/repositories/scoreboard";
import { recordAttempt } from "@/server/db/repositories/stage-executions";
import { transitionReview } from "@/server/db/repositories/reviews";
import { eq } from "drizzle-orm";
import { projects, reviews } from "@/server/db/schema";
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

/** Findings are decided only while their review waits on a person (4.23). */
function waitOnAPerson(): void {
  for (const to of ["running", "verifying", "awaiting_confirmation"] as const) {
    transitionReview(db, reviewId, to);
  }
}

function candidate(overrides: Partial<Parameters<typeof createCandidate>[1]> = {}) {
  return createCandidate(db, {
    reviewId,
    repo: "primary",
    filePath: "app/src/orders/total.ts",
    lineStart: 4,
    lineEnd: 4,
    severity: "CRITICAL",
    ruleCode: "8",
    issue: "Money in floats",
    comment: "Totals drift.",
    mechanism: "summed as floats",
    ...overrides,
  });
}

const evidence = { quotedCode: "code", lineStart: 4, lineEnd: 4 };

describe("a scoreboard with nothing to report", () => {
  it("says nothing rather than zero for a rate with no denominator", () => {
    // Zero percent precision is a claim about findings that were judged. With
    // none judged, the honest answer is that there is no answer yet.
    const board = readScoreboard(db);
    expect(board.precision).toBeNull();
    expect(board.proofsDiscardedRate).toBeNull();
    expect(board.spendUsd).toBe(0);
    expect(board.ruleYield).toEqual([]);
  });
});

describe("the two rates the product is about", () => {
  it("measures precision against what a person decided, not what was raised", () => {
    // A finding still awaiting a decision is not evidence either way, so it
    // must not drag the number in either direction.
    const kept = candidate();
    const dropped = candidate({ issue: "Second" });
    const undecided = candidate({ issue: "Third" });
    for (const finding of [kept, dropped, undecided]) markVerified(db, finding.id, evidence);
    waitOnAPerson();
    confirmFinding(db, kept.id);
    dismissFinding(db, dropped.id, "Guarded upstream.");

    expect(readScoreboard(db).precision).toBe(0.5);
  });

  it("does not count a finding left out unproven as one a person rejected", () => {
    // Verification never proved it, so leaving it out says nothing about
    // whether it was worth reading (D-190).
    const kept = candidate();
    const dropped = candidate({ issue: "Second" });
    const unproven = candidate({ issue: "Third" });
    for (const finding of [kept, dropped]) markVerified(db, finding.id, evidence);
    markOpenQuestion(db, unproven.id, "Could not tell from the code.");
    waitOnAPerson();
    confirmFinding(db, kept.id);
    dismissFinding(db, dropped.id, "Guarded upstream.");
    dismissFinding(db, unproven.id, "Could not prove it.");

    expect(readScoreboard(db).precision).toBe(0.5);
  });

  it("measures discarded proofs against everything raised, including what was hidden", () => {
    // Killed findings are filtered out of every other screen. Here they are
    // the point: how often a proof failed the program's check of it.
    const real = candidate();
    markVerified(db, real.id, evidence);
    waitOnAPerson();
    confirmFinding(db, real.id);
    markKilled(
      db,
      candidate({ issue: "Invented" }).id,
      "Quoted code that was not there.",
      "quote_check",
    );

    expect(readScoreboard(db).proofsDiscardedRate).toBe(0.5);
  });

  it("counts only the quotation check's kills, not a refutation (4.24)", () => {
    // A finding the verifier read and judged wrong had no proof to discard:
    // it cited real code, and counting it too overstated the rate.
    const real = candidate();
    markVerified(db, real.id, evidence);
    waitOnAPerson();
    confirmFinding(db, real.id);
    markKilled(db, candidate({ issue: "Refuted" }).id, "Guarded upstream.", "verification");
    markKilled(
      db,
      candidate({ issue: "Invented" }).id,
      "Quoted code that was not there.",
      "quote_check",
    );

    expect(readScoreboard(db).proofsDiscardedRate).toBeCloseTo(1 / 3);
  });
});

describe("which rules earn their keep", () => {
  it("credits a rule for what it got into a report, out of everything it raised", () => {
    const kept = candidate({ ruleCode: "8" });
    const dropped = candidate({ ruleCode: "8", issue: "Second" });
    const other = candidate({ ruleCode: "2", issue: "Third" });
    for (const finding of [kept, dropped, other]) markVerified(db, finding.id, evidence);
    waitOnAPerson();
    confirmFinding(db, kept.id);
    dismissFinding(db, dropped.id, "Not a problem here.");
    confirmFinding(db, other.id);

    const board = readScoreboard(db);
    // Worst yield first: the rule costing the most attention for the least
    // return is the one an author needs to see.
    expect(board.ruleYield.map((rule) => rule.ruleCode)).toEqual(["8", "2"]);
    expect(board.ruleYield[0]).toEqual({ ruleCode: "8", confirmed: 1, total: 2 });
    expect(board.ruleYield[1]).toEqual({ ruleCode: "2", confirmed: 1, total: 1 });
  });

  it("leaves a finding that cited no rule out of the rule table", () => {
    // It still counts in the totals; there is simply no rule to credit, and
    // filing it under an invented code would be a measurement of nothing.
    markVerified(db, candidate({ ruleCode: null }).id, evidence);

    const board = readScoreboard(db);
    expect(board.ruleYield).toEqual([]);
    expect(board.recent[0]?.total).toBe(1);
  });
});

describe("the recent list", () => {
  it("counts a review's findings as its queue holds them, the killed left out (D-253)", () => {
    // Recent said "0 of 10" of a review whose page said "0 of 9 decided":
    // the ten counted a finding verification refuted, which nobody can
    // confirm.
    markVerified(db, candidate().id, evidence);
    markKilled(db, candidate({ issue: "Refuted" }).id, "Guarded upstream.", "verification");

    const board = readScoreboard(db);
    expect(board.recent[0]).toMatchObject({ confirmed: 0, total: 1 });
    expect(board.projects[0]?.latest).toMatchObject({ confirmed: 0, total: 1 });
  });

  it("carries each review's own tally and leaves duration null until it ends", () => {
    markVerified(db, candidate().id, evidence);

    const row = readScoreboard(db).recent[0];
    expect(row?.total).toBe(1);
    expect(row?.confirmed).toBe(0);
    // Never started, so there is no duration to state.
    expect(row?.durationMs).toBeNull();
  });

  it("counts a completed review once it has actually completed", () => {
    expect(readScoreboard(db).reviewsCompleted).toBe(0);
    for (const status of ["running", "verifying", "awaiting_confirmation", "complete"] as const) {
      transitionReview(db, reviewId, status);
    }
    expect(readScoreboard(db).reviewsCompleted).toBe(1);
  });
});

describe("what the dashboard widgets need", () => {
  it("lists the reviews behind the awaiting count, oldest wait first", () => {
    // The count alone tells someone there is work without telling them where
    // it is, which is a notification rather than a way in.
    const second = seedReview(db, seedProject(db, "other").id).id;
    for (const id of [reviewId, second]) {
      transitionReview(db, id, "running");
      transitionReview(db, id, "verifying");
      transitionReview(db, id, "awaiting_confirmation");
    }

    const board = readScoreboard(db);
    expect(board.awaiting).toBe(2);
    expect(board.awaitingReviews).toHaveLength(2);
    // Oldest wait first: the one most likely to have been forgotten.
    const waits = board.awaitingReviews.map((row) => row.since);
    expect([...waits].sort()).toEqual(waits);
    expect(board.awaitingReviews[0]?.fromBranch).toBe("feature/x");
  });

  it("dates a wait from when the run ended, not from when the review was made", () => {
    // A waiting review has no completion time, so the wait was counted from
    // its creation: one made on Monday and run on Friday had waited a week.
    // Then from its last stage row, which a finding verified again moves.
    const second = seedReview(db, seedProject(db, "other").id).id;
    const unseen = seedReview(db, seedProject(db, "unseen").id).id;
    const ended = { [reviewId]: "2999-01-02T00:00:00.000Z", [second]: "2999-01-01T00:00:00.000Z" };
    for (const id of [reviewId, second, unseen]) {
      transitionReview(db, id, "running");
      transitionReview(db, id, "verifying");
      transitionReview(db, id, "awaiting_confirmation");
      db.update(reviews)
        .set({ runEndedAt: ended[id] ?? null })
        .where(eq(reviews.id, id))
        .run();
    }
    recordAttempt(db, {
      reviewId: second,
      stage: "s5_verification",
      promptHash: "hash",
      attempt: 1,
      status: "succeeded",
      startedAt: "2999-01-03T00:00:00.000Z",
      endedAt: "2999-01-03T00:00:00.000Z",
      findingId: "verified-again",
    });

    const waiting = readScoreboard(db).awaitingReviews;
    // One whose run's end nobody recorded says no time, and comes last.
    expect(waiting.map((row) => row.id)).toEqual([second, reviewId, unseen]);
    expect(waiting.map((row) => row.since)).toEqual([ended[second], ended[reviewId], null]);
  });

  it("times a review by its run, leaving out the wait for a person", () => {
    waitOnAPerson();
    transitionReview(db, reviewId, "complete");
    db.update(reviews)
      .set({
        startedAt: "2026-08-18T10:00:00.000Z",
        runEndedAt: "2026-08-18T10:10:00.000Z",
        completedAt: "2026-08-20T10:10:00.000Z",
      })
      .where(eq(reviews.id, reviewId))
      .run();

    expect(readScoreboard(db).recent[0]?.durationMs).toBe(600_000);
    // Run once: the time is the review's whole.
    expect(readScoreboard(db).recent[0]?.ranBefore).toBe(false);

    // A stage answered before this run started was an earlier run's, whose
    // cost is in the row's and whose time is not (AE6). One verified again
    // is no run.
    const earlier = {
      reviewId,
      promptHash: "hash",
      attempt: 1,
      status: "succeeded" as const,
      startedAt: "2026-08-18T09:40:00.000Z",
      endedAt: "2026-08-18T09:41:00.000Z",
    };
    recordAttempt(db, { ...earlier, stage: "s5_verification", findingId: "verified-again" });
    expect(readScoreboard(db).recent[0]?.ranBefore).toBe(false);
    recordAttempt(db, { ...earlier, stage: "s1_risk" });
    expect(readScoreboard(db).recent[0]?.ranBefore).toBe(true);
  });

  it("counts a dismissal as a decision, and leaves killed findings out of the queue", () => {
    // The widget's whole job is saying how much is left. Counting only the
    // confirmed ones told someone who had dismissed a queue that they had not
    // started it, and counting killed findings in the total set a target the
    // queue never shows and so can never reach.
    const kept = candidate();
    const dropped = candidate({ issue: "Second" });
    const untouched = candidate({ issue: "Third" });
    for (const finding of [kept, dropped, untouched]) markVerified(db, finding.id, evidence);
    markKilled(
      db,
      candidate({ issue: "Invented" }).id,
      "Quoted code that was not there.",
      "quote_check",
    );
    waitOnAPerson();
    confirmFinding(db, kept.id);
    dismissFinding(db, dropped.id, "Guarded upstream.");

    const row = readScoreboard(db).awaitingReviews[0];
    expect(row?.decided).toBe(2);
    expect(row?.total).toBe(3);
  });

  it("keeps two projects with the same name apart", () => {
    // Two remotes can end in the same repository name. Matching on it would
    // report one project's last finding as another's.
    const twin = seedProject(db, "example-twin");
    db.update(projects).set({ name: "example" }).where(eq(projects.id, twin.id)).run();
    const twinReview = seedReview(db, twin.id).id;
    transitionReview(db, twinReview, "running");

    const board = readScoreboard(db);
    const both = board.projects.filter((project) => project.name === "example");
    expect(both).toHaveLength(2);
    expect(both.every((project) => project.reviews === 1)).toBe(true);
    expect(new Set(both.map((project) => project.latest?.id)).size).toBe(2);
  });

  it("reports a project that has never been reviewed rather than hiding it", () => {
    // The most useful thing the widget can point at is the project with no
    // review yet.
    seedProject(db, "untouched");

    const fresh = readScoreboard(db).projects.find((project) => project.name === "untouched");
    expect(fresh).toBeDefined();
    expect(fresh?.reviews).toBe(0);
    expect(fresh?.latest).toBeNull();
  });
});

describe("what a project's own checks found", () => {
  it("is counted with the code's findings, as the review's own queue counts it", () => {
    // Read from the findings table alone, a review whose only finding was a
    // failing test said "no findings" on the dashboard while it waited on one.
    const failed = recordFailedCommand(db, reviewId, {
      step: "tests",
      command: "npm test",
      exitCode: 1,
      timedOut: false,
      logPath: "/tmp/tests.log",
      tail: "1 failed",
    });
    waitOnAPerson();

    const waiting = readScoreboard(db);
    expect(waiting.awaitingReviews[0]).toMatchObject({ decided: 0, total: 1 });
    expect(waiting.recent[0]).toMatchObject({ confirmed: 0, total: 1 });

    confirmCheckFinding(db, failed.id);

    const decided = readScoreboard(db);
    expect(decided.awaitingReviews[0]).toMatchObject({ decided: 1, total: 1 });
    expect(decided.recent[0]).toMatchObject({ confirmed: 1, total: 1 });
    expect(decided.projects[0]?.latest).toMatchObject({ confirmed: 1, total: 1 });
    // The two rates stay the code's: a failing command cites no rule and was
    // never a quotation to check.
    expect(decided.precision).toBeNull();
    expect(decided.proofsDiscardedRate).toBeNull();
  });
});
