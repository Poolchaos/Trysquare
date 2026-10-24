/**
 * The five steps a person reads, mapped onto the stages that do the work
 * (proof-and-steps plan, WP-G; the approved mockup, PG-4, D-187).
 */

import { describe, expect, it } from "vitest";
import { REVIEW_STAGES } from "@/lib/domain/enums";
import {
  STEPS,
  designTallies,
  findingTallies,
  stepCount,
  stepResult,
  stepStates,
  stepUsage,
} from "@/lib/review/steps";

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
    // S0, then every stage the pipeline has: a new stage fails this until it
    // is given a step.
    expect(STEPS.flatMap((step) => step.stages)).toEqual(["s0_prepare", ...REVIEW_STAGES]);
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
          "s4b_design_grading",
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
      // Proven by the first and held for the second (WP-E): proven so far.
      finding({ status: "candidate", proofJson: "{}" }),
      // From before proofs were kept (0012): proven by its status.
      finding({ status: "verified" }),
      finding({ status: "dismissed", dismissedFrom: "verified" }),
      // Verified again and refuted: its old proof is not a proof now.
      finding({ status: "killed", killedBy: "verification", proofJson: "{}" }),
    ]);
    expect(tallies).toEqual({
      raised: 12,
      provenOnce: 6,
      proven: 5,
      provenTwice: 2,
      open: 3,
      refuted: 2,
      discarded: 1,
      withSecond: 1,
      toProve: 1,
    });
    // The live view's five divide what was raised, each finding once.
    expect(
      tallies.proven + tallies.refuted + tallies.discarded + tallies.open + tallies.toProve,
    ).toBe(tallies.raised);
  });
});

describe("what each step says it did", () => {
  const facts = {
    rules: 14,
    files: 13,
    tallies: {
      raised: 11,
      provenOnce: 11,
      proven: 10,
      provenTwice: 10,
      open: 1,
      refuted: 0,
      discarded: 0,
      withSecond: 0,
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

  it("says the second verifier is at work once the first has ruled on all", () => {
    const second = { ...facts, tallies: { ...facts.tallies, withSecond: 7, toProve: 0 } };
    expect(stepCount(3, "now", second)).toBe("7 with the second verifier");
    // While the first still has some, those are what is left to prove.
    const first = { ...facts, tallies: { ...facts.tallies, withSecond: 7, toProve: 2 } };
    expect(stepCount(3, "now", first)).toBe("2 to prove");
  });

  it("counts one as one", () => {
    const one = {
      ...facts,
      rules: 1,
      files: 1,
      tallies: { ...facts.tallies, raised: 1 },
      waiting: 1,
    };
    expect(stepCount(0, "done", one)).toBe("1 rule frozen");
    expect(stepCount(1, "done", one)).toBe("1 file read");
    expect(stepCount(1, "now", one)).toBe("Reading 1 file");
    expect(stepCount(2, "now", one)).toBe("1 candidate so far");
    expect(stepCount(2, "done", one)).toBe("1 candidate raised");
    expect(stepCount(4, "now", one)).toBe("1 waits for you");
  });

  it("says when a step is grading screens, not walking rules or proving code", () => {
    // During S4b the step said "Walking the rules", and during S5c "0 to
    // prove", while neither was happening (review round 8).
    const none = { ...facts, tallies: { ...facts.tallies, raised: 0, toProve: 0 } };
    expect(stepCount(2, "now", none, "s4b_design_grading")).toBe("Grading the screens");
    expect(stepCount(3, "now", none, "s5c_design_second")).toBe("Grading the screens again");
    expect(stepCount(2, "now", none, "s3_adversarial")).toBe("Walking the rules");
    // Waiting is waiting, whatever is running elsewhere.
    expect(stepCount(3, "next", none, "s4b_design_grading")).toBe("Waiting");
  });

  it("says nothing it does not know", () => {
    // A review whose ruleset was never frozen has no count to give.
    expect(stepCount(0, "now", { ...facts, rules: null })).toBe("Freezing the ruleset");
  });
});

describe("what each step came to", () => {
  const facts = {
    rules: 14,
    files: 13,
    tallies: {
      raised: 11,
      provenOnce: 11,
      proven: 10,
      provenTwice: 10,
      open: 1,
      refuted: 0,
      discarded: 0,
      withSecond: 0,
      toProve: 0,
    },
    waiting: 10,
    status: "awaiting_confirmation",
    secondVerifier: true,
  };

  it("says each step's result, refuted and discarded told apart", () => {
    expect(STEPS.map((_, index) => stepResult(index, facts))).toEqual([
      "14 rules frozen for this review, and the sweeps marked every line a rule names.",
      "13 changed files classed by risk and read with what they call into.",
      "11 candidates raised, and every change and deletion accounted for.",
      "10 proven by both verifiers, 1 open question, none refuted, none discarded for quoting code that was not there.",
      "Coverage audited. Your confirmation, then the report.",
    ]);
    const mixed = {
      ...facts,
      tallies: { ...facts.tallies, provenTwice: 0, open: 2, refuted: 3, discarded: 1 },
    };
    expect(stepResult(3, mixed)).toBe(
      "None proven by both verifiers, 2 open questions, 3 refuted, 1 discarded for quoting code that was not there.",
    );
    expect(stepResult(4, { ...facts, status: "complete" })).toBe(
      "Coverage audited, every finding decided, and the report written.",
    );
  });

  it("does not claim a second verifier a review never had", () => {
    expect(stepResult(3, { ...facts, secondVerifier: false })).toMatch(/^11 proven, /);
  });

  it("says plainly when there was nothing", () => {
    const empty = {
      ...facts,
      rules: null,
      files: 1,
      tallies: { ...facts.tallies, raised: 0, provenOnce: 0, provenTwice: 0, open: 0 },
    };
    expect(stepResult(0, empty)).toBe("The sweeps marked every line a rule names.");
    expect(stepResult(1, empty)).toBe(
      "1 changed file classed by risk and read with what it calls into.",
    );
    expect(stepResult(2, empty)).toBe(
      "No candidates raised, and every change and deletion accounted for.",
    );
    expect(stepResult(3, empty)).toBe("Nothing to prove.");
  });
});

describe("what each step spent", () => {
  it("counts every request a step's stages sent and the time they took", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 23, 10, 0, s)).toISOString();
    const usage = stepUsage([
      { stage: "s1_risk", startedAt: at(0), endedAt: at(10) },
      { stage: "s2_comprehension", startedAt: at(10), endedAt: at(40) },
      // A failed attempt was still sent, so it counts.
      { stage: "s3_adversarial", startedAt: at(40), endedAt: at(45) },
      { stage: "s3_adversarial", startedAt: at(45), endedAt: at(55) },
      { stage: "s5b_second_verification", startedAt: at(55), endedAt: null },
    ]);
    expect(usage).toEqual([
      { requests: 0, ms: 0 },
      { requests: 2, ms: 40_000 },
      { requests: 2, ms: 15_000 },
      // In flight: sent, its time not yet known.
      { requests: 1, ms: 0 },
      { requests: 0, ms: 0 },
    ]);
  });
});

