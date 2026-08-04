/**
 * Which profile a review runs under.
 *
 * The rule these pin down is asymmetric on purpose: sending a model less than
 * it can hold costs requests, while sending it more than it can hold produces
 * a review that reads clean because the model quietly lost half the protocol.
 */

import { describe, expect, it } from "vitest";
import { REVIEW_PROFILES } from "@/lib/domain/enums";
import { isJudgmentProfile, profileRank, resolveProfile } from "@/lib/review/profiles";

describe("profile strength", () => {
  it("ranks the enum from most to least of the protocol per request", () => {
    // The comparison reads this order, so a reordering silently changes which
    // overrides are accepted. Stated here so that cannot happen unnoticed.
    expect([...REVIEW_PROFILES]).toEqual([
      "full-context",
      "chunked",
      "decomposed",
      "mechanical-only",
    ]);
    expect(profileRank("full-context")).toBeLessThan(profileRank("chunked"));
    expect(profileRank("chunked")).toBeLessThan(profileRank("decomposed"));
  });

  it("excludes mechanical-only from the profiles that can judge", () => {
    expect(isJudgmentProfile("mechanical-only")).toBe(false);
    expect(REVIEW_PROFILES.filter(isJudgmentProfile)).toHaveLength(3);
  });
});

describe("resolving a review's profile", () => {
  it("takes the model's own profile when nothing is asked for", () => {
    const result = resolveProfile({ model: "claude-sonnet-5", modelProfile: "decomposed" });
    expect(result).toEqual({ ok: true, profile: "decomposed", downgradedFrom: null });
  });

  it("allows a deliberate downgrade and records what it came from", () => {
    const result = resolveProfile({
      model: "claude-fable-5[1m]",
      modelProfile: "full-context",
      requested: "decomposed",
    });
    expect(result).toMatchObject({
      ok: true,
      profile: "decomposed",
      downgradedFrom: "full-context",
    });
  });

  it("refuses a profile stronger than the model is registered for", () => {
    const result = resolveProfile({
      model: "claude-sonnet-5",
      modelProfile: "decomposed",
      requested: "full-context",
    });
    expect(result).toMatchObject({ ok: false, code: "ProfileStrongerThanModel" });
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("claude-sonnet-5");
    expect(result.message).toContain("would read as a clean review");
  });

  it("refuses a mechanical-only model outright", () => {
    // Its batch plan contains no judgment requests at all, so the run would
    // raise nothing and then fail reconciliation with every hunk unaccounted.
    const result = resolveProfile({
      model: "claude-haiku-4-5-20251001",
      modelProfile: "mechanical-only",
    });
    expect(result).toMatchObject({ ok: false, code: "ProfileNotForJudgment" });
  });

  it("does not point at weaker profiles when no weaker profile could ever run", () => {
    // A mechanical-only model refuses every judgment profile, so "pick a
    // weaker profile" was advice whose only destination was another refusal.
    const result = resolveProfile({
      model: "claude-haiku-4-5-20251001",
      modelProfile: "mechanical-only",
      requested: "decomposed",
    });
    expect(result).toMatchObject({ ok: false, code: "ProfileNotForJudgment" });
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("Pick a model");
    expect(result.message).not.toContain("weaker");
  });

  it("refuses mechanical-only even when it is asked for explicitly", () => {
    const result = resolveProfile({
      model: "claude-fable-5[1m]",
      modelProfile: "full-context",
      requested: "mechanical-only",
    });
    expect(result).toMatchObject({ ok: false, code: "ProfileNotForJudgment" });
  });

  it("assumes full-context for a model it does not know, rather than guessing lower", () => {
    // Same stance the pipeline takes on an unknown context window: make one
    // request per batch and let the model refuse, instead of inventing a limit.
    const result = resolveProfile({ model: "something-new", modelProfile: null });
    expect(result).toEqual({ ok: true, profile: "full-context", downgradedFrom: null });
  });

  it("reports no downgrade when the request matches the model", () => {
    const result = resolveProfile({
      model: "claude-fable-5",
      modelProfile: "chunked",
      requested: "chunked",
    });
    expect(result).toMatchObject({ ok: true, downgradedFrom: null });
  });
});
