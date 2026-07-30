import { describe, expect, it } from "vitest";
import {
  StageDidNotAccountError,
  assertReconciled,
  isReconciled,
  reconcileAdversarial,
} from "@/lib/review/coverage";

const HUNKS = [
  { path: "a.ts", hunkIndex: 0 },
  { path: "a.ts", hunkIndex: 1 },
  { path: "b.ts", hunkIndex: 0 },
];

const SWEEPS = [
  { path: "a.ts", line: 12, ruleCode: "3" },
  { path: "b.ts", line: 4, ruleCode: "6" },
];

describe("reconciling the adversarial stage", () => {
  it("passes when every hunk and sweep hit is accounted for", () => {
    const result = reconcileAdversarial(HUNKS, SWEEPS, {
      hunksWithFindings: [HUNKS[0]!],
      hunksCleared: [HUNKS[1]!, HUNKS[2]!],
      sweepDispositions: SWEEPS,
    });
    expect(isReconciled(result)).toBe(true);
    expect(() => assertReconciled(result)).not.toThrow();
  });

  it("catches a hunk the stage never mentioned", () => {
    // This is the failure the whole ledger exists to prevent: a hunk nobody
    // mentioned is a hunk nobody reviewed, and the review still looks whole.
    const result = reconcileAdversarial(HUNKS, SWEEPS, {
      hunksWithFindings: [HUNKS[0]!],
      hunksCleared: [HUNKS[1]!],
      sweepDispositions: SWEEPS,
    });
    expect(result.unaccountedHunks).toEqual([{ path: "b.ts", hunkIndex: 0 }]);
    expect(() => assertReconciled(result)).toThrow(StageDidNotAccountError);
    expect(() => assertReconciled(result)).toThrow(/b\.ts hunk 0/);
  });

  it("catches an undispositioned sweep hit", () => {
    const result = reconcileAdversarial(HUNKS, SWEEPS, {
      hunksWithFindings: [],
      hunksCleared: HUNKS,
      sweepDispositions: [SWEEPS[0]!],
    });
    expect(result.unaccountedSweeps).toHaveLength(1);
    expect(() => assertReconciled(result)).toThrow(/sweep hit\(s\) were left undispositioned/);
  });

  it("catches a hunk the stage invented", () => {
    // A stage describing a change set that does not exist has lost track of
    // what it is reviewing, which makes the rest of its output unsafe.
    const result = reconcileAdversarial(HUNKS, SWEEPS, {
      hunksWithFindings: [{ path: "imaginary.ts", hunkIndex: 7 }],
      hunksCleared: HUNKS,
      sweepDispositions: SWEEPS,
    });
    expect(result.unknownHunks).toEqual([{ path: "imaginary.ts", hunkIndex: 7 }]);
    expect(() => assertReconciled(result)).toThrow(/not in the change set/);
  });

  it("catches a sweep hit the stage invented", () => {
    const result = reconcileAdversarial(HUNKS, SWEEPS, {
      hunksWithFindings: [],
      hunksCleared: HUNKS,
      sweepDispositions: [...SWEEPS, { path: "a.ts", line: 99, ruleCode: "9" }],
    });
    expect(result.unknownSweeps).toHaveLength(1);
    expect(() => assertReconciled(result)).toThrow(/never found/);
  });

  it("does not accept a hunk cleared under a different file", () => {
    const result = reconcileAdversarial(HUNKS, [], {
      hunksWithFindings: [],
      hunksCleared: [
        { path: "a.ts", hunkIndex: 0 },
        { path: "a.ts", hunkIndex: 1 },
        // Right index, wrong file: b.ts hunk 0 is still unreviewed.
        { path: "a.ts", hunkIndex: 0 },
      ],
      sweepDispositions: [],
    });
    expect(result.unaccountedHunks).toEqual([{ path: "b.ts", hunkIndex: 0 }]);
  });

  it("treats an empty change set as reconciled", () => {
    const result = reconcileAdversarial([], [], {
      hunksWithFindings: [],
      hunksCleared: [],
      sweepDispositions: [],
    });
    expect(isReconciled(result)).toBe(true);
  });

  it("reports every problem at once rather than the first", () => {
    const result = reconcileAdversarial(HUNKS, SWEEPS, {
      hunksWithFindings: [{ path: "ghost.ts", hunkIndex: 0 }],
      hunksCleared: [],
      sweepDispositions: [],
    });
    expect(() => assertReconciled(result)).toThrow(/hunk\(s\) were neither given a finding/);
    expect(() => assertReconciled(result)).toThrow(/undispositioned/);
    expect(() => assertReconciled(result)).toThrow(/not in the change set/);
  });
});
