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
  markVerified,
} from "@/server/db/repositories/findings";
import { readScoreboard } from "@/server/db/repositories/scoreboard";
import { transitionReview } from "@/server/db/repositories/reviews";
import { eq } from "drizzle-orm";
import { projects } from "@/server/db/schema";
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
    expect(board.inventionRate).toBeNull();
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
    confirmFinding(db, kept.id);
    dismissFinding(db, dropped.id, "Guarded upstream.");

    expect(readScoreboard(db).precision).toBe(0.5);
  });

  it("measures invention against everything raised, including what was hidden", () => {
    // Killed findings are filtered out of every other screen. Here they are
    // the point: they are how often the engine cited code that was not there.
    const real = candidate();
    markVerified(db, real.id, evidence);
    confirmFinding(db, real.id);
    markKilled(db, candidate({ issue: "Invented" }).id, "Quoted code that was not there.");

    expect(readScoreboard(db).inventionRate).toBe(0.5);
  });
});

describe("which rules earn their keep", () => {
  it("credits a rule for what it got into a report, out of everything it raised", () => {
    const kept = candidate({ ruleCode: "8" });
    const dropped = candidate({ ruleCode: "8", issue: "Second" });
    const other = candidate({ ruleCode: "2", issue: "Third" });
    for (const finding of [kept, dropped, other]) markVerified(db, finding.id, evidence);
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
