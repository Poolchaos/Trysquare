/**
 * Reviews the design fixture and scores each screenshot's grades against its
 * key (WP-I step 6, the run WP-J reads).
 *
 * The fixture's own e2e photographs its screens in the review's throwaway
 * copy, both graders grade them, and the score says which planted defect
 * was found, which was missed, and which clean screen was failed. The
 * evidence keeps every grade beside the screenshot it is of, so each can be
 * read against the image. `--fake` proves the plumbing for nothing, as the
 * test does; without it the run says how the CLI is signed in first and
 * stops, having spent nothing, when that bills per token or may, unless
 * `--per-token` says it may spend.
 *
 *   npm run demo:design -- --fake
 *   npm run demo:design -- --real
 *   npm run demo:design -- --model claude-opus-5-5
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listCheckFindings } from "@/server/db/repositories/check-findings";
import { listFindings, statusOf } from "@/server/db/repositories/findings";
import { requireReview } from "@/server/db/repositories/reviews";
import { listForReview } from "@/server/db/repositories/stage-executions";
import type { ReviewEvent } from "@/server/jobs/bus";
import { screenshotsDir } from "@/server/review/screenshots";
import { readDemoOptions, type DemoOptions } from "./lib/demo-args";
import { readyForReview } from "./lib/demo-cli";
import { reviewDesignFixture } from "./lib/design-demo";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

const log = (line = "") => process.stdout.write(`${line}\n`);

function renderEvent(event: ReviewEvent): void {
  if (event.kind === "stage" && event.phase !== "replayed") log(`  ${event.stage} started`);
  else if (event.kind === "note") log(`  note: ${event.note.message}`);
  else if (event.kind === "status") log(`  status: ${event.status}`);
}

/** Every grade each grading stage gave, by screenshot, as it answered. */
function gradesOf(rows: ReturnType<typeof listForReview>) {
  const grades: Record<string, { stage: string; grade: string; whatIsOff: string }[]> = {};
  for (const row of rows) {
    if (row.status !== "succeeded" || row.outputJson === null) continue;
    if (row.stage !== "s4b_design_grading" && row.stage !== "s5c_design_second") continue;
    const answer = JSON.parse(row.outputJson) as {
      grades?: { screenshot: string; grade: string; whatIsOff: string }[];
    };
    for (const grade of answer.grades ?? []) {
      (grades[grade.screenshot] ??= []).push({
        stage: row.stage,
        grade: grade.grade,
        whatIsOff: grade.whatIsOff,
      });
    }
  }
  return grades;
}

async function main(): Promise<number> {
  const asked = readDemoOptions("npm run demo:design", process.argv.slice(2), process.env);
  if ("refusal" in asked) {
    log(asked.refusal);
    return 1;
  }
  const { options } = asked;
  const startedAt = Date.now();
  const dataDir = mkdtempSync(join(tmpdir(), "trysquare-design-demo-"));
  log("Trysquare design demo");
  log(`model    ${options.fake ? "fake CLI (no model is called)" : options.model}`);
  log(`data dir ${dataDir}`);
  log();

  const events: string[] = [];
  const run = await reviewDesignFixture({
    dataDir,
    model: options.model,
    playwright: dirname(createRequire(import.meta.url).resolve("@playwright/test/package.json")),
    fake: options.fake,
    prepare: async (db) =>
      options.fake
        ? { claudePath: join(REPO_ROOT, "tests", "fixtures", "fake-claude.mjs") }
        : readyForReview(db, { model: options.model, perToken: options.perToken, log }),
    onEvent: (event) => {
      events.push(JSON.stringify({ at: new Date().toISOString(), ...event }));
      renderEvent(event);
    },
  });
  if (run === null) {
    if (!options.keep) rmSync(dataDir, { recursive: true, force: true });
    return 1;
  }
  try {
    return report(run, { ...options, dataDir, startedAt, events });
  } finally {
    // Closed before the directory goes, whatever happened: Windows will not
    // delete an open database.
    run.db.$client.close();
    if (options.keep) log(`Kept the data directory: ${dataDir}`);
    else rmSync(dataDir, { recursive: true, force: true });
  }
}

