/**
 * Which profile a review runs under, given the model it runs on.
 *
 * A profile decides how the adversarial work is divided into requests, never
 * how much of the protocol is applied (docs/06 section 3). That is why a
 * downgrade is allowed and an upgrade is not: dividing the work more finely
 * than the model needs costs requests, while dividing it less finely than the
 * model can absorb quietly hands a weak model more than it can hold, and the
 * failure looks like a clean review rather than an error.
 *
 * Pure: no database, no registry lookup. The caller supplies what the model's
 * registry entry says and this decides what follows from it.
 */

import { REVIEW_PROFILES, type ReviewProfile } from "@/lib/domain/enums";

/**
 * Strength order, strongest first.
 *
 * This reads the enum's own order rather than restating it, so the two cannot
 * disagree. The order is therefore load-bearing: `REVIEW_PROFILES` is sorted
 * by how much of the protocol a model can absorb at once, and reordering it
 * changes which overrides are accepted.
 */
export function profileRank(profile: ReviewProfile): number {
  return REVIEW_PROFILES.indexOf(profile);
}

/** Whether a profile can carry the stages that ask a model for judgment. */
export function isJudgmentProfile(profile: ReviewProfile): boolean {
  return profile !== "mechanical-only";
}

export type ProfileResolution =
  | { ok: true; profile: ReviewProfile; downgradedFrom: ReviewProfile | null }
  | { ok: false; code: "ProfileNotForJudgment" | "ProfileStrongerThanModel"; message: string };

export interface ResolveProfileInput {
  /** What the model's registry entry says it can absorb, if it is registered. */
  modelProfile: ReviewProfile | null;
  /** What the caller asked for. Absent means take the model's own profile. */
  requested?: ReviewProfile | undefined;
  /** For the message only. */
  model: string;
}

/**
 * The profile a review will run under, or the reason it cannot run.
 *
 * An unregistered model resolves to `full-context` because there is nothing
 * to narrow from. That matches how the pipeline treats an unknown context
 * window: it makes one request per batch and lets the model refuse, rather
 * than inventing a limit here. The caller records the assumption as a run
 * note so it is visible rather than inferred from the request count.
 */
export function resolveProfile(input: ResolveProfileInput): ProfileResolution {
  const modelProfile = input.modelProfile ?? "full-context";

  // Checked before any requested profile is considered: a model that cannot
  // judge cannot run a review under any profile, so advice about choosing a
  // weaker one would send the user in a circle. The model is the problem.
  if (!isJudgmentProfile(modelProfile)) {
    return {
      ok: false,
      code: "ProfileNotForJudgment",
      message:
        `${input.model} is registered for mechanical work only, so it cannot run a review. ` +
        "Its stages ask a model to judge code, and this one is not trusted to. " +
        "Pick a model probed for review work.",
    };
  }

  if (input.requested === undefined) {
    return { ok: true, profile: modelProfile, downgradedFrom: null };
  }

  if (!isJudgmentProfile(input.requested)) {
    return {
      ok: false,
      code: "ProfileNotForJudgment",
      message:
        "The mechanical-only profile makes no judgment requests, so a review using it would " +
        "raise no findings and report a clean result. Choose a profile that reviews.",
    };
  }

  if (profileRank(input.requested) < profileRank(modelProfile)) {
    // The suggestion is honest because this branch is only reachable for a
    // judgment-capable model, whose own profile is always an allowed answer.
    return {
      ok: false,
      code: "ProfileStrongerThanModel",
      message:
        `${input.model} is registered for the ${modelProfile} profile, so it cannot run ` +
        `${input.requested}. A stronger profile sends more of the protocol per request than ` +
        "this model is known to hold, and the result would read as a clean review rather " +
        `than as a failure. ${modelProfile} or weaker is allowed.`,
    };
  }

  return {
    ok: true,
    profile: input.requested,
    downgradedFrom: input.requested === modelProfile ? null : modelProfile,
  };
}

/**
 * How a profile divides a model's work, said in the picker so a person
 * choosing a model knows what it will be given (WP-F, D-187). No tokens: the
 * app cannot total them before a run, and a theme-by-theme model reads every
 * file once per theme. `passes` is the pre-flight's, absent before one.
 */
export function whatTheModelGets(profile: ReviewProfile, passes?: number): string | null {
  const count = passes === undefined ? "" : `, ${passes} ${passes === 1 ? "pass" : "passes"}`;
  if (profile === "full-context") return "The whole ruleset in one pass.";
  if (profile === "chunked") return `One pass per rule theme${count}.`;
  if (profile === "decomposed") return `Each file against the rules that apply to it${count}.`;
  return null;
}
