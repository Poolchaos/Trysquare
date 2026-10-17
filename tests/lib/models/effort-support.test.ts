/**
 * Which models a review may ask for xhigh on (4.7, D-122, corrected by D-123).
 *
 * The CLI runs xhigh on every model but a fixed list of older ones, which it
 * sends at high or at no effort, without a word, so a review asking for it
 * there would record an effort it never had.
 */

import { describe, expect, it } from "vitest";
import { effortRunsOn } from "@/lib/models/effort-support";

describe("the effort a model actually runs at", () => {
  it("runs xhigh on every current model, at any window", () => {
    // Sonnet 5 was refused until D-123: its row in the CLI's
    // table was misread, and the CLI sends xhigh for it.
    for (const model of [
      "claude-fable-5[1m]",
      "claude-fable-5",
      "claude-opus-5[1m]",
      "claude-opus-5",
      "claude-sonnet-5[1m]",
      "claude-sonnet-5",
      "claude-haiku-5-5",
    ]) {
      expect(effortRunsOn(model, "xhigh"), model).toBe(true);
    }
  });

  it("does not run xhigh on the older models the CLI sends without it", () => {
    for (const model of [
      "claude-haiku-4-5-20251001",
      "claude-opus-4-6",
      "claude-opus-4-1-20250805",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
    ]) {
      expect(effortRunsOn(model, "xhigh"), model).toBe(false);
    }
  });

  it("leaves every other tier to the model", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(effortRunsOn("claude-haiku-4-5-20251001", effort), effort).toBe(true);
    }
  });
});
