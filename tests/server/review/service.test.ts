/**
 * The review service, run end to end against real git repositories.
 *
 * Everything below uses real clones, real worktrees and a real bundle. Only
 * the model is faked, because the model is the one part that costs money and
 * cannot be made deterministic. That balance is deliberate: the failures this
 * service is likely to have are git failures and state failures, and a test
 * that stubbed git away would not see any of them.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ReviewEffort } from "@/lib/domain/enums";
import { parseUnifiedDiff, type ParsedFile } from "@/lib/git/diff";
import { importProtocol } from "@/lib/rulesets/import";
import { bundleDir, logsDir, runDir, worktreeRepoDir, worktreeRootDir } from "@/lib/paths";
import type { Db } from "@/server/db/client";
import {
  confirmFinding,
  listFindings,
  listFindingsByStatus,
  requireFinding,
  statusOf as findingStatusOf,
} from "@/server/db/repositories/findings";
import { createProject, listProjects } from "@/server/db/repositories/projects";
import {
  createReview,
  getReview,
  markOrphanedReviewsInterrupted,
  readRunNotes,
  requireReview,
  transitionReview,
} from "@/server/db/repositories/reviews";
import { SETTING_KEYS, writeSetting } from "@/server/db/repositories/settings";
import { models, reviews } from "@/server/db/schema";
import { recordProbeSuccess, registerCandidate } from "@/server/db/repositories/models";
import { listLedgerFiles } from "@/server/db/repositories/ledger";
import { renderReport } from "@/lib/review/report";
import { buildReportInput } from "@/server/review/report-input";
import { listForReview, usageTotals } from "@/server/db/repositories/stage-executions";
import { cloneBare, diffText, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { addWorktree } from "@/server/gitops/worktree";
import {
  deleteReviewEntirely,
  prepareAndRun,
  removeReviewWorktrees,
  ReviewNotRunnableError,
  RulesetRequiredError,
  type StageLifecycleEvent,
} from "@/server/review/service";
// @ts-expect-error -- plain JavaScript so it can also be run from a shell.
import { buildSeededRepos } from "../../fixtures/build-seeded-repos.mjs";
import {
  answerSequence,
  buildIdealStageOutputs,
  writeAnswersDir,
  type SeededManifest,
} from "../../helpers/ideal-answers";
import { makeTestDb, type TestDb } from "../db/helpers";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
).ruleset;

const RULESET = { imported: PROTOCOL, name: "Example protocol", tier: "global" as const };

let fixtureRoot: string;
let appClone: string;
let coreClone: string;
let manifest: SeededManifest;
let appHead: string;
let appBase: string;
let coreHead: string;
let coreBase: string;
let referenceRoot: string;
let appFiles: ParsedFile[];
let coreFiles: ParsedFile[];

let ctx: TestDb;
let db: Db;
let dataDir: string;
let answersDir: string;

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "trysquare-service-fixture-"));
  const built = buildSeededRepos(fixtureRoot);
  manifest = built.manifest;

  // Cloned once. The bare clones are only ever read by these tests; every
  // worktree lives under a per-test data directory.
  appClone = join(fixtureRoot, "app.git");
  coreClone = join(fixtureRoot, "core.git");
  await cloneBare(built.appDir, appClone);
  await cloneBare(built.coreDir, coreClone);

  appBase = await mergeBase(appClone, "main", "feature/rename-prefs");
  appHead = await resolveCommit(appClone, "feature/rename-prefs");
  coreBase = await mergeBase(coreClone, "main", "feature/rename-prefs");
  coreHead = await resolveCommit(coreClone, "feature/rename-prefs");
  appFiles = parseUnifiedDiff(await diffText(appClone, appBase, appHead));
  coreFiles = parseUnifiedDiff(await diffText(coreClone, coreBase, coreHead));

  // A checkout of the same pinned commits, used only to write the answers a
  // correct reviewer would give. Verification quotes the file it read, and the
  // bytes at a commit are the bytes at that commit wherever it is checked out,
  // so this stands in for the worktree the service has not laid out yet.
  referenceRoot = join(fixtureRoot, "reference");
  await addWorktree(appClone, join(referenceRoot, "app"), appHead);
  await addWorktree(coreClone, join(referenceRoot, "shared-core"), coreHead);
}, 180_000);

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-service-data-"));
  answersDir = join(dataDir, "answers");
  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = answersDir;
  process.env.FAKE_CLAUDE_COUNTER = join(dataDir, "calls.txt");
  process.env.FAKE_CLAUDE_RECORD_DIR = join(dataDir, "calls");
});

afterEach(() => {
  ctx.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_DIR;
  delete process.env.FAKE_CLAUDE_COUNTER;
  delete process.env.FAKE_CLAUDE_RECORD_DIR;
  delete process.env.FAKE_CLAUDE_FAIL_AT;
});

/** A review of the app alone, or of the app and its dependency together. */
function seedReview(
  options: { linked?: boolean; effort?: ReviewEffort; intent?: string } = {},
): string {
  const project = createProject(db, {
    name: "app",
    gitUrl: "git@example.com:acme/app.git",
    defaultBranch: "main",
    clonePath: appClone,
  });

  const linked = options.linked
    ? createProject(db, {
        name: "shared-core",
        gitUrl: "git@example.com:acme/shared-core.git",
        defaultBranch: "main",
        clonePath: coreClone,
      })
    : undefined;

  return createReview(db, {
    projectId: project.id,
    fromBranch: "feature/rename-prefs",
    fromCommit: appHead,
    intoBranch: "main",
    intoCommit: appBase,
    mergeBaseCommit: appBase,
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(options.intent === undefined ? {} : { intent: options.intent }),
    ...(linked
      ? {
          linked: {
            projectId: linked.id,
            fromBranch: "feature/rename-prefs",
            fromCommit: coreHead,
            intoBranch: "main",
            intoCommit: coreBase,
            mergeBaseCommit: coreBase,
          },
        }
      : {}),
  }).id;
}

