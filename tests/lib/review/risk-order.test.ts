/**
 * The order the later stages see the change set in.
 *
 * The permutation case is the one that matters most: ordering must never
 * change which files are reviewed, because everything downstream reconciles
 * what was accounted for against what was handed over.
 */

import { describe, expect, it } from "vitest";
import { byRiskOrder, riskOrderedPaths, type RiskRanked } from "@/lib/review/risk-order";

const file = (path: string, ...riskTags: RiskRanked["riskTags"]): RiskRanked => ({
  path,
  riskTags,
});

describe("which file is worked first", () => {
  it("puts a file touching more risk categories ahead of one touching fewer", () => {
    const order = riskOrderedPaths([
      file("app/theme.ts"),
      file("app/billing.ts", "money", "destructive"),
      file("app/session.ts", "auth"),
    ]);
    expect(order).toEqual(["app/billing.ts", "app/session.ts", "app/theme.ts"]);
  });

  it("counts a repeated category once", () => {
    // The stage schema puts no uniqueness constraint on the array and the
    // ledger round-trips it verbatim, so a model repeating itself would
    // otherwise outrank a file genuinely touching two kinds of risk.
    const order = riskOrderedPaths([
      file("app/repeated.ts", "money", "money", "money"),
      file("app/genuine.ts", "money", "auth"),
    ]);
    expect(order).toEqual(["app/genuine.ts", "app/repeated.ts"]);
  });

  it("leaves files of equal risk in the order the inventory found them", () => {
    const order = riskOrderedPaths([
      file("app/b.ts", "money"),
      file("app/a.ts", "auth"),
      file("app/c.ts", "concurrency"),
    ]);
    expect(order).toEqual(["app/b.ts", "app/a.ts", "app/c.ts"]);
  });

  it("returns every file exactly once", () => {
    // The invariant the coverage ledger rests on: this is a permutation, so
    // reordering can never drop a file from the work.
    const files = [
      file("app/a.ts", "money"),
      file("app/b.ts"),
      file("app/c.ts", "auth", "destructive"),
      file("app/d.ts", "money"),
    ];
    const order = riskOrderedPaths(files);
    expect([...order].sort()).toEqual(files.map((entry) => entry.path).sort());
  });
});

describe("applying a decided order to another list", () => {
  it("sorts a different shape into the same order", () => {
    const order = ["app/b.ts", "app/a.ts"];
    const rows = [{ p: "app/a.ts" }, { p: "app/b.ts" }];
    expect([...rows].sort(byRiskOrder(order, (row) => row.p))).toEqual([
      { p: "app/b.ts" },
      { p: "app/a.ts" },
    ]);
  });

  it("puts an unmentioned path last without scrambling the rest", () => {
    // The sentinel is the list length rather than Infinity: two Infinities
    // subtract to NaN, and a comparator returning NaN leaves the array in an
    // order nobody chose.
    const order = ["app/b.ts", "app/a.ts"];
    const rows = [{ p: "app/z.ts" }, { p: "app/y.ts" }, { p: "app/a.ts" }, { p: "app/b.ts" }];
    expect([...rows].sort(byRiskOrder(order, (row) => row.p)).map((row) => row.p)).toEqual([
      "app/b.ts",
      "app/a.ts",
      "app/z.ts",
      "app/y.ts",
    ]);
  });
});
