/**
 * The five steps a person reads, mapped onto the stages that do the work
 * (proof-and-steps plan, WP-G; the approved mockup, PG-4, D-187).
 */

import { describe, expect, it } from "vitest";
import { STEPS, findingTallies, stepCount, stepStates } from "@/lib/review/steps";

const finding = (overrides: Record<string, unknown>) => ({
  status: "verified",
  killedBy: null,
  dismissedFrom: null,
  proofJson: null,
  secondProofJson: null,
  ...overrides,
});

describe("the five steps", () => {
  it("cover every stage, in order, each once", () => {
    expect(STEPS.map((step) => step.title)).toEqual([
      "Understand the rules",
      "Understand the change",
      "Find issues",
      "Prove each finding",
      "Report",
    ]);
    expect(STEPS.flatMap((step) => step.stages)).toEqual([
      "s0_prepare",
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
      "s4_deletions",
      "s5_verification",
      "s5b_second_verification",
      "s6_audit",
    ]);
  });
});

describe("where a review is", () => {
  const done =
    (...stages: string[]) =>
    (stage: string) =>
      stages.includes(stage);

  it("is on the step whose stage is running, the ones before done", () => {
    expect(
      stepStates({
        stageDone: done(
          "s0_prepare",
          "s1_risk",
          "s2_comprehension",
          "s3_adversarial",
          "s4_deletions",
        ),
        executing: "s5_verification",
        status: "verifying",
      }),
    ).toEqual(["done", "done", "done", "now", "next"]);
  });

  it("is on a step part way through it", () => {
    expect(
      stepStates({
        stageDone: done("s0_prepare", "s1_risk"),
        executing: "s2_comprehension",
        status: "running",
      }),
    ).toEqual(["done", "now", "next", "next", "next"]);
  });

  it("waits on the person at the report once every stage has run", () => {
    const all = done(...STEPS.flatMap((step) => step.stages));
    expect(
      stepStates({ stageDone: all, executing: null, status: "awaiting_confirmation" }),
    ).toEqual(["done", "done", "done", "done", "now"]);
    expect(stepStates({ stageDone: all, executing: null, status: "complete" })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
  });
});

describe("what became of the findings", () => {
  it("tells proven once, proven by both, open, refuted and discarded apart", () => {
    const tallies = findingTallies([
      finding({ proofJson: "{}", secondProofJson: "{}" }),
      finding({ status: "confirmed", proofJson: "{}", secondProofJson: "{}" }),
      // The first proved it, the second did not: open, and proven once.
      finding({ status: "open_question", proofJson: "{}" }),
      finding({ status: "open_question" }),
      // Left out unproven still counts as one that stayed open (D-190).
      finding({ status: "dismissed", dismissedFrom: "open_question" }),
      finding({ status: "killed", killedBy: "verification" }),
      finding({ status: "killed", killedBy: "quote_check" }),
      finding({ status: "candidate" }),
    ]);
    expect(tallies).toEqual({
      raised: 8,
      provenOnce: 3,
      provenTwice: 2,
      open: 3,
      refuted: 1,
      discarded: 1,
      toProve: 1,
    });
  });
});

describe("what each step says it did", () => {
  const facts = {
    rules: 14,
    files: 13,
    tallies: {
      raised: 11,
      provenOnce: 11,
      provenTwice: 10,
      open: 1,
      refuted: 0,
      discarded: 0,
      toProve: 0,
    },
    waiting: 10,
  };

  it("counts what it has measured, and waits when it has not begun", () => {
    expect(stepCount(0, "done", facts)).toBe("14 rules frozen");
    expect(stepCount(1, "done", facts)).toBe("13 files read");
    expect(stepCount(2, "done", facts)).toBe("11 candidates raised");
    expect(stepCount(3, "done", facts)).toBe("10 proven by both verifiers");
    expect(stepCount(3, "now", { ...facts, tallies: { ...facts.tallies, toProve: 4 } })).toBe(
      "4 to prove",
    );
    expect(stepCount(4, "now", facts)).toBe("10 wait for you");
    expect(stepCount(4, "done", facts)).toBe("Reported");
    expect(stepCount(2, "next", facts)).toBe("Waiting");
    // Running, a count is not yet a result.
    const none = { ...facts, tallies: { ...facts.tallies, raised: 0 } };
    expect(stepCount(2, "now", none)).toBe("Walking the rules");
    expect(stepCount(2, "now", facts)).toBe("11 candidates so far");
  });

  it("says nothing it does not know", () => {
    // A review whose ruleset was never frozen has no count to give.
    expect(stepCount(0, "now", { ...facts, rules: null })).toBe("Freezing the ruleset");
  });
});
