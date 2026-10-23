import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IllegalTransitionError } from "@/lib/domain/state-machines";
import type { Db } from "@/server/db/client";
import {
  confirmFinding,
  createCandidate,
  findingTallies,
  dismissFinding,
  listAwaitingDecision,
  listFindingsByStatus,
  listUnresolvedCandidates,
  markKilled,
  markOpenQuestion,
  markVerified,
  OpenQuestionNotConfirmableError,
  ReviewNotDecidingError,
  requireFinding,
  statusOf,
} from "@/server/db/repositories/findings";
import { transitionReview } from "@/server/db/repositories/reviews";
import { makeTestDb, seedProject, seedReview, type TestDb } from "./helpers";

let ctx: TestDb;
let db: Db;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = seedReview(db, seedProject(db).id).id;
  // Findings are decided only while their review waits on a person.
  for (const to of ["running", "verifying", "awaiting_confirmation"] as const) {
    transitionReview(db, reviewId, to);
  }
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
    expect(listFindingsByStatus(db, reviewId, ["confirmed"])).toHaveLength(0);
    expect(listUnresolvedCandidates(db, reviewId)).toHaveLength(1);
  });

  it("cannot be decided once its review is complete or cancelled (4.23)", () => {
    // A cancelled review's undecided findings could still be confirmed,
    // deciding a review nobody was finishing.
    const finding = candidate();
    markVerified(db, finding.id, {
      quotedCode: "total += item.price;",
      lineStart: 42,
      lineEnd: 42,
      note: "checked",
    });
    transitionReview(db, reviewId, "cancelled");
    expect(() => confirmFinding(db, finding.id)).toThrow(ReviewNotDecidingError);
    expect(() => dismissFinding(db, finding.id, "Not a problem.")).toThrow(
      /is cancelled: its findings are decided only while it awaits confirmation/,
    );
    expect(statusOf(requireFinding(db, finding.id))).toBe("verified");
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
    markKilled(db, finding.id, "A guard at line 39 already handles this.", "verification");

    expect(listAwaitingDecision(db, reviewId)).toHaveLength(0);
    expect(() => confirmFinding(db, finding.id)).toThrow(IllegalTransitionError);
    // Kept rather than deleted: it is the measurement of engine accuracy.
    expect(statusOf(requireFinding(db, finding.id))).toBe("killed");
  });

  it("surfaces an open question for a human to dismiss, never to confirm", () => {
    // PG-2 (a), D-185: only proven findings reach the report.
    const finding = candidate();
    markOpenQuestion(db, finding.id, "Needs the caller in another repo to confirm the shape.");
    expect(listAwaitingDecision(db, reviewId)).toHaveLength(1);
    expect(() => confirmFinding(db, finding.id)).toThrow(OpenQuestionNotConfirmableError);
    expect(() => confirmFinding(db, finding.id)).toThrow(/cannot go into the report/);
    expect(statusOf(requireFinding(db, finding.id))).toBe("open_question");
    const dismissed = dismissFinding(db, finding.id, "Not reproducible here.");
    expect(dismissed.status).toBe("dismissed");
    // Left out unproven, not rejected: the report keeps the two apart (D-190).
    expect(dismissed.dismissedFrom).toBe("open_question");
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

    const report = listFindingsByStatus(db, reviewId, ["confirmed"]);
    expect(report).toHaveLength(1);
    expect(report[0]!.id).toBe(kept.id);
  });

  it("requires a reason for a dismissal and keeps it", () => {
    const finding = candidate();
    markVerified(db, finding.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });

    expect(() => dismissFinding(db, finding.id, "  ")).toThrow(/needs a reason/);

    const dismissed = dismissFinding(db, finding.id, "Handled by the retry wrapper.");
    expect(dismissed.dismissReason).toBe("Handled by the retry wrapper.");
    expect(dismissed.dismissedFrom).toBe("verified");
    expect(dismissed.decidedAt).not.toBeNull();
  });

  it("keeps a rewritten comment beside the engine's, never over it", () => {
    // The report is for whoever fixes the code, so it takes the person's
    // words. The engine's stay on the row: how well it explained itself is
    // the only measurement of whether the prompts are working, and an edit
    // that overwrote them would erase the evidence it is itself a data point
    // in.
    const finding = candidate();
    markVerified(db, finding.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });

    const confirmed = confirmFinding(db, finding.id, {
      comment: "Rounds the total down, so an invoice under a cent bills as zero.",
    });

    expect(confirmed.editedComment).toBe(
      "Rounds the total down, so an invoice under a cent bills as zero.",
    );
    expect(confirmed.comment).toBe(finding.comment);
  });

  it("records nothing when the comment was left alone", () => {
    // Otherwise every confirmation would look like an edit, and "edited"
    // would stop meaning anything on the screen or in the record.
    const untouched = candidate();
    const whitespace = candidate({ issue: "Second finding" });
    const same = candidate({ issue: "Third finding" });
    for (const f of [untouched, whitespace, same]) {
      markVerified(db, f.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });
    }

    expect(confirmFinding(db, untouched.id).editedComment).toBeNull();
    expect(confirmFinding(db, whitespace.id, { comment: "   " }).editedComment).toBeNull();
    expect(confirmFinding(db, same.id, { comment: same.comment }).editedComment).toBeNull();
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
    markKilled(db, killed.id, "False positive.", "verification");

    const awaiting = listAwaitingDecision(db, reviewId);
    expect(awaiting.map((f) => f.id).sort()).toEqual([verified.id, question.id].sort());
  });
});

describe("what a review yielded, across the whole list", () => {
  it("counts each review's findings by what became of them", () => {
    // The reviews list showed a status and a date, so a review that confirmed
    // several criticals looked exactly like one that was cancelled.
    const kept = candidate();
    const dropped = candidate({ issue: "Second" });
    const invented = candidate({ issue: "Third" });

    markVerified(db, kept.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });
    markVerified(db, dropped.id, { quotedCode: "code", lineStart: 1, lineEnd: 1 });
    confirmFinding(db, kept.id);
    dismissFinding(db, dropped.id, "Handled upstream.");
    markKilled(db, invented.id, "Quoted code that was not there.", "quote_check");

    const tally = findingTallies(db).get(reviewId);
    expect(tally).toEqual({ total: 3, confirmed: 1, dismissed: 1, killed: 1 });
  });

  it("keeps killed findings in the count rather than hiding the engine's misses", () => {
    // They are the measurement of how often the engine invents things, and a
    // history that drops them reads cleaner than the one that happened.
    markKilled(db, candidate().id, "False positive.", "verification");
    expect(findingTallies(db).get(reviewId)?.killed).toBe(1);
    expect(findingTallies(db).get(reviewId)?.total).toBe(1);
  });

  it("reports nothing for a review that raised nothing", () => {
    expect(findingTallies(db).has(reviewId)).toBe(false);
  });
});
