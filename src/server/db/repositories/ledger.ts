/**
 * The coverage ledger: the record of what the review actually looked at.
 *
 * This module is why the pipeline can claim nothing was skipped. Every changed
 * file, every hunk, and every mechanical sweep hit is written here before any
 * model runs, and each one must end the review either attached to findings or
 * explicitly cleared with a reason. `assertCoverageComplete` is the check, and
 * it is code rather than a prompt instruction because a model cannot be asked
 * to be honest about what it skipped.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { newId } from "@/lib/ids";
import type {
  ChangeType,
  HunkStatus,
  RepoRole,
  RiskTag,
  SweepDisposition,
} from "@/lib/domain/enums";
import { riskTagSchema } from "@/lib/domain/enums";
import { z } from "zod";
import type { Db } from "../client";
import { findings, ledgerFiles, ledgerHunks, sweepHits } from "../schema";
import { parseJsonColumn, serialiseJsonColumn } from "./json";

export type LedgerFile = typeof ledgerFiles.$inferSelect;
export type LedgerHunk = typeof ledgerHunks.$inferSelect;
export type SweepHit = typeof sweepHits.$inferSelect;

const riskTagsSchema = z.array(riskTagSchema);
const stringArraySchema = z.array(z.string());

export interface HunkInput {
  hunkIndex: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface LedgerFileInput {
  repo: RepoRole;
  path: string;
  changeType: ChangeType;
  oldPath?: string | null;
  hunks: readonly HunkInput[];
}

/**
 * Seeds the ledger from the deterministic change inventory. A file with no
 * hunks is legitimate (a pure rename, or a deleted file recorded whole) and is
 * still tracked, because "not in the ledger" must never mean "not reviewed".
 */
export function recordChangedFiles(
  db: Db,
  reviewId: string,
  files: readonly LedgerFileInput[],
): LedgerFile[] {
  const created: LedgerFile[] = [];
  for (const file of files) {
    const row = {
      id: newId(),
      reviewId,
      repo: file.repo,
      path: file.path,
      changeType: file.changeType,
      oldPath: file.oldPath ?? null,
      riskTags: "[]",
      chainFilesRead: "[]",
      status: "pending",
    };
    db.insert(ledgerFiles).values(row).run();
    for (const hunk of file.hunks) {
      db.insert(ledgerHunks)
        .values({
          id: newId(),
          ledgerFileId: row.id,
          hunkIndex: hunk.hunkIndex,
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          status: "pending",
          clearReason: null,
        })
        .run();
    }
    created.push(row);
  }
  return created;
}

export function setFileRiskTags(db: Db, ledgerFileId: string, tags: readonly RiskTag[]): void {
  db.update(ledgerFiles)
    .set({ riskTags: serialiseJsonColumn([...tags], riskTagsSchema) })
    .where(eq(ledgerFiles.id, ledgerFileId))
    .run();
}

export function getFileRiskTags(file: LedgerFile): RiskTag[] {
  return parseJsonColumn("ledger_files.risk_tags", file.riskTags, riskTagsSchema);
}

export function setChainFilesRead(db: Db, ledgerFileId: string, paths: readonly string[]): void {
  db.update(ledgerFiles)
    .set({ chainFilesRead: serialiseJsonColumn([...paths], stringArraySchema) })
    .where(eq(ledgerFiles.id, ledgerFileId))
    .run();
}

export function getChainFilesRead(file: LedgerFile): string[] {
  return parseJsonColumn("ledger_files.chain_files_read", file.chainFilesRead, stringArraySchema);
}

export function listLedgerFiles(db: Db, reviewId: string): LedgerFile[] {
  return db.select().from(ledgerFiles).where(eq(ledgerFiles.reviewId, reviewId)).all();
}

export function listHunks(db: Db, ledgerFileId: string): LedgerHunk[] {
  return db.select().from(ledgerHunks).where(eq(ledgerHunks.ledgerFileId, ledgerFileId)).all();
}

/** A hunk was examined and produced findings. */
export function markHunkHasFindings(db: Db, hunkId: string): void {
  setHunkStatus(db, hunkId, "has_findings", null);
}

/**
 * A hunk was examined and is fine. The reason is mandatory: an unexplained
 * clear is indistinguishable from a skipped hunk, which is the failure this
 * ledger exists to prevent.
 */
export function clearHunk(db: Db, hunkId: string, reason: string): void {
  if (reason.trim() === "") {
    throw new Error(
      `Cannot clear hunk "${hunkId}" without a reason: an unexplained clear is a skipped hunk.`,
    );
  }
  setHunkStatus(db, hunkId, "cleared", reason);
}

function setHunkStatus(db: Db, hunkId: string, status: HunkStatus, clearReason: string | null) {
  const result = db
    .update(ledgerHunks)
    .set({ status, clearReason })
    .where(eq(ledgerHunks.id, hunkId))
    .run();
  if (result.changes === 0) throw new Error(`No ledger hunk with id "${hunkId}".`);
}

export function markFileReviewed(db: Db, ledgerFileId: string): void {
  db.update(ledgerFiles).set({ status: "reviewed" }).where(eq(ledgerFiles.id, ledgerFileId)).run();
}

export interface SweepHitInput {
  ruleCode: string;
  pattern: string;
  repo: RepoRole;
  path: string;
  line: number;
  excerpt: string;
}