/** Another review of the same commits, for comparing two runs of one fixture. */
function seedReviewOnly(): string {
  const project = listProjects(db).find((p) => p.name === "app")!;
  return createReview(db, {
    projectId: project.id,
    fromBranch: "feature/rename-prefs",
    fromCommit: appHead,
    intoBranch: "main",
    intoCommit: appBase,
    mergeBaseCommit: appBase,
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
  }).id;
}

/** Writes the answers a correct reviewer would give about this fixture. */
function writeIdealAnswers(options: { linked?: boolean } = {}): void {
  const files = [
    ...appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
    ...(options.linked
      ? coreFiles.map((file) => ({ repo: "linked" as const, slug: "shared-core", file }))
      : []),
  ];

  const outputs = buildIdealStageOutputs({
    files,
    manifest: options.linked
      ? manifest
      : { ...manifest, defects: manifest.defects.filter((d) => d.kind !== "cross-repo") },
    worktreeRoot: referenceRoot,
    rules: PROTOCOL.rules,
  });
  writeAnswersDir(answersDir, answerSequence(outputs));
}

function run(reviewId: string, extra: Record<string, unknown> = {}) {
  return prepareAndRun(db, reviewId, {
    dataDir,
    claudePath: FAKE_CLI,
    ruleset: RULESET,
    ...extra,
  });
}

const recordedArgv = (): string[][] => {
  const dir = join(dataDir, "calls");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")).args as string[]);
};

describe("running a review to the point a human looks at it", () => {
  it("walks the statuses and lands awaiting confirmation", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();

    const seen: StageLifecycleEvent[] = [];
    const outcome = await run(reviewId, {
      onStageLifecycle: (e: StageLifecycleEvent) => seen.push(e),
    });

    expect(outcome.kind).toBe("completed");
    expect(requireReview(db, reviewId).status).toBe("awaiting_confirmation");
    expect(seen.map((e) => e.stage)).toEqual([
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
      "s4_deletions",
      "s5_verification",
    ]);
    expect(seen.every((e) => e.kind === "live")).toBe(true);
  }, 120_000);

  it("reports the comment a person rewrote, and keeps the engine's on the row", async () => {
    // The report is read by whoever fixes the code, so it takes the human
    // wording. The engine's own stays: how well it explained itself is the
    // measurement of whether the prompts work, and an edit is a data point in
    // exactly that, so overwriting it would destroy the evidence.
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const [finding] = listFindingsByStatus(db, reviewId, ["verified"]);
    expect(finding).toBeDefined();
    const engineWording = finding!.comment;
    const mine = "Rounds the total down, so an invoice under a cent bills as zero.";

    confirmFinding(db, finding!.id, { comment: mine });

    const report = renderReport(buildReportInput(db, reviewId));
    expect(report).toContain(`Comment: ${mine}`);
    expect(report).not.toContain(engineWording);
    expect(requireFinding(db, finding!.id).comment).toBe(engineWording);
  }, 120_000);

  it("finds the seeded defects, at the file and line the manifest states", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const verified = listFindings(db, reviewId).filter(
      (finding) => findingStatusOf(finding) === "verified",
    );
    for (const defect of manifest.defects.filter((d) => d.kind !== "cross-repo")) {
      const match = verified.find(
        (finding) => finding.filePath === `app/${defect.file}` && finding.lineStart === defect.line,
      );
      expect(match, `${defect.id} at app/${defect.file}:${defect.line}`).toBeDefined();
    }
  }, 120_000);

  it("records what every stage was asked and what the run spent", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const rows = listForReview(db, reviewId);
    expect(rows.map((row) => row.stage)).toEqual([
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
      "s4_deletions",
      "s5_verification",
    ]);
    expect(rows.every((row) => row.status === "succeeded")).toBe(true);
    expect(rows.every((row) => row.promptHash.length === 64)).toBe(true);

    const review = requireReview(db, reviewId);
    expect(review.usageInputTokens).toBe(500);
    expect(review.costEquivalentUsd).toBeCloseTo(0.021, 5);
  }, 120_000);

  it("leaves the bundle and the logs behind as evidence", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    expect(existsSync(join(bundleDir(dataDir, reviewId), "inventory.json"))).toBe(true);
    expect(existsSync(join(bundleDir(dataDir, reviewId), "diff.patch"))).toBe(true);
    expect(readdirSync(logsDir(dataDir, reviewId)).length).toBeGreaterThan(0);
  }, 120_000);

  it("reviews two repositories together when the change spans them", async () => {
    const reviewId = seedReview({ linked: true });
    writeIdealAnswers({ linked: true });
    const outcome = await run(reviewId);

    expect(outcome.kind).toBe("completed");
    expect(existsSync(worktreeRepoDir(dataDir, reviewId, "app"))).toBe(true);
    expect(existsSync(worktreeRepoDir(dataDir, reviewId, "shared-core"))).toBe(true);

    const crossRepo = manifest.defects.find((defect) => defect.kind === "cross-repo")!;
    const found = listFindings(db, reviewId).find(
      (finding) => finding.filePath === `app/${crossRepo.file}`,
    );
    expect(found).toBeDefined();
  }, 180_000);
});