function report(
  run: NonNullable<Awaited<ReturnType<typeof reviewDesignFixture>>>,
  options: DemoOptions & { dataDir: string; startedAt: number; events: string[] },
): number {
  const { dataDir, startedAt, events } = options;
  const { db, reviewId, score, manifest } = run;
  const review = requireReview(db, reviewId);
  log();
  // A run that did not reach a person stopped before both graders had
  // answered: what it left is not a score of either (review round 9).
  if (run.outcome !== "completed") {
    log(`Not a measurement: the review ended ${run.outcome} before both graders had answered.`);
  }
  log("Against the key");
  // The key's defect beside what the grader said: both failing a screen is
  // not both naming what was planted, which only the words show.
  for (const hit of score.found) {
    log(
      `  FOUND   ${hit.screenshot.padEnd(24)} key: ${hit.defect}; graded ${hit.grade}: ${hit.whatIsOff}`,
    );
  }
  for (const miss of score.missed)
    log(`  MISSED  ${miss.screenshot.padEnd(24)} ${miss.defect}: ${miss.why}`);
  for (const wrong of score.falsePositives) {
    log(
      `  WRONG   ${wrong.screenshot.padEnd(24)} clean, graded ${wrong.grade}: ${wrong.whatIsOff}`,
    );
  }
  for (const open of score.cleanOpen)
    log(`  OPEN    ${open.padEnd(24)} clean, failed by one grader`);
  for (const extra of score.unkeyed) {
    log(`  UNKEYED ${extra.screenshot.padEnd(24)} not in the key, left ${extra.status}`);
  }
  const planted = manifest.screens.filter((screen) => screen.defect !== null).length;
  log();
  log(
    `${score.found.length}/${planted} planted screenshots found, ${score.falsePositives.length} clean one(s) failed by both graders.`,
  );
  log(
    `outcome  ${run.outcome}, $${review.costEquivalentUsd.toFixed(4)} cost-equivalent, ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  // Each run its own directory, the screenshots beside every grade given
  // them, so each grade can be read against its image.
  const stamp = new Date().toISOString();
  const label = `${stamp.slice(11, 19).replaceAll(":", "")}-${
    options.fake ? "fake" : options.model.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-|-$/g, "")
  }`;
  const outDir = join(REPO_ROOT, "review", `${stamp.slice(0, 10)}-design`, label);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "events.jsonl"), `${events.join("\n")}\n`);
  writeFileSync(
    join(outDir, "score.json"),
    `${JSON.stringify({ outcome: run.outcome, ...score }, null, 2)}\n`,
  );
  writeFileSync(
    join(outDir, "grades.json"),
    `${JSON.stringify(
      {
        key: manifest.screens,
        grades: gradesOf(listForReview(db, reviewId)),
        findings: listCheckFindings(db, reviewId).filter((row) => row.kind === "design"),
      },
      null,
      2,
    )}\n`,
  );
  // The code stages read the screens' HTML too, and what they raised is
  // part of the run: the first real run raised three and kept none.
  const codeFindings = listFindings(db, reviewId).map((finding) => ({
    status: statusOf(finding),
    file: finding.filePath,
    lines: [finding.lineStart, finding.lineEnd],
    severity: finding.severity,
    ruleCode: finding.ruleCode,
    issue: finding.issue,
    comment: finding.comment,
    quotedCode: finding.quotedCode,
    verificationNote: finding.verificationNote,
  }));
  writeFileSync(join(outDir, "code-findings.json"), `${JSON.stringify(codeFindings, null, 2)}\n`);
  // Made only for a screenshot copied: an e2e that saved none left none.
  const shots = screenshotsDir(dataDir, reviewId);
  if (existsSync(shots)) cpSync(shots, join(outDir, "screenshots"), { recursive: true });
  log(`Wrote the score, every grade, the screenshots and the code findings to ${outDir}`);
  return run.outcome === "completed" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    log(`The demo failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) log(error.stack);
    process.exit(1);
  });
