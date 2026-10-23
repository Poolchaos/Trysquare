/**
 * The second, independent verifier: every finding the first verifier proves
 * is proven again on the other strong family (PG-1 (a), D-185), so one
 * model's blind spot is not the review's. Pure, so the server that refuses
 * a Start and the screen that keeps Start off read the same rule.
 */

import type { ModelAvailability } from "./availability";

export function pairedVerifierFor(family: string | undefined): string {
  return family === "opus" ? "claude-fable-5-1" : "claude-opus-5-5";
}

export interface SecondVerifier {
  model: string;
  usable: boolean;
  /** Why it cannot run, finishing "<model> ...", or null when it can. */
  reason: string | null;
}

/** By the probe that vouches for it now, as the picker judges a model. */
export function secondVerifierReadiness(
  model: string,
  availability: ModelAvailability | undefined,
): SecondVerifier {
  const reason =
    availability === "available"
      ? null
      : availability === "stale"
        ? "was probed too long ago to be vouched for now"
        : availability === "unavailable"
          ? "did not answer its last probe"
          : "has not been probed";
  return { model, usable: reason === null, reason };
}

export function secondVerifierRefusal(verifier: SecondVerifier): string {
  return (
    `Every verified finding is checked again by ${verifier.model}, which ${verifier.reason}. ` +
    "Probe it, then start again."
  );
}
