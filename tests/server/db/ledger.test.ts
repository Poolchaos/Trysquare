import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import {
  IncompleteCoverageError,
  assertCoverageComplete,
  attachSweepHitToFinding,
  clearHunk,
  clearSweepHit,
  coverageReport,
  getChainFilesRead,
  getFileRiskTags,
  listHunks,
  listLedgerFiles,
  listSweepHits,
  markFileReviewed,
  markHunkHasFindings,
  recordChangedFiles,
  recordSweepHits,
  setChainFilesRead,
  setFileRiskTags,
} from "@/server/db/repositories/ledger";
import { createCandidate, markKilled } from "@/server/db/repositories/findings";
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

function seedTwoHunks() {
  const [file] = recordChangedFiles(db, reviewId, [
    {
      repo: "primary",
      path: "src/orders/total.ts",
      changeType: "modified",
      hunks: [
        { hunkIndex: 0, oldStart: 10, oldLines: 3, newStart: 10, newLines: 5 },
        { hunkIndex: 1, oldStart: 40, oldLines: 0, newStart: 42, newLines: 4 },
      ],
    },
  ]);
  return file!;
}

describe("coverage ledger", () => {
  it("records every changed file and hunk as pending before anything runs", () => {
    seedTwoHunks();
    const report = coverageReport(db, reviewId);
    expect(report).toMatchObject({
      totalFiles: 1,
      totalHunks: 2,
      pendingHunks: 2,
      pendingSweepHits: 0,
    });
  });

  it("tracks a file with no hunks, so a rename is never invisible to the review", () => {
    recordChangedFiles(db, reviewId, [
      {
        repo: "primary",
        path: "src/new-name.ts",
        changeType: "renamed",
        oldPath: "src/old-name.ts",
        hunks: [],
      },
    ]);
    const report = coverageReport(db, reviewId);
    expect(report.totalFiles).toBe(1);
    expect(report.totalHunks).toBe(0);
  });

  it("refuses to pass the audit while any hunk is undispositioned", () => {
    const file = seedTwoHunks();
    const hunks = listHunks(db, file.id);
    markHunkHasFindings(db, hunks[0]!.id);

    expect(() => assertCoverageComplete(db, reviewId)).toThrow(IncompleteCoverageError);
    expect(coverageReport(db, reviewId).pendingHunks).toBe(1);
  });

  it("passes the audit once every hunk and file is accounted for", () => {
    const file = seedTwoHunks();
    const hunks = listHunks(db, file.id);
    markHunkHasFindings(db, hunks[0]!.id);
    clearHunk(db, hunks[1]!.id, "Comment-only change, no behaviour affected.");

    // Dispositioning the hunks is not enough on its own: the file itself must
    // be marked reviewed, which is what covers deletions and renames.
    expect(() => assertCoverageComplete(db, reviewId)).toThrow(IncompleteCoverageError);
    markFileReviewed(db, file.id);

    const report = assertCoverageComplete(db, reviewId);
    expect(report.pendingHunks).toBe(0);
    expect(report.pendingFiles).toBe(0);
  });

  it("will not accept a clear without a reason, because that is a skipped hunk", () => {
    const file = seedTwoHunks();
    const hunks = listHunks(db, file.id);
    expect(() => clearHunk(db, hunks[0]!.id, "")).toThrow(/without a reason/);
    expect(() => clearHunk(db, hunks[0]!.id, "   ")).toThrow(/without a reason/);
    // The refused clears must not have marked anything.
    expect(coverageReport(db, reviewId).pendingHunks).toBe(2);
  });

  it("names the shortfall in the error so the failure is actionable", () => {
    seedTwoHunks();
    try {
      assertCoverageComplete(db, reviewId);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteCoverageError);
      expect((error as Error).message).toContain("2 of 2 hunks");
    }
  });

  it("blocks a deleted file that nobody reviewed, even though it has no hunks", () => {
    // The regression this catches: checking hunks alone would let an entire
    // deleted file through the gate, because a deletion has nothing to hunk.
    recordChangedFiles(db, reviewId, [
      { repo: "primary", path: "src/legacy/guard.ts", changeType: "deleted", hunks: [] },
    ]);

    expect(coverageReport(db, reviewId).pendingHunks).toBe(0);
    expect(() => assertCoverageComplete(db, reviewId)).toThrow(/1 of 1 changed files not reviewed/);

    const [file] = listLedgerFiles(db, reviewId);
    markFileReviewed(db, file!.id);
    expect(() => assertCoverageComplete(db, reviewId)).not.toThrow();
  });

  it("blocks a candidate finding that verification never ruled on", () => {
    const file = seedTwoHunks();
    for (const hunk of listHunks(db, file.id)) clearHunk(db, hunk.id, "checked");
    markFileReviewed(db, file.id);
    expect(() => assertCoverageComplete(db, reviewId)).not.toThrow();

    const candidate = createCandidate(db, {
      reviewId,
      repo: "primary",
      filePath: "src/orders/total.ts",
      lineStart: 11,
      lineEnd: 11,
      severity: "WARNING",
      issue: "Possible issue",
      comment: "Comment",
      mechanism: "mechanism",
    });

    expect(coverageReport(db, reviewId).unresolvedCandidates).toBe(1);
    expect(() => assertCoverageComplete(db, reviewId)).toThrow(
      /1 candidate findings never verified/,
    );

    markKilled(db, candidate.id, "Refuted on re-reading the file.");
    expect(() => assertCoverageComplete(db, reviewId)).not.toThrow();
  });
});

