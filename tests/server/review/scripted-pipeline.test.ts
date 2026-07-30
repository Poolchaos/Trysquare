/**
 * The same correct review, delivered through the real engine runner and a
 * fake CLI reading its answers from files.
 *
 * The quality gate proves the pipeline carries a correct review intact when
 * the reviewer is a function called in process. That leaves a gap: everything
 * between the pipeline and the CLI, the prompt going out as argv, the answer
 * coming back as a result event, the JSON being extracted and parsed. This
 * closes it, and in doing so proves the shared answer helper drives both
 * paths to the same outcome. If it did not, the service tests built on the
 * file path would be testing something the gate never checked.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseUnifiedDiff, type ParsedFile } from "@/lib/git/diff";
import { changedExportedSymbols } from "@/lib/git/symbols";
import { importProtocol } from "@/lib/rulesets/import";
import type { Db } from "@/server/db/client";
import { listFindings, statusOf } from "@/server/db/repositories/findings";
import { createReview } from "@/server/db/repositories/reviews";
import { cloneBare, diffText, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { addWorktree } from "@/server/gitops/worktree";
import { createEngineRunner } from "@/server/review/engine-runner";
import { runReviewPipeline } from "@/server/review/pipeline";
// @ts-expect-error -- plain JavaScript so it can also be run from a shell.
import { buildSeededRepos } from "../../fixtures/build-seeded-repos.mjs";
import {
  answerSequence,
  buildIdealStageOutputs,
  type SeededDefect,
  type SeededManifest,
  writeAnswersDir,
} from "../../helpers/ideal-answers";
import { makeTestDb, seedProject, type TestDb } from "../db/helpers";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
);

let root: string;
let worktreeRoot: string;
let manifest: SeededManifest;
let appFiles: ParsedFile[];
let coreFiles: ParsedFile[];

let ctx: TestDb;
let db: Db;
let reviewId: string;
let runDir: string;

function entries() {
  return [
    ...appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
    ...coreFiles.map((file) => ({ repo: "linked" as const, slug: "shared-core", file })),
  ];
}

const qualified = (defect: SeededDefect): string =>
  `${defect.repo === "app" ? "app" : "shared-core"}/${defect.file}`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-scripted-"));
  const built = buildSeededRepos(root);
  manifest = built.manifest;

  const appClone = join(root, "app.git");
  const coreClone = join(root, "core.git");
  await cloneBare(built.appDir, appClone);
  await cloneBare(built.coreDir, coreClone);

  const appBase = await mergeBase(appClone, "main", "feature/rename-prefs");
  const appHead = await resolveCommit(appClone, "feature/rename-prefs");
  const coreBase = await mergeBase(coreClone, "main", "feature/rename-prefs");
  const coreHead = await resolveCommit(coreClone, "feature/rename-prefs");

  appFiles = parseUnifiedDiff(await diffText(appClone, appBase, appHead));
  coreFiles = parseUnifiedDiff(await diffText(coreClone, coreBase, coreHead));

  worktreeRoot = join(root, "worktree");
  await addWorktree(appClone, join(worktreeRoot, "app"), appHead);
  await addWorktree(coreClone, join(worktreeRoot, "shared-core"), coreHead);
}, 180_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = createReview(db, {
    projectId: seedProject(db, "seeded").id,
    fromBranch: "feature/rename-prefs",
    fromCommit: "a".repeat(40),
    intoBranch: "main",
    intoCommit: "b".repeat(40),
    mergeBaseCommit: "c".repeat(40),
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
  }).id;

  runDir = mkdtempSync(join(tmpdir(), "trysquare-run-"));
  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = join(runDir, "answers");
  process.env.FAKE_CLAUDE_COUNTER = join(runDir, "calls.txt");
  process.env.FAKE_CLAUDE_RECORD_DIR = join(runDir, "calls");
});

afterEach(() => {
  ctx.cleanup();
  rmSync(runDir, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_DIR;
  delete process.env.FAKE_CLAUDE_COUNTER;
  delete process.env.FAKE_CLAUDE_RECORD_DIR;
  delete process.env.FAKE_CLAUDE_FAIL_AT;
});

function runScripted() {
  const outputs = buildIdealStageOutputs({
    files: entries(),
    manifest,
    worktreeRoot,
    rules: PROTOCOL.ruleset.rules,
  });
  writeAnswersDir(join(runDir, "answers"), answerSequence(outputs));

  const stagesSeen: string[] = [];
  const runner = createEngineRunner({
    worktreeRoot,
    logsDir: join(runDir, "logs"),
    model: "claude-fable-5[1m]",
    timeoutMs: 30_000,
    directives: PROTOCOL.ruleset.directives,
    rules: PROTOCOL.ruleset.rules,
    claudePath: FAKE_CLI,
    onStageComplete: (info) => stagesSeen.push(info.stage),
  });

  return runReviewPipeline({
    db,
    reviewId,
    worktreeRoot,
    files: entries(),
    rules: PROTOCOL.ruleset.rules,
    profile: "full-context",
    changedSymbols: changedExportedSymbols(coreFiles),
    systemPromptFor: () => "You are a reviewer.",
    run: runner.run,
  }).then((result) => ({ result, stagesSeen, runner }));
}

const callsMade = (): number => Number(readFileSync(join(runDir, "calls.txt"), "utf8"));

/** The argument vector of every call the run made, in order. */
function recordedCalls(): string[][] {
  const dir = join(runDir, "calls");
  return readdirSync(dir)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")).args as string[]);
}

