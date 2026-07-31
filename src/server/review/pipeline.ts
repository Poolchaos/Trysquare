/**
 * The review pipeline.
 *
 * Runs the stages in order and, between them, does the bookkeeping that makes
 * the review's claims checkable: seeding the ledger from the deterministic
 * inventory, running the mechanical sweeps, reconciling what each stage
 * accounted for against what it was given, byte-checking every verified
 * finding against the file it cites, and refusing to finish while anything is
 * outstanding.
 *
 * The stage runner is injected. The real one spawns the CLI; tests supply a
 * scripted one, so the orchestration can be exercised end to end without
 * spending model usage or depending on what a model happens to say today.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewProfile, ReviewStage } from "@/lib/domain/enums";
import type { ChangedSymbol } from "@/lib/git/symbols";
import { assertBatchesCoverEverything, planRuleBatches } from "@/lib/rulesets/compose";
import type { ImportedRule } from "@/lib/rulesets/model";
import { budgetFor, estimateTokens, fitsBudget, splitToFit } from "@/lib/review/budget";
import {
  assertReconciled,
  reconcileAdversarial,
  type HunkRef,
  type SweepRef,
  type SymbolRef,
} from "@/lib/review/coverage";
import { checkQuotedCode, describeMismatch } from "@/lib/review/quote-match";
import {
  type AdversarialStageOutput,
  adversarialStageSchema,
  comprehensionStageSchema,
  deletionStageSchema,
  riskStageSchema,
  verificationStageSchema,
} from "@/lib/review/stage-schemas";
import { assertSweepComplete, runSweeps } from "@/lib/review/sweep";
import type { Db } from "@/server/db/client";
import { appendRunNote } from "@/server/db/repositories/reviews";
import {
  renderAdversarialPrompt,
  renderComprehensionPrompt,
  renderDeletionPrompt,
  renderRiskPrompt,
  renderVerificationPrompt,
  type ChangedFileEntry,
  type StageContentInput,
} from "./content";
import {
  createCandidate,
  listUnresolvedCandidates,
  markKilled,
  markOpenQuestion,
  markVerified,
} from "@/server/db/repositories/findings";
import {
  assertCoverageComplete,
  clearHunk,
  clearSweepHit,
  attachSweepHitToFinding,
  listHunks,
  listLedgerFiles,
  listSweepHits,
  markFileReviewed,
  markHunkHasFindings,
  recordChangedFiles,
  recordSweepHits,
  setChainFilesRead,
  setFileRiskTags,
  type CoverageReport,
} from "@/server/db/repositories/ledger";

export interface StageRequest {
  stage: ReviewStage;
  systemPrompt: string;
  prompt: string;
  resumeSessionId?: string | undefined;
}

export interface StageResponse {
  /** The stage's JSON answer, still unvalidated. */
  output: unknown;
  sessionId: string;
  usage?: { inputTokens: number; outputTokens: number; costEquivalentUsd: number };
}

export type StageRunner = (request: StageRequest) => Promise<StageResponse>;

export interface PipelineInput {
  db: Db;
  reviewId: string;
  /** Root the model reads from: the worktree, or its parent when linked. */
  worktreeRoot: string;
  /** Changed files per repository, from the deterministic inventory. */
  files: readonly ChangedFileEntry[];
  /** The full rules, used both for the sweep and for planning the batches. */
  rules: readonly ImportedRule[];
  /** Decides how the adversarial work is divided. See docs/06. */
  profile: ReviewProfile;
  /**
   * The model's probed context window. Given, the pipeline splits a stage
   * whose prompt would not fit; absent, it makes one request per batch and
   * lets the model refuse rather than guessing at a limit.
   */
  contextWindow?: number | undefined;
  /** Contract changes in a linked dependency, for the adversarial stage. */
  changedSymbols?: readonly ChangedSymbol[] | undefined;
  /** Pre-change file contents, so deletions can be reviewed at all. */
  baseContents?: ReadonlyMap<string, string> | undefined;
  /**
   * Composes the system prompt. Given a batch's rules when the profile sends
   * fewer than all of them, so the caller keeps ownership of composition.
   */
  systemPromptFor: (stage: ReviewStage, batch?: { rules: readonly ImportedRule[] }) => string;
  run: StageRunner;
}

