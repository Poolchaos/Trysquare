/**
 * The two state machines the review pipeline turns on, as pure data.
 *
 * These are here rather than in the repositories because they are the rules,
 * not the storage: a transition is legal or it is not, regardless of what is
 * writing it. Repositories call `assert*Transition` before every status write
 * so there is exactly one place a status can change, and no ad hoc updates.
 */

import { z } from "zod";
import type { CloneStatus } from "./enums";

export const REVIEW_STATUSES = [
  "draft",
  "running",
  "verifying",
  "awaiting_confirmation",
  "complete",
  "paused_limit",
  "interrupted",
  "failed",
  "cancelled",
] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/** Statuses where stages are executing and a subprocess may be alive. */
export const ACTIVE_REVIEW_STATUSES = ["running", "verifying"] as const;

/**
 * Statuses that can be resumed rather than restarted.
 *
 * A failure joins the pause and the interruption because the recovery is the
 * same one: every stage already answered replays from its checkpoint and only
 * the stage that broke runs again. The alternative, a per-stage retry, would
 * be a second recovery path exercised a tenth as often.
 */
export const RESUMABLE_REVIEW_STATUSES = ["paused_limit", "interrupted", "failed"] as const;

export function isResumableReview(status: ReviewStatus): boolean {
  return (RESUMABLE_REVIEW_STATUSES as readonly ReviewStatus[]).includes(status);
}

/**
 * Interruptions reachable from any active status: a rate limit pause, a
 * process or host death, a fault, or the user cancelling.
 */
const INTERRUPTIONS = ["paused_limit", "interrupted", "failed", "cancelled"] as const;

const REVIEW_TRANSITIONS: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = {
  draft: ["running", "cancelled"],
  running: ["verifying", ...INTERRUPTIONS],
  verifying: ["awaiting_confirmation", ...INTERRUPTIONS],
  // Findings are on the table and the user is deciding. Nothing is executing,
  // so this cannot be interrupted, only finished or abandoned.
  awaiting_confirmation: ["complete", "cancelled"],
  // Resuming re-enters `running`; which stage to resume is carried by
  // currentStage, so the status does not need to encode it.
  paused_limit: ["running", "failed", "cancelled"],
  interrupted: ["running", "failed", "cancelled"],
  complete: [],
  // Resumable, like a pause or an interruption. Every stage already answered
  // replays from its checkpoint, so retrying costs only the stage that broke.
  // Recovery is by resuming the review rather than retrying one stage: the
  // pipeline has no way to re-enter partway through a stage anyway, and one
  // mechanism that is exercised often beats two that are not (D-50).
  failed: ["running"],
  cancelled: [],
};

/**
 * A clone goes pending, cloning, then ready or failed, and a failed one can be
 * retried.
 *
 * The other two machines in this file are enforced and this one was not:
 * `setCloneStatus` wrote whatever it was handed, so `cloning` was declared in
 * the enum and never actually reached, and nothing would have caught a ready
 * clone being moved back to pending.
 */
const CLONE_TRANSITIONS: Readonly<Record<CloneStatus, readonly CloneStatus[]>> = {
  pending: ["cloning", "ready", "failed"],
  cloning: ["ready", "failed"],
  ready: [],
  failed: ["pending", "cloning"],
};

export function canTransitionClone(from: CloneStatus, to: CloneStatus): boolean {
  return (CLONE_TRANSITIONS[from] ?? []).includes(to);
}

export class InvalidCloneTransitionError extends Error {
  constructor(
    readonly from: CloneStatus,
    readonly to: CloneStatus,
  ) {
    super(`A clone cannot go from ${from} to ${to}.`);
    this.name = "InvalidCloneTransitionError";
  }
}

export function assertCloneTransition(from: CloneStatus, to: CloneStatus): void {
  if (!canTransitionClone(from, to)) throw new InvalidCloneTransitionError(from, to);
}

export const FINDING_STATUSES = [
  "candidate",
  "verified",
  "killed",
  "open_question",
  "confirmed",
  "dismissed",
] as const;
export const findingStatusSchema = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

const FINDING_TRANSITIONS: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  // Set by the verification stage, which runs in a fresh session.
  candidate: ["verified", "killed", "open_question"],
  // Only a human moves a finding into or out of a report.
  verified: ["confirmed", "dismissed"],
  open_question: ["confirmed", "dismissed"],
  // Killed findings are kept rather than deleted: they are the measurement of
  // how often the engine invents things, which is worth knowing.
  killed: [],
  confirmed: [],
  dismissed: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly entity: "review" | "finding",
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[],
  ) {
    super(
      allowed.length === 0
        ? `A ${entity} in "${from}" is final and cannot become "${to}".`
        : `A ${entity} cannot go from "${from}" to "${to}". Allowed: ${allowed.join(", ")}.`,
    );
    this.name = "IllegalTransitionError";
  }
}

export function reviewTransitionsFrom(from: ReviewStatus): readonly ReviewStatus[] {
  return REVIEW_TRANSITIONS[from];
}

export function canTransitionReview(from: ReviewStatus, to: ReviewStatus): boolean {
  return REVIEW_TRANSITIONS[from].includes(to);
}

export function assertReviewTransition(from: ReviewStatus, to: ReviewStatus): void {
  if (!canTransitionReview(from, to)) {
    throw new IllegalTransitionError("review", from, to, REVIEW_TRANSITIONS[from]);
  }
}

export function findingTransitionsFrom(from: FindingStatus): readonly FindingStatus[] {
  return FINDING_TRANSITIONS[from];
}

export function canTransitionFinding(from: FindingStatus, to: FindingStatus): boolean {
  return FINDING_TRANSITIONS[from].includes(to);
}

export function assertFindingTransition(from: FindingStatus, to: FindingStatus): void {
  if (!canTransitionFinding(from, to)) {
    throw new IllegalTransitionError("finding", from, to, FINDING_TRANSITIONS[from]);
  }
}

export function isTerminalReviewStatus(status: ReviewStatus): boolean {
  return REVIEW_TRANSITIONS[status].length === 0;
}

export function isTerminalFindingStatus(status: FindingStatus): boolean {
  return FINDING_TRANSITIONS[status].length === 0;
}

/** Only these reach the report, and only a human puts them there. */
export function isReportableFindingStatus(status: FindingStatus): boolean {
  return status === "confirmed";
}
