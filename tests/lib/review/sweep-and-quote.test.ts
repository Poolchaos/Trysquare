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

  it("records one hit per rule and line, however many of its patterns match", () => {
    // A hit is dispositioned by path, line and rule, so a second pattern of
    // the same rule made a hit no answer could reach (audit finding 11).
    // Two rules on one line are two hits: each is its own disposition.
    const outcome = runSweeps(TARGETS, [
      { code: "7", sweepPatterns: ["TODO", "finish"] },
      { code: "8", sweepPatterns: ["TODO"] },
    ]);
    expect(outcome.hits.map((hit) => [hit.ruleCode, hit.line, hit.pattern])).toEqual([
      ["7", 13, "TODO"],
      ["8", 13, "TODO"],
    ]);
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

  it("runs a pattern that is not a regular expression as literal text", () => {
    // Protocol authors write sweep patterns as code fragments, and a fragment
    // ending in an open bracket is an unterminated group to the regex engine.
    // Refusing it failed a real 61-file review in S0 over one character of
    // punctuation, while the author's intent, find this text, was never in
    // doubt. The pattern that did it was "new Date(".
    const outcome = runSweeps(TARGETS, [{ code: "29", sweepPatterns: ["console.log("] }]);

    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits[0]?.line).toBe(12);
    expect(outcome.hits[0]?.ruleCode).toBe("29");
    expect(outcome.patternsRun).toBe(1);
    // Read that way, and said so: silence here would be the sweep quietly
    // meaning something other than what the protocol wrote.
    expect(outcome.ranAsLiteral).toEqual([{ ruleCode: "29", pattern: "console.log(" }]);
    expect(outcome.problems).toEqual([]);
    expect(() => assertSweepComplete(outcome)).not.toThrow();
  });

  it("still reads a valid pattern as a regular expression, not as text", () => {
    // The fallback must not swallow the normal case: escaped and alternating
    // patterns are how the example protocol is written, and reading one
    // literally would silently stop it matching anything.
    const outcome = runSweeps(TARGETS, [{ code: "6", sweepPatterns: ["console\\.(log|warn)"] }]);

    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits[0]?.excerpt).toContain("console.log");
    expect(outcome.ranAsLiteral).toEqual([]);
  });

  it("still refuses an outcome carrying a pattern that could not be run at all", () => {
    // The guard is tested directly rather than through runSweeps: escaping
    // makes every pattern runnable, so this is the boundary holding for a
    // future compile() that can fail, not a path reachable today.
    const outcome = {
      hits: [],
      problems: [{ ruleCode: "9", pattern: "x", reason: "unrunnable" }],
      ranAsLiteral: [],
      patternsRun: 0,
      linesScanned: 0,
    };
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

describe("valid quotations the check used to kill (4.21)", () => {
  it("forgives the byte-order mark at the start of a file, across lines", () => {
    // The mark is invisible, so no quote carries it; on one line it already
    // passed as indentation, across two it did not.
    const bom = "\uFEFFimport { a } from './a';\nexport const b = a;\n";
    expect(
      checkQuotedCode(bom, 1, 2, "import { a } from './a';\nexport const b = a;").matches,
    ).toBe(true);
  });

  it("forgives tabs quoted as spaces, nested", () => {
    const tabbed = "function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n";
    const quoted = "  if (x) {\n    return 1;\n  }";
    expect(checkQuotedCode(tabbed, 2, 4, quoted).matches).toBe(true);
  });

  it("forgives a faithful quote of a file that mixes tabs and spaces", () => {
    const mixed = "\tif (a) {\n        b();\n";
    expect(checkQuotedCode(mixed, 1, 2, "    if (a) {\n        b();").matches).toBe(true);
    expect(checkQuotedCode(mixed, 1, 2, "        if (a) {\n        b();").matches).toBe(true);
  });

  it("still holds space indentation to what the file has, where no tab is involved", () => {
    const spaced = "if (x) {\n  y();\n}\n";
    expect(checkQuotedCode(spaced, 1, 3, "if (x) {\n    y();\n}").matches).toBe(false);
  });

  it("still kills a quote whose code differs under a tab", () => {
    const tabbed = "\tif (x) {\n\t\treturn 1;\n\t}\n";
    expect(checkQuotedCode(tabbed, 1, 3, "if (x) {\n  return 2;\n}").matches).toBe(false);
  });
});

describe("what the tab and Unicode forgiveness must not let through (D-115)", () => {
  // Indentation is meaning in Python and YAML, and a quote that re-nests a
  // line misstates the code however the tabs are written.
  const python = "if x:\n\tif y:\n\t\tfoo()\n\tbar()\n";

  it("kills a quote that moves a line into a deeper block", () => {
    expect(
      checkQuotedCode(python, 1, 4, "if x:\n    if y:\n        foo()\n        bar()").matches,
    ).toBe(false);
  });

  it("kills a quote that moves a line out of its block", () => {
    expect(checkQuotedCode(python, 1, 4, "if x:\n    if y:\n    foo()\n    bar()").matches).toBe(
      false,
    );
  });

  it("kills a re-nesting written in tabs on both sides", () => {
    expect(checkQuotedCode(python, 1, 4, "if x:\n\tif y:\n\t\tfoo()\n\t\tbar()").matches).toBe(
      false,
    );
  });

  it("kills a re-nesting a quote writes in tabs over a space-indented file", () => {
    const spaced = "if x:\n    if y:\n        foo()\n    bar()\n";
    expect(checkQuotedCode(spaced, 1, 4, "if x:\n\tif y:\n\t\tfoo()\n\t\tbar()").matches).toBe(
      false,
    );
  });

  it("kills a quote that re-nests one line with tabs over a space-indented file", () => {
    // At a tab width of 2 the two tabs equal the file's four spaces, but a
    // file with no tab has no tab width to forgive.
    const spaced = "if x:\n    if y:\n        foo()\n    bar()\n";
    expect(
      checkQuotedCode(spaced, 1, 4, "if x:\n    if y:\n        foo()\n\t\tbar()").matches,
    ).toBe(false);
  });

  it("kills characters Unicode calls equivalent, since code tells them apart", () => {
    // OHM SIGN and GREEK CAPITAL OMEGA are one character after NFC, and two
    // different values in a string or two different identifiers in code.
    const ohm = 'if (unit === "\u2126") {}\n';
    expect(checkQuotedCode(ohm, 1, 1, 'if (unit === "\u03A9") {}').matches).toBe(false);
    const decomposed = "const cafe\u0301 = 1;\n";
    expect(checkQuotedCode(decomposed, 1, 1, "const caf\u00e9 = 1;").matches).toBe(false);
  });

  it("forgives a byte-order mark only at the start of the file", () => {
    const midFile = "a();\n\uFEFFb();\nc();\n";
    expect(checkQuotedCode(midFile, 2, 3, "b();\nc();").matches).toBe(false);
  });
});
