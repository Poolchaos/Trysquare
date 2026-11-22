/**
 * What a report is told of its review's effort (the nineteenth grade, AG3).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";
import { createReview } from "@/server/db/repositories/reviews";
import { saveImportedRuleset, writeReviewSnapshot } from "@/server/db/repositories/rulesets";
import { buildReportInput } from "@/server/review/report-input";
import { makeTestDb, seedProject, type TestDb } from "../db/helpers";

let ctx: TestDb;

beforeEach(() => {
  ctx = makeTestDb();
});

afterEach(() => ctx.cleanup());

function reviewRunAs(engineMode: "headless" | "interactive"): string {
  // A report is of a review that froze a ruleset: one rule is enough.
  const { rulesetId } = saveImportedRuleset(ctx.db, {
    name: "One rule",
    tier: "project",
    imported: importProtocol("# One\n\n## Rules\n\n### 1. Dates\n\n**Rule:** Dates are UTC.\n")
      .ruleset,
  });
  const { id } = createReview(ctx.db, {
    projectId: seedProject(ctx.db).id,
    fromBranch: "feature/x",
    fromCommit: "a".repeat(40),
    intoBranch: "main",
    intoCommit: "b".repeat(40),
    mergeBaseCommit: "c".repeat(40),
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    effort: "high",
    engineMode,
  });
  writeReviewSnapshot(ctx.db, id, rulesetId);
  return id;
}

describe("the effort a report states", () => {
  it("is the review's, where the app made the calls", () => {
    expect(buildReportInput(ctx.db, reviewRunAs("headless")).effort).toBe("high");
  });

  it("is none for an interactive review, whose commands pass no effort", () => {
    expect(buildReportInput(ctx.db, reviewRunAs("interactive")).effort).toBeNull();
  });
});