describe("a review driven through the CLI boundary", () => {
  it("verifies every seeded defect at the file and line the manifest states", async () => {
    const { result } = await runScripted();

    const verified = listFindings(db, reviewId).filter(
      (finding) => statusOf(finding) === "verified",
    );
    for (const defect of manifest.defects) {
      const match = verified.find(
        (finding) => finding.filePath === qualified(defect) && finding.lineStart === defect.line,
      );
      expect(match, `${defect.id} at ${qualified(defect)}:${defect.line}`).toBeDefined();
    }
    expect(result.verified).toBe(manifest.defects.length);
    expect(result.killedByQuoteCheck).toBe(0);
  }, 120_000);

  it("accounts for the whole change set, as the in-process gate does", async () => {
    // The two paths must reach the same place. If the file path lost a
    // disposition somewhere in the round trip, coverage is where it shows.
    const { result } = await runScripted();

    expect(result.coverage.pendingHunks).toBe(0);
    expect(result.coverage.pendingSweepHits).toBe(0);
    expect(result.coverage.pendingFiles).toBe(0);
    expect(result.coverage.unresolvedCandidates).toBe(0);
  }, 120_000);

  it("asks its five questions, one process each", async () => {
    const { stagesSeen } = await runScripted();

    expect(stagesSeen).toEqual([
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
      "s4_deletions",
      "s5_verification",
    ]);
    expect(callsMade()).toBe(5);
  }, 120_000);

  it("keeps the verification stage out of the shared session", async () => {
    // The independence of verification, checked where it is actually decided:
    // the command line. The four chained stages rejoin the session the first
    // one opened; verification is spawned without --resume, so it cannot see
    // the reasoning that produced the findings it is asked to refute.
    const { runner } = await runScripted();
    const calls = recordedCalls();

    expect(calls[0]?.includes("--resume")).toBe(false);
    for (const index of [1, 2, 3]) {
      expect(calls[index]?.includes("--resume"), `call ${index + 1} should resume`).toBe(true);
    }
    expect(calls[4]?.includes("--resume"), "verification must start fresh").toBe(false);
    expect(runner.chainSessionId()).toBeDefined();
  }, 120_000);

  it("stops the run when the model stops answering part way through", async () => {
    // A usage limit during the adversarial stage. Nothing here recovers from
    // it yet; what matters is that the failure surfaces rather than the run
    // completing with a third of the change set silently unexamined.
    process.env.FAKE_CLAUDE_FAIL_AT = "3";

    await expect(runScripted()).rejects.toThrow(/usage limit/i);
    expect(listFindings(db, reviewId)).toEqual([]);
  }, 120_000);
});
