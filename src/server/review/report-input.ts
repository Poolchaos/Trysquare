/**
 * Gathering everything the report renderer needs from the database.
 *
 * Separate from the renderer so the rendering stays pure and testable, and so
 * the reading happens in one place rather than being spread across two routes
 * that could drift about what a report contains.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checksDir } from "@/lib/paths";
import { listCheckFindings, type CheckFinding } from "../db/repositories/check-findings";
import { getChainFilesRead, coverageReport, listLedgerFiles } from "../db/repositories/ledger";
import { listFindings, statusOf } from "../db/repositories/findings";
import { requireProject } from "../db/repositories/projects";
import { requireReview } from "../db/repositories/reviews";
import { readReviewSnapshotMeta } from "../db/repositories/rulesets";
import type { Db } from "../db/client";
import type {
  DesignChecked,
  ReportCheck,
  ReportCheckRun,
  ReportFinding,
  ReportInput,
} from "@/lib/review/report";
import type { ChecksResult } from "./project-checks";
import { screenshotFile, screenshotNameOf } from "./screenshots";

/**
 * How each of the project's own commands ended, from the result the review
 * kept (WP-I), and whether the screens were graded; none when they were not
 * run or the result is gone.
 */
function checksRanFor(
  dataDir: string | undefined,
  reviewId: string,
): { ran: ReportCheckRun[]; design?: DesignChecked } {
  if (dataDir === undefined) return { ran: [] };
  const path = join(checksDir(dataDir, reviewId), "result.json");
  if (!existsSync(path)) return { ran: [] };
  try {
    const kept = JSON.parse(readFileSync(path, "utf8")) as ChecksResult;
    const e2e = kept.commands.find((command) => command.step === "e2e");
    const design: DesignChecked =
      kept.checks.e2eCommand === null
        ? "no e2e command"
        : e2e === undefined || e2e.cancelled
          ? "e2e not run"
          : kept.screenshots.length > 0
            ? (kept.screenshotsLeft ?? []).length > 0
              ? "partly graded"
              : "graded"
            : (kept.screenshotsLeft ?? []).length > 0
              ? "none gradable"
              : "no screenshots";
    const ran = kept.commands.map((command): ReportCheckRun => ({
      step: command.step,
      command: command.command,
      outcome: command.cancelled
        ? "cancelled"
        : command.timedOut
          ? "timed out"
          : command.exitCode === 0
            ? "passed"
            : "failed",
    }));
    return { ran, design };
  } catch {
    return { ran: [] };
  }
}

/**
 * The most screenshot data one report carries, counted as the base64 it is
 * carried as: two hundred screens graded C or D at the copy's limit would
 * otherwise make a report of gigabytes (review round 8). Past it a screen
 * is named, not shown.
 */
export const REPORT_IMAGE_BYTES = 24 * 1024 * 1024;

const base64Length = (bytes: number) => 4 * Math.ceil(bytes / 3);

/**
 * Turns check rows into the report's, carrying each design finding's
 * screenshot whole while the report has room, read only from its own
 * review's screenshots folder.
 */
function reportChecks(dataDir: string | undefined, reviewId: string) {
  let carried = 0;
  const screenshotOf = (
    row: CheckFinding,
  ): Pick<ReportCheck, "screenshotName" | "screenshotDataUri"> => {
    if (row.screenshotPath === null) return {};
    const name =
      dataDir === undefined
        ? row.screenshotPath
        : screenshotNameOf(dataDir, reviewId, row.screenshotPath);
    const file = dataDir === undefined ? null : screenshotFile(dataDir, reviewId, name);
    let dataUri: string | null = null;
    if (file !== null) {
      try {
        // Sized before it is read: a file past the budget is never loaded.
        const encoded = base64Length(statSync(file).size);
        if (carried + encoded <= REPORT_IMAGE_BYTES) {
          carried += encoded;
          dataUri = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
        }
      } catch {
        dataUri = null;
      }
    }
    return { screenshotName: name, screenshotDataUri: dataUri };
  };
  return (row: CheckFinding): ReportCheck => ({
    ...screenshotOf(row),
    command: row.command,
    severity: row.severity,
    issue: row.issue,
    evidence: row.evidence,
    verificationNote: row.verificationNote,
    dismissReason: row.dismissReason,
  });
}