export interface PipelineResult {
  coverage: CoverageReport;
  candidatesRaised: number;
  verified: number;
  killed: number;
  openQuestions: number;
  /** Findings killed because their quotation did not match the file. */
  killedByQuoteCheck: number;
  /** How many requests the adversarial stage was divided into. */
  adversarialRequests: number;
  /** Rule/file pairs a narrowing profile deliberately did not check. */
  excludedPairs: number;
}

/** Paths in the ledger are qualified by repository, as the model sees them. */
/** The label a candidate is given in the verification prompt. */
function refFor(index: number): string {
  return `C${index + 1}`;
}

function indexOfRef(ref: string): number {
  const parsed = Number.parseInt(ref.replace(/^C/i, ""), 10);
  return Number.isFinite(parsed) ? parsed - 1 : -1;
}

function qualified(slug: string, path: string): string {
  return `${slug}/${path}`;
}

export async function runReviewPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { db, reviewId } = input;

  // S0: everything deterministic, before any model is involved.
  //
  // Seeded once per review, not once per run. The inventory is derived from
  // commits that cannot move, so a resumed run would insert a second identical
  // set of rows, and every count the coverage report makes would then be
  // double what the change set actually contains. Existing rows are the same
  // rows this would have written, and the dispositions already recorded
  // against them are the ones being resumed.
  const alreadySeeded = listLedgerFiles(db, reviewId).length > 0;

  const ledgerFiles = alreadySeeded
    ? listLedgerFiles(db, reviewId)
    : recordChangedFiles(
        db,
        reviewId,
        input.files.map((entry) => ({
          repo: entry.repo,
          path: qualified(entry.slug, entry.file.path),
          changeType: entry.file.changeType,
          oldPath: entry.file.oldPath ?? null,
          hunks: entry.file.hunks.map((hunk) => ({
            hunkIndex: hunk.hunkIndex,
            oldStart: hunk.oldStart,
            oldLines: hunk.oldLines,
            newStart: hunk.newStart,
            newLines: hunk.newLines,
          })),
        })),
      );

  const sweepOutcome = runSweeps(
    input.files.map((entry) => ({ repo: entry.repo, file: entry.file })),
    input.rules,
  );
  // A partial sweep finds fewer hits, and fewer hits looks like cleaner code.
  // Run on every entry, resumed or not: it is the check on the sweep itself,
  // and skipping it would let a resumed run proceed on an unverified sweep.
  assertSweepComplete(sweepOutcome);

  if (!alreadySeeded) {
    recordSweepHits(
      db,
      reviewId,
      sweepOutcome.hits.map((hit) => {
        const entry = input.files.find((f) => f.file.path === hit.path && f.repo === hit.repo);
        return { ...hit, path: qualified(entry?.slug ?? "", hit.path) };
      }),
    );
  }

  const content: StageContentInput = {
    files: input.files,
    sweepHits: listSweepHits(db, reviewId).map((hit) => ({
      path: hit.path,
      line: hit.line,
      ruleCode: hit.ruleCode,
      pattern: hit.pattern,
      excerpt: hit.excerpt,
    })),
    ...(input.changedSymbols === undefined ? {} : { changedSymbols: input.changedSymbols }),
    ...(input.baseContents === undefined ? {} : { baseContents: input.baseContents }),
  };

  // S1: risk classification.
  const risk = riskStageSchema.parse(
    (
      await input.run({
        stage: "s1_risk",
        systemPrompt: input.systemPromptFor("s1_risk"),
        prompt: renderRiskPrompt(content),
      })
    ).output,
  );
  for (const entry of risk.files) {
    const ledgerFile = ledgerFiles.find((file) => file.path === entry.path);
    if (ledgerFile) setFileRiskTags(db, ledgerFile.id, entry.riskTags);
  }

  // S2: comprehension. Findings are forbidden here by the prompt; the schema
  // has nowhere to put them, so one cannot arrive by accident either.
  const comprehension = comprehensionStageSchema.parse(
    (
      await input.run({
        stage: "s2_comprehension",
        systemPrompt: input.systemPromptFor("s2_comprehension"),
        prompt: renderComprehensionPrompt(content),
      })
    ).output,
  );
  for (const entry of comprehension.files) {
    const ledgerFile = ledgerFiles.find((file) => file.path === entry.path);
    if (ledgerFile) setChainFilesRead(db, ledgerFile.id, entry.chainFilesRead);
  }

  // S3: the adversarial pass. How it is divided depends on the model; what it
  // must account for does not.
  const adversarial = await runAdversarialStage(input, content, ledgerFiles);

  const expectedHunks: HunkRef[] = ledgerFiles.flatMap((file) =>
    listHunks(db, file.id).map((hunk) => ({ path: file.path, hunkIndex: hunk.hunkIndex })),
  );
  const expectedSweeps: SweepRef[] = listSweepHits(db, reviewId).map((hit) => ({
    path: hit.path,
    line: hit.line,
    ruleCode: hit.ruleCode,
  }));

  const findingHunks: HunkRef[] = adversarial.findings.map((finding) => ({
    path: finding.path,
    hunkIndex: hunkIndexFor(finding.path, finding.lineStart, ledgerFiles, db),
  }));

  const expectedSymbols: SymbolRef[] = (input.changedSymbols ?? []).map((symbol) => ({
    symbol: symbol.name,
    path: symbol.path,
  }));

  assertReconciled(
    reconcileAdversarial(
      expectedHunks,
      expectedSweeps,
      {
        hunksWithFindings: findingHunks,
        hunksCleared: adversarial.clearedHunks,
        sweepDispositions: adversarial.sweepDispositions,
        symbolDispositions: adversarial.symbolDispositions.map((disposition) => ({
          symbol: disposition.symbol,
          path: disposition.path,
        })),
      },
      expectedSymbols,
    ),
  );

  assertSymbolVerdictsAreBacked(adversarial);

  // Record what the stage decided.
  for (const cleared of adversarial.clearedHunks) {
    const ledgerFile = ledgerFiles.find((file) => file.path === cleared.path);
    if (!ledgerFile) continue;
    const hunk = listHunks(db, ledgerFile.id).find((h) => h.hunkIndex === cleared.hunkIndex);
    if (hunk) clearHunk(db, hunk.id, cleared.reason);
  }
  for (const hunkRef of findingHunks) {
    const ledgerFile = ledgerFiles.find((file) => file.path === hunkRef.path);
    if (!ledgerFile) continue;
    const hunk = listHunks(db, ledgerFile.id).find((h) => h.hunkIndex === hunkRef.hunkIndex);
    if (hunk) markHunkHasFindings(db, hunk.id);
  }

  const candidates = [...adversarial.findings].map((finding) =>
    createCandidate(db, {
      reviewId,
      repo: repoOf(finding.path, input),
      filePath: finding.path,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      severity: finding.severity,
      ruleCode: finding.ruleCode,
      issue: finding.issue,
      comment: finding.comment,
      mechanism: finding.mechanism,
    }),
  );

  const sweepRows = listSweepHits(db, reviewId);
  for (const disposition of adversarial.sweepDispositions) {
    const row = sweepRows.find(
      (hit) =>
        hit.path === disposition.path &&
        hit.line === disposition.line &&
        hit.ruleCode === disposition.ruleCode,
    );
    if (!row) continue;
    if (disposition.disposition === "cleared") {
      clearSweepHit(db, row.id, disposition.reason);
      continue;
    }

    // The stage says this hit became a finding, so a finding must exist for
    // it. Attaching an empty id here would leave a hit that reads as handled
    // and points at nothing, which is worse than an open one: it looks
    // resolved in the ledger and cannot be traced back to anything.
    const match = nearestFindingTo(candidates, disposition.path, disposition.line);
    if (!match) {
      throw new SweepDispositionUnmatchedError(
        disposition.path,
        disposition.line,
        disposition.ruleCode,
      );
    }
    attachSweepHitToFinding(db, row.id, match.id);
  }

  // S4: deletions, which is where regressions hide.
  const deletions = deletionStageSchema.parse(
    (
      await input.run({
        stage: "s4_deletions",
        systemPrompt: input.systemPromptFor("s4_deletions"),
        prompt: renderDeletionPrompt(content),
      })
    ).output,
  );
  for (const finding of deletions.findings) {
    candidates.push(
      createCandidate(db, {
        reviewId,
        repo: repoOf(finding.path, input),
        filePath: finding.path,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd,
        severity: finding.severity,
        ruleCode: finding.ruleCode,
        issue: finding.issue,
        comment: finding.comment,
        mechanism: finding.mechanism,
      }),
    );
  }

  // Every file has now been looked at by the comprehension, adversarial and
  // deletion stages, so the file rows can be closed.
  for (const file of ledgerFiles) markFileReviewed(db, file.id);

  // S5: verification, in a fresh session with no access to the reasoning that
  // produced the candidates.
  const verification = verificationStageSchema.parse(
    (
      await input.run({
        stage: "s5_verification",
        systemPrompt: input.systemPromptFor("s5_verification"),
        prompt: renderVerificationPrompt(
          candidates.map((finding, index) => ({
            // Positional, because the candidate order is fixed by the stage
            // answers that produced it, and those are replayed byte for byte.
            // A database id here would change on every resume and the
            // verification stage could never be replayed.
            ref: refFor(index),
            path: finding.filePath,
            lineStart: finding.lineStart,
            lineEnd: finding.lineEnd,
            severity: finding.severity,
            issue: finding.issue,
            mechanism: finding.mechanism,
          })),
        ),
      })
    ).output,
  );

  let verified = 0;
  let killed = 0;
  let openQuestions = 0;
  let killedByQuoteCheck = 0;

  for (const verdict of verification.verdicts) {
    const finding = candidates[indexOfRef(verdict.ref)];
    if (!finding) continue;

    if (verdict.verdict === "killed") {
      markKilled(db, finding.id, verdict.note || "Refuted during verification.");
      killed += 1;
      continue;
    }
    if (verdict.verdict === "open_question") {
      markOpenQuestion(db, finding.id, verdict.note || "Could not be settled from the code.");
      openQuestions += 1;
      continue;
    }

    // The verifier says it confirmed the finding. The program now checks that
    // claim against the file, because a citation that does not match the code
    // is not evidence, however confident the wording.
    const contents = await readFileIfPossible(input.worktreeRoot, finding.filePath);
    if (contents === null) {
      markKilled(db, finding.id, `The cited file could not be read: ${finding.filePath}`);
      killed += 1;
      killedByQuoteCheck += 1;
      continue;
    }

    const check = checkQuotedCode(contents, verdict.lineStart, verdict.lineEnd, verdict.quotedCode);
    if (!check.matches) {
      markKilled(
        db,
        finding.id,
        `The quotation did not match the file: ${describeMismatch(check.reason)}.`,
      );
      killed += 1;
      killedByQuoteCheck += 1;
      continue;
    }

    markVerified(db, finding.id, {
      quotedCode: verdict.quotedCode,
      lineStart: verdict.lineStart,
      lineEnd: verdict.lineEnd,
      note: verdict.note,
    });
    verified += 1;
  }

  // A candidate the verification stage never ruled on is an outstanding
  // question, not a silent pass.
  for (const stranded of listUnresolvedCandidates(db, reviewId)) {
    markOpenQuestion(db, stranded.id, "Verification returned no verdict for this finding.");
    openQuestions += 1;
  }

  // S6: nothing may be outstanding.
  const coverage = assertCoverageComplete(db, reviewId);

  return {
    coverage,
    candidatesRaised: candidates.length,
    verified,
    killed,
    openQuestions,
    killedByQuoteCheck,
    adversarialRequests: adversarial.requestCount,
    excludedPairs: adversarial.excludedPairs,
  };
}

