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
import { sep } from "node:path";
import type { RepoRole, ReviewProfile, ReviewStage } from "@/lib/domain/enums";
import { opaqueChanges } from "@/lib/git/opaque";
import { unsafeRepoPathReason } from "@/lib/git/repo-path";
import type { ChangedSymbol } from "@/lib/git/symbols";
import { insideRoot } from "@/lib/paths";
import { assertBatchesCoverEverything, planRuleBatches } from "@/lib/rulesets/compose";
import type { ImportedRule } from "@/lib/rulesets/model";
import { budgetFor, estimateTokens, fitsBudget, splitToFit } from "@/lib/review/budget";
import {
  assertDeletionsReconciled,
  assertReconciled,
  citesHunk,
  citesLine,
  rangesOverlap,
  reconcileAdversarial,
  reconcileDeletions,
  type HunkRef,
  type SweepRef,
  type SymbolRef,
} from "@/lib/review/coverage";
import { checkQuotedCode, describeMismatch } from "@/lib/review/quote-match";
import { byRiskOrder, riskOrderedPaths } from "@/lib/review/risk-order";
import { ruleCodeReader } from "@/lib/review/rule-codes";
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
import { realPath } from "@/server/real-path";
import {
  isDeletionCandidate,
  numberedLines,
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
  getFileRiskTags,
  attachSweepHitToFinding,
  listHunks,
  listLedgerFiles,
  listSweepHits,
  markFileReviewed,
  markHunkHasFindings,
  seedLedger,
  setChainFilesRead,
  setFileRiskTags,
  type CoverageReport,
} from "@/server/db/repositories/ledger";

export interface StageRequest {
  stage: ReviewStage;
  systemPrompt: string;
  prompt: string;
  resumeSessionId?: string | undefined;
  /** Set only when a stage divides its work, so progress can be reported. */
  batchNumber?: number;
  batchCount?: number;
}

export interface StageResponse {
  /** The stage's JSON answer, still unvalidated. */
  output: unknown;
  sessionId: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    costEquivalentUsd: number;
  };
}

export type StageRunner = (request: StageRequest) => Promise<StageResponse>;

export interface PipelineInput {
  db: Db;
  reviewId: string;
  /** Root the model reads from: the worktree, or its parent when linked. */
  worktreeRoot: string;
  /** Changed files per repository, from the deterministic inventory. */
  files: readonly ChangedFileEntry[];
  /**
   * Each repository's directory under worktreeRoot, and its role. Defaults to
   * those with a changed file, which misses a linked repository that changed
   * nothing.
   */
  repositories?: readonly { slug: string; repo: RepoRole }[] | undefined;
  /** The full rules, used both for the sweep and for planning the batches. */
  rules: readonly ImportedRule[];
  /** Decides how the adversarial work is divided. See docs/06. */
  profile: ReviewProfile;
  /** What the author says the change was meant to do, if they said. */
  intent?: string | undefined;
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
  /**
   * Told when this pipeline rejects a stage's already-stored answer, so the
   * caller can strike the checkpoint. Without it a resume replays the exact
   * answer that was rejected and fails the same way every time.
   */
  invalidate?: ((stage: ReviewStage, reason: string) => void) | undefined;
}

export interface PipelineResult {
  coverage: CoverageReport;
  candidatesRaised: number;
  verified: number;
  killed: number;
  openQuestions: number;
  /**
   * Findings a mechanical check killed after verification said verified: the
   * file could not be read, the quotation did not match it, or the quoted
   * lines missed the candidate's (D-99).
   */
  killedByQuoteCheck: number;
  /** How many requests the adversarial stage was divided into. */
  adversarialRequests: number;
  /** Rule/file pairs a narrowing profile deliberately did not check. */
  excludedPairs: number;
}

/** The label a candidate is given in the verification prompt. */
function refFor(index: number): string {
  return `C${index + 1}`;
}

function indexOfRef(ref: string): number {
  const parsed = Number.parseInt(ref.replace(/^C/i, ""), 10);
  return Number.isFinite(parsed) ? parsed - 1 : -1;
}

/** Paths in the ledger are qualified by repository, as the model sees them. */
function qualified(slug: string, path: string): string {
  return `${slug}/${path}`;
}