/**
 * Turns `<<candidate:path:line>>` placeholders into the labels the prompt
 * actually used, which is what a person reading the prompt would type.
 */
function resolveCandidateTokens(answer: string, prompt: string): string {
  // Only the question, never the whole document: the instructions above it
  // carry the output contract, which is itself JSON, and scanning from the
  // first brace in the file finds that instead of the candidate list.
  const question = prompt.slice(prompt.indexOf("## The question"));
  const start = question.indexOf("{");
  const end = question.lastIndexOf("}");
  if (start === -1 || end <= start) return answer;

  let candidates: { ref: string; path: string; lineStart: number }[] = [];
  try {
    candidates =
      (JSON.parse(question.slice(start, end + 1)) as { candidates?: typeof candidates })
        .candidates ?? [];
  } catch {
    return answer;
  }

  return answer.replace(/<<candidate:(.+?):(\d+)>>/g, (whole, path: string, line: string) => {
    const match = candidates.find(
      (candidate) => candidate.path === path && String(candidate.lineStart) === line,
    );
    return match ? match.ref : whole;
  });
}

describe("the interactive engine", () => {
  it("runs a whole review from files on disk, spending nothing", async () => {
    // Mode B end to end: the app writes each stage's prompt into the bundle,
    // a person (here, a loop) writes the answer beside it, and the pipeline
    // reconciles those answers exactly as it would the CLI's. What this
    // proves is that the second engine is the same review, not a looser one.
    const project = createProject(db, {
      name: "app",
      gitUrl: "git@example.com:acme/app.git",
      defaultBranch: "main",
      clonePath: appClone,
    });
    const reviewId = createReview(db, {
      projectId: project.id,
      fromBranch: "feature/rename-prefs",
      fromCommit: appHead,
      intoBranch: "main",
      intoCommit: appBase,
      mergeBaseCommit: appBase,
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "interactive",
    }).id;

    const outputs = buildIdealStageOutputs({
      files: appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
      manifest: { ...manifest, defects: manifest.defects.filter((d) => d.kind !== "cross-repo") },
      worktreeRoot: referenceRoot,
      rules: PROTOCOL.rules,
    });
    const answers = answerSequence(outputs);
    const bundle = bundleDir(dataDir, reviewId);
    const stages = [
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
      "s4_deletions",
      "s5_verification",
    ] as const;

    // Stands in for the person: waits for each prompt to be written, then
    // saves that stage's answer next to it.
    let stopped = false;
    const answering = (async () => {
      for (const [index, stage] of stages.entries()) {
        for (let waited = 0; waited < 600 && !stopped; waited += 1) {
          if (existsSync(join(bundle, `${stage}-prompt.md`))) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (stopped) return;
        // Answered the way a person would: by reading the prompt they were
        // handed. The verification stage labels each candidate in the prompt
        // itself, and the ideal answers carry placeholders for those labels
        // because no fixture can know them in advance. The fake CLI resolves
        // them from the prompt; here there is no CLI, so this does.
        const promptText = readFileSync(join(bundle, `${stage}-prompt.md`), "utf8");
        writeFileSync(
          join(bundle, `${stage}-output.json`),
          resolveCandidateTokens(JSON.stringify(answers[index]), promptText),
          "utf8",
        );
      }
    })();

    const outcome = await prepareAndRun(db, reviewId, {
      dataDir,
      // No CLI path at all: Mode B must not spawn anything.
      ruleset: RULESET,
    });
    stopped = true;
    await answering;

    expect(outcome.kind, JSON.stringify(outcome)).toBe("completed");
    expect(requireReview(db, reviewId).status).toBe("awaiting_confirmation");
    // The same findings the headless run produces, verified against the same
    // worktree bytes.
    expect(listFindingsByStatus(db, reviewId, ["verified"]).length).toBeGreaterThan(0);
    // Nothing was spent here: the tokens belong to the session the person ran.
    expect(requireReview(db, reviewId).usageInputTokens).toBe(0);
    // And the prompt a person was handed is on disk for every stage.
    for (const stage of stages) {
      expect(existsSync(join(bundle, `${stage}-prompt.md`))).toBe(true);
    }
  }, 180_000);
});

describe("the commits a review is pinned to", () => {
  it("checks out exactly the pinned commit", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktreeRepoDir(dataDir, reviewId, "app"),
      encoding: "utf8",
    }).trim();
    expect(head).toBe(appHead);
  }, 120_000);

  it("refuses to run when a pinned commit is gone", async () => {
    // A force-push is the usual cause. Reviewing a different commit and
    // calling it the same review would make every finding untraceable.
    const project = createProject(db, {
      name: "app",
      gitUrl: "git@example.com:acme/app.git",
      defaultBranch: "main",
      clonePath: appClone,
    });
    const reviewId = createReview(db, {
      projectId: project.id,
      fromBranch: "feature/rename-prefs",
      fromCommit: "0".repeat(40),
      intoBranch: "main",
      intoCommit: appBase,
      mergeBaseCommit: appBase,
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
    }).id;

    const outcome = await run(reviewId);

    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.reason).toMatch(/pinned to commit 0{40}/);
    expect(requireReview(db, reviewId).status).toBe("failed");
  }, 120_000);

  it("replaces a worktree sitting at the wrong commit", async () => {
    // What an interrupted run leaves behind. The worktree is disposable and
    // the pin is not, so the pin wins.
    const reviewId = seedReview();
    writeIdealAnswers();

    // Exactly what an interrupted run leaves: a worktree at the right path
    // holding the wrong commit.
    const worktree = worktreeRepoDir(dataDir, reviewId, "app");
    await addWorktree(appClone, worktree, appBase);
    expect(
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim(),
    ).toBe(appBase);

    const outcome = await run(reviewId);
    expect(outcome.kind).toBe("completed");

    expect(
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim(),
    ).toBe(appHead);
  }, 120_000);

  it("fails the run when something wrote inside the worktree", async () => {
    // The app never writes inside a checked-out review. If the tree is dirty,
    // something did, and every quotation checked against it is suspect.
    const reviewId = seedReview();
    writeIdealAnswers();

    const outcome = await prepareAndRun(db, reviewId, {
      dataDir,
      claudePath: FAKE_CLI,
      ruleset: RULESET,
      onStageLifecycle: (event) => {
        if (event.stage === "s5_verification") {
          writeFileSync(join(worktreeRepoDir(dataDir, reviewId, "app"), "meddled.ts"), "// oops\n");
        }
      },
    });

    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.reason).toMatch(/modified|meddled/i);
    expect(requireReview(db, reviewId).status).toBe("failed");
  }, 120_000);
});

