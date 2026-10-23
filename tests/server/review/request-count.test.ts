/**
 * The pre-flight's count of requests, held to what a run actually sends.
 *
 * The count used to be S3's rule batches alone, four short of every run and
 * blind to a batch split to fit the window (proof-and-steps plan, WP-F). The
 * run is the authority here: each profile, with no window and with one small
 * enough to force a split, sends exactly the adversarial requests counted.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewProfile } from "@/lib/domain/enums";
import { parseUnifiedDiff } from "@/lib/git/diff";
import type { ImportedRule } from "@/lib/rulesets/model";
import type { Db } from "@/server/db/client";
import { runReviewPipeline, type StageRequest } from "@/server/review/pipeline";
import { countRequests } from "@/server/review/request-count";
import { makeTestDb, seedProject, seedReview, type TestDb } from "../db/helpers";

/** Three files of different sizes, so a small window splits them. */
function fileDiff(name: string, lines: number): string {
  const added = Array.from(
    { length: lines },
    (_, index) => `+export const ${name}${index} = ${index};`,
  );
  return [
    `diff --git a/${name}.ts b/${name}.ts`,
    `--- a/${name}.ts`,
    `+++ b/${name}.ts`,
    `@@ -0,0 +1,${lines} @@`,
    ...added,
    "",
  ].join("\n");
}
const FILES = parseUnifiedDiff(
  [fileDiff("orders", 40), fileDiff("users", 25), fileDiff("billing", 60)].join(""),
).map((file) => ({ repo: "primary" as const, slug: "app", file }));

function rule(code: string, tags: string[]): ImportedRule {
  return {
    code,
    title: `Rule ${code}`,
    severity: "WARNING",
    tags,
    ruleText: "text",
    violationExample: null,
    correctPattern: null,
    detection: null,
    notes: null,
    sweepPatterns: [],
    group: "Group",
    raw: "raw",
    startLine: 1,
    endLine: 2,
  };
}
const RULES = [rule("1", ["typescript"]), rule("2", ["security"]), rule("3", ["data"])];

/** A system prompt that grows with its rules, as the composed one does. */
const systemFor = (rules: readonly ImportedRule[]) =>
  `You are a reviewer.\n${rules.map((entry) => `Rule ${entry.code}: ${"x".repeat(200)}`).join("\n")}`;

let ctx: TestDb;
let db: Db;
let reviewId: string;
let worktreeRoot: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = seedReview(db, seedProject(db).id).id;
  worktreeRoot = mkdtempSync(join(tmpdir(), "trysquare-count-"));
  mkdirSync(join(worktreeRoot, "app"), { recursive: true });
});

afterEach(() => {
  ctx.cleanup();
  rmSync(worktreeRoot, { recursive: true, force: true });
});

/** The adversarial requests a run makes; it stops at reconciliation after them. */
async function adversarialRequestsSent(
  profile: ReviewProfile,
  contextWindow: number | undefined,
  intent?: string,
): Promise<number> {
  const asked: StageRequest[] = [];
  await runReviewPipeline({
    db,
    reviewId,
    worktreeRoot,
    files: FILES,
    rules: RULES,
    profile,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(intent === undefined ? {} : { intent }),
    systemPromptFor: (_stage, batch) => systemFor(batch?.rules ?? RULES),
    secondVerifier: "claude-opus-5-5",
    run: async (request) => {
      asked.push(request);
      const output =
        request.stage === "s3_adversarial"
          ? { findings: [], clearedHunks: [], sweepDispositions: [] }
          : { files: [] };
      return { output, sessionId: "session" };
    },
  }).catch(() => undefined);
  return asked.filter((request) => request.stage === "s3_adversarial").length;
}

function counted(profile: ReviewProfile, contextWindow: number | undefined, intent?: string) {
  return countRequests({
    content: { files: FILES, sweepHits: [], ...(intent === undefined ? {} : { intent }) },
    files: FILES.map((entry) => `${entry.slug}/${entry.file.path}`),
    rules: RULES,
    profile,
    contextWindow,
    systemPromptFor: systemFor,
  });
}

describe("the requests a review is said to make", () => {
  // Decomposed sends one file per request, so no window splits it: its case
  // holds the count to the run, not the split (review round 4).
  for (const profile of ["full-context", "chunked", "decomposed"] as const) {
    for (const contextWindow of [undefined, 1_000]) {
      it(`are the adversarial requests a ${profile} run sends, window ${contextWindow ?? "unknown"}`, async () => {
        const plan = counted(profile, contextWindow);
        expect(plan.byStage.s3_adversarial).toBe(
          await adversarialRequestsSent(profile, contextWindow),
        );
      });
    }
  }

  it("count every stage that asks a model, the second verifier's included", () => {
    const plan = counted("full-context", undefined);
    expect(plan.byStage).toEqual({
      s1_risk: 1,
      s2_comprehension: 1,
      s3_adversarial: 1,
      s4_deletions: 1,
      s5_verification: 1,
      s5b_second_verification: 1,
    });
    expect(plan.total).toBe(6);
    expect(plan.split).toBe(false);
  });

  it("count the intent every adversarial prompt carries, as the run does", async () => {
    // Left out, a long intent made the run split a batch the count kept
    // whole (review round 4).
    const intent = "Rename the field. ".repeat(60);
    const plan = counted("full-context", 2_000, intent);
    expect(plan.byStage.s3_adversarial).toBeGreaterThan(
      counted("full-context", 2_000).byStage.s3_adversarial,
    );
    expect(plan.byStage.s3_adversarial).toBe(
      await adversarialRequestsSent("full-context", 2_000, intent),
    );
  });

  it("say when a file is too large for the window on its own", () => {
    // Sent anyway, as the run notes; the count said nothing (review round 4).
    expect(counted("decomposed", 300).oversized).toBe(true);
    expect(counted("decomposed", undefined).oversized).toBe(false);
  });

  it("say when a batch was split to fit the window, which makes the count an estimate", () => {
    const plan = counted("full-context", 1_000);
    expect(plan.split).toBe(true);
    expect(plan.byStage.s3_adversarial).toBeGreaterThan(1);
    expect(plan.passes).toBe(1);
  });
});