export async function runReviewPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { db, reviewId } = input;

  // Every check that can refuse a stage's answer runs through this, so the
  // refused answer is struck from the checkpoints before the error travels.
  const rejecting = <T>(stage: ReviewStage, judge: () => T): T => {
    try {
      return judge();
    } catch (error) {
      input.invalidate?.(stage, error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  // S0: everything deterministic, before any model is involved.
  //
  // Symbols were the one path family the model saw unqualified. It reads the
  // worktree, where the file lives under the repository's slug, and a real
  // model reports the path it actually opened: the first live run answered
  // "shared-core/types.ts" against an expectation of "types.ts", perfectly
  // correct in substance and refused on spelling. Qualified here, in one
  // place, so the prompt, the expectation and the reconciliation all speak
  // the worktree's language like every other path in the pipeline. Callers
  // that pass symbols with no linked repository checked out get them
  // verbatim, since there is no slug to speak of.
  const linkedSlug = input.files.find((entry) => entry.repo === "linked")?.slug;
  const qualifiedSymbols =
    input.changedSymbols === undefined
      ? undefined
      : input.changedSymbols.map((symbol) =>
          linkedSlug === undefined
            ? symbol
            : { ...symbol, path: qualified(linkedSlug, symbol.path) },
        );

  const sweepOutcome = runSweeps(
    input.files.map((entry) => ({ repo: entry.repo, file: entry.file })),
    input.rules,
  );
  // A partial sweep finds fewer hits, and fewer hits looks like cleaner code.
  // Run on every entry, resumed or not: it is the check on the sweep itself,
  // and skipping it would let a resumed run proceed on an unverified sweep.
  assertSweepComplete(sweepOutcome);
  const sweepHitRows = sweepOutcome.hits.map((hit) => {
    const entry = input.files.find((f) => f.file.path === hit.path && f.repo === hit.repo);
    return { ...hit, path: qualified(entry?.slug ?? "", hit.path) };
  });

  // Seeded once per review, not once per run. The inventory is derived from
  // commits that cannot move, so a resumed run would insert a second identical
  // set of rows, and every count the coverage report makes would then be
  // double what the change set actually contains. Existing rows are the same
  // rows this would have written, and the dispositions already recorded
  // against them are the ones being resumed. The files, hunks and hits go in
  // together (4.16): a seed that stopped part way would otherwise stand.
  const alreadySeeded = listLedgerFiles(db, reviewId).length > 0;

  const ledgerFiles = alreadySeeded
    ? listLedgerFiles(db, reviewId)
    : seedLedger(
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
        sweepHitRows,
      );

  // Over frozen commits, a frozen ruleset and a diff taken the same way every
  // time (D-110), the sweep finds the same hits on every run. A resumed
  // ledger holding a different number was seeded in part, before seeding
  // was one transaction, or by a version of the app that read the diff
  // differently. Either way its hits are not this run's, and ones never
  // dispositioned would leave the review reading as a clean sweep.
  if (alreadySeeded) {
    const stored = listSweepHits(db, reviewId).length;
    if (stored !== sweepHitRows.length) {
      throw new Error(
        `This review's ledger holds ${stored} sweep hit(s) where the sweep finds ` +
          `${sweepHitRows.length}: it was seeded only in part, or by a version of the app ` +
          `that read the change differently. Start the review again rather than resume it.`,
      );
    }
  }

  if (!alreadySeeded && sweepOutcome.ranAsLiteral.length > 0) {
    appendRunNote(db, reviewId, {
      kind: "note",
      message:
        `${sweepOutcome.ranAsLiteral.length} sweep pattern(s) are not valid regular ` +
        `expressions and ran as literal text: ` +
        sweepOutcome.ranAsLiteral
          .map((entry) => `${entry.ruleCode} (${entry.pattern})`)
          .join(", ") +
        `.`,
    });
  }

  // What the review reads only a pointer to is said, not passed over (4.23).
  // Written on the first run only, like the note above.
  if (!alreadySeeded) {
    const opaque = opaqueChanges(
      input.files.map((entry) => ({ ...entry.file, path: qualified(entry.slug, entry.file.path) })),
    );
    if (opaque.submodules.length > 0) {
      appendRunNote(db, reviewId, {
        kind: "note",
        message:
          `${opaque.submodules.length} submodule pointer(s) moved: ` +
          `${opaque.submodules.join(", ")}. The code they point to is another repository's ` +
          `and was not reviewed.`,
      });
    }
    if (opaque.lfsPointers.length > 0) {
      appendRunNote(db, reviewId, {
        kind: "note",
        message:
          `${opaque.lfsPointers.length} file(s) are or were Git LFS pointers: ` +
          `${opaque.lfsPointers.join(", ")}. The content they point to is stored outside ` +
          `the repository and was not reviewed.`,
      });
    }
  }

  const content: StageContentInput = {
    files: input.files,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
    sweepHits: listSweepHits(db, reviewId).map((hit) => ({
      path: hit.path,
      line: hit.line,
      ruleCode: hit.ruleCode,
      pattern: hit.pattern,
      excerpt: hit.excerpt,
    })),
    ...(qualifiedSymbols === undefined ? {} : { changedSymbols: qualifiedSymbols }),
    ...(input.baseContents === undefined ? {} : { baseContents: input.baseContents }),
  };

  // S1: risk classification.
  const riskResponse = await input.run({
    stage: "s1_risk",
    systemPrompt: input.systemPromptFor("s1_risk"),
    prompt: renderRiskPrompt(content),
  });
  const risk = rejecting("s1_risk", () => riskStageSchema.parse(riskResponse.output));
  for (const entry of risk.files) {
    const ledgerFile = ledgerFiles.find((file) => file.path === entry.path);
    if (ledgerFile) setFileRiskTags(db, ledgerFile.id, entry.riskTags);
  }

  // 03 asks for the highest-risk files first, and S1 has always produced the
  // tags for it. This is where they are read back.
  //
  // Read from the ledger rather than from the answer in memory: that is what
  // makes the column load-bearing rather than merely written, and a resumed
  // run whose S1 was replayed gets the same order from the same rows.
  //
  // Ranked against `content.files`, never against the ledger's row order:
  // `listLedgerFiles` is a bare select with no ORDER BY, so ranking its
  // output would quietly move the equal-risk tie-break from the deterministic
  // inventory order to whatever order SQLite happened to return.
  const tagsByPath = new Map(
    listLedgerFiles(db, reviewId).map((file) => [file.path, getFileRiskTags(file)] as const),
  );
  const riskOrder = riskOrderedPaths(
    content.files.map((entry) => ({
      path: qualified(entry.slug, entry.file.path),
      riskTags: tagsByPath.get(qualified(entry.slug, entry.file.path)) ?? [],
    })),
  );
  const ordered: StageContentInput = {
    ...content,
    files: [...content.files].sort(
      byRiskOrder(riskOrder, (entry) => qualified(entry.slug, entry.file.path)),
    ),
  };
  const orderedLedgerFiles = [...ledgerFiles].sort(byRiskOrder(riskOrder, (file) => file.path));

  const tagged = content.files
    .map((entry) => ({
      path: qualified(entry.slug, entry.file.path),
      tags: tagsByPath.get(qualified(entry.slug, entry.file.path)) ?? [],
    }))
    .filter((entry) => entry.tags.length > 0);
  if (tagged.length > 0) {
    appendRunNote(db, reviewId, {
      kind: "note",
      message:
        `Worked ${tagged.length} risk-tagged file(s) first: ` +
        tagged
          .slice(0, 5)
          .map((entry) => `${entry.path} (${[...new Set(entry.tags)].join(", ")})`)
          .join("; "),
    });
  }

  // S2: comprehension. Findings are forbidden here by the prompt; the schema
  // has nowhere to put them, so one cannot arrive by accident either.
  const comprehensionResponse = await input.run({
    stage: "s2_comprehension",
    systemPrompt: input.systemPromptFor("s2_comprehension"),
    prompt: renderComprehensionPrompt(ordered),
  });
  const comprehension = rejecting("s2_comprehension", () =>
    comprehensionStageSchema.parse(comprehensionResponse.output),
  );
  for (const entry of comprehension.files) {
    const ledgerFile = ledgerFiles.find((file) => file.path === entry.path);
    if (ledgerFile) setChainFilesRead(db, ledgerFile.id, entry.chainFilesRead);
  }

  // S3: the adversarial pass. How it is divided depends on the model; what it
  // must account for does not.
  const adversarial = await runAdversarialStage(input, ordered, orderedLedgerFiles);

  const expectedHunks: HunkRef[] = ledgerFiles.flatMap((file) =>
    listHunks(db, file.id).map((hunk) => ({ path: file.path, hunkIndex: hunk.hunkIndex })),
  );
  const expectedSweeps: SweepRef[] = listSweepHits(db, reviewId).map((hit) => ({
    path: hit.path,
    line: hit.line,
    ruleCode: hit.ruleCode,
  }));

  const findingHunks: HunkRef[] = adversarial.findings.flatMap((finding) =>
    hunksCoveredBy(finding, ledgerFiles, db),
  );

  const expectedSymbols: SymbolRef[] = (qualifiedSymbols ?? []).map((symbol) => ({
    symbol: symbol.name,
    path: symbol.path,
  }));

  rejecting("s3_adversarial", () => {
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
  });

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
    const alsoCleared = adversarial.clearedHunks.find(
      (cleared) => cleared.path === hunkRef.path && cleared.hunkIndex === hunkRef.hunkIndex,
    );
    if (hunk) markHunkHasFindings(db, hunk.id, alsoCleared?.reason ?? null);
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
    const match = findingAt(candidates, disposition.path, disposition.line);
    if (!match) {
      const unmatched = new SweepDispositionUnmatchedError(
        disposition.path,
        disposition.line,
        disposition.ruleCode,
      );
      input.invalidate?.("s3_adversarial", unmatched.message);
      throw unmatched;
    }
    attachSweepHitToFinding(db, row.id, match.id);
  }

  // S4: deletions, which is where regressions hide.
  const deletionsResponse = await input.run({
    stage: "s4_deletions",
    systemPrompt: input.systemPromptFor("s4_deletions"),
    prompt: renderDeletionPrompt(ordered),
  });
  const readRuleCode = ruleCodeReader(input.rules.map((rule) => rule.code));
  const deletions = rejecting("s4_deletions", () => {
    const parsed = deletionStageSchema.parse(deletionsResponse.output);
    // Both directions, like every other stage: something removed and never
    // mentioned means the stage skipped it, and something mentioned that was
    // never removed means it is describing a change set that does not exist.
    assertDeletionsReconciled(
      reconcileDeletions(
        input.files
          .filter(isDeletionCandidate)
          .map((entry) => qualified(entry.slug, entry.file.path)),
        parsed.reviewedDeletions.map((entry) => entry.path),
      ),
    );
    const repoSlugs = repositoriesOf(input).map((repository) => repository.slug);
    for (const finding of parsed.findings) assertNamesRepoFile(finding.path, repoSlugs);
    return {
      ...parsed,
      findings: parsed.findings.map((finding) => ({
        ...finding,
        ruleCode: readRuleCode(finding.ruleCode),
      })),
    };
  });

  // A modification removes lines as well as adding them, so the deletions
  // stage reads the removed half of a change the adversarial stage has
  // already reported and raises it again in different words. Both live runs
  // of the seeded fixture did exactly this: nine defects arrived as eighteen
  // candidates, each one twice, and the person deciding them would have
  // decided every finding in the review twice (D-59).
  //
  // The match is deliberately narrow: same file, same named rule, and line
  // ranges that overlap. Folding on position alone would merge two genuinely
  // different findings that happen to cite one line, and losing a real
  // finding silently is the one failure this pipeline exists to prevent.
  // A duplicate that survives because the two stages spelled the rule
  // differently is visible noise; a fold that ate a finding is not.
  //
  // A finding that names no rule is never folded. Two such findings at one
  // line are indistinguishable to this code, so folding them would be a
  // guess, and the direction to guess in is the one that keeps both.
  const foldedIntoEarlier: string[] = [];
  for (const finding of deletions.findings) {
    const alreadyRaised =
      finding.ruleCode === null
        ? undefined
        : candidates.find(
            (existing) =>
              existing.filePath === finding.path &&
              existing.ruleCode === finding.ruleCode &&
              existing.lineStart <= finding.lineEnd &&
              finding.lineStart <= existing.lineEnd,
          );
    if (alreadyRaised) {
      foldedIntoEarlier.push(`${finding.path}:${finding.lineStart}`);
      continue;
    }
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

  // Counted on the review rather than folded away in silence: how often the
  // deletions stage repeats itself is the measurement of whether its prompt
  // is scoped correctly, and a silent fold would erase the evidence.
  //
  // Written on the first run only, like the sweep's note above: a resume
  // replays the same stage answers and would append the same line again.
  if (!alreadySeeded && foldedIntoEarlier.length > 0) {
    appendRunNote(db, reviewId, {
      kind: "note",
      message:
        `The deletions stage raised ${foldedIntoEarlier.length} finding(s) the adversarial ` +
        `stage had already reported, folded into the earlier one: ` +
        `${foldedIntoEarlier.join(", ")}.`,
    });
  }

  // A file closes when the stages that owed an account of it have given one:
  // its hunks are all dispositioned, and if it removed anything or moved away
  // from a path, the deletion stage named it.
  //
  // Closing every file unconditionally would make the audit's changed-files
  // check unfalsifiable: `pendingFiles` could never be anything but zero, so
  // the one invariant that catches a whole deleted file going unreviewed
  // would always pass.
  const accountedDeletions = new Set(deletions.reviewedDeletions.map((entry) => entry.path));
  const removes = new Set(
    input.files.filter(isDeletionCandidate).map((entry) => qualified(entry.slug, entry.file.path)),
  );
  for (const file of ledgerFiles) {
    const hunksSettled = listHunks(db, file.id).every((hunk) => hunk.status !== "pending");
    const deletionSettled = !removes.has(file.path) || accountedDeletions.has(file.path);
    // A file with no hunks and nothing removed is a binary blob or a mode
    // change: there is no text for a reader to account for, so nothing is owed.
    if (hunksSettled && deletionSettled) markFileReviewed(db, file.id);
  }

  // S5: verification, in a fresh session with no access to the reasoning that
  // produced the candidates.
  const verificationResponse = await input.run({
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
      // The verifier reads only the worktree, which a deleted file has left
      // (D-106), so each one cited comes with it, once.
      Object.fromEntries(
        [...new Set(candidates.map((finding) => finding.filePath))].flatMap((path) => {
          const before = input.baseContents?.get(path);
          return before === undefined ? [] : [[path, numberedLines(before)]];
        }),
      ),
    ),
  });
  const verification = rejecting("s5_verification", () => {
    const parsed = verificationStageSchema.parse(verificationResponse.output);
    assertVerdictsMatch(parsed.verdicts, candidates.length);
    return parsed;
  });

  let verified = 0;
  let killed = 0;
  let openQuestions = 0;
  let killedByQuoteCheck = 0;

  for (const verdict of verification.verdicts) {
    const finding = candidates[indexOfRef(verdict.ref)];
    if (!finding) continue;

    if (verdict.verdict === "killed") {
      markKilled(db, finding.id, verdict.note || "Refuted during verification.", "verification");
      killed += 1;
      continue;
    }
    if (verdict.verdict === "open_question") {
      markOpenQuestion(db, finding.id, verdict.note || "Could not be settled from the code.");
      openQuestions += 1;
      continue;
    }

    // The verifier may correct where the code sits, but not move the finding
    // onto other code: a true quotation of lines the finding is not about
    // verified it, and the finding then moved to them (D-99).
    if (!rangesOverlap(finding, verdict)) {
      markKilled(
        db,
        finding.id,
        `Verification quoted ${spanOf(verdict)}, which does not overlap the cited ` +
          `${spanOf(finding)}.`,
        "quote_check",
      );
      killed += 1;
      killedByQuoteCheck += 1;
      continue;
    }

    // The verifier says it confirmed the finding. The program now checks that
    // claim against the file, because a citation that does not match the code
    // is not evidence, however confident the wording.
    // A deleted file is checked against what it held, the only copy there is:
    // read from the worktree, every finding in one was killed as unreadable
    // (D-106).
    const contents =
      input.baseContents?.get(finding.filePath) ??
      (await readFileIfPossible(input.worktreeRoot, finding.filePath));
    if (contents === null) {
      markKilled(
        db,
        finding.id,
        `The cited file could not be read: ${finding.filePath}`,
        "quote_check",
      );
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
        "quote_check",
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

  const readRuleCode = ruleCodeReader(input.rules.map((rule) => rule.code));

  const merged: AdversarialStageOutput = {
    findings: [],
    clearedHunks: [],
    sweepDispositions: [],
    symbolDispositions: [],
  };
  let requestCount = 0;

  // Every request planned before the first one is sent, because a prompt that
  // says "request 2 of 5" has to know the 5. It said "of 0" instead, which is
  // falsy, so the line the prompt was written to carry has never once
  // rendered and no batched model has been told it was one of several.
  const planned = plan.batches.map((batch) => ({
    batch,
    groups: splitBatchToFit(
      input,
      content,
      input.systemPromptFor("s3_adversarial", { rules: batch.rules }),
      batch.files,
    ),
  }));
  const totalRequests = planned.reduce((count, entry) => count + entry.groups.length, 0);

  for (const [index, { batch, groups }] of planned.entries()) {
    const systemPrompt = input.systemPromptFor("s3_adversarial", { rules: batch.rules });

    for (const group of groups) {
      requestCount += 1;
      const response = await input.run({
        stage: "s3_adversarial",
        systemPrompt,
        prompt: renderAdversarialPrompt(content, {
          files: group,
          ...(batch.theme === undefined ? {} : { theme: batch.theme }),
          batchNumber: requestCount,
          batchCount: totalRequests,
        }),
        // Carried so the runner can say which request is in flight. A stage
        // that makes nine requests looked identical to one that makes one,
        // for as long as it took.
        batchNumber: requestCount,
        batchCount: totalRequests,
      });

      let parsed: AdversarialStageOutput;
      try {
        parsed = adversarialStageSchema.parse(response.output);
      } catch (error) {
        input.invalidate?.(
          "s3_adversarial",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      // Rule codes are read back to the ruleset's own spelling here, at the
      // edge where a model's answer enters. A disposition's code is compared
      // against a sweep hit's, which came from the ruleset, so "Rule 3"
      // against "3" fails reconciliation and stops the run.
      merged.findings.push(
        ...parsed.findings.map((finding) => ({
          ...finding,
          ruleCode: readRuleCode(finding.ruleCode),
        })),
      );
      merged.clearedHunks.push(...parsed.clearedHunks);
      merged.sweepDispositions.push(
        ...parsed.sweepDispositions.map((disposition) => ({
          ...disposition,
          // Never null for a disposition: the schema requires the string.
          ruleCode: readRuleCode(disposition.ruleCode) ?? disposition.ruleCode,
        })),
      );
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
    // faces the quotation check like any other finding. Paths match exactly:
    // a symbol's path is qualified like every other, and matching on how a
    // path ends let the primary's own orders.ts back a change to the
    // dependency's (4.23).
    const cited = new Set([disposition.path, ...disposition.consumersChecked]);
    const backed = output.findings.some((finding) => cited.has(finding.path));
    if (!backed) {
      problems.push(
        `${disposition.symbol} was reported as producing a finding, but no finding cites ` +
          `${disposition.path} or any consumer named alongside it`,
      );
    }
  }

  if (problems.length > 0) throw new SymbolVerdictUnbackedError(problems);
}

export class VerdictsMismatchError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `The verification stage's verdicts do not match the candidates it was asked about: ` +
        `${problems.join("; ")}. A candidate takes one verdict, so the answer is ` +
        `refused.`,
    );
    this.name = "VerdictsMismatchError";
  }
}

/**
 * No candidate is given two verdicts. The second was applied as a second
 * state change and threw outside the checks that strike a refused answer, so
 * every resume replayed it (4.17). A verdict for no candidate is left aside
 * as before: its candidate goes to the person as an open question.
 */
function assertVerdictsMatch(verdicts: readonly { ref: string }[], candidateCount: number): void {
  const problems: string[] = [];
  const named = new Map<number, string>();
  for (const verdict of verdicts) {
    const index = indexOfRef(verdict.ref);
    if (index < 0 || index >= candidateCount) continue;
    const earlier = named.get(index);
    if (earlier !== undefined) {
      problems.push(
        `${refFor(index)} was given more than one verdict (as ${earlier} and ${verdict.ref})`,
      );
      continue;
    }
    named.set(index, verdict.ref);
  }
  if (problems.length > 0) throw new VerdictsMismatchError(problems);
}

export class FindingPathError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(
      `The deletions stage raised a finding at ${JSON.stringify(path)}, which ${reason}. ` +
        `A finding must name a file in one of this review's repositories, so the answer is refused.`,
    );
    this.name = "FindingPathError";
  }
}

/**
 * Refuses a deletion finding whose path cannot name a file in this review
 * (D-98), before verification spends anything on it.
 *
 * Not refused for lying outside the change set: who depended on the removed
 * code is what the stage looks for, and that caller is usually a file the
 * change never touched.
 */
function assertNamesRepoFile(path: string, repoSlugs: readonly string[]): void {
  const unsafe = unsafeRepoPathReason(path);
  if (unsafe !== null) throw new FindingPathError(path, unsafe);
  const [slug, ...rest] = path.split("/");
  if (!repoSlugs.includes(slug ?? "")) {
    throw new FindingPathError(
      path,
      `is not in any repository of this review (${repoSlugs.join(", ")})`,
    );
  }
  if (rest.length === 0) throw new FindingPathError(path, "names no file inside it");
}

export class SweepDispositionUnmatchedError extends Error {
  constructor(
    readonly path: string,
    readonly line: number,
    readonly ruleCode: string,
  ) {
    super(
      `The adversarial stage said the sweep hit at ${path}:${line} (rule ${ruleCode}) became a ` +
        `finding, but raised no finding whose lines include it. A hit recorded against a ` +
        `finding about other code reads as handled when nothing looked at it, ` +
        `so the run stops rather than storing it.`,
    );
    this.name = "SweepDispositionUnmatchedError";
  }
}

/**
 * The finding a sweep hit belongs to: the first whose line range contains it.
 *
 * Only containment counts (D-96). The nearest finding by line used to do, so
 * a finding about other code marked a hit handled that nothing had examined.
 */
function findingAt(
  candidates: readonly { id: string; filePath: string; lineStart: number; lineEnd: number }[],
  path: string,
  line: number,
): { id: string } | undefined {
  return candidates.find((finding) => finding.filePath === path && citesLine(finding, line));
}

function spanOf(range: { lineStart: number; lineEnd: number }): string {
  return range.lineStart === range.lineEnd
    ? `line ${range.lineStart}`
    : `lines ${range.lineStart} to ${range.lineEnd}`;
}

function repositoriesOf(input: PipelineInput): readonly { slug: string; repo: RepoRole }[] {
  if (input.repositories) return input.repositories;
  const bySlug = new Map(input.files.map((entry) => [entry.slug, entry.repo]));
  return [...bySlug].map(([slug, repo]) => ({ slug, repo }));
}

function repoOf(path: string, input: PipelineInput): RepoRole {
  const slug = path.split("/")[0];
  return repositoriesOf(input).find((repository) => repository.slug === slug)?.repo ?? "primary";
}

/**
 * The hunks a finding accounts for: those its first or last cited line falls
 * in (D-96, D-101).
 *
 * A finding elsewhere in a changed file is kept, since unchanged code can
 * break with the change, but it accounts for no hunk. It used to stand in for
 * the file's first hunk, so a stage could account for code it never looked at.
 */
function hunksCoveredBy(
  finding: { path: string; lineStart: number; lineEnd: number },
  ledgerFiles: readonly { id: string; path: string }[],
  db: Db,
): HunkRef[] {
  const ledgerFile = ledgerFiles.find((file) => file.path === finding.path);
  // Reported against a hunk that does not exist, so reconciliation refuses
  // the answer as describing a file outside the change set.
  if (!ledgerFile) return [{ path: finding.path, hunkIndex: 0 }];
  return listHunks(db, ledgerFile.id)
    .filter((hunk) => citesHunk(finding, hunk))
    .map((hunk) => ({ path: finding.path, hunkIndex: hunk.hunkIndex }));
}

async function readFileIfPossible(root: string, qualifiedPath: string): Promise<string | null> {
  try {
    // A path a model named is contained like one from a diff: one that leaves
    // the worktree reads as unreadable, and the finding citing it is killed.
    // By where it really is, and read from there: a link the change
    // committed passes the text check and led the read wherever it pointed,
    // as it did the context route's (D-142, D-143; D-181 item 1).
    const [target, realRoot] = await Promise.all([
      realPath(insideRoot(root, qualifiedPath)),
      realPath(root),
    ]);
    if (target !== realRoot && !target.startsWith(realRoot + sep)) return null;
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}
