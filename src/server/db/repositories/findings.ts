/**
 * Finding persistence.
 *
 * Two rules live here. A finding's status changes only through
 * `transitionFinding`, and only a human call site may confirm or dismiss one:
 * `confirmFinding` and `dismissFinding` are the only paths to a report, which
 * is what "the human is the done-gatekeeper" means in code.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { newId, nowIso } from "@/lib/ids";
import type { KillKind, RepoRole, Severity } from "@/lib/domain/enums";
import {
  type FindingStatus,
  assertFindingTransition,
  findingStatusSchema,
} from "@/lib/domain/state-machines";
import type { EvidenceStep } from "@/lib/review/evidence";
import type { Db } from "../client";
import { findings, reviews } from "../schema";

export class FindingNotFoundError extends Error {
  constructor(readonly findingId: string) {
    super(`No finding with id "${findingId}".`);
    this.name = "FindingNotFoundError";
  }
}

export type Finding = typeof findings.$inferSelect;

export interface CreateCandidateInput {
  reviewId: string;
  repo: RepoRole;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: Severity;
  ruleCode?: string | null;
  issue: string;
  comment: string;
  mechanism: string;
}

/** Findings are always born as candidates: nothing enters already verified. */
export function createCandidate(db: Db, input: CreateCandidateInput): Finding {
  const row = {
    id: newId(),
    reviewId: input.reviewId,
    repo: input.repo,
    filePath: input.filePath,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    raisedLineStart: input.lineStart,
    raisedLineEnd: input.lineEnd,
    severity: input.severity,
    raisedSeverity: input.severity,
    ruleCode: input.ruleCode ?? null,
    issue: input.issue,
    comment: input.comment,
    mechanism: input.mechanism,
    quotedCode: "",
    proofJson: null,
    secondProofJson: null,
    status: "candidate" satisfies FindingStatus,
    verificationNote: null,
    killedBy: null,
    dismissReason: null,
    dismissedFrom: null,
    editedComment: null,
    createdAt: nowIso(),
    verifiedAt: null,
    decidedAt: null,
  };
  db.insert(findings).values(row).run();
  return row;
}

export function getFinding(db: Db, findingId: string): Finding | undefined {
  return db.select().from(findings).where(eq(findings.id, findingId)).get();
}

export function requireFinding(db: Db, findingId: string): Finding {
  const finding = getFinding(db, findingId);
  if (!finding) throw new FindingNotFoundError(findingId);
  return finding;
}

export function statusOf(finding: Finding): FindingStatus {
  return findingStatusSchema.parse(finding.status);
}

interface TransitionPatch {
  quotedCode?: string;
  verificationNote?: string | null;
  killedBy?: KillKind;
  dismissReason?: string | null;
  dismissedFrom?: FindingStatus;
  editedComment?: string | null;
  lineStart?: number;
  lineEnd?: number;
  severity?: Severity;
  proofJson?: string;
  secondProofJson?: string;
}

function transitionFinding(
  db: Db,
  findingId: string,
  to: FindingStatus,
  patch: TransitionPatch = {},
): Finding {
  const finding = requireFinding(db, findingId);
  const from = statusOf(finding);
  assertFindingTransition(from, to);

  const now = nowIso();
  const update: Partial<typeof findings.$inferInsert> = { ...patch, status: to };
  if (to === "verified" || to === "killed" || to === "open_question") update.verifiedAt = now;
  if (to === "confirmed" || to === "dismissed") update.decidedAt = now;

  const result = db
    .update(findings)
    .set(update)
    .where(and(eq(findings.id, findingId), eq(findings.status, from)))
    .run();
  if (result.changes === 0) {
    throw new Error(`Finding "${findingId}" changed status concurrently; nothing was overwritten.`);
  }
  return requireFinding(db, findingId);
}

/**
 * Verification succeeded. The quoted code is required: it is what the
 * byte-comparison against the worktree file checks, and a finding without it
 * cannot be proven, which is the whole point of the stage.
 */