/**
 * Runs the adversarial stage as however many requests the profile calls for,
 * and merges the answers into one.
 *
 * Splitting happens for two independent reasons: the profile divides the rules
 * because the model cannot hold them all at once, and the context guard
 * divides the files because a particular prompt would not fit. Both are
 * recorded on the review, because a run that quietly did less work than
 * another would otherwise look identical to it.
 */
async function runAdversarialStage(
  input: PipelineInput,
  content: StageContentInput,
  ledgerFiles: readonly { path: string }[],
): Promise<AdversarialStageOutput & { requestCount: number; excludedPairs: number }> {
  const filePaths = ledgerFiles.map((file) => file.path);
  const plan = planRuleBatches(input.rules, filePaths, input.profile);
  // Proves the division did not lose anything before a single request is sent.
  assertBatchesCoverEverything(plan, input.rules, filePaths);

  if (plan.excluded.length > 0) {
    appendRunNote(input.db, input.reviewId, {
      kind: "excluded-pairs",
      message:
        `The ${input.profile} profile did not check ${plan.excluded.length} rule/file pair(s): ` +
        plan.excluded
          .slice(0, 20)
          .map((pair) => `${pair.rule} against ${pair.file} (${pair.reason})`)
          .join("; "),
    });
  }

  const merged: AdversarialStageOutput = {
    findings: [],
    clearedHunks: [],
    sweepDispositions: [],
    symbolDispositions: [],
  };
  let requestCount = 0;

  for (const [index, batch] of plan.batches.entries()) {
    const systemPrompt = input.systemPromptFor("s3_adversarial", { rules: batch.rules });
    const groups = splitBatchToFit(input, content, systemPrompt, batch.files);

    for (const group of groups) {
      requestCount += 1;
      const response = await input.run({
        stage: "s3_adversarial",
        systemPrompt,
        prompt: renderAdversarialPrompt(content, {
          files: group,
          ...(batch.theme === undefined ? {} : { theme: batch.theme }),
          batchNumber: requestCount,
          batchCount: 0,
        }),
      });

      const parsed = adversarialStageSchema.parse(response.output);
      merged.findings.push(...parsed.findings);
      merged.clearedHunks.push(...parsed.clearedHunks);
      merged.sweepDispositions.push(...parsed.sweepDispositions);
      // Deduplicated: a symbol may legitimately be dispositioned in more than
      // one batch, and counting it twice would misreport the accounting.
      for (const disposition of parsed.symbolDispositions) {
        const seen = merged.symbolDispositions.some(
          (existing) =>
            existing.symbol === disposition.symbol && existing.path === disposition.path,
        );
        if (!seen) merged.symbolDispositions.push(disposition);
      }
    }

    if (groups.length > 1) {
      appendRunNote(input.db, input.reviewId, {
        kind: "batch-split",
        message:
          `Batch ${index + 1}${batch.theme ? ` (${batch.theme})` : ""} was split into ` +
          `${groups.length} requests to fit the model's context window.`,
      });
    }
  }

  return { ...merged, requestCount, excludedPairs: plan.excluded.length };
}

