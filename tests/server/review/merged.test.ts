/**
 * Noticing a reviewed branch has merged (audit finding S4): asked of git
 * only when a review's target branch has moved since it was last found not
 * merged, and each branch's tip read once per look, rather than a git
 * process per review on every load of the list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDb, seedProject, seedReview, type TestDb } from "../db/helpers";
import { requireReview } from "@/server/db/repositories/reviews";

const { isAncestor, resolveBranch } = vi.hoisted(() => ({
  isAncestor: vi.fn<(dir: string, commit: string, tip: string) => Promise<boolean>>(),
  resolveBranch: vi.fn<(dir: string, branch: string) => Promise<string>>(),
}));
vi.mock("@/server/gitops/repo", () => ({ isAncestor, resolveBranch }));

const { detectMerged } = await import("@/server/review/merged");

let ctx: TestDb;

beforeEach(() => {
  ctx = makeTestDb();
  isAncestor.mockReset().mockResolvedValue(false);
  resolveBranch.mockReset().mockResolvedValue("tip-1");
});

function reviews(count: number) {
  const project = seedProject(ctx.db);
  return Array.from({ length: count }, () =>
    requireReview(ctx.db, seedReview(ctx.db, project.id).id),
  );
}

describe("noticing a review's branch has merged", () => {
  it("asks git once per review, and again only once the target branch moves", async () => {
    const rows = reviews(3);
    await detectMerged(ctx.db, rows);
    expect(isAncestor).toHaveBeenCalledTimes(3);
    // Asked of the tip just read, the one the answer is kept for, not of a
    // branch name a fetch could move in between (review round 12).
    expect(isAncestor).toHaveBeenLastCalledWith(expect.any(String), rows[2]!.fromCommit, "tip-1");
    // The same tips: nothing to ask, and each branch's tip read once.
    resolveBranch.mockClear();
    await detectMerged(ctx.db, rows);
    expect(isAncestor).toHaveBeenCalledTimes(3);
    expect(resolveBranch).toHaveBeenCalledTimes(1);
    // The target branch moved: each review is asked again.
    resolveBranch.mockResolvedValue("tip-2");
    await detectMerged(ctx.db, rows);
    expect(isAncestor).toHaveBeenCalledTimes(6);
  });

  it("records one that has merged, and asks no more of it", async () => {
    const [row] = reviews(1);
    isAncestor.mockResolvedValue(true);
    await detectMerged(ctx.db, [row!]);
    expect(requireReview(ctx.db, row!.id).mergedDetectedAt).not.toBeNull();
    await detectMerged(ctx.db, [requireReview(ctx.db, row!.id)]);
    expect(isAncestor).toHaveBeenCalledTimes(1);
  });

  it("keeps no answer git could not give, and asks again on the next look", async () => {
    // Review round 12: a timeout or a failed spawn read as not merged, and
    // was kept until the target branch next moved, a quiet branch never.
    const [row] = reviews(1);
    isAncestor.mockRejectedValueOnce(new Error("git timed out"));
    await detectMerged(ctx.db, [row!]);
    isAncestor.mockResolvedValueOnce(true);
    await detectMerged(ctx.db, [row!]);
    expect(isAncestor).toHaveBeenCalledTimes(2);
    expect(requireReview(ctx.db, row!.id).mergedDetectedAt).not.toBeNull();
  });
});
