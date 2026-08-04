/**
 * Every closed set of values the domain uses, with a matching zod schema.
 *
 * These live in `lib` so that the database schema, the API boundary, and the
 * UI all narrow against one definition rather than three copies that drift.
 */

import { z } from "zod";

/** A review can span two repositories; every path is tagged with which one. */
export const REPO_ROLES = ["primary", "linked"] as const;
export const repoRoleSchema = z.enum(REPO_ROLES);
export type RepoRole = z.infer<typeof repoRoleSchema>;

export const CLONE_STATUSES = ["pending", "cloning", "ready", "failed"] as const;
export const cloneStatusSchema = z.enum(CLONE_STATUSES);
export type CloneStatus = z.infer<typeof cloneStatusSchema>;

/** Rulesets compose across tiers: general rules, stack rules, project rules. */
export const RULESET_TIERS = ["global", "tech", "project"] as const;
export const rulesetTierSchema = z.enum(RULESET_TIERS);
export type RulesetTier = z.infer<typeof rulesetTierSchema>;

/**
 * ERROR in a source protocol maps onto CRITICAL: it is a hard block and
 * carrying two names for one severity only invites inconsistent reporting.
 */
export const SEVERITIES = ["CRITICAL", "WARNING", "NITPICK"] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

/** Non-rule protocol content that is composed into stage prompts verbatim. */
export const DIRECTIVE_SECTIONS = [
  "prime_directive",
  "procedure",
  "scope",
  "philosophy",
  "severity_model",
  "output_format",
  "domain_knowledge",
] as const;
export const directiveSectionSchema = z.enum(DIRECTIVE_SECTIONS);
export type DirectiveSection = z.infer<typeof directiveSectionSchema>;

export const ENGINE_MODES = ["headless", "interactive"] as const;
export const engineModeSchema = z.enum(ENGINE_MODES);
export type EngineMode = z.infer<typeof engineModeSchema>;

/** How much of the protocol a model can absorb per request. See docs/06. */
export const REVIEW_PROFILES = [
  "full-context",
  "chunked",
  "decomposed",
  "mechanical-only",
] as const;
export const reviewProfileSchema = z.enum(REVIEW_PROFILES);
export type ReviewProfile = z.infer<typeof reviewProfileSchema>;

/**
 * How hard the model is asked to think.
 *
 * These four are what the CLI accepts, read from its own validator rather than
 * its help text, which is out of date and omits `max`. There is no tier
 * between high and max. Fixed when a review is created rather than changeable
 * while one runs: a stage answered at one effort and replayed at another would
 * report a thoroughness the answer never had.
 */
export const REVIEW_EFFORTS = ["low", "medium", "high", "max"] as const;
export const reviewEffortSchema = z.enum(REVIEW_EFFORTS);
export type ReviewEffort = z.infer<typeof reviewEffortSchema>;

/**
 * What a person may actually pick.
 *
 * `max` is the CLI's ultracode tier: extra-high reasoning that also lets the
 * session spawn its own workflows and sub-agents. A review here already fans
 * out across five stages and as many batches as the profile calls for, so
 * that tier turns one review into an unbounded amount of someone else's
 * usage, spent unattended, on a subscription this app is a guest on. It stays
 * in the enum because reviews created before this rule still name it and
 * their rows must keep parsing; it is simply never offered, and refused on
 * the way in.
 */
export const SELECTABLE_REVIEW_EFFORTS = REVIEW_EFFORTS.filter(
  (effort) => effort !== "max",
) as readonly ReviewEffort[];

export function isSelectableEffort(effort: ReviewEffort): boolean {
  return SELECTABLE_REVIEW_EFFORTS.includes(effort);
}

/** The AI stages, in execution order. S0 is deterministic and has no row. */
export const REVIEW_STAGES = [
  "s1_risk",
  "s2_comprehension",
  "s3_adversarial",
  "s4_deletions",
  "s5_verification",
  "s6_audit",
] as const;
export const reviewStageSchema = z.enum(REVIEW_STAGES);
export type ReviewStage = z.infer<typeof reviewStageSchema>;

export const STAGE_STATUSES = ["running", "succeeded", "failed", "cancelled"] as const;
export const stageStatusSchema = z.enum(STAGE_STATUSES);
export type StageStatus = z.infer<typeof stageStatusSchema>;

/**
 * Why a stage failed. Recorded so the UI can show the real cause instead of a
 * generic error, and so a limit pause is distinguishable from a real fault.
 */
export const STAGE_ERROR_CLASSES = [
  "spawn",
  "timeout",
  "limit",
  "invalid_output",
  "git",
  "cancelled",
  "unknown",
] as const;
export const stageErrorClassSchema = z.enum(STAGE_ERROR_CLASSES);
export type StageErrorClass = z.infer<typeof stageErrorClassSchema>;

export const CHANGE_TYPES = ["added", "modified", "deleted", "renamed"] as const;
export const changeTypeSchema = z.enum(CHANGE_TYPES);
export type ChangeType = z.infer<typeof changeTypeSchema>;

/** Risk categories from the protocol's classification table. */
export const RISK_TAGS = [
  "money",
  "auth",
  "data_shape",
  "destructive",
  "concurrency",
  "time",
  "shared",
] as const;
export const riskTagSchema = z.enum(RISK_TAGS);
export type RiskTag = z.infer<typeof riskTagSchema>;

/**
 * A hunk ends the review either attached to findings or explicitly cleared.
 * `pending` past the audit stage is a coverage failure, not a warning.
 */
export const HUNK_STATUSES = ["pending", "cleared", "has_findings"] as const;
export const hunkStatusSchema = z.enum(HUNK_STATUSES);
export type HunkStatus = z.infer<typeof hunkStatusSchema>;

export const SWEEP_DISPOSITIONS = ["pending", "cleared", "finding"] as const;
export const sweepDispositionSchema = z.enum(SWEEP_DISPOSITIONS);
export type SweepDisposition = z.infer<typeof sweepDispositionSchema>;
