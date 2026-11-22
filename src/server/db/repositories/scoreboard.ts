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
 * findings are worth reading. Proofs discarded is what the quotation check
 * killed out of everything ever raised: a proof that is not the code at its
 * lines, or one that quotes true code off the lines the finding cites, so it
 * is not a count of inventions (D-252). Only those kills: one the verifier
 * refuted had no proof to check (4.24). Elsewhere killed findings are only
 * listed, under a review's run detail (D-97); this is the one place they are
 * counted.
 */

import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { needsYouKind, type NeedsYouKind } from "@/lib/review/needs-you";
import { ranBefore, runTimeMs } from "@/lib/review/run-time";
import type { Db } from "../client";
import { checkFindings, findings, projects, reviewRulesets, reviews } from "../schema";
import { parseJsonColumn } from "./json";
import { firstStageStarts } from "./stage-executions";

export interface ScoreboardRow {
  id: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  /**
   * Who authored the commit the reviewed branch ended on, as git has it.
   * Null for a review made before it was kept (D-297).
   */
  author: { name: string; email: string } | null;
  model: string;
  status: string;
  confirmed: number;
  total: number;
  costUsd: number;
  durationMs: number | null;
  /** An earlier run spent something, so `durationMs` is the last run's and `costUsd` every run's. */
  ranBefore: boolean;
  createdAt: string;
}

export interface RuleYield {
  ruleCode: string;
  /**
   * The ruleset the rule is in, by the name the review froze it under. A
   * number names a rule within one ruleset and not across them, so two
   * rulesets' rule 1 are two rows. Null where the review froze no ruleset.
   */
  rulesetName: string | null;
  /** Findings under this rule that a person put in a report. */
  confirmed: number;
  /** Every finding this rule ever raised, whatever became of it. */
  total: number;
}

export interface AwaitingReview {
  id: string;
  /** What it waits on a person for: a decision, a Resume (D-259), or its commands run (AH3). */
  status: NeedsYouKind;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  /**
   * Confirmed or dismissed. Both are decisions, and counting only the
   * confirmed ones told someone who had dismissed a whole queue that they
   * had not started it.
   */
  decided: number;
  /**
   * The size of the queue this person will actually be shown, so killed
   * findings are not in it: the quotation check hides those, and a total
   * that counts them can never be reached.
   */
  total: number;
  /**
   * When the run ended, so when the wait began. Null on a review from before
   * that was recorded whose rows do not say (D-248), and on one a restart
   * interrupted, whose end nobody saw.
   */
  since: string | null;
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
  /**
   * Reviews answered in the person's own session that have started. Their
   * usage is recorded as zero and was never measured, so `spendUsd` is of
   * the others alone, and the screen says how many it leaves out (AH1).
   */
  interactiveReviews: number;
  reviewsCompleted: number;
  reviewsTotal: number;
  /** Confirmed over decided. Null until something has been decided. */
  precision: number | null;
  /** Killed by the quotation check over everything raised. Null until then. */
  proofsDiscardedRate: number | null;
  awaiting: number;
  /** The reviews behind that count and those waiting on a Resume, for the screen to list. */
  awaitingReviews: AwaitingReview[];
  /** Cost of each completed review, oldest first, for a shape over time. */
  spendHistory: number[];
  recent: ScoreboardRow[];
  ruleYield: RuleYield[];
  /** Every project with what its last review actually found. */
  projects: ProjectOutcome[];
}

const frozenCodesSchema = z.object({ rules: z.array(z.object({ code: z.string() })) });

/**
 * Which of a review's frozen rulesets holds a rule, by its number. The
 * rulesets of one review share no number (RS-2b), so within a review the
 * number is enough. A review on one ruleset is answered without reading its
 * frozen copy; one on several has each copy's numbers read once. The name
 * is the one its newest review froze it under.
 */
