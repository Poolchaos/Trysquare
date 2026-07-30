/**
 * Finding persistence.
 *
 * Two rules live here. A finding's status changes only through
 * `transitionFinding`, and only a human call site may confirm or dismiss one:
 * `confirmFinding` and `dismissFinding` are the only paths to a report, which
 * is what "the human is the done-gatekeeper" means in code.
 */

import { and, eq, inArray } from "drizzle-orm";
import { newId, nowIso } from "@/lib/ids";
import type { RepoRole, Severity } from "@/lib/domain/enums";
import {
  type FindingStatus,
  assertFindingTransition,
  findingStatusSchema,
} from "@/lib/domain/state-machines";
import type { Db } from "../client";
import { findings } from "../schema";

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
    severity: input.severity,
    ruleCode: input.ruleCode ?? null,
    issue: input.issue,
    comment: input.comment,
    mechanism: input.mechanism,
    quotedCode: "",
    status: "candidate" satisfies FindingStatus,
    verificationNote: null,
    dismissReason: null,
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
  dismissReason?: string | null;
  lineStart?: number;
  lineEnd?: number;
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
  evidence: { quotedCode: string; lineStart: number; lineEnd: number; note?: string },
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
  });
}

/** Verification refuted it, or the quoted code did not match the file. */
export function markKilled(db: Db, findingId: string, reason: string): Finding {
  return transitionFinding(db, findingId, "killed", { verificationNote: reason });
}

/** Verification could neither confirm nor refute. Surfaced to the user as a question. */
export function markOpenQuestion(db: Db, findingId: string, whatWouldResolveIt: string): Finding {
  return transitionFinding(db, findingId, "open_question", {
    verificationNote: whatWouldResolveIt,
  });
}

/** Human decision. The only route into a report. */
export function confirmFinding(db: Db, findingId: string): Finding {
  return transitionFinding(db, findingId, "confirmed");
}

/** Human decision. The reason is kept: dismissals are evidence about the engine. */
export function dismissFinding(db: Db, findingId: string, reason: string): Finding {
  if (reason.trim() === "") {
    throw new Error("A dismissal needs a reason: it is the record of why this was not a problem.");
  }
  return transitionFinding(db, findingId, "dismissed", { dismissReason: reason });
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

/** What the report contains. Nothing else may appear in it. */
export function listConfirmed(db: Db, reviewId: string): Finding[] {
  return listFindingsByStatus(db, reviewId, ["confirmed"]);
}

/** Candidates still awaiting a verdict. Non-empty past S5 is a pipeline bug. */
export function listUnresolvedCandidates(db: Db, reviewId: string): Finding[] {
  return listFindingsByStatus(db, reviewId, ["candidate"]);
}