export function buildReportInput(db: Db, reviewId: string, dataDir?: string): ReportInput {
  const review = requireReview(db, reviewId);
  const project = requireProject(db, review.projectId);
  const findings = listFindings(db, reviewId);
  const meta = readReviewSnapshotMeta(db, reviewId);
  const checkRows = listCheckFindings(db, reviewId);
  const asReportCheck = reportChecks(dataDir, reviewId);
  const dismissedCheck = (fromOpenQuestion: boolean) =>
    checkRows
      .filter(
        (row) =>
          row.status === "dismissed" &&
          (row.dismissedFrom === "open_question") === fromOpenQuestion,
      )
      .map(asReportCheck);

  // In the order the report shows them, which is the order the image
  // budget is spent in (review round 9).
  const confirmedChecks = checkRows.filter((row) => row.status === "confirmed").map(asReportCheck);
  // Graded C or D by one grader only, as a code finding one verifier
  // proved is an open question: never proven, so apart (D-190).
  const leftOutChecks = dismissedCheck(true);
  const dismissedChecks = dismissedCheck(false);

  const of = (status: string, keep: (finding: (typeof findings)[number]) => boolean = () => true) =>
    findings
      .filter((finding) => statusOf(finding) === status && keep(finding))
      .map((finding): ReportFinding => ({
        filePath: finding.filePath,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd,
        severity: finding.severity,
        ruleCode: finding.ruleCode,
        issue: finding.issue,
        // The person's words when they rewrote the engine's, because the
        // report is read by whoever has to fix the code. The engine's own
        // wording stays on the row as the record of how it explained itself.
        comment: finding.editedComment ?? finding.comment,
        mechanism: finding.mechanism,
        quotedCode: finding.quotedCode,
        dismissReason: finding.dismissReason,
      }))
      // Stable order so two exports of one review are byte-identical.
      .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart);

  const coverage = coverageReport(db, reviewId);
  const chainFilesRead = new Set(
    listLedgerFiles(db, reviewId).flatMap((file) => getChainFilesRead(file)),
  ).size;

  const linkedProject =
    review.linkedProjectId === null ? undefined : requireProject(db, review.linkedProjectId);

  return {
    projectName: project.name,
    fromBranch: review.fromBranch,
    intoBranch: review.intoBranch,
    fromCommit: review.fromCommit,
    mergeBaseCommit: review.mergeBaseCommit,
    ...(linkedProject && review.linkedFromCommit
      ? {
          linked: {
            projectName: linkedProject.name,
            fromBranch: review.linkedFromBranch ?? "",
            fromCommit: review.linkedFromCommit,
          },
        }
      : {}),
    intent: review.intent,

    confirmed: of("confirmed"),
    dismissed: of("dismissed", (finding) => finding.dismissedFrom !== "open_question"),
    leftOutUnproven: of("dismissed", (finding) => finding.dismissedFrom === "open_question"),
    // The project's own checks, decided as the code findings are (D-197).
    checks: {
      ...checksRanFor(dataDir, reviewId),
      confirmed: confirmedChecks,
      dismissed: dismissedChecks,
      leftOutUnproven: leftOutChecks,
    },

    coverage: {
      totalFiles: coverage.totalFiles,
      totalHunks: coverage.totalHunks,
      totalSweepHits: coverage.totalSweepHits,
      refutedOnlyHunks: coverage.refutedOnlyHunks,
      refutedOnlySweepHits: coverage.refutedOnlySweepHits,
    },
    chainFilesRead,

    rulesetName: meta.rulesetName,
    rulesetVersion: meta.rulesetVersion,
    model: review.model,
    effort: review.effort,
    profile: review.profileId,

    usage: {
      inputTokens: review.usageInputTokens,
      outputTokens: review.usageOutputTokens,
      cacheReadTokens: review.usageCacheReadTokens,
      costEquivalentUsd: review.costEquivalentUsd,
    },
    startedAt: review.startedAt,
    completedAt: review.completedAt,
  };
}
