/**
 * Which model checks every verified finding again, and whether it can (PG-1
 * (a), D-185): the other strong family, refused at Start when it cannot run.
 */

import { describe, expect, it } from "vitest";
import {
  pairedVerifierFor,
  secondVerifierReadiness,
  secondVerifierRefusal,
} from "@/lib/models/pairing";

describe("the second verifier's model", () => {
  it("is Fable 5.1 for an Opus review, and Opus 5.5 for any other", () => {
    expect(pairedVerifierFor("opus")).toBe("claude-fable-5-1");
    expect(pairedVerifierFor("fable")).toBe("claude-opus-5-5");
    expect(pairedVerifierFor("sonnet")).toBe("claude-opus-5-5");
    // An unregistered model has no family to pair against.
    expect(pairedVerifierFor(undefined)).toBe("claude-opus-5-5");
  });
});

describe("whether it can run", () => {
  it("only on a probe that vouches for it now", () => {
    expect(secondVerifierReadiness("claude-opus-5-5", "available")).toEqual({
      model: "claude-opus-5-5",
      usable: true,
      reason: null,
    });
    for (const [availability, reason] of [
      ["unknown", "has not been probed"],
      [undefined, "has not been probed"],
      ["stale", "was probed too long ago to be vouched for now"],
      ["unavailable", "did not answer its last probe"],
    ] as const) {
      expect(secondVerifierReadiness("claude-opus-5-5", availability)).toEqual({
        model: "claude-opus-5-5",
        usable: false,
        reason,
      });
    }
  });

  it("is refused in words that say what to do", () => {
    const readiness = secondVerifierReadiness("claude-opus-5-5", "unknown");
    expect(secondVerifierRefusal(readiness)).toBe(
      "Every verified finding is checked again by claude-opus-5-5, which has not been probed. " +
        "Probe it, then start again.",
    );
  });
});
