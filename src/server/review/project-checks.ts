/**
 * A project's own checks within a review (WP-I, D-191): its install, tests
 * and e2e, run in a throwaway copy of the commit under review, the result
 * kept beside the review's other evidence and the copy removed.
 *
 * Run in preparation, before any model is asked, so a review that cannot
 * get them is told so before it spends. A resume reuses a result for the
 * same commit and the same checks rather than running the suite again.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checksDir } from "@/lib/paths";
import type { ProjectChecks } from "@/lib/projects/checks";
import type { Db } from "../db/client";
import { appendRunNote } from "../db/repositories/reviews";
import { makeThrowawayCopy, removeThrowawayCopy } from "../gitops/copy";
import { runProjectChecks, type ChecksRun, type CommandResult } from "../projectrun/run";

export interface ChecksResult extends ChecksRun {
  commit: string;
  checks: ProjectChecks;
}

const STEP_NAMES: Record<CommandResult["step"], string> = {
  install: "Install",
  tests: "Tests",
  e2e: "E2E",
};

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** One line per command, as a person reading the run would want it said. */
export function describeCommand(result: CommandResult): string {
  const name = `${STEP_NAMES[result.step]} (${result.command})`;
  if (result.cancelled) return `${name} was stopped by the cancel.`;
  if (result.timedOut) {
    return `${name} was stopped at its time limit after ${seconds(result.durationMs)}; its output is in ${result.logPath}.`;
  }
  return result.exitCode === 0
    ? `${name} passed in ${seconds(result.durationMs)}.`
    : `${name} failed with exit code ${result.exitCode} in ${seconds(result.durationMs)}; its output is in ${result.logPath}.`;
}

async function readKept(path: string): Promise<ChecksResult | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as ChecksResult;
  } catch {
    return null;
  }
}

export async function runChecksForReview(
  db: Db,
  options: {
    reviewId: string;
    dataDir: string;
    clonePath: string;
    commit: string;
    checks: ProjectChecks;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<ChecksResult> {
  const dir = checksDir(options.dataDir, options.reviewId);
  const resultPath = join(dir, "result.json");
  const kept = await readKept(resultPath);
  if (
    kept !== null &&
    kept.commit === options.commit &&
    JSON.stringify(kept.checks) === JSON.stringify(options.checks)
  ) {
    appendRunNote(db, options.reviewId, {
      kind: "note",
      message:
        "The project's own checks ran before this resume, on the same commit; their result stands.",
    });
    return kept;
  }

  // A result for another commit or other checks is not this one's.
  // With retries: what a crashed run left running can hold a file in it for
  // a moment on Windows (review round 7).
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const copyDir = join(dir, "copy");
  await mkdir(dir, { recursive: true });
  let run: ChecksRun;
  try {
    await makeThrowawayCopy(options.clonePath, options.commit, copyDir);
    run = await runProjectChecks({
      checks: options.checks,
      copyDir,
      logDir: join(dir, "logs"),
      screenshotsDir: join(dir, "screenshots"),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } finally {
    await removeThrowawayCopy(copyDir);
  }

  for (const command of run.commands) {
    appendRunNote(db, options.reviewId, { kind: "note", message: describeCommand(command) });
  }
  const install = run.commands.find((command) => command.step === "install");
  if (install !== undefined && install.exitCode !== 0 && !install.cancelled) {
    appendRunNote(db, options.reviewId, {
      kind: "note",
      message: "The install failed, so the tests and e2e were not run.",
    });
  }
  const e2e = run.commands.find((command) => command.step === "e2e");
  if (e2e !== undefined && !e2e.cancelled) {
    appendRunNote(db, options.reviewId, {
      kind: "note",
      message:
        run.screenshots.length === 0
          ? `The e2e saved no screenshot in ${options.checks.screenshotDir}, so the design was not checked.`
          : `The e2e saved ${run.screenshots.length} screenshot(s) to grade.`,
    });
  }

  const result: ChecksResult = { ...run, commit: options.commit, checks: options.checks };
  // Not kept when cancelled: a resume runs them whole.
  if (!run.commands.some((command) => command.cancelled)) {
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}