describe("what a review is judged against", () => {
  it("refuses to start with no ruleset to freeze", async () => {
    const reviewId = seedReview();
    await expect(
      prepareAndRun(db, reviewId, { dataDir, claudePath: FAKE_CLI }),
    ).rejects.toBeInstanceOf(RulesetRequiredError);
    // Nothing was started, so nothing has to be unwound.
    expect(requireReview(db, reviewId).status).toBe("draft");
  }, 120_000);

  it("keeps judging against the frozen ruleset after the rules are edited", async () => {
    // The promise the snapshot exists for. A rule edited today must not change
    // what a review started yesterday is being judged against, and the proof
    // is what actually reaches the model on the command line.
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const before = recordedArgv();
    const systemPromptSent = before[2]?.[before[2].indexOf("--system-prompt") + 1] ?? "";
    expect(systemPromptSent).toContain(PROTOCOL.rules[0]?.ruleText ?? "never matched");
  }, 120_000);
});

describe("when a review cannot finish", () => {
  it("pauses rather than failing when the usage limit is reached", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";

    const outcome = await run(reviewId);

    expect(outcome.kind).toBe("paused");
    const review = requireReview(db, reviewId);
    expect(review.status).toBe("paused_limit");
    expect(review.pausedReason).toMatch(/usage limit/i);
  }, 120_000);

  it("records when the limit clears, so the pause has an end rather than reading as a hang", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    process.env.FAKE_CLAUDE_RESETS_AT = "1785408600";

    await run(reviewId);

    const review = requireReview(db, reviewId);
    expect(review.status).toBe("paused_limit");
    expect(review.pausedResetsAt).toBe(1785408600);
    delete process.env.FAKE_CLAUDE_RESETS_AT;
  }, 120_000);

  it("clears the reset time when the review moves on", async () => {
    // A stale reset time on a running review would tell someone their run is
    // waiting for a limit it already passed.
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    process.env.FAKE_CLAUDE_RESETS_AT = "1785408600";
    await run(reviewId);
    delete process.env.FAKE_CLAUDE_FAIL_AT;
    delete process.env.FAKE_CLAUDE_RESETS_AT;

    await run(reviewId);

    const review = requireReview(db, reviewId);
    expect(review.pausedResetsAt).toBeNull();
    expect(review.pausedReason).toBeNull();
  }, 120_000);

  it("resumes a failed review, paying only for the stage that broke", async () => {
    // 03 always specced a retry after a stage failure and the state machine
    // made failed terminal, so the only recovery was starting over and paying
    // for every stage again.
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_SCENARIO = "error-result";

    const failed = await run(reviewId);
    expect(failed.kind).toBe("failed");
    expect(requireReview(db, reviewId).status).toBe("failed");

    delete process.env.FAKE_CLAUDE_SCENARIO;
    process.env.FAKE_CLAUDE_SCENARIO = "script";
    const outcome = await run(reviewId);

    expect(outcome.kind).toBe("completed");
    const review = requireReview(db, reviewId);
    expect(review.status).toBe("awaiting_confirmation");
    // A review that ran again has not finished, whatever the failure recorded.
    expect(review.completedAt).toBeNull();
  }, 120_000);

  it("resumes without asking again for what it already knows", async () => {
    // The whole point of checkpointing, seen from the outside: the second run
    // pays only for the stages the first never reached.
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    await run(reviewId);

    const spentAfterPause = requireReview(db, reviewId).usageInputTokens;
    delete process.env.FAKE_CLAUDE_FAIL_AT;
    // The fake hands out answers in order, and two were consumed before the
    // limit hit. The resumed run asks the third question again, so its cursor
    // goes back to the answer that was waiting for it.
    writeFileSync(join(dataDir, "calls.txt"), "2");

    const replayed: string[] = [];
    const outcome = await run(reviewId, {
      onStageLifecycle: (event: StageLifecycleEvent) => {
        if (event.kind === "replayed") replayed.push(event.stage);
      },
    });

    expect(outcome.kind, JSON.stringify(outcome)).toBe("completed");
    expect(replayed).toEqual(["s1_risk", "s2_comprehension"]);
    // Seeded once per review, not once per run. A second set of ledger rows
    // would double every number the coverage report states about the change.
    expect(listLedgerFiles(db, reviewId)).toHaveLength(appFiles.length);
    // Two stages replayed, three paid for, and the earlier spend still counted.
    expect(requireReview(db, reviewId).usageInputTokens).toBe(spentAfterPause + 300);
  }, 180_000);

  it("recovers by resume when its own reconciliation rejected an answer", async () => {
    // The stage's answer is checkpointed the moment the engine returns valid
    // JSON, and the pipeline rejects it only afterwards. Left checkpointed as
    // succeeded, every resume would replay the rejected answer byte for byte
    // and fail identically forever; the only exit was deleting the review and
    // paying for all five stages again.
    const reviewId = seedReview();
    const files = appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file }));
    const outputs = buildIdealStageOutputs({
      files,
      manifest: { ...manifest, defects: manifest.defects.filter((d) => d.kind !== "cross-repo") },
      worktreeRoot: referenceRoot,
      rules: PROTOCOL.rules,
    });
    const sequence = answerSequence(outputs);
    // The first S4 answer accounts for nothing; the correct one waits behind
    // it for the resume's live re-ask.
    writeAnswersDir(answersDir, [
      ...sequence.slice(0, 3),
      { ...(sequence[3] as object), reviewedDeletions: [] },
      ...sequence.slice(3),
    ]);

    const failed = await run(reviewId);
    expect(failed.kind).toBe("failed");
    const s4Rows = () => listForReview(db, reviewId).filter((row) => row.stage === "s4_deletions");
    // The rejected answer must not be sitting there looking replayable.
    expect(s4Rows().every((row) => row.status === "failed")).toBe(true);

    const replayed: string[] = [];
    const outcome = await run(reviewId, {
      onStageLifecycle: (event: StageLifecycleEvent) => {
        if (event.kind === "replayed") replayed.push(event.stage);
      },
    });

    expect(outcome.kind, JSON.stringify(outcome)).toBe("completed");
    expect(replayed).toEqual(["s1_risk", "s2_comprehension", "s3_adversarial"]);
    expect(requireReview(db, reviewId).status).toBe("awaiting_confirmation");
    expect(s4Rows().some((row) => row.status === "succeeded")).toBe(true);
  }, 180_000);

  it("refuses to start a review that is already finished", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    await expect(run(reviewId)).rejects.toBeInstanceOf(ReviewNotRunnableError);
  }, 120_000);
});

