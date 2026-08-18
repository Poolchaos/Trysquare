/**
 * What this machine has actually measured, across every review it has run.
 *
 * Every number here is counted from rows this app wrote. Nothing is predicted,
 * scored or inferred: the standing rule for this screen is that a figure not
 * measured from local data does not render, so a rate with no denominator
 * comes back null and the screen says nothing rather than "0%" (D-68).
 *
 * The two rates are the ones the product is actually about. Precision is what
 * a person confirmed out of what they decided, which measures whether the
 * findings are worth reading. Invention is what the quotation check killed out
 * of everything ever raised, which measures how often the engine makes things
 * up. Killed findings are hidden on every other screen, deliberately, and this
 * is the one place they are the point.
 */

import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { findings, projects, reviews } from "../schema";

export interface ScoreboardRow {
  id: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  model: string;
  status: string;
  confirmed: number;
  total: number;
  costUsd: number;
  durationMs: number | null;
  createdAt: string;
}

export interface RuleYield {
  ruleCode: string;
  /** Findings under this rule that a person put in a report. */
  confirmed: number;
  /** Every finding this rule ever raised, whatever became of it. */
  total: number;
}

export interface AwaitingReview {
  id: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  confirmed: number;
  total: number;
  /** When the review stopped and started waiting on a person. */
  since: string;
}

export interface ProjectOutcome {
  id: string;
  name: string;
  reviews: number;
  /** The most recent review of this project, if it has one. */
  latest: { id: string; status: string; confirmed: number; total: number; at: string } | null;
}

export interface Scoreboard {
  spendUsd: number;
  reviewsCompleted: number;
  reviewsTotal: number;
  /** Confirmed over decided. Null until something has been decided. */
  precision: number | null;
  /** Killed by the quotation check over everything raised. Null until then. */
  inventionRate: number | null;
  awaiting: number;
  /** The reviews behind that count, so the screen can list them. */
  awaitingReviews: AwaitingReview[];
  /** Cost of each completed review, oldest first, for a shape over time. */
  spendHistory: number[];
  recent: ScoreboardRow[];
  ruleYield: RuleYield[];
  /** Every project with what its last review actually found. */
  projects: ProjectOutcome[];
}

export function readScoreboard(db: Db, recentLimit = 12): Scoreboard {
  const reviewRows = db
    .select({
      id: reviews.id,
      projectId: reviews.projectId,
      projectName: projects.name,
      fromBranch: reviews.fromBranch,
      intoBranch: reviews.intoBranch,
      model: reviews.model,
      status: reviews.status,
      cost: reviews.costEquivalentUsd,
      startedAt: reviews.startedAt,
      completedAt: reviews.completedAt,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(projects, eq(reviews.projectId, projects.id))
    .orderBy(desc(reviews.createdAt))
    .all();

  const findingRows = db
    .select({
      reviewId: findings.reviewId,
      status: findings.status,
      ruleCode: findings.ruleCode,
    })
    .from(findings)
    .all();

  const byReview = new Map<string, { confirmed: number; total: number }>();
  const byRule = new Map<string, RuleYield>();
  let confirmed = 0;
  let dismissed = 0;
  let killed = 0;

  for (const row of findingRows) {
    const tally = byReview.get(row.reviewId) ?? { confirmed: 0, total: 0 };
    tally.total += 1;
    if (row.status === "confirmed") tally.confirmed += 1;
    byReview.set(row.reviewId, tally);

    if (row.status === "confirmed") confirmed += 1;
    if (row.status === "dismissed") dismissed += 1;
    if (row.status === "killed") killed += 1;

    // A finding that cited no rule is counted in the totals above but has no
    // rule to credit, so it is left out here rather than filed under a made-up
    // code.
    if (row.ruleCode !== null && row.ruleCode !== "") {
      const yielded = byRule.get(row.ruleCode) ?? {
        ruleCode: row.ruleCode,
        confirmed: 0,
        total: 0,
      };
      yielded.total += 1;
      if (row.status === "confirmed") yielded.confirmed += 1;
      byRule.set(row.ruleCode, yielded);
    }
  }

  const projectRows = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(projects.name)
    .all();

  const completed = reviewRows.filter((review) => review.status === "complete");
  const decided = confirmed + dismissed;
  const raised = findingRows.length;

  return {
    spendUsd: reviewRows.reduce((total, review) => total + review.cost, 0),
    reviewsCompleted: completed.length,
    reviewsTotal: reviewRows.length,
    precision: decided === 0 ? null : confirmed / decided,
    inventionRate: raised === 0 ? null : killed / raised,
    awaiting: reviewRows.filter((review) => review.status === "awaiting_confirmation").length,
    // Oldest first, so the shape reads left to right the way time does.
    spendHistory: [...completed].reverse().map((review) => review.cost),
    recent: reviewRows.slice(0, recentLimit).map((review) => ({
      id: review.id,
      projectName: review.projectName,
      fromBranch: review.fromBranch,
      intoBranch: review.intoBranch,
      model: review.model,
      status: review.status,
      confirmed: byReview.get(review.id)?.confirmed ?? 0,
      total: byReview.get(review.id)?.total ?? 0,
      costUsd: review.cost,
      durationMs:
        review.startedAt && review.completedAt
          ? new Date(review.completedAt).getTime() - new Date(review.startedAt).getTime()
          : null,
      createdAt: review.createdAt,
    })),
    // Worst yield first: a rule that fires often and is confirmed rarely is
    // the one costing the most review attention for the least return.
    ruleYield: [...byRule.values()].sort(
      (a, b) => a.confirmed / a.total - b.confirmed / b.total || b.total - a.total,
    ),
    // Oldest wait first: the review that has been waiting longest is the one
    // most likely to have been forgotten.
    awaitingReviews: reviewRows
      .filter((review) => review.status === "awaiting_confirmation")
      .map((review) => ({
        id: review.id,
        projectName: review.projectName,
        fromBranch: review.fromBranch,
        intoBranch: review.intoBranch,
        confirmed: byReview.get(review.id)?.confirmed ?? 0,
        total: byReview.get(review.id)?.total ?? 0,
        // When it stopped, which is when the waiting began. A review that
        // never finished a run has only its creation to go on.
        since: review.completedAt ?? review.createdAt,
      }))
      .sort((a, b) => a.since.localeCompare(b.since)),
    // Every project, including those with no review yet: a project that has
    // never been reviewed is the most useful thing this widget can point at.
    projects: projectRows.map((project) => {
      // Matched by id, never by name: two remotes can end in the same
      // repository name, and a widget that merged them would report one
      // project's last finding as another's.
      const mine = reviewRows.filter((review) => review.projectId === project.id);
      const latest = mine[0];
      return {
        id: project.id,
        name: project.name,
        reviews: mine.length,
        latest: latest
          ? {
              id: latest.id,
              status: latest.status,
              confirmed: byReview.get(latest.id)?.confirmed ?? 0,
              total: byReview.get(latest.id)?.total ?? 0,
              at: latest.createdAt,
            }
          : null,
      };
    }),
  };
}
