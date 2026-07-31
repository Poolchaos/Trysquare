/**
 * Runs a whole review against the seeded fixture and reports what it found.
 *
 * This exists so the app can be judged before it has a screen. It builds two
 * git repositories with known defects planted in them, reviews the branch pair
 * for real, and prints which of those defects the review actually found. The
 * manifest is the answer key, so the output is a score rather than an
 * impression.
 *
 * `--fake` routes every model call through the test double, which makes the
 * whole demo free and deterministic. That mode proves the plumbing. It proves
 * nothing about review quality, which is what the real run is for.
 *
 *   npm run demo:fixture -- --fake
 *   npm run demo:fixture -- --model claude-fable-5[1m]
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { dbPath } from "@/lib/paths";
import { importProtocol } from "@/lib/rulesets/import";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { listFindings, statusOf } from "@/server/db/repositories/findings";
import { recordProbeSuccess, registerCandidate } from "@/server/db/repositories/models";
import { createProject, linkDependency } from "@/server/db/repositories/projects";
import { createReview, requireReview } from "@/server/db/repositories/reviews";
import { cloneBare, diffText, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { probeModel } from "@/server/engine/probe";
import { JobManager } from "@/server/jobs/manager";
import type { ReviewEvent } from "@/server/jobs/bus";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures");

/** Cheap, and enough to smoke the plumbing. Quality judgement uses fable. */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface Options {
  model: string;
  fake: boolean;
  keep: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const modelAt = argv.indexOf("--model");
  return {
    model: modelAt === -1 ? DEFAULT_MODEL : (argv[modelAt + 1] ?? DEFAULT_MODEL),
    fake: argv.includes("--fake"),
    keep: argv.includes("--keep"),
  };
}

const log = (line = "") => process.stdout.write(`${line}\n`);

/** Grouped with commas whatever the machine's locale says, because this output
 * is captured as evidence and two runs have to be comparable. */
const count = (value: number): string => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

interface Defect {
  id: string;
  file: string;
  line: number;
  severity: string;
  kind: string;
}

interface Manifest {
  defects: Defect[];
  cleanFiles: string[];
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  const dataDir = mkdtempSync(join(tmpdir(), "trysquare-demo-"));
  const fixtureRoot = join(dataDir, "fixture");
  mkdirSync(fixtureRoot, { recursive: true });

  log(`Trysquare demo`);
  log(`model    ${options.fake ? "fake CLI (no model is called)" : options.model}`);
  log(`data dir ${dataDir}`);
  log();

  // Built by the same script the tests use, so the demo and the suite are
  // scoring the same code against the same answer key.
  const { buildSeededRepos } = (await import(join(FIXTURES, "build-seeded-repos.mjs"))) as {
    buildSeededRepos: (root: string) => { appDir: string; coreDir: string; manifest: Manifest };
  };
  const built = buildSeededRepos(fixtureRoot);
  const manifest = built.manifest;
  log(
    `Built the fixture: ${manifest.defects.length} planted defect(s), ` +
      `${manifest.cleanFiles.length} file(s) that are deliberately fine.`,
  );

  const appClone = join(dataDir, "clones", "app.git");
  const coreClone = join(dataDir, "clones", "core.git");
  await cloneBare(built.appDir, appClone);
  await cloneBare(built.coreDir, coreClone);

  const db = createDb(dbPath(dataDir));
  runMigrations(db);

  const claudePath = options.fake ? join(FIXTURES, "fake-claude.mjs") : undefined;
  const manager = new JobManager();
  manager.init({ db, dataDir, ...(claudePath === undefined ? {} : { claudePath }) });

  if (!options.fake) {
    log(`Probing ${options.model}...`);
    const probe = await probeModel(options.model);
    if (probe.status !== "available") {
      log(`The model is not usable: ${probe.error}`);
      log("Nothing was spent. Pass --fake to run the demo without a model.");
      if (!options.keep) rmSync(dataDir, { recursive: true, force: true });
      return 1;
    }
    registerCandidate(db, {
      id: options.model,
      family: options.model.split("-")[1] ?? "unknown",
      displayName: options.model,
      profileId: "full-context",
    });
    recordProbeSuccess(db, options.model, {
      resolvedId: probe.resolvedId,
      contextWindow: probe.contextWindow,
    });
    log(`Available as ${probe.resolvedId}, ` + `${count(probe.contextWindow)} token window.`);
  }