describe("what grading the screens came to (WP-I step 5)", () => {
  const facts = {
    rules: 14,
    files: 13,
    tallies: {
      raised: 2,
      provenOnce: 2,
      proven: 2,
      provenTwice: 2,
      open: 0,
      refuted: 0,
      discarded: 0,
      withSecond: 0,
      toProve: 0,
    },
    waiting: 2,
    status: "awaiting_confirmation",
    secondVerifier: true,
  };

  it("counts the screens graded C or D, and what the second grader made of them", () => {
    const design = designTallies([
      { kind: "design", status: "verified" },
      { kind: "design", status: "confirmed" },
      { kind: "design", status: "open_question" },
      { kind: "design", status: "dismissed", dismissedFrom: "open_question" },
      { kind: "test", status: "verified" },
    ]);
    expect(design).toEqual({ raised: 4, proven: 2, open: 2 });
    // One still with the second grader is neither; one dismissed after both
    // graded it C or D was proven (review round 8).
    expect(
      designTallies([
        { kind: "design", status: "candidate" },
        { kind: "design", status: "dismissed", dismissedFrom: "verified" },
      ]),
    ).toEqual({ raised: 2, proven: 1, open: 0 });
    expect(stepResult(2, { ...facts, design })).toBe(
      "2 candidates raised, and every change and deletion accounted for. 4 screens graded C or D.",
    );
    expect(stepResult(3, { ...facts, design })).toMatch(
      /\. The second grader agreed on 2 of 4 screens graded C or D, leaving 2 open\.$/,
    );
  });

  it("says nothing of screens when none was graded C or D", () => {
    const none = { ...facts, design: designTallies([]) };
    expect(stepResult(2, none)).toBe(
      "2 candidates raised, and every change and deletion accounted for.",
    );
    const empty = { ...none, tallies: { ...facts.tallies, raised: 0 } };
    expect(stepResult(3, empty)).toBe("Nothing to prove.");
    expect(stepResult(3, { ...empty, design: { raised: 1, proven: 1, open: 0 } })).toBe(
      "Nothing to prove in the code. The second grader agreed on 1 of 1 screen graded C or D.",
    );
  });
});