/**
 * Divides one batch's files so each request fits the context window.
 *
 * Without a known window nothing is split: guessing at a limit would either
 * waste requests or fail anyway, and the model refusing an oversized prompt is
 * a clearer signal than a number invented here.
 */
function splitBatchToFit(
  input: PipelineInput,
  content: StageContentInput,
  systemPrompt: string,
  files: readonly string[],
): string[][] {
  if (input.contextWindow === undefined) return [[...files]];

  const whole = renderAdversarialPrompt(content, { files });
  if (fitsBudget(systemPrompt, whole, input.contextWindow)) return [[...files]];

  if (files.length <= 1) {
    // Nothing left to divide. It is still sent, and still reported: silently
    // sending an oversized prompt is how a request fails for a reason the run
    // never records.
    appendRunNote(input.db, input.reviewId, {
      kind: "oversized-prompt",
      message:
        `${files[0] ?? "(no file)"} does not fit the context window on its own (about ` +
        `${estimateTokens(systemPrompt) + estimateTokens(whole)} tokens against a budget of ` +
        `${budgetFor(input.contextWindow)}). It was sent anyway.`,
    });
    return [[...files]];
  }

  const sized = files.map((path) => ({
    key: path,
    estimatedTokens: estimateTokens(renderAdversarialPrompt(content, { files: [path] })),
  }));

  const split = splitToFit(sized, budgetFor(input.contextWindow), estimateTokens(systemPrompt));

  for (const item of split.oversized) {
    // Sent anyway. Being told the prompt is too large is strictly better than
    // deciding here not to review the file.
    appendRunNote(input.db, input.reviewId, {
      kind: "oversized-prompt",
      message:
        `${item.key} does not fit the context window on its own (about ` +
        `${item.estimatedTokens} tokens). It was sent as a request of its own.`,
    });
  }

  return split.groups.map((group) => group.map((item) => item.key));
}