  const app = createProject(db, {
    name: "app",
    gitUrl: `file://${built.appDir}`,
    defaultBranch: "main",
    clonePath: appClone,
  });
  const core = createProject(db, {
    name: "shared-core",
    gitUrl: `file://${built.coreDir}`,
    defaultBranch: "main",
    clonePath: coreClone,
  });
  linkDependency(db, {
    projectId: app.id,
    dependencyProjectId: core.id,
    packageName: "@acme/shared-core",
  });

  const ruleset = importProtocol(
    await readFile(join(FIXTURES, "example-protocol.md"), "utf8"),
  ).ruleset;

  const reviewId = createReview(db, {
    projectId: app.id,
    fromBranch: "feature/rename-prefs",
    fromCommit: await resolveCommit(appClone, "feature/rename-prefs"),
    intoBranch: "main",
    intoCommit: await resolveCommit(appClone, "main"),
    mergeBaseCommit: await mergeBase(appClone, "main", "feature/rename-prefs"),
    model: options.model,
    profileId: "full-context",
    engineMode: "headless",
    intent:
      "Rename the Prefs.reportAutoNavigate field to autoNavigateDestination in the shared " +
      "package and migrate every consumer, plus assorted unrelated tidy-ups.",
    linked: {
      projectId: core.id,
      fromBranch: "feature/rename-prefs",
      fromCommit: await resolveCommit(coreClone, "feature/rename-prefs"),
      intoBranch: "main",
      intoCommit: await resolveCommit(coreClone, "main"),
      mergeBaseCommit: await mergeBase(coreClone, "main", "feature/rename-prefs"),
    },
  }).id;

  if (options.fake) await writeFakeAnswers(dataDir, built, manifest, appClone, coreClone);

  const eventLog: string[] = [];
  const stageStartedAt = new Map<string, number>();
  manager.subscribe(reviewId, (event) => {
    eventLog.push(JSON.stringify({ at: new Date().toISOString(), ...event }));
    renderEvent(event, stageStartedAt);
  });

  log();
  log(`Running`);
  manager.start(reviewId, {
    ruleset: { imported: ruleset, name: "Example protocol", tier: "global" },
  });
  const outcome = await manager.settled(reviewId);

  log();
  const review = requireReview(db, reviewId);
  const report = scoreAgainstManifest(db, reviewId, manifest);
  renderScore(report, review, Date.now() - startedAt, outcome?.kind ?? "failed");