describe("clearing up after a review", () => {
  it("removes the checked-out copies but keeps the evidence", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    await removeReviewWorktrees(db, reviewId, dataDir);

    expect(existsSync(worktreeRootDir(dataDir, reviewId))).toBe(false);
    expect(existsSync(join(bundleDir(dataDir, reviewId), "inventory.json"))).toBe(true);
  }, 120_000);

  it("removes everything, including the evidence, when the review is deleted", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    await deleteReviewEntirely(db, reviewId, dataDir);

    expect(existsSync(runDir(dataDir, reviewId))).toBe(false);
    expect(getReview(db, reviewId)).toBeUndefined();
  }, 120_000);

  it("leaves the clone untouched by all of it", async () => {
    // The app never writes inside a project it was given. A worktree add and
    // remove must leave the bare clone exactly as it found it.
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);
    await removeReviewWorktrees(db, reviewId, dataDir);

    const head = execFileSync("git", ["rev-parse", "feature/rename-prefs"], {
      cwd: appClone,
      encoding: "utf8",
    }).trim();
    expect(head).toBe(appHead);
  }, 120_000);
});

describe("what a resume reuses", () => {
  it("replays the verification stage too, and asks the model nothing", async () => {
    // The promise the architecture makes: a completed stage is never re-run.
    // It used to fail here, because candidates were recreated with fresh ids
    // and the verification prompt embedded them, so the question changed on
    // every re-entry. Candidates are now named by the label the prompt gives
    // them, which depends only on the stage answers that produced them, and
    // those are replayed byte for byte.
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "5";
    expect((await run(reviewId)).kind).toBe("paused");

    delete process.env.FAKE_CLAUDE_FAIL_AT;
    writeFileSync(join(dataDir, "calls.txt"), "4");
    expect((await run(reviewId)).kind).toBe("completed");
    expect(requireReview(db, reviewId).status).toBe("awaiting_confirmation");

    // The verification stage is now answered and stored, so a further entry
    // would have nothing left to ask. Prove it by asking the same questions
    // again through a fresh runner over the same review.
    const verificationRows = listForReview(db, reviewId).filter(
      (row) => row.stage === "s5_verification" && row.status === "succeeded",
    );
    expect(verificationRows).toHaveLength(1);

    const failed = listForReview(db, reviewId).filter(
      (row) => row.stage === "s5_verification" && row.status === "failed",
    );
    // The interrupted attempt and the one that answered asked the same
    // question, which is what makes the stage replayable at all.
    expect(failed[0]?.promptHash).toBe(verificationRows[0]?.promptHash);
  }, 180_000);

  it("reaches the same findings whether it was interrupted or not", async () => {
    // Determinism stated as the user would state it: an interrupted review
    // and one that ran straight through end up saying the same things.
    const straightThrough = seedReview();
    writeIdealAnswers();
    await run(straightThrough);
    const expected = listFindings(db, straightThrough)
      .map((f) => `${f.filePath}:${f.lineStart}:${findingStatusOf(f)}`)
      .sort();

    rmSync(join(dataDir, "calls.txt"), { force: true });
    rmSync(join(dataDir, "calls"), { recursive: true, force: true });
    const interrupted = seedReviewOnly();
    process.env.FAKE_CLAUDE_FAIL_AT = "5";
    expect((await run(interrupted)).kind).toBe("paused");
    delete process.env.FAKE_CLAUDE_FAIL_AT;
    writeFileSync(join(dataDir, "calls.txt"), "4");
    expect((await run(interrupted)).kind).toBe("completed");

    const actual = listFindings(db, interrupted)
      .map((f) => `${f.filePath}:${f.lineStart}:${findingStatusOf(f)}`)
      .sort();
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(0);
  }, 240_000);
});