export class SymbolVerdictUnbackedError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `A contract change in the linked dependency was dispositioned without the evidence ` +
        `that verdict requires: ${problems.join("; ")}. A cross-repo change that still ` +
        `compiles where it is declared only breaks at the consumer, so saying it is fine ` +
        `has to mean somebody looked at the consumers.`,
    );
    this.name = "SymbolVerdictUnbackedError";
  }
}

/**
 * Checks that each symbol verdict carries what it claims.
 *
 * "All consumers verified" without naming a consumer is not a check, it is an
 * assertion. "A finding" without a finding is worse: it reads as handled and
 * points at nothing. Both are refused, which is what makes the third verdict,
 * no consumers found, worth having: a newly exported symbol genuinely has
 * none, and that answer stays available without weakening the other two.
 */
function assertSymbolVerdictsAreBacked(output: AdversarialStageOutput): void {
  const problems: string[] = [];

  for (const disposition of output.symbolDispositions) {
    if (
      disposition.verdict === "all_consumers_verified" &&
      disposition.consumersChecked.length === 0
    ) {
      problems.push(
        `${disposition.symbol} was reported as verified against all consumers, but none were named`,
      );
      continue;
    }

    if (disposition.verdict !== "finding") continue;

    // The finding must cite real code, either in the dependency where the
    // contract changed or in a consumer that now disagrees with it. It then
    // faces the quotation check like any other finding.
    const cited = new Set([disposition.path, ...disposition.consumersChecked]);
    const backed = output.findings.some(
      (finding) => cited.has(finding.path) || finding.path.endsWith(disposition.path),
    );
    if (!backed) {
      problems.push(
        `${disposition.symbol} was reported as producing a finding, but no finding cites ` +
          `${disposition.path} or any consumer named alongside it`,
      );
    }
  }

  if (problems.length > 0) throw new SymbolVerdictUnbackedError(problems);
}

