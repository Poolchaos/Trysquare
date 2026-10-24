/**
 * Gathering everything the report renderer needs from the database.
 *
 * Separate from the renderer so the rendering stays pure and testable, and so
 * the reading happens in one place rather than being spread across two routes
 * that could drift about what a report contains.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checksDir } from "@/lib/paths";
import { listCheckFindings, type CheckFinding } from "../db/repositories/check-findings";
import { getChainFilesRead, coverageReport, listLedgerFiles } from "../db/repositories/ledger";
import { listFindings, statusOf } from "../db/repositories/findings";
import { requireProject } from "../db/repositories/projects";
import { requireReview } from "../db/repositories/reviews";
import { readReviewSnapshotMeta } from "../db/repositories/rulesets";
import type { Db } from "../db/client";
import type { ReportCheck, ReportCheckRun, ReportFinding, ReportInput } from "@/lib/review/report";
import type { ChecksResult } from "./project-checks";

/**
 * How each of the project's own commands ended, from the result the review
 * kept (WP-I), or none when they were not run or the result is gone.
 */
function checksRanFor(dataDir: string | undefined, reviewId: string): ReportCheckRun[] {
  if (dataDir === undefined) return [];
  const path = join(checksDir(dataDir, reviewId), "result.json");
  if (!existsSync(path)) return [];
  try {
    const kept = JSON.parse(readFileSync(path, "utf8")) as ChecksResult;
    return kept.commands.map((command) => ({
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
  } catch {
    return [];
  }
}

/** A design finding's screenshot as an image the report can carry whole. */
function screenshotOf(
  row: CheckFinding,
): Pick<ReportCheck, "screenshotName" | "screenshotDataUri"> {
  if (row.screenshotPath === null) return {};
  let dataUri: string | null = null;
  try {
    dataUri = `data:image/png;base64,${readFileSync(row.screenshotPath).toString("base64")}`;
  } catch {
    dataUri = null;
  }
  return { screenshotName: basename(row.screenshotPath), screenshotDataUri: dataUri };
}

const asReportCheck = (row: CheckFinding): ReportCheck => ({
  ...screenshotOf(row),
  command: row.command,
  severity: row.severity,
  issue: row.issue,
  evidence: row.evidence,
  verificationNote: row.verificationNote,
  dismissReason: row.dismissReason,
});

export function buildReportInput(db: Db, reviewId: string, dataDir?: string): ReportInput {
  const review = requireReview(db, reviewId);
  const project = requireProject(db, review.projectId);
  const findings = listFindings(db, reviewId);
  const meta = readReviewSnapshotMeta(db, reviewId);
  const checkRows = listCheckFindings(db, reviewId);

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
      ran: checksRanFor(dataDir, reviewId),
      confirmed: checkRows.filter((row) => row.status === "confirmed").map(asReportCheck),
      dismissed: checkRows.filter((row) => row.status === "dismissed").map(asReportCheck),
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