function frozenRuleOwners(
  db: Db,
): (reviewId: string, code: string) => { rulesetId: string; rulesetName: string } | null {
  const rows = db
    .select({
      reviewId: reviewRulesets.reviewId,
      rulesetId: reviewRulesets.rulesetId,
      rulesetName: reviewRulesets.rulesetName,
      snapshotJson: reviewRulesets.snapshotJson,
      createdAt: reviews.createdAt,
    })
    .from(reviewRulesets)
    .innerJoin(reviews, eq(reviewRulesets.reviewId, reviews.id))
    .orderBy(desc(reviews.createdAt))
    .all();
  const names = new Map<string, string>();
  const frozen = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!names.has(row.rulesetId)) names.set(row.rulesetId, row.rulesetName);
    frozen.set(row.reviewId, [...(frozen.get(row.reviewId) ?? []), row]);
  }
  const codes = new Map<string, Map<string, string>>();
  return (reviewId, code) => {
    const held = frozen.get(reviewId) ?? [];
    let rulesetId: string | undefined;
    if (held.length === 1) {
      rulesetId = held[0]!.rulesetId;
    } else if (held.length > 1) {
      let owners = codes.get(reviewId);
      if (owners === undefined) {
        owners = new Map();
        for (const row of held) {
          const copy = parseJsonColumn(
            "review_rulesets.snapshot_json",
            row.snapshotJson,
            frozenCodesSchema,
          );
          for (const rule of copy.rules) owners.set(rule.code, row.rulesetId);
        }
        codes.set(reviewId, owners);
      }
      rulesetId = owners.get(code);
    }
    return rulesetId === undefined ? null : { rulesetId, rulesetName: names.get(rulesetId) ?? "" };
  };
}