export class SweepDispositionUnmatchedError extends Error {
  constructor(
    readonly path: string,
    readonly line: number,
    readonly ruleCode: string,
  ) {
    super(
      `The adversarial stage said the sweep hit at ${path}:${line} (rule ${ruleCode}) became a ` +
        `finding, but raised no finding in that file. A hit recorded against no finding reads ` +
        `as handled and points at nothing, so the run stops rather than storing it.`,
    );
    this.name = "SweepDispositionUnmatchedError";
  }
}

/**
 * The finding a sweep hit belongs to.
 *
 * A file can carry several findings, so the hit is matched to the one whose
 * line range contains it, and otherwise to the closest by line. Matching on
 * path alone would attach a hit to whichever finding happened to be first.
 * Ties break towards the earlier line, so the choice is deterministic.
 */
function nearestFindingTo(
  candidates: readonly { id: string; filePath: string; lineStart: number; lineEnd: number }[],
  path: string,
  line: number,
): { id: string } | undefined {
  const inFile = candidates.filter((finding) => finding.filePath === path);
  if (inFile.length === 0) return undefined;

  const containing = inFile.find((finding) => line >= finding.lineStart && line <= finding.lineEnd);
  if (containing) return containing;

  return [...inFile].sort((a, b) => {
    const byDistance =
      Math.min(Math.abs(a.lineStart - line), Math.abs(a.lineEnd - line)) -
      Math.min(Math.abs(b.lineStart - line), Math.abs(b.lineEnd - line));
    return byDistance !== 0 ? byDistance : a.lineStart - b.lineStart;
  })[0];
}

function repoOf(path: string, input: PipelineInput): "primary" | "linked" {
  const slug = path.split("/")[0];
  return input.files.find((entry) => entry.slug === slug)?.repo ?? "primary";
}

/** The hunk a finding's line falls inside, or the first hunk of the file. */
function hunkIndexFor(
  path: string,
  line: number,
  ledgerFiles: readonly { id: string; path: string }[],
  db: Db,
): number {
  const ledgerFile = ledgerFiles.find((file) => file.path === path);
  if (!ledgerFile) return 0;
  const hunks = listHunks(db, ledgerFile.id);
  const containing = hunks.find(
    (hunk) => line >= hunk.newStart && line < hunk.newStart + Math.max(hunk.newLines, 1),
  );
  return containing?.hunkIndex ?? hunks[0]?.hunkIndex ?? 0;
}

async function readFileIfPossible(root: string, qualifiedPath: string): Promise<string | null> {
  try {
    return await readFile(join(root, qualifiedPath), "utf8");
  } catch {
    return null;
  }
}

export { listLedgerFiles };