export function recordSweepHits(
  db: Db,
  reviewId: string,
  hits: readonly SweepHitInput[],
): SweepHit[] {
  const created: SweepHit[] = [];
  for (const hit of hits) {
    const row = {
      id: newId(),
      reviewId,
      ruleCode: hit.ruleCode,
      pattern: hit.pattern,
      repo: hit.repo,
      path: hit.path,
      line: hit.line,
      excerpt: hit.excerpt,
      disposition: "pending",
      clearReason: null,
      findingId: null,
    };
    db.insert(sweepHits).values(row).run();
    created.push(row);
  }
  return created;
}

export function listSweepHits(db: Db, reviewId: string): SweepHit[] {
  return db.select().from(sweepHits).where(eq(sweepHits.reviewId, reviewId)).all();
}

/** The sweep hit became a finding. */
export function attachSweepHitToFinding(db: Db, sweepHitId: string, findingId: string): void {
  setSweepDisposition(db, sweepHitId, "finding", null, findingId);
}

/** The sweep hit was examined and is not a problem here. Reason mandatory. */
export function clearSweepHit(db: Db, sweepHitId: string, reason: string): void {
  if (reason.trim() === "") {
    throw new Error(
      `Cannot clear sweep hit "${sweepHitId}" without a reason: ` +
        `an unexplained clear is indistinguishable from never having looked.`,
    );
  }
  setSweepDisposition(db, sweepHitId, "cleared", reason, null);
}

function setSweepDisposition(
  db: Db,
  sweepHitId: string,
  disposition: SweepDisposition,
  clearReason: string | null,
  findingId: string | null,
) {
  const result = db
    .update(sweepHits)
    .set({ disposition, clearReason, findingId })
    .where(eq(sweepHits.id, sweepHitId))
    .run();
  if (result.changes === 0) throw new Error(`No sweep hit with id "${sweepHitId}".`);
}

export interface CoverageReport {
  totalFiles: number;
  totalHunks: number;
  pendingHunks: number;
  totalSweepHits: number;
  pendingSweepHits: number;
  pendingFiles: number;
  /** Candidate findings with no verification verdict yet. */
  unresolvedCandidates: number;
}

export function coverageReport(db: Db, reviewId: string): CoverageReport {
  const files = listLedgerFiles(db, reviewId);
  const fileIds = files.map((f) => f.id);

  const hunkCounts =
    fileIds.length === 0
      ? { total: 0, pending: 0 }
      : (db
          .select({
            total: sql<number>`count(*)`,
            pending: sql<number>`sum(case when ${ledgerHunks.status} = 'pending' then 1 else 0 end)`,
          })
          .from(ledgerHunks)
          .where(inArray(ledgerHunks.ledgerFileId, fileIds))
          .get() ?? { total: 0, pending: 0 });

  const sweepCounts = db
    .select({
      total: sql<number>`count(*)`,
      pending: sql<number>`sum(case when ${sweepHits.disposition} = 'pending' then 1 else 0 end)`,
    })
    .from(sweepHits)
    .where(eq(sweepHits.reviewId, reviewId))
    .get() ?? { total: 0, pending: 0 };

  const unresolvedCandidates = db
    .select()
    .from(findings)
    .where(and(eq(findings.reviewId, reviewId), eq(findings.status, "candidate")))
    .all().length;

  return {
    totalFiles: files.length,
    totalHunks: Number(hunkCounts.total ?? 0),
    pendingHunks: Number(hunkCounts.pending ?? 0),
    totalSweepHits: Number(sweepCounts.total ?? 0),
    pendingSweepHits: Number(sweepCounts.pending ?? 0),
    pendingFiles: files.filter((f) => f.status === "pending").length,
    unresolvedCandidates,
  };
}

export class IncompleteCoverageError extends Error {
  constructor(
    readonly reviewId: string,
    readonly report: CoverageReport,
    readonly shortfalls: readonly string[],
  ) {
    super(
      `Review "${reviewId}" has not covered everything it changed: ` +
        `${shortfalls.join("; ")}. ` +
        `Everything changed must end with findings or an explicit clear.`,
    );
    this.name = "IncompleteCoverageError";
  }
}

/**
 * The audit-stage gate, implementing all four conditions in
 * docs/03-REVIEW-PIPELINE.md section S6: every hunk dispositioned, every sweep
 * hit dispositioned, every changed file reviewed, and every candidate finding
 * resolved.
 *
 * The file check matters on its own because a deleted or renamed file has no
 * hunks: checking hunks alone would let a whole deleted file pass the gate
 * without anyone having looked at what its removal broke, which is exactly the
 * regression class the deletion stage exists to catch.
 *
 * This throws rather than warning. Incomplete coverage is a defect in the run,
 * not a caveat to attach to the output.
 */
export function assertCoverageComplete(db: Db, reviewId: string): CoverageReport {
  const report = coverageReport(db, reviewId);
  const shortfalls: string[] = [];

  if (report.pendingHunks > 0) {
    shortfalls.push(`${report.pendingHunks} of ${report.totalHunks} hunks undispositioned`);
  }
  if (report.pendingSweepHits > 0) {
    shortfalls.push(
      `${report.pendingSweepHits} of ${report.totalSweepHits} sweep hits undispositioned`,
    );
  }
  if (report.pendingFiles > 0) {
    shortfalls.push(`${report.pendingFiles} of ${report.totalFiles} changed files not reviewed`);
  }
  if (report.unresolvedCandidates > 0) {
    shortfalls.push(`${report.unresolvedCandidates} candidate findings never verified`);
  }

  if (shortfalls.length > 0) throw new IncompleteCoverageError(reviewId, report, shortfalls);
  return report;
}
