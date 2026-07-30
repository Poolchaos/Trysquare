import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IllegalTransitionError } from "@/lib/domain/state-machines";
import type { Db } from "@/server/db/client";
import {
  confirmFinding,
  createCandidate,
  dismissFinding,
  listAwaitingDecision,
  listConfirmed,
  listUnresolvedCandidates,
  markKilled,
  markOpenQuestion,
  markVerified,
  requireFinding,
  statusOf,
} from "@/server/db/repositories/findings";
import { makeTestDb, seedProject, seedReview, type TestDb } from "./helpers";

let ctx: TestDb;
let db: Db;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = seedReview(db, seedProject(db).id).id;
});

afterEach(() => ctx.cleanup());

function candidate(overrides: Partial<Parameters<typeof createCandidate>[1]> = {}) {
  return createCandidate(db, {
    reviewId,
    repo: "primary",
    filePath: "src/orders/total.ts",
    lineStart: 42,
    lineEnd: 44,
    severity: "CRITICAL",
    ruleCode: "28",
    issue: "Money is summed in floating point.",
    comment: "Totals drift by fractions of a cent once orders get large.",
    mechanism: "cents summed as floats at line 43, rendered at line 51",
    ...overrides,
  });
}

describe("finding verification", () => {
  it("is born as a candidate and is not reportable", () => {
    const finding = candidate();
    expect(statusOf(finding)).toBe("candidate");
    expect(listConfirmed(db, reviewId)).toHaveLength(0);
    expect(listUnresolvedCandidates(db, reviewId)).toHaveLength(1);
  });

  it("cannot be confirmed without passing verification first", () => {
    const finding = candidate();
    expect(() => confirmFinding(db, finding.id)).toThrow(IllegalTransitionError);
    expect(statusOf(requireFinding(db, finding.id))).toBe("candidate");
  });

  it("refuses to verify without the quoted code that proves it", () => {
    const finding = candidate();
    expect(() =>
      markVerified(db, finding.id, { quotedCode: "   ", lineStart: 42, lineEnd: 44 }),
    ).toThrow(/empty quoted code/);
    expect(statusOf(requireFinding(db, finding.id))).toBe("candidate");
  });

  it("stores the quoted code and the lines verification actually confirmed", () => {
    const finding = candidate();
    const verified = markVerified(db, finding.id, {
      quotedCode: "const total = items.reduce((a, b) => a + b.price, 0);",
      lineStart: 43,
      lineEnd: 43,
      note: "Confirmed against the checked-out file.",
    });
    expect(statusOf(verified)).toBe("verified");
    // The quoted code is the whole point of the stage: it is what gets
    // byte-compared against the file, so assert it was actually stored.
    expect(verified.quotedCode).toBe("const total = items.reduce((a, b) => a + b.price, 0);");
    expect(verified.verificationNote).toBe("Confirmed against the checked-out file.");
    // Verification corrects the line numbers rather than trusting the candidate.
    expect(verified.lineStart).toBe(43);
    expect(verified.lineEnd).toBe(43);
    expect(verified.verifiedAt).not.toBeNull();

    // Read back from the database, not the returned object.
    const persisted = requireFinding(db, finding.id);
    expect(persisted.quotedCode).toBe("const total = items.reduce((a, b) => a + b.price, 0);");
    expect(persisted.lineStart).toBe(43);
  });

  it("keeps a killed finding out of every user-facing list, permanently", () => {
    const finding = candidate();
    markKilled(db, finding.id, "A guard at line 39 already handles this.");

    expect(listAwaitingDecision(db, reviewId)).toHaveLength(0);
    expect(() => confirmFinding(db, finding.id)).toThrow(IllegalTransitionError);
    // Kept rather than deleted: it is the measurement of engine accuracy.
    expect(statusOf(requireFinding(db, finding.id))).toBe("killed");
  });

  it("surfaces an open question for a human to resolve", () => {
    const finding = candidate();
    markOpenQuestion(db, finding.id, "Needs the caller in another repo to confirm the shape.");
    expect(listAwaitingDecision(db, reviewId)).toHaveLength(1);
    expect(confirmFinding(db, finding.id).status).toBe("confirmed");
  });
});

describe("human decision", () => {
  it("puts only confirmed findings into the report", () => {
    const kept = candidate();
    const dropped = candidate({ issue: "Second finding" });
    for (const f of [kept, dropped]) {
      markVerified(db, f.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });
    }

    confirmFinding(db, kept.id);
    dismissFinding(db, dropped.id, "Intentional: this path is dead code pending removal.");

    const report = listConfirmed(db, reviewId);
    expect(report).toHaveLength(1);
    expect(report[0]!.id).toBe(kept.id);
  });

  it("requires a reason for a dismissal and keeps it", () => {
    const finding = candidate();
    markVerified(db, finding.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });

    expect(() => dismissFinding(db, finding.id, "  ")).toThrow(/needs a reason/);

    const dismissed = dismissFinding(db, finding.id, "Handled by the retry wrapper.");
    expect(dismissed.dismissReason).toBe("Handled by the retry wrapper.");
    expect(dismissed.decidedAt).not.toBeNull();
  });

  it("does not let a decision be reversed silently", () => {
    const finding = candidate();
    markVerified(db, finding.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });
    confirmFinding(db, finding.id);
    expect(() => dismissFinding(db, finding.id, "changed my mind")).toThrow(IllegalTransitionError);
  });

  it("shows verified findings and open questions together for decision", () => {
    const verified = candidate();
    const question = candidate({ issue: "Second" });
    const killed = candidate({ issue: "Third" });

    markVerified(db, verified.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });
    markOpenQuestion(db, question.id, "Unclear whether the caller can pass null.");
    markKilled(db, killed.id, "False positive.");

    const awaiting = listAwaitingDecision(db, reviewId);
    expect(awaiting.map((f) => f.id).sort()).toEqual([verified.id, question.id].sort());
  });
});
