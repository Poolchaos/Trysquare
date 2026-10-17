/**
 * Which models a review may ask for xhigh on (4.7, D-122).
 *
 * The CLI quietly runs xhigh as high on a model it does not mark as
 * supporting it, so a review asking for it there would record an effort it
 * never had.
 */

import { describe, expect, it } from "vitest";
import { effortRunsOn } from "@/lib/models/effort-support";

describe("the effort a model actually runs at", () => {
  it("runs xhigh on the models the CLI marks as supporting it, at any window", () => {
    for (const model of [
      "claude-fable-5[1m]",
      "claude-fable-5",
      "claude-opus-5[1m]",
      "claude-opus-5",
    ]) {
      expect(effortRunsOn(model, "xhigh"), model).toBe(true);
    }
  });

  it("does not run xhigh on the models it would quietly run at high", () => {
    for (const model of ["claude-sonnet-5[1m]", "claude-sonnet-5", "claude-haiku-4-5-20251001"]) {
      expect(effortRunsOn(model, "xhigh"), model).toBe(false);
    }
  });

  it("leaves every other tier to the model", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(effortRunsOn("claude-haiku-4-5-20251001", effort), effort).toBe(true);
    }
  });
});