describe("sweep hits", () => {
  it("blocks the audit until every hit is dispositioned", () => {
    const file = seedTwoHunks();
    for (const hunk of listHunks(db, file.id)) clearHunk(db, hunk.id, "checked");
    markFileReviewed(db, file.id);

    const [hit] = recordSweepHits(db, reviewId, [
      {
        ruleCode: "6",
        pattern: "\\bas\\b",
        repo: "primary",
        path: "src/orders/total.ts",
        line: 12,
        excerpt: "const x = value as Total;",
      },
    ]);

    expect(() => assertCoverageComplete(db, reviewId)).toThrow(IncompleteCoverageError);
    clearSweepHit(db, hit!.id, "Cast is on a literal built in this function, not external data.");
    expect(assertCoverageComplete(db, reviewId).pendingSweepHits).toBe(0);
  });

  it("links a hit to the finding it produced", () => {
    const [hit] = recordSweepHits(db, reviewId, [
      {
        ruleCode: "23",
        pattern: "floating promise",
        repo: "primary",
        path: "src/a.ts",
        line: 3,
        excerpt: "doThing();",
      },
    ]);
    attachSweepHitToFinding(db, hit!.id, "finding-123");

    // Assert the link itself, not just the disposition count: without this the
    // test passes even when the finding id is discarded.
    const persisted = listSweepHits(db, reviewId).find((h) => h.id === hit!.id);
    expect(persisted?.findingId).toBe("finding-123");
    expect(persisted?.disposition).toBe("finding");
    expect(persisted?.clearReason).toBeNull();

    const report = coverageReport(db, reviewId);
    expect(report.pendingSweepHits).toBe(0);
    expect(report.totalSweepHits).toBe(1);
  });

  it("requires a reason to clear a hit", () => {
    const [hit] = recordSweepHits(db, reviewId, [
      {
        ruleCode: "9",
        pattern: "console\\.",
        repo: "primary",
        path: "a.ts",
        line: 1,
        excerpt: "x",
      },
    ]);
    expect(() => clearSweepHit(db, hit!.id, "  ")).toThrow(/without a reason/);
  });
});

describe("risk tags", () => {
  it("round-trips through the JSON column via the database", () => {
    const file = seedTwoHunks();
    expect(getFileRiskTags(file)).toEqual([]);

    setFileRiskTags(db, file.id, ["money", "shared"]);

    // Read the row back rather than trusting the in-memory object, so this
    // actually exercises serialisation, storage, and parsing.
    const persisted = listLedgerFiles(db, reviewId).find((f) => f.id === file.id);
    expect(persisted).toBeDefined();
    expect(getFileRiskTags(persisted!)).toEqual(["money", "shared"]);
  });

  it("round-trips the chain of files each review stage read", () => {
    const file = seedTwoHunks();
    setChainFilesRead(db, file.id, ["src/shared/table.ts", "src/hooks/useStock.ts"]);

    const persisted = listLedgerFiles(db, reviewId).find((f) => f.id === file.id);
    expect(getChainFilesRead(persisted!)).toEqual(["src/shared/table.ts", "src/hooks/useStock.ts"]);
  });

  it("rejects a tag that is not a known risk category", () => {
    const file = seedTwoHunks();
    expect(() =>
      getFileRiskTags({ ...file, riskTags: JSON.stringify(["not_a_category"]) }),
    ).toThrow(/not valid/);
  });
});

describe("cascade", () => {
  it("removes the ledger when its review is deleted", async () => {
    const file = seedTwoHunks();
    expect(listHunks(db, file.id)).toHaveLength(2);

    const { deleteReview } = await import("@/server/db/repositories/reviews");
    deleteReview(db, reviewId);

    expect(coverageReport(db, reviewId).totalFiles).toBe(0);
    expect(listHunks(db, file.id)).toHaveLength(0);
  });
});