export function readScoreboard(db: Db, recentLimit = 12): Scoreboard {
  const reviewRows = db
    .select({
      id: reviews.id,
      projectId: reviews.projectId,
      projectName: projects.name,
      fromBranch: reviews.fromBranch,
      intoBranch: reviews.intoBranch,
      fromAuthorName: reviews.fromAuthorName,
      fromAuthorEmail: reviews.fromAuthorEmail,
      engineMode: reviews.engineMode,
      model: reviews.model,
      status: reviews.status,
      cost: reviews.costEquivalentUsd,
      startedAt: reviews.startedAt,
      runEndedAt: reviews.runEndedAt,
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
      killedBy: findings.killedBy,
      dismissedFrom: findings.dismissedFrom,
      ruleCode: findings.ruleCode,
    })
    .from(findings)
    .all();

  const ownerOf = frozenRuleOwners(db);
  const byReview = new Map<string, { confirmed: number; decided: number; queued: number }>();
  const byRule = new Map<string, RuleYield>();
  let confirmed = 0;
  let dismissed = 0;
  let discarded = 0;

  for (const row of findingRows) {
    const tally = byReview.get(row.reviewId) ?? { confirmed: 0, decided: 0, queued: 0 };
    if (row.status === "confirmed") tally.confirmed += 1;
    if (row.status === "confirmed" || row.status === "dismissed") tally.decided += 1;
    // Everything the queue will show. A killed finding is not in it.
    if (row.status !== "killed") tally.queued += 1;
    byReview.set(row.reviewId, tally);

    if (row.status === "confirmed") confirmed += 1;
    // Left out unproven is not rejected: precision is about findings that
    // were proven and read (D-190).
    if (row.status === "dismissed" && row.dismissedFrom !== "open_question") dismissed += 1;
    if (row.status === "killed" && row.killedBy === "quote_check") discarded += 1;

    // A finding that cited no rule is counted in the totals above but has no
    // rule to credit, so it is left out here rather than filed under a made-up
    // code.
    if (row.ruleCode !== null && row.ruleCode !== "") {
      // By ruleset and number: the number alone added rule 1 of one ruleset
      // to rule 1 of another (the eighteenth grade, AF3).
      const owner = ownerOf(row.reviewId, row.ruleCode);
      const key = JSON.stringify([owner?.rulesetId ?? null, row.ruleCode]);
      const yielded = byRule.get(key) ?? {
        ruleCode: row.ruleCode,
        rulesetName: owner?.rulesetName ?? null,
        confirmed: 0,
        total: 0,
      };
      yielded.total += 1;
      if (row.status === "confirmed") yielded.confirmed += 1;
      byRule.set(key, yielded);
    }
  }

  // What a project's own checks found is decided in the same queue (D-197),
  // so each review's counts take it in. The two rates and the rule yield do
  // not: a failing command or a graded screen cites no rule and quotes no code.
  const checkRows = db
    .select({ reviewId: checkFindings.reviewId, status: checkFindings.status })
    .from(checkFindings)
    .all();
  for (const row of checkRows) {
    const tally = byReview.get(row.reviewId) ?? { confirmed: 0, decided: 0, queued: 0 };
    tally.queued += 1;
    if (row.status === "confirmed") tally.confirmed += 1;
    if (row.status === "confirmed" || row.status === "dismissed") tally.decided += 1;
    byReview.set(row.reviewId, tally);
  }

  const projectRows = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(projects.name)
    .all();

  const firstStages = firstStageStarts(db);
  const completed = reviewRows.filter((review) => review.status === "complete");
  const decided = confirmed + dismissed;
  const raised = findingRows.length;

  return {
    spendUsd: reviewRows.reduce((total, review) => total + review.cost, 0),
    interactiveReviews: reviewRows.filter(
      (review) => review.engineMode === "interactive" && review.status !== "draft",
    ).length,
    reviewsCompleted: completed.length,
    reviewsTotal: reviewRows.length,
    precision: decided === 0 ? null : confirmed / decided,
    proofsDiscardedRate: raised === 0 ? null : discarded / raised,
    awaiting: reviewRows.filter((review) => review.status === "awaiting_confirmation").length,
    // Oldest first, so the shape reads left to right the way time does.
    // Of the reviews the app measured: an interactive one, recorded as zero,
    // was a point at nothing in a line the tile says leaves it out (AI6).
    spendHistory: [...completed]
      .reverse()
      .filter((review) => review.engineMode !== "interactive")
      .map((review) => review.cost),
    recent: reviewRows.slice(0, recentLimit).map((review) => ({
      id: review.id,
      projectName: review.projectName,
      fromBranch: review.fromBranch,
      intoBranch: review.intoBranch,
      author:
        review.fromAuthorEmail === null
          ? null
          : { name: review.fromAuthorName ?? "", email: review.fromAuthorEmail },
      model: review.model,
      status: review.status,
      confirmed: byReview.get(review.id)?.confirmed ?? 0,
      total: byReview.get(review.id)?.queued ?? 0,
      costUsd: review.cost,
      // The run's time: to when it stopped, not to when a person completed
      // the review, which can be days later (D-248).
      durationMs: runTimeMs(review),
      ranBefore: ranBefore(review.startedAt, firstStages.get(review.id)),
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
      .flatMap((review) => {
        // A running review answered in the person's own session waits on
        // them at every stage, so it is listed too (AH3).
        const kind = needsYouKind(review);
        return kind !== null
          ? [
              {
                id: review.id,
                status: kind,
                projectName: review.projectName,
                fromBranch: review.fromBranch,
                intoBranch: review.intoBranch,
                decided: byReview.get(review.id)?.decided ?? 0,
                total: byReview.get(review.id)?.queued ?? 0,
                since: review.runEndedAt,
              },
            ]
          : [];
      })
      // ISO times, so the least string is the oldest. One with no time last.
      .sort((a, b) =>
        a.since === null || b.since === null
          ? Number(a.since === null) - Number(b.since === null)
          : a.since.localeCompare(b.since),
      ),
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
              total: byReview.get(latest.id)?.queued ?? 0,
              at: latest.createdAt,
            }
          : null,
      };
    }),
  };
}