export function markVerified(
  db: Db,
  findingId: string,
  evidence: {
    quotedCode: string;
    lineStart: number;
    lineEnd: number;
    note?: string;
    /**
     * The verifier's proof, every step already checked against the code; its
     * severity replaces the finder's, which raisedSeverity keeps (PG-3,
     * D-185). The pipeline always gives one.
     */
    proof?: VerifiedProof;
    /** The second verifier's, which agreed; its severity is shown, not taken (D-188). */
    secondProof?: VerifiedProof;
  },
): Finding {
  if (evidence.quotedCode.trim() === "") {
    throw new Error(
      `Cannot verify finding "${findingId}" with empty quoted code: ` +
        `a verified finding must carry the lines it was checked against.`,
    );
  }
  return transitionFinding(db, findingId, "verified", {
    quotedCode: evidence.quotedCode,
    lineStart: evidence.lineStart,
    lineEnd: evidence.lineEnd,
    verificationNote: evidence.note ?? null,
    ...(evidence.proof === undefined
      ? {}
      : { severity: evidence.proof.severity, proofJson: JSON.stringify(evidence.proof) }),
    ...(evidence.secondProof === undefined
      ? {}
      : { secondProofJson: JSON.stringify(evidence.secondProof) }),
  });
}

export interface VerifiedProof {
  severity: Severity;
  trigger: string;
  evidence: readonly EvidenceStep[];
  guardsSearched: readonly string[];
}

/** Verification refuted it, or the quoted code did not match the file. */
export function markKilled(db: Db, findingId: string, reason: string, by: KillKind): Finding {
  return transitionFinding(db, findingId, "killed", { verificationNote: reason, killedBy: by });
}

/** Verification could neither confirm nor refute. Surfaced to the user as a question. */
export function markOpenQuestion(db: Db, findingId: string, whatWouldResolveIt: string): Finding {
  // Verified again and still unsettled: the status stands, the note is the
  // newer verifier's (WP-D2). Guarded like a transition, so a decision
  // landing meanwhile is not overwritten.
  if (statusOf(requireFinding(db, findingId)) === "open_question") {
    const result = db
      .update(findings)
      .set({ verificationNote: whatWouldResolveIt, verifiedAt: nowIso() })
      .where(and(eq(findings.id, findingId), eq(findings.status, "open_question")))
      .run();
    if (result.changes === 0) {
      throw new Error(
        `Finding "${findingId}" changed status concurrently; nothing was overwritten.`,
      );
    }
    return requireFinding(db, findingId);
  }
  return transitionFinding(db, findingId, "open_question", {
    verificationNote: whatWouldResolveIt,
  });
}

export class ReviewNotDecidingError extends Error {
  constructor(
    readonly reviewId: string,
    readonly status: string,
  ) {
    super(
      `Review "${reviewId}" is ${status.replace(/_/g, " ")}: its findings are decided only while ` +
        "it awaits confirmation.",
    );
    this.name = "ReviewNotDecidingError";
  }
}

/**
 * A person decides findings only while their review waits on one (4.23): a
 * cancelled review's undecided findings could still be confirmed, deciding a
 * review nobody was finishing.
 */
function assertDeciding(db: Db, findingId: string): void {
  const { reviewId } = requireFinding(db, findingId);
  const status =
    db.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, reviewId)).get()
      ?.status ?? "missing";
  if (status !== "awaiting_confirmation") throw new ReviewNotDecidingError(reviewId, status);
}

/**
 * Human decision. The only route into a report.
 *
 * A replacement comment is optional and kept beside the engine's, never over
 * it. The report reads the person's words because they are the ones written
 * for whoever fixes the code; the engine's stay because how well it explained
 * itself is the only measurement of whether the prompts are working, and
 * overwriting them would erase the evidence every edit is a data point in.
 * An empty or unchanged replacement records nothing, so "edited" keeps
 * meaning edited.
 */
export function confirmFinding(
  db: Db,
  findingId: string,
  options: { comment?: string | undefined } = {},
): Finding {
  assertDeciding(db, findingId);
  if (statusOf(requireFinding(db, findingId)) === "open_question") {
    throw new OpenQuestionNotConfirmableError(findingId);
  }
  const replacement = options.comment?.trim() ?? "";
  const original = requireFinding(db, findingId).comment;
  const edited = replacement === "" || replacement === original.trim() ? null : replacement;
  return transitionFinding(db, findingId, "confirmed", { editedComment: edited });
}