describe("failing safely", () => {
  it("does not replace a real diagnosis with a state-machine complaint", async () => {
    // Something else can move a review while this run is failing: a cancel
    // from the job manager is the obvious case, and cancelled is terminal.
    // Transitioning anyway would throw from inside the catch block, and the
    // user would be shown a complaint about statuses instead of what broke.
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "1";

    const outcome = await run(reviewId, {
      onStageLifecycle: (event: StageLifecycleEvent) => {
        // Stand in for a cancel landing while the first stage is in flight.
        if (event.stage === "s1_risk") transitionReview(db, reviewId, "cancelled");
      },
    });

    expect(outcome.kind).toBe("paused");
    expect(outcome.kind === "paused" && outcome.reason).toMatch(/usage limit/i);
    // The cancel stands, because it is terminal and this run lost the race.
    expect(requireReview(db, reviewId).status).toBe("cancelled");
  }, 120_000);

  it("refuses a linked review that records no commits for its dependency", async () => {
    // Reviewing the primary alone would look complete while the half of the
    // change that motivated linking the repositories went unread.
    const reviewId = seedReview({ linked: true });
    db.update(reviews)
      .set({ linkedFromCommit: null, linkedMergeBaseCommit: null })
      .where(eq(reviews.id, reviewId))
      .run();
    writeIdealAnswers({ linked: true });

    const outcome = await run(reviewId);

    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.reason).toMatch(/no pinned commits/i);
  }, 120_000);
});

describe("cancelling a run", () => {
  it("stops between stages, where no process exists to kill", async () => {
    // The engine hands the signal to the process it spawns, which covers a
    // cancel arriving mid-stage. This is the other case: the abort lands
    // between stages, and without a boundary check the run would carry on and
    // hand the user who pressed cancel a completed review.
    const reviewId = seedReview();
    writeIdealAnswers();
    const controller = new AbortController();

    const outcome = await run(reviewId, {
      signal: controller.signal,
      onStageLifecycle: (event: StageLifecycleEvent) => {
        // Called before the engine is asked, so no child exists yet.
        if (event.stage === "s1_risk") controller.abort();
      },
    });

    expect(outcome.kind).toBe("cancelled");
    expect(requireReview(db, reviewId).status).toBe("cancelled");
    // It stopped at the boundary rather than working through the pipeline.
    expect(listForReview(db, reviewId).length).toBeLessThan(5);
  }, 120_000);

  it("keeps what it had already paid for", async () => {
    // Cancelling is not throwing the work away. The stage already in flight
    // finishes and is checkpointed, and the run stops at the next boundary, so
    // nothing that was paid for is lost and nothing new is started.
    const reviewId = seedReview();
    writeIdealAnswers();
    const controller = new AbortController();

    await run(reviewId, {
      signal: controller.signal,
      onStageLifecycle: (event: StageLifecycleEvent) => {
        if (event.stage === "s3_adversarial") controller.abort();
      },
    });

    const stored = listForReview(db, reviewId).filter((row) => row.status === "succeeded");
    expect(stored.map((row) => row.stage)).toEqual([
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
    ]);
  }, 120_000);
});

