import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { checkQuotedCode, stripCommonIndent } from "@/lib/review/quote-match";
import { SweepIncompleteError, assertSweepComplete, runSweeps } from "@/lib/review/sweep";

const PATCH = [
  "diff --git a/src/orders.ts b/src/orders.ts",
  "--- a/src/orders.ts",
  "+++ b/src/orders.ts",
  "@@ -10,3 +10,6 @@",
  " const existing = 1;",
  "+const user = payload as User;",
  "+console.log('debugging');",
  "+// TODO: finish this",
  " const after = 2;",
  "-const removed = someValue as Legacy;",
  "",
].join("\n");

const FILES = parseUnifiedDiff(PATCH);
const TARGETS = FILES.map((file) => ({ repo: "primary" as const, file }));

const RULES = [
  { code: "3", sweepPatterns: ["\\bas\\b"] },
  { code: "6", sweepPatterns: ["console\\."] },
  { code: "7", sweepPatterns: ["TODO", "FIXME"] },
];

describe("mechanical sweeps", () => {
  it("finds every pattern in the added lines", () => {
    const outcome = runSweeps(TARGETS, RULES);
    const codes = outcome.hits.map((hit) => hit.ruleCode).sort();
    expect(codes).toEqual(["3", "6", "7"]);
  });

  it("reports the line number in the post-change file, which is what a finding cites", () => {
    const outcome = runSweeps(TARGETS, RULES);
    const cast = outcome.hits.find((hit) => hit.ruleCode === "3");
    expect(cast?.line).toBe(11);
    expect(cast?.excerpt).toBe("const user = payload as User;");
  });

  it("sweeps only added lines, matching the protocol's scope rule", () => {
    // The removed line also contains "as", but the change did not introduce it.
    const outcome = runSweeps(TARGETS, RULES);
    expect(outcome.hits.filter((hit) => hit.ruleCode === "3")).toHaveLength(1);
    expect(outcome.hits.some((hit) => hit.excerpt.includes("someValue"))).toBe(false);
  });

  it("does not skip a second match because of regex state", () => {
    // A global regex would skip every other line through lastIndex.
    const repeated = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,0 +1,3 @@",
      "+const a = x as A;",
      "+const b = y as B;",
      "+const c = z as C;",
      "",
    ].join("\n");
    const outcome = runSweeps(
      parseUnifiedDiff(repeated).map((file) => ({ repo: "primary" as const, file })),
      [{ code: "3", sweepPatterns: ["\\bas\\b"] }],
    );
    expect(outcome.hits).toHaveLength(3);
  });

  it("counts what it scanned, so a sweep that ran is distinguishable from one that did not", () => {
    const outcome = runSweeps(TARGETS, RULES);
    expect(outcome.linesScanned).toBe(3);
    expect(outcome.patternsRun).toBe(4);
  });

  it("skips binary files rather than pretending to have read them", () => {
    const binary = [
      "diff --git a/img.png b/img.png",
      "index 111..222 100644",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const outcome = runSweeps(
      parseUnifiedDiff(binary).map((file) => ({ repo: "primary" as const, file })),
      RULES,
    );
    expect(outcome.hits).toEqual([]);
  });

  it("reports an unusable pattern instead of quietly running fewer checks", () => {
    // Fewer patterns means fewer hits, and fewer hits looks like cleaner code.
    const outcome = runSweeps(TARGETS, [{ code: "9", sweepPatterns: ["([unclosed"] }]);
    expect(outcome.problems).toHaveLength(1);
    expect(outcome.problems[0]?.ruleCode).toBe("9");
    expect(() => assertSweepComplete(outcome)).toThrow(SweepIncompleteError);
  });

  it("passes the completeness check when every pattern ran", () => {
    expect(() => assertSweepComplete(runSweeps(TARGETS, RULES))).not.toThrow();
  });

  it("returns nothing when there are no patterns, without failing", () => {
    const outcome = runSweeps(TARGETS, [{ code: "1", sweepPatterns: [] }]);
    expect(outcome.hits).toEqual([]);
    expect(outcome.problems).toEqual([]);
  });
});

const FILE = ["export function total(items: Item[]) {", "  return items.length;", "}", ""].join(
  "\n",
);

describe("checking a finding's quotation", () => {
  it("accepts a quote that matches the cited lines", () => {
    const check = checkQuotedCode(FILE, 2, 2, "  return items.length;");
    expect(check.matches).toBe(true);
  });

  it("accepts a multi-line quote", () => {
    const check = checkQuotedCode(FILE, 1, 3, FILE.split("\n").slice(0, 3).join("\n"));
    expect(check.matches).toBe(true);
  });

  it("rejects a quote of code that is not at those lines", () => {
    // The finding that reads well and cites the wrong place.
    const check = checkQuotedCode(FILE, 1, 1, "  return items.length;");
    expect(check.matches).toBe(false);
    if (!check.matches) expect(check.reason.kind).toBe("content-differs");
  });

  it("rejects a paraphrase, however close", () => {
    const check = checkQuotedCode(FILE, 2, 2, "  return items.count;");
    expect(check.matches).toBe(false);
  });

  it("rejects lines past the end of the file", () => {
    const check = checkQuotedCode(FILE, 40, 41, "anything");
    expect(check.matches).toBe(false);
    if (!check.matches) {
      expect(check.reason.kind).toBe("out-of-range");
      if (check.reason.kind === "out-of-range") expect(check.reason.fileLines).toBe(3);
    }
  });

  it("rejects a finding that quoted nothing", () => {
    const check = checkQuotedCode(FILE, 1, 1, "   ");
    expect(check.matches).toBe(false);
    if (!check.matches) expect(check.reason.kind).toBe("empty-quote");
  });

  it("rejects a backwards or zero line range", () => {
    expect(checkQuotedCode(FILE, 3, 1, "x").matches).toBe(false);
    expect(checkQuotedCode(FILE, 0, 1, "x").matches).toBe(false);
  });

  it("forgives indentation the quote lost, since that carries no meaning", () => {
    expect(checkQuotedCode(FILE, 2, 2, "return items.length;").matches).toBe(true);
  });

  it("forgives a trailing newline and trailing spaces", () => {
    expect(checkQuotedCode(FILE, 2, 2, "  return items.length;   \n").matches).toBe(true);
  });

  it("forgives carriage returns, so a Windows checkout still verifies", () => {
    const crlf = FILE.split("\n").join("\r\n");
    expect(checkQuotedCode(crlf, 2, 2, "  return items.length;").matches).toBe(true);
  });

  it("does not treat the blank line after a trailing newline as a real line", () => {
    // Citing it would otherwise look like a valid quotation of nothing.
    expect(checkQuotedCode(FILE, 4, 4, "").matches).toBe(false);
  });

  it("strips only the indentation common to every line", () => {
    expect(stripCommonIndent("    a\n      b")).toBe("a\n  b");
  });
});