/**
 * An open question is a finding verification could not prove, and only proven
 * findings reach the report (PG-2 (a), D-185). Said as such, not as a bare
 * illegal transition, so the person knows what they can do instead.
 */
export class OpenQuestionNotConfirmableError extends Error {
  constructor(readonly findingId: string) {
    super(
      "This finding is an open question: verification could not prove it, so it cannot go " +
        "into the report. Dismiss it, or verify it again.",
    );
    this.name = "OpenQuestionNotConfirmableError";
  }
}

/**
 * Human decision. The reason is kept: dismissing a verified finding is
 * evidence about the engine. So is the status it had, since leaving out an
 * open question rejects nothing (D-190).
 */
export function dismissFinding(db: Db, findingId: string, reason: string): Finding {
  if (reason.trim() === "") {
    throw new Error("A dismissal needs a reason: it is the record of why it was left out.");
  }
  assertDeciding(db, findingId);
  return transitionFinding(db, findingId, "dismissed", {
    dismissReason: reason,
    dismissedFrom: statusOf(requireFinding(db, findingId)),
  });
}

/**
 * Removes every finding for a review.
 *
 * Exists for exactly one caller: the resume path, which recreates findings
 * deterministically by replaying the stored stage answers. Every finding is
 * derived from those answers, so wiping and rebuilding is exact, whereas
 * leaving them would duplicate each one on every resume.
 *
 * It must not be used anywhere else. Discarding findings outside a replay
 * would destroy decisions a human made, which is the one thing this app
 * treats as authoritative.
 */
export function deleteAllForReview(db: Db, reviewId: string): number {
  const result = db.delete(findings).where(eq(findings.reviewId, reviewId)).run();
  return result.changes;
}

export function listFindings(db: Db, reviewId: string): Finding[] {
  return db.select().from(findings).where(eq(findings.reviewId, reviewId)).all();
}

export function listFindingsByStatus(
  db: Db,
  reviewId: string,
  statuses: readonly FindingStatus[],
): Finding[] {
  return db
    .select()
    .from(findings)
    .where(and(eq(findings.reviewId, reviewId), inArray(findings.status, [...statuses])))
    .all();
}

/** What the confirmation screen shows: verified findings plus open questions. */
export function listAwaitingDecision(db: Db, reviewId: string): Finding[] {
  return listFindingsByStatus(db, reviewId, ["verified", "open_question"]);
}

/** Candidates still awaiting a verdict. Non-empty past S5 is a pipeline bug. */
export function listUnresolvedCandidates(db: Db, reviewId: string): Finding[] {
  return listFindingsByStatus(db, reviewId, ["candidate"]);
}

/**
 * What each review actually yielded, in one query rather than one per row.
 *
 * The reviews list showed a status and a timestamp, so a three-hour review
 * that confirmed twelve criticals looked exactly like a cancelled one. These
 * are the numbers that tell them apart.
 *
 * Killed findings are counted here rather than hidden. They are the engine's
 * own error rate, and a list that quietly drops them reports a cleaner
 * history than actually happened.
 */
export interface FindingTally {
  total: number;
  confirmed: number;
  dismissed: number;
  killed: number;
}

export function findingTallies(db: Db): Map<string, FindingTally> {
  const rows = db
    .select({
      reviewId: findings.reviewId,
      status: findings.status,
      count: sql<number>`count(*)`,
    })
    .from(findings)
    .groupBy(findings.reviewId, findings.status)
    .all();

  const tallies = new Map<string, FindingTally>();
  for (const row of rows) {
    const tally = tallies.get(row.reviewId) ?? { total: 0, confirmed: 0, dismissed: 0, killed: 0 };
    tally.total += row.count;
    if (row.status === "confirmed") tally.confirmed += row.count;
    if (row.status === "dismissed") tally.dismissed += row.count;
    if (row.status === "killed") tally.killed += row.count;
    tallies.set(row.reviewId, tally);
  }
  return tallies;
}