describe("how hard the model is asked to think", () => {
  it("sends the effort the review was created with, on every stage", async () => {
    const reviewId = seedReview({ effort: "max" });
    writeIdealAnswers();

    await run(reviewId);

    const calls = recordedArgv();
    expect(calls).toHaveLength(5);
    for (const [index, args] of calls.entries()) {
      expect(args[args.indexOf("--effort") + 1], `call ${index + 1}`).toBe("max");
    }
  }, 120_000);

  it("defaults to thinking hard, because that is what a review is for", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();

    await run(reviewId);

    const first = recordedArgv()[0] ?? [];
    expect(first[first.indexOf("--effort") + 1]).toBe("high");
  }, 120_000);
});

describe("coming back after the process died", () => {
  it("resumes a review the restart found still marked as running", async () => {
    // The real sequence: a review is running, the process dies, startup marks
    // whatever was still active as interrupted, and the user presses resume.
    // Nothing survived the restart that could have been running it.
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    await run(reviewId);

    // Put the row back into the state a crash would have left it in.
    transitionReview(db, reviewId, "running");
    expect(markOrphanedReviewsInterrupted(db)).toBe(1);
    expect(requireReview(db, reviewId).status).toBe("interrupted");

    delete process.env.FAKE_CLAUDE_FAIL_AT;
    writeFileSync(join(dataDir, "calls.txt"), "2");
    const replayed: string[] = [];
    const outcome = await run(reviewId, {
      onStageLifecycle: (event: StageLifecycleEvent) => {
        if (event.kind === "replayed") replayed.push(event.stage);
      },
    });

    expect(outcome.kind, JSON.stringify(outcome)).toBe("completed");
    expect(replayed).toEqual(["s1_risk", "s2_comprehension"]);
    expect(requireReview(db, reviewId).status).toBe("awaiting_confirmation");
  }, 180_000);
});

describe("the window a review batches against", () => {
  it("is frozen with the ruleset, not read live", async () => {
    // The window decides how the adversarial stage divides its work, which
    // decides its prompts, which decides whether a resumed run can replay
    // them. Read live, a model probe expiring between runs would silently
    // re-ask a stage that had already been answered and paid for.
    //
    // This checks that the decision is recorded once and never revised. That
    // the recorded value is the one the pipeline batches against is enforced
    // by construction rather than here: the registry is read at exactly one
    // line in the service, inside the freeze, and the run site can only see
    // the column. The batching behaviour itself is covered by the pipeline
    // window tests.
    registerCandidate(db, {
      id: "claude-fable-5[1m]",
      family: "fable",
      displayName: "Fable",
      profileId: "full-context",
    });
    recordProbeSuccess(db, "claude-fable-5[1m]", {
      resolvedId: "claude-fable-5",
      contextWindow: 1_000_000,
    });

    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    await run(reviewId);

    expect(requireReview(db, reviewId).contextWindow).toBe(1_000_000);

    // The probe goes stale, or the model is withdrawn entirely.
    db.delete(models).where(eq(models.id, "claude-fable-5[1m]")).run();

    delete process.env.FAKE_CLAUDE_FAIL_AT;
    writeFileSync(join(dataDir, "calls.txt"), "2");
    expect((await run(reviewId)).kind).toBe("completed");

    expect(requireReview(db, reviewId).contextWindow).toBe(1_000_000);
  }, 180_000);

  it("records that the window is unknown, rather than leaving it undecided", async () => {
    // No registry row at all. The review still freezes the answer, so a later
    // probe cannot change how an already-started review batches.
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    expect(requireReview(db, reviewId).contextWindow).toBeNull();
  }, 120_000);
});

describe("what the run actually cost", () => {
  it("counts the cached tokens as well as the fresh ones", async () => {
    // The CLI reports cached reads separately, and they are most of what a
    // chained stage sends. Folding them into the input count would overstate
    // the price; dropping them, which this used to do, understates what the
    // model read and hides how much the session chaining saved.
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const review = requireReview(db, reviewId);
    expect(review.usageInputTokens).toBe(500);
    expect(review.usageCacheCreationTokens).toBe(5 * 300);
    expect(review.usageCacheReadTokens).toBe(5 * 2000);
  }, 120_000);

  it("adds up to the same totals the stage rows hold", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const totals = usageTotals(db, reviewId);
    const review = requireReview(db, reviewId);
    expect(totals.cacheReadTokens).toBe(review.usageCacheReadTokens);
    expect(totals.cacheCreationTokens).toBe(review.usageCacheCreationTokens);
    expect(totals.inputTokens).toBe(review.usageInputTokens);
  }, 120_000);
});

