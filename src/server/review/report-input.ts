/**
 * Gathering everything the report renderer needs from the database.
 *
 * Separate from the renderer so the rendering stays pure and testable, and so
 * the reading happens in one place rather than being spread across two routes
 * that could drift about what a report contains.
 */

import { getChainFilesRead, coverageReport, listLedgerFiles } from "../db/repositories/ledger";
import { listFindings, statusOf } from "../db/repositories/findings";
import { requireProject } from "../db/repositories/projects";
import { requireReview } from "../db/repositories/reviews";
import { readReviewSnapshotMeta } from "../db/repositories/rulesets";
import type { Db } from "../db/client";
import type { ReportFinding, ReportInput } from "@/lib/review/report";

export function buildReportInput(db: Db, reviewId: string): ReportInput {
  const review = requireReview(db, reviewId);
  const project = requireProject(db, review.projectId);
  const findings = listFindings(db, reviewId);
  const meta = readReviewSnapshotMeta(db, reviewId);

  const of = (status: string): ReportFinding[] =>
    findings
      .filter((finding) => statusOf(finding) === status)
      .map((finding) => ({
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
    dismissed: of("dismissed"),
    openQuestions: of("open_question"),

    coverage: {
      totalFiles: coverage.totalFiles,
      totalHunks: coverage.totalHunks,
      totalSweepHits: coverage.totalSweepHits,
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