  const outDir = join(REPO_ROOT, "review", `${new Date().toISOString().slice(0, 10)}-fg2`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "events.jsonl"), `${eventLog.join("\n")}\n`);
  writeFileSync(join(outDir, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
  log(`Wrote the event log and the score to ${outDir}`);

  if (options.keep) log(`Kept the data directory: ${dataDir}`);
  else rmSync(dataDir, { recursive: true, force: true });

  // The exit code reports whether the pipeline ran, not whether the findings
  // were good. Finding quality is a human judgement, and the cheap default
  // model is a plumbing smoke rather than a quality claim.
  return outcome?.kind === "completed" ? 0 : 1;
}

function renderEvent(event: ReviewEvent, startedAt: Map<string, number>): void {
  if (event.kind === "stage") {
    if (event.phase === "replayed") {
      log(`  ${event.stage} replayed from an earlier run, costing nothing`);
      return;
    }
    startedAt.set(event.stage, Date.now());
    log(`  ${event.stage} started`);
    return;
  }
  if (event.kind === "engine" && event.event === "tool-use") {
    log(`      ${event.detail}`);
    return;
  }
  if (event.kind === "rate-limit") {
    log(`  rate limit: ${event.status}`);
    return;
  }
  if (event.kind === "note") {
    log(`  note: ${event.note.message}`);
    return;
  }
  if (event.kind === "status") {
    log(`  status: ${event.status}${event.pausedReason ? ` (${event.pausedReason})` : ""}`);
  }
}

interface Score {
  found: { id: string; where: string }[];
  missed: { id: string; where: string }[];
  falsePositives: { file: string; line: number; issue: string }[];
  killedByQuoteCheck: number;
  openQuestions: number;
}

function scoreAgainstManifest(
  db: ReturnType<typeof createDb>,
  reviewId: string,
  manifest: Manifest,
): Score {
  const findings = listFindings(db, reviewId);
  const verified = findings.filter((finding) => statusOf(finding) === "verified");

  const found: Score["found"] = [];
  const missed: Score["missed"] = [];
  for (const defect of manifest.defects) {
    const where = `app/${defect.file}:${defect.line}`;
    // Within two lines: a reviewer that cites the guard rather than the line
    // it guards has still found the defect.
    const hit = verified.find(
      (finding) =>
        finding.filePath === `app/${defect.file}` && Math.abs(finding.lineStart - defect.line) <= 2,
    );
    (hit ? found : missed).push({ id: defect.id, where });
  }

  const falsePositives = verified
    .filter((finding) => manifest.cleanFiles.some((clean) => finding.filePath === `app/${clean}`))
    .map((finding) => ({ file: finding.filePath, line: finding.lineStart, issue: finding.issue }));

  return {
    found,
    missed,
    falsePositives,
    killedByQuoteCheck: findings.filter((finding) => statusOf(finding) === "killed").length,
    openQuestions: findings.filter((finding) => statusOf(finding) === "open_question").length,
  };
}

function renderScore(
  score: Score,
  review: ReturnType<typeof requireReview>,
  elapsedMs: number,
  outcome: string,
): void {
  const total = score.found.length + score.missed.length;
  log(`Against the answer key`);
  for (const hit of score.found) log(`  FOUND   ${hit.id.padEnd(22)} ${hit.where}`);
  for (const miss of score.missed) log(`  MISSED  ${miss.id.padEnd(22)} ${miss.where}`);
  log(`  ${score.found.length}/${total} planted defect(s) found.`);

  if (score.falsePositives.length > 0) {
    log();
    log(`  ${score.falsePositives.length} finding(s) in files that are deliberately fine:`);
    for (const wrong of score.falsePositives) log(`    ${wrong.file}:${wrong.line} ${wrong.issue}`);
  } else {
    log(`  No findings in the files that are deliberately fine.`);
  }

  log();
  log(`The run`);
  log(`  outcome            ${outcome}`);
  log(`  discarded quotes   ${score.killedByQuoteCheck} (cited code that was not there)`);
  log(`  open questions     ${score.openQuestions}`);
  log(
    `  tokens             ${count(review.usageInputTokens)} in, ` +
      `${count(review.usageOutputTokens)} out, ` +
      `${count(review.usageCacheReadTokens)} cached read`,
  );
  log(`  cost equivalent    $${review.costEquivalentUsd.toFixed(4)}`);
  log(`  wall time          ${(elapsedMs / 1000).toFixed(1)}s`);
}

/**
 * The answers the fake CLI hands back, built from the manifest.
 *
 * Shared with the test suite, so `--fake` exercises the same ideal reviewer the
 * engine quality gate does.
 */
async function writeFakeAnswers(
  dataDir: string,
  built: { appDir: string; coreDir: string },
  manifest: Manifest,
  appClone: string,
  coreClone: string,
): Promise<void> {
  const helpers = (await import(join(REPO_ROOT, "tests", "helpers", "ideal-answers.ts"))) as {
    buildIdealStageOutputs: (input: unknown) => unknown;
    answerSequence: (outputs: unknown) => unknown[];
    writeAnswersDir: (dir: string, answers: readonly unknown[]) => string;
  };

  const reference = join(dataDir, "reference");
  const appHead = await resolveCommit(appClone, "feature/rename-prefs");
  const coreHead = await resolveCommit(coreClone, "feature/rename-prefs");
  const { addWorktree } = await import("@/server/gitops/worktree");
  await addWorktree(appClone, join(reference, "app"), appHead);
  await addWorktree(coreClone, join(reference, "shared-core"), coreHead);

  const appFiles = parseUnifiedDiff(
    await diffText(appClone, await mergeBase(appClone, "main", "feature/rename-prefs"), appHead),
  );
  const coreFiles = parseUnifiedDiff(
    await diffText(coreClone, await mergeBase(coreClone, "main", "feature/rename-prefs"), coreHead),
  );

  const outputs = helpers.buildIdealStageOutputs({
    files: [
      ...appFiles.map((file) => ({ repo: "primary", slug: "app", file })),
      ...coreFiles.map((file) => ({ repo: "linked", slug: "shared-core", file })),
    ],
    manifest,
    worktreeRoot: reference,
    rules: importProtocol(await readFile(join(FIXTURES, "example-protocol.md"), "utf8")).ruleset
      .rules,
  });

  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = join(dataDir, "answers");
  process.env.FAKE_CLAUDE_COUNTER = join(dataDir, "calls.txt");
  helpers.writeAnswersDir(join(dataDir, "answers"), helpers.answerSequence(outputs));
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    log(`The demo failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) log(`${error.stack}`);
    process.exit(1);
  });