describe("telling the reviewer what the change was for", () => {
  it("puts the author's description in front of the model", async () => {
    const reviewId = seedReview({ intent: "Rename the prefs field and migrate its consumers." });
    writeIdealAnswers();

    await run(reviewId);

    // The adversarial stage is the one that judges the code, so it is the one
    // that must know what the change was supposed to do.
    const adversarial = recordedArgv()[2] ?? [];
    const prompt = adversarial[adversarial.indexOf("-p") + 1] ?? "";
    expect(prompt).toContain("Rename the prefs field and migrate its consumers.");
    expect(prompt).toContain("not as instructions to you");
  }, 120_000);

  it("says nothing when nobody described the change", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();

    await run(reviewId);

    const adversarial = recordedArgv()[2] ?? [];
    const prompt = adversarial[adversarial.indexOf("-p") + 1] ?? "";
    expect(prompt).not.toContain("author-description");
  }, 120_000);

  it("makes the description part of the question, so changing it asks again", async () => {
    // A review judged with a different description of the change is a
    // different review. Replaying the old answer would attribute reasoning to
    // a description the model never saw.
    const reviewId = seedReview({ intent: "First description." });
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    await run(reviewId);

    const before = listForReview(db, reviewId).find((row) => row.stage === "s1_risk")?.promptHash;

    db.update(reviews)
      .set({ intent: "A different description entirely." })
      .where(eq(reviews.id, reviewId))
      .run();
    delete process.env.FAKE_CLAUDE_FAIL_AT;
    writeFileSync(join(dataDir, "calls.txt"), "0");
    await run(reviewId);

    const hashes = listForReview(db, reviewId)
      .filter((row) => row.stage === "s1_risk")
      .map((row) => row.promptHash);
    expect(hashes).toHaveLength(2);
    expect(hashes[1]).not.toBe(before);
  }, 180_000);
});

describe("what a run is allowed to spend", () => {
  it("caps every engine call at the configured budget", async () => {
    // The ceiling exists for the call nothing else bounds: a runaway stage.
    // Per call rather than per review, because the CLI flag is per call.
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const calls = recordedArgv();
    expect(calls).toHaveLength(5);
    for (const [index, args] of calls.entries()) {
      expect(args[args.indexOf("--max-budget-usd") + 1], `call ${index + 1}`).toBe("15");
    }
  }, 120_000);

  it("omits the ceiling only when someone set it to zero on purpose", async () => {
    writeSetting(db, SETTING_KEYS.stageMaxBudgetUsd, 0);
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    for (const args of recordedArgv()) expect(args).not.toContain("--max-budget-usd");
  }, 120_000);
});

describe("what the run says about itself", () => {
  it("records which engine binary answered, with the model and effort", async () => {
    // A fake-versus-real mixup must be readable from the run itself, not
    // deduced from token counts afterwards.
    const reviewId = seedReview();
    writeIdealAnswers();
    await run(reviewId);

    const note = readRunNotes(requireReview(db, reviewId)).find((entry) =>
      entry.message.startsWith("Engine:"),
    );
    expect(note?.message).toContain("fake-claude.mjs");
    expect(note?.message).toContain("claude-fable-5[1m]");
    expect(note?.message).toContain("effort high");
  }, 120_000);
});

describe("what is left on disk after a run stops", () => {
  it("removes the worktrees when a run is cancelled, and keeps the evidence", async () => {
    // D-12: cancelled will not resume, so the checkout goes; the bundle and
    // logs stay, because a stopped run is exactly when someone reads them.
    const reviewId = seedReview();
    writeIdealAnswers();
    const controller = new AbortController();
    await run(reviewId, {
      signal: controller.signal,
      onStageLifecycle: (event: StageLifecycleEvent) => {
        if (event.stage === "s2_comprehension") controller.abort();
      },
    });

    expect(requireReview(db, reviewId).status).toBe("cancelled");
    expect(existsSync(worktreeRootDir(dataDir, reviewId))).toBe(false);
    expect(existsSync(join(bundleDir(dataDir, reviewId), "inventory.json"))).toBe(true);
  }, 120_000);

  it("keeps the worktrees while a run is paused, because it will resume", async () => {
    const reviewId = seedReview();
    writeIdealAnswers();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    await run(reviewId);

    expect(requireReview(db, reviewId).status).toBe("paused_limit");
    expect(existsSync(worktreeRootDir(dataDir, reviewId))).toBe(true);
  }, 120_000);
});

describe("a rule someone switched off", () => {
  it("never reaches the model, and its sweep patterns never run", async () => {
    // The end of the chain: the flag is only meaningful if the rule's text is
    // absent from what the CLI is actually handed.
    const { saveImportedRuleset, setRuleEnabled, writeReviewSnapshot } =
      await import("@/server/db/repositories/rulesets");
    const { rulesetId } = saveImportedRuleset(db, {
      name: "Example protocol",
      tier: "global",
      imported: PROTOCOL,
    });
    const dropped = PROTOCOL.rules[0]!;
    setRuleEnabled(db, rulesetId, dropped.code, false);

    const reviewId = seedReview();
    writeIdealAnswers();
    // Frozen from the edited ruleset, which is what starting a review does.
    writeReviewSnapshot(db, reviewId, rulesetId);
    await prepareAndRun(db, reviewId, { dataDir, claudePath: FAKE_CLI });

    // The adversarial stage is the one carrying the full rule text.
    const adversarial = recordedArgv()[2] ?? [];
    const systemPrompt = adversarial[adversarial.indexOf("--system-prompt") + 1] ?? "";
    expect(systemPrompt).toContain(PROTOCOL.rules[1]!.ruleText);
    expect(systemPrompt).not.toContain(dropped.ruleText);
  }, 120_000);
});
