/**
 * The pipeline end to end, driven by a scripted stage runner.
 *
 * The point of these tests is not that a model says something sensible; it is
 * that the program does the right thing with whatever a model says, including
 * when what it says is wrong, incomplete, or invented.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { DeletionsNotAccountedError, StageDidNotAccountError } from "@/lib/review/coverage";
import type { Db } from "@/server/db/client";
import { deleteAllForReview, listFindings, statusOf } from "@/server/db/repositories/findings";
import {
  IncompleteCoverageError,
  coverageReport,
  listHunks,
  listLedgerFiles,
  listSweepHits,
} from "@/server/db/repositories/ledger";
import {
  SweepDispositionUnmatchedError,
  SymbolVerdictUnbackedError,
  runReviewPipeline,
  type StageRequest,
  type StageResponse,
} from "@/server/review/pipeline";
import { readRunNotes, requireReview } from "@/server/db/repositories/reviews";
import { makeTestDb, seedProject, seedReview, type TestDb } from "../db/helpers";

const SOURCE = [
  "export function total(items: Item[]) {",
  "  const user = payload as User;",
  "  return items.reduce((sum, item) => sum + item.price, 0);",
  "}",
  "",
].join("\n");

const PATCH = [
  "diff --git a/orders.ts b/orders.ts",
  "--- a/orders.ts",
  "+++ b/orders.ts",
  "@@ -1,2 +1,4 @@",
  " export function total(items: Item[]) {",
  "+  const user = payload as User;",
  "+  return items.reduce((sum, item) => sum + item.price, 0);",
  " }",
  "",
].join("\n");

const FILES = parseUnifiedDiff(PATCH).map((file) => ({
  repo: "primary" as const,
  slug: "app",
  file,
}));

/** A rule as the importer produces one, since the pipeline plans batches from these. */
function rule(code: string, tags: string[], sweepPatterns: string[] = []) {
  return {
    code,
    title: `Rule ${code}`,
    severity: "WARNING" as const,
    tags,
    ruleText: "text",
    violationExample: null,
    correctPattern: null,
    detection: null,
    notes: null,
    sweepPatterns,
    group: "Group",
    raw: "raw",
    startLine: 1,
    endLine: 2,
  };
}

const RULES = [rule("3", ["typescript"], ["\\bas\\b"])];

let ctx: TestDb;
let db: Db;
let reviewId: string;
let worktreeRoot: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = seedReview(db, seedProject(db).id).id;
  worktreeRoot = mkdtempSync(join(tmpdir(), "trysquare-pipeline-"));
  mkdirSync(join(worktreeRoot, "app"), { recursive: true });
  writeFileSync(join(worktreeRoot, "app", "orders.ts"), SOURCE);
});

afterEach(() => {
  ctx.cleanup();
  rmSync(worktreeRoot, { recursive: true, force: true });
});

/** A stage runner that replays scripted answers, keyed by stage. */
function scripted(
  answers: Partial<Record<string, unknown>>,
): (r: StageRequest) => Promise<StageResponse> {
  return async (request) => ({
    output: answers[request.stage] ?? {},
    sessionId: `session-${request.stage}`,
  });
}

const COMPLETE_ADVERSARIAL = {
  findings: [
    {
      path: "app/orders.ts",
      lineStart: 2,
      lineEnd: 2,
      severity: "CRITICAL",
      ruleCode: "3",
      issue: "Unchecked cast on external data.",
      comment: "payload is not validated before being treated as a User.",
      mechanism: "payload arrives untyped at line 2 and is asserted rather than parsed",
    },
  ],
  clearedHunks: [],
  sweepDispositions: [
    {
      path: "app/orders.ts",
      line: 2,
      ruleCode: "3",
      disposition: "finding",
      reason: "This is the cast the finding is about.",
    },
  ],
};

const BASE_ANSWERS = {
  s1_risk: { files: [{ path: "app/orders.ts", riskTags: ["money"], reason: "totals" }] },
  s2_comprehension: {
    files: [
      {
        path: "app/orders.ts",
        summary: "Adds a cast and a total.",
        chainFilesRead: ["app/types.ts"],
        uncertainties: [],
      },
    ],
  },
  s3_adversarial: COMPLETE_ADVERSARIAL,
  s4_deletions: { findings: [], reviewedDeletions: [] },
};

function run(answers: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return runReviewPipeline({
    db,
    reviewId,
    worktreeRoot,
    files: FILES,
    rules: RULES,
    profile: "full-context",
    systemPromptFor: (stage) => `prompt for ${stage}`,
    run: scripted(answers),
    ...overrides,
  });
}

describe("a complete run", () => {
  it("verifies a finding whose quotation matches the file", async () => {
    const result = await run({
      ...BASE_ANSWERS,
      s5_verification: {
        verdicts: [
          {
            ref: "",
            verdict: "verified",
            quotedCode: "  const user = payload as User;",
            lineStart: 2,
            lineEnd: 2,
            note: "Confirmed against the file.",
          },
        ],
      },
    });
    // The scripted verdict names no candidate, so it matches nothing and the
    // candidate is left stranded, which the pipeline turns into a question.
    expect(result.candidatesRaised).toBe(1);
    expect(result.openQuestions).toBe(1);
    expect(result.coverage.pendingHunks).toBe(0);
  });

  it("passes the audit only when everything is dispositioned", async () => {
    const result = await run({ ...BASE_ANSWERS, s5_verification: { verdicts: [] } });
    expect(result.coverage.pendingHunks).toBe(0);
    expect(result.coverage.pendingSweepHits).toBe(0);
    expect(result.coverage.unresolvedCandidates).toBe(0);
  });

  it("records the sweep hit the mechanical pass found", async () => {
    // The cast is found by the program before any model runs.
    const result = await run({ ...BASE_ANSWERS, s5_verification: { verdicts: [] } });
    expect(result.coverage.totalSweepHits).toBe(1);
  });
});

describe("a stage that divides its work", () => {
  it("tells each request which of how many it is", async () => {
    // The prompt was written to say this and never once did: the total was
    // hardcoded to zero, which is falsy, so the line was skipped on every
    // batched request ever sent. A model told to account only for what it
    // was shown deserves to know it is one of several.
    const prompts: string[] = [];
    const manyRules = [
      rule("1", ["typescript"]),
      rule("2", ["async"]),
      rule("3", ["typescript"], ["\\bas\\b"]),
      rule("4", ["security"]),
    ];

    await run(
      { ...BASE_ANSWERS, s5_verification: { verdicts: [] } },
      {
        rules: manyRules,
        profile: "decomposed",
        run: async (request: StageRequest) => {
          if (request.stage === "s3_adversarial") prompts.push(request.prompt);
          return {
            output:
              request.stage === "s3_adversarial"
                ? { findings: [], clearedHunks: [], sweepDispositions: [], symbolDispositions: [] }
                : ((
                    {
                      ...BASE_ANSWERS,
                      s5_verification: { verdicts: [] },
                    } as Record<string, unknown>
                  )[request.stage] ?? {}),
            sessionId: "s",
          };
        },
      },
    ).catch(() => undefined);

    expect(prompts.length).toBeGreaterThan(1);
    // Numbered against the real total, not against zero.
    for (const [index, prompt] of prompts.entries()) {
      expect(prompt).toContain(`This is request ${index + 1} of ${prompts.length}`);
    }
  });
});

describe("a rule code a model wrote in prose", () => {
  it("reaches the finding row in the ruleset's own spelling", async () => {
    // Both live runs answered "Rule 1" where the protocol says "1". The
    // confirmation screen looks the code up to show the rule's own words, so
    // a prose code shows the rule as missing from the ruleset it came from.
    const result = await run({
      ...BASE_ANSWERS,
      s3_adversarial: {
        ...COMPLETE_ADVERSARIAL,
        findings: [{ ...COMPLETE_ADVERSARIAL.findings[0]!, ruleCode: "Rule 3" }],
      },
      s5_verification: { verdicts: [] },
    });

    expect(result.candidatesRaised).toBe(1);
    expect(listFindings(db, reviewId)[0]?.ruleCode).toBe("3");
  });

  it("does not stop the run when a sweep disposition is written the same way", async () => {
    // This one is not cosmetic: a disposition's code is compared against the
    // sweep hit's, which came from the ruleset, so a prose code there fails
    // reconciliation and the whole review stops.
    const result = await run({
      ...BASE_ANSWERS,
      s3_adversarial: {
        ...COMPLETE_ADVERSARIAL,
        sweepDispositions: [{ ...COMPLETE_ADVERSARIAL.sweepDispositions[0]!, ruleCode: "rule 3" }],
      },
      s5_verification: { verdicts: [] },
    });

    expect(result.coverage.pendingSweepHits).toBe(0);
  });

  it("keeps a code that is not in the ruleset, rather than dropping it", async () => {
    const result = await run({
      ...BASE_ANSWERS,
      s3_adversarial: {
        ...COMPLETE_ADVERSARIAL,
        findings: [{ ...COMPLETE_ADVERSARIAL.findings[0]!, ruleCode: "Rule 99" }],
      },
      s5_verification: { verdicts: [] },
    });

    // The screen says such a code is not in the frozen ruleset, which is both
    // true and worth knowing; nulling it would hide that a rule was cited.
    expect(result.candidatesRaised).toBe(1);
    expect(listFindings(db, reviewId)[0]?.ruleCode).toBe("Rule 99");
  });
});

describe("a finding two stages both report", () => {
  /** The deletions stage repeating the adversarial stage's finding, its own way. */
  const restated = (overrides: Record<string, unknown> = {}) => ({
    path: "app/orders.ts",
    lineStart: 2,
    lineEnd: 2,
    severity: "CRITICAL" as const,
    ruleCode: "3",
    issue: "The cast that replaced validation was removed from the guarded path.",
    comment: "Read from what the change removed rather than what it added.",
    mechanism: "the removed line at 2 left payload asserted rather than parsed",
    ...overrides,
  });

  it("folds the repeat into the finding already raised", async () => {
    // Both live runs of the seeded fixture did this: nine defects arrived as
    // eighteen candidates, and a person would have decided each one twice.
    const result = await run({
      ...BASE_ANSWERS,
      s4_deletions: { findings: [restated()], reviewedDeletions: [] },
      s5_verification: { verdicts: [] },
    });

    expect(result.candidatesRaised).toBe(1);
    expect(listFindings(db, reviewId)).toHaveLength(1);
    // The one kept is the one raised first, with its own wording intact.
    expect(listFindings(db, reviewId)[0]?.issue).toBe("Unchecked cast on external data.");
  });

  it("says on the run how often the deletions stage repeated itself", async () => {
    // Folded, not hidden: how often this happens is the measurement of
    // whether the deletion stage's prompt is scoped correctly.
    await run({
      ...BASE_ANSWERS,
      s4_deletions: { findings: [restated()], reviewedDeletions: [] },
      s5_verification: { verdicts: [] },
    });

    const notes = readRunNotes(requireReview(db, reviewId)).filter((note) =>
      note.message.includes("already reported"),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toContain("app/orders.ts:2");
  });

  it("keeps a finding that cites a different rule at the same line", async () => {
    // The negative control. Two rules can be broken by one line, and folding
    // on position alone would eat the second one silently, which is the
    // failure this pipeline exists to prevent.
    const result = await run({
      ...BASE_ANSWERS,
      s4_deletions: {
        findings: [restated({ ruleCode: "9", issue: "A different rule, same line." })],
        reviewedDeletions: [],
      },
      s5_verification: { verdicts: [] },
    });

    expect(result.candidatesRaised).toBe(2);
  });

  it("keeps a finding that names no rule, rather than guessing it is the same one", async () => {
    // Two findings at one line that both cite nothing are indistinguishable
    // here, so folding them would be a guess. The direction to guess in is
    // the one that keeps both: a duplicate is noise, a lost finding is not.
    const result = await run({
      ...BASE_ANSWERS,
      s3_adversarial: {
        ...COMPLETE_ADVERSARIAL,
        findings: [{ ...COMPLETE_ADVERSARIAL.findings[0]!, ruleCode: null }],
      },
      s4_deletions: {
        findings: [restated({ ruleCode: null, issue: "Also unattributed, also line 2." })],
        reviewedDeletions: [],
      },
      s5_verification: { verdicts: [] },
    });

    expect(result.candidatesRaised).toBe(2);
  });

  it("keeps a finding at a line the earlier one does not cover", async () => {
    const result = await run({
      ...BASE_ANSWERS,
      s4_deletions: {
        findings: [restated({ lineStart: 3, lineEnd: 3, issue: "The reduce, not the cast." })],
        reviewedDeletions: [],
      },
      s5_verification: { verdicts: [] },
    });

    expect(result.candidatesRaised).toBe(2);
  });
});

describe("refusing to accept an incomplete stage", () => {
  it("fails when a hunk was neither given a finding nor cleared", async () => {
    await expect(
      run({
        ...BASE_ANSWERS,
        s3_adversarial: { findings: [], clearedHunks: [], sweepDispositions: [] },
        s5_verification: { verdicts: [] },
      }),
    ).rejects.toThrow(StageDidNotAccountError);
  });

  it("fails when a sweep hit was left undispositioned", async () => {
    await expect(
      run({
        ...BASE_ANSWERS,
        s3_adversarial: {
          findings: [],
          clearedHunks: [{ path: "app/orders.ts", hunkIndex: 0, reason: "fine" }],
          sweepDispositions: [],
        },
        s5_verification: { verdicts: [] },
      }),
    ).rejects.toThrow(/undispositioned/);
  });

  it("fails when a stage reports a hunk that is not in the change set", async () => {
    await expect(
      run({
        ...BASE_ANSWERS,
        s3_adversarial: {
          findings: [],
          clearedHunks: [
            { path: "app/orders.ts", hunkIndex: 0, reason: "fine" },
            { path: "imaginary.ts", hunkIndex: 4, reason: "invented" },
          ],
          sweepDispositions: COMPLETE_ADVERSARIAL.sweepDispositions.map((d) => ({
            ...d,
            disposition: "cleared" as const,
          })),
        },
        s5_verification: { verdicts: [] },
      }),
    ).rejects.toThrow(/not in the change set/);
  });

  describe("a finding that sits outside every hunk", () => {
    // Eleven lines, one inserted at line 6, so lines 1, 2, 10 and 11 are in
    // the file but outside the only hunk (lines 3 to 9 with context).
    const LONG_SOURCE = ["l1", "l2", "l3", "l4", "l5", "added", "l6", "l7", "l8", "l9", "l10", ""];
    const LONG_FILES = parseUnifiedDiff(
      [
        "diff --git a/long.ts b/long.ts",
        "--- a/long.ts",
        "+++ b/long.ts",
        "@@ -3,6 +3,7 @@",
        " l3",
        " l4",
        " l5",
        "+added",
        " l6",
        " l7",
        " l8",
        "",
      ].join("\n"),
    ).map((file) => ({ repo: "primary" as const, slug: "app", file }));

    const finding = (lineStart: number, lineEnd: number) => ({
      ...COMPLETE_ADVERSARIAL.findings[0]!,
      path: "app/long.ts",
      lineStart,
      lineEnd,
    });

    function runLong(adversarial: Record<string, unknown>) {
      writeFileSync(join(worktreeRoot, "app", "long.ts"), LONG_SOURCE.join("\n"));
      return run(
        {
          s1_risk: { files: [] },
          s2_comprehension: { files: [] },
          s3_adversarial: { clearedHunks: [], sweepDispositions: [], ...adversarial },
          s4_deletions: { findings: [], reviewedDeletions: [] },
          s5_verification: { verdicts: [] },
        },
        { files: LONG_FILES },
      );
    }

    it("does not account for the hunk, which is still owed a finding or a clear", async () => {
      // Line 11 exists and was never changed. A finding there used to stand in
      // for the file's first hunk, so a stage could account for code it never
      // looked at by citing code nobody asked it about.
      await expect(runLong({ findings: [finding(11, 11)] })).rejects.toThrow(
        /neither given a finding nor cleared \(for example app\/long\.ts hunk 0\)/,
      );
    });

    it("is kept once the hunk is accounted for, and left to verification", async () => {
      const result = await runLong({
        findings: [finding(11, 11)],
        clearedHunks: [{ path: "app/long.ts", hunkIndex: 0, reason: "only an insertion" }],
      });
      expect(result.candidatesRaised).toBe(1);
      expect(listFindings(db, reviewId)[0]?.lineStart).toBe(11);
    });

    it("does not account for a hunk its range only passes over", async () => {
      // Lines 1 to 11 start and end outside the hunk at 3 to 9. Counting any
      // overlap let one finding at 1 to 999999 account for every hunk in its
      // file (D-101).
      await expect(runLong({ findings: [finding(1, 11)] })).rejects.toThrow(
        /neither given a finding nor cleared/,
      );
      await expect(runLong({ findings: [finding(1, 999999)] })).rejects.toThrow(
        /neither given a finding nor cleared/,
      );
    });

    it("accounts for a hunk its line range reaches into from above", async () => {
      // Lines 1 to 6 start outside the hunk and end on the inserted line, so
      // the finding is about what changed.
      const result = await runLong({ findings: [finding(1, 6)] });
      expect(result.coverage.pendingHunks).toBe(0);
    });
  });

  it("fails when a finding cites a file that is not in the change set", async () => {
    await expect(
      run({
        ...BASE_ANSWERS,
        s3_adversarial: {
          ...COMPLETE_ADVERSARIAL,
          findings: [
            ...COMPLETE_ADVERSARIAL.findings,
            { ...COMPLETE_ADVERSARIAL.findings[0]!, path: "app/imaginary.ts" },
          ],
        },
        s5_verification: { verdicts: [] },
      }),
    ).rejects.toThrow(/not in the change set/);
  });

  it("rejects a malformed stage answer rather than working around it", async () => {
    await expect(run({ ...BASE_ANSWERS, s1_risk: { wrong: "shape" } })).rejects.toThrow();
  });

  it("runs a pattern that is not a regex as literal text, and says so on the run", async () => {
    // The whole review used to die here. A pattern written as a code
    // fragment, which is how protocol authors write them, is an unterminated
    // group to the regex engine; refusing it cost a real 61-file review its
    // S0. The hit it produces is an ordinary hit: recorded, and dispositioned
    // by the adversarial stage like every other.
    const literalRules = [...RULES, rule("29", ["general"], ["reduce((sum"])];
    const answers = {
      ...BASE_ANSWERS,
      s3_adversarial: {
        ...COMPLETE_ADVERSARIAL,
        sweepDispositions: [
          ...COMPLETE_ADVERSARIAL.sweepDispositions,
          {
            path: "app/orders.ts",
            line: 3,
            ruleCode: "29",
            disposition: "cleared" as const,
            reason: "Examined; the reduce is over a fixed list.",
          },
        ],
      },
      s5_verification: { verdicts: [] },
    };

    const result = await run(answers, { rules: literalRules });

    expect(result.coverage.totalSweepHits).toBe(2);
    expect(result.coverage.pendingSweepHits).toBe(0);
    expect(listSweepHits(db, reviewId).some((hit) => hit.ruleCode === "29")).toBe(true);

    // Named on the review, because a pattern read as text means something
    // different from the same pattern read as a regex, and the difference is
    // the reviewer's to know.
    const notes = readRunNotes(requireReview(db, reviewId)).filter((note) =>
      note.message.includes("literal text"),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toContain("29 (reduce((sum)");
  });

  it("does not repeat the literal-pattern note when a run is resumed", async () => {
    // The note is written beside the sweep, and a resumed run re-runs the
    // sweep to re-check it. Writing the note again would have every resume
    // add a line saying the same thing about the same patterns.
    const literalRules = [...RULES, rule("29", ["general"], ["reduce((sum"])];
    const answers = {
      ...BASE_ANSWERS,
      s3_adversarial: {
        ...COMPLETE_ADVERSARIAL,
        sweepDispositions: [
          ...COMPLETE_ADVERSARIAL.sweepDispositions,
          {
            path: "app/orders.ts",
            line: 3,
            ruleCode: "29",
            disposition: "cleared" as const,
            reason: "Examined; the reduce is over a fixed list.",
          },
        ],
      },
      s5_verification: { verdicts: [] },
    };

    await run(answers, { rules: literalRules });
    await run(answers, { rules: literalRules });

    const notes = readRunNotes(requireReview(db, reviewId)).filter((note) =>
      note.message.includes("literal text"),
    );
    expect(notes).toHaveLength(1);
  });
});

describe("the quotation check", () => {
  async function verifyWith(quote: string, lineStart: number, lineEnd: number) {
    const runner = async (request: StageRequest): Promise<StageResponse> => {
      if (request.stage === "s5_verification") {
        return {
          output: {
            verdicts: [
              {
                // The first candidate, by the label the prompt gives it. No
                // database read is needed, because the label does not depend
                // on ids that change between runs.
                ref: "C1",
                verdict: "verified",
                quotedCode: quote,
                lineStart,
                lineEnd,
                note: "checked",
              },
            ],
          },
          sessionId: "s",
        };
      }
      return {
        output: BASE_ANSWERS[request.stage as keyof typeof BASE_ANSWERS] ?? {},
        sessionId: "s",
      };
    };

    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: FILES,
      rules: RULES,
      profile: "full-context",
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: runner,
    });
    return { result };
  }

  it("verifies a finding that quoted the file accurately", async () => {
    const { result } = await verifyWith("  const user = payload as User;", 2, 2);
    expect(result.verified).toBe(1);
    expect(result.killedByQuoteCheck).toBe(0);

    const finding = listFindings(db, reviewId)[0]!;
    expect(statusOf(finding)).toBe("verified");
    expect(finding.quotedCode).toContain("payload as User");
  });

  it("kills a finding whose quotation is not what is at those lines", async () => {
    // The dangerous case: a plausible finding citing code that is not there.
    const { result } = await verifyWith("  const user = validate(payload);", 2, 2);
    expect(result.verified).toBe(0);
    expect(result.killedByQuoteCheck).toBe(1);

    const finding = listFindings(db, reviewId)[0]!;
    expect(statusOf(finding)).toBe("killed");
    expect(finding.verificationNote).toContain("did not match the file");
  });

  it("kills a finding citing lines past the end of the file", async () => {
    const { result } = await verifyWith("  const user = payload as User;", 90, 91);
    expect(result.killedByQuoteCheck).toBe(1);
  });

  it("kills a finding whose file does not exist", async () => {
    rmSync(join(worktreeRoot, "app", "orders.ts"));
    const { result } = await verifyWith("  const user = payload as User;", 2, 2);
    expect(result.killedByQuoteCheck).toBe(1);
    const finding = listFindings(db, reviewId)[0]!;
    expect(finding.verificationNote).toContain("could not be read");
  });

  it("kills a finding verified by quoting code it does not cite", async () => {
    // Line 1 is quoted exactly, but the finding is about line 2. The verdict
    // used to move the finding to line 1, so a true quotation of unrelated
    // code verified it (4.1 audit: a candidate at 500 verified by line 1).
    const { result } = await verifyWith("export function total(items: Item[]) {", 1, 1);
    expect(result.verified).toBe(0);
    expect(result.killedByQuoteCheck).toBe(1);

    const finding = listFindings(db, reviewId)[0]!;
    expect(statusOf(finding)).toBe("killed");
    expect(finding.lineStart).toBe(2);
    expect(finding.verificationNote).toBe(
      "Verification quoted line 1, which does not overlap the cited line 2.",
    );
  });

  it("verifies a quotation that corrects the range while still overlapping it", async () => {
    const { result } = await verifyWith(
      [
        "  const user = payload as User;",
        "  return items.reduce((sum, item) => sum + item.price, 0);",
      ].join("\n"),
      2,
      3,
    );
    expect(result.verified).toBe(1);
    expect(listFindings(db, reviewId)[0]?.lineEnd).toBe(3);
  });

  it("still passes the audit after a finding is killed", async () => {
    // A killed finding is resolved, not outstanding.
    const { result } = await verifyWith("wrong code", 2, 2);
    expect(result.coverage.unresolvedCandidates).toBe(0);
  });

  it("counts what was accounted for only by the finding it killed", async () => {
    // Still covered (D-97), but said, so a refutation never reads as a pass.
    const { result } = await verifyWith("wrong code", 2, 2);
    expect(result.coverage.pendingHunks).toBe(0);
    expect(result.coverage.refutedOnlyHunks).toBe(1);
    expect(result.coverage.refutedOnlySweepHits).toBe(1);
  });

  it("counts nothing as refuted when the finding stands", async () => {
    const { result } = await verifyWith("  const user = payload as User;", 2, 2);
    expect(result.coverage.refutedOnlyHunks).toBe(0);
    expect(result.coverage.refutedOnlySweepHits).toBe(0);
  });
});

describe("a hunk with one finding refuted and another standing", () => {
  // Line 2 holds the cast the sweep hit, line 3 the sum; both are in the
  // file's only hunk.
  const BOTH = {
    ...COMPLETE_ADVERSARIAL,
    findings: [
      { ...COMPLETE_ADVERSARIAL.findings[0]!, lineStart: 2, lineEnd: 2 },
      { ...COMPLETE_ADVERSARIAL.findings[0]!, lineStart: 3, lineEnd: 3, issue: "Float sum" },
    ],
  };
  const verdict = (ref: string, line: number, verdict: "verified" | "killed") => ({
    ref,
    verdict,
    quotedCode: SOURCE.split("\n")[line - 1],
    lineStart: line,
    lineEnd: line,
    note: verdict === "killed" ? "Refuted." : "checked",
  });

  it("counts the hunk as standing, and the hit as refuted when its own finding fell", async () => {
    const result = await run({
      ...BASE_ANSWERS,
      s3_adversarial: BOTH,
      s5_verification: { verdicts: [verdict("C1", 2, "killed"), verdict("C2", 3, "verified")] },
    });
    expect(result.coverage.refutedOnlyHunks).toBe(0);
    expect(result.coverage.refutedOnlySweepHits).toBe(1);
  });

  it("counts neither when the finding on the hit's line stands", async () => {
    const result = await run({
      ...BASE_ANSWERS,
      s3_adversarial: BOTH,
      s5_verification: { verdicts: [verdict("C1", 2, "verified"), verdict("C2", 3, "killed")] },
    });
    expect(result.coverage.refutedOnlyHunks).toBe(0);
    expect(result.coverage.refutedOnlySweepHits).toBe(0);
  });
});

describe("a verdict that never arrives", () => {
  it("turns a candidate with no verdict into an open question, not a pass", async () => {
    const result = await run({ ...BASE_ANSWERS, s5_verification: { verdicts: [] } });
    expect(result.openQuestions).toBe(1);
    const finding = listFindings(db, reviewId)[0]!;
    expect(statusOf(finding)).toBe("open_question");
    expect(finding.verificationNote).toContain("no verdict");
  });

  it("never leaves the review claiming completeness with work outstanding", async () => {
    const result = await run({ ...BASE_ANSWERS, s5_verification: { verdicts: [] } });
    expect(() => {
      if (result.coverage.unresolvedCandidates > 0)
        throw new IncompleteCoverageError(reviewId, result.coverage, []);
    }).not.toThrow();
  });
});

describe("attaching a sweep hit to the finding it produced", () => {
  it("picks the finding whose line range contains the hit", async () => {
    // Matching on path alone would attach the hit to whichever finding came
    // first, which is only right by accident.
    const twoFindings = {
      ...COMPLETE_ADVERSARIAL,
      findings: [
        {
          ...COMPLETE_ADVERSARIAL.findings[0]!,
          lineStart: 3,
          lineEnd: 3,
          issue: "Float money sum",
        },
        { ...COMPLETE_ADVERSARIAL.findings[0]!, lineStart: 2, lineEnd: 2 },
      ],
    };

    await run({ ...BASE_ANSWERS, s3_adversarial: twoFindings, s5_verification: { verdicts: [] } });

    const hit = listSweepHits(db, reviewId)[0]!;
    const attached = listFindings(db, reviewId).find((f) => f.id === hit.findingId);
    expect(hit.disposition).toBe("finding");
    // The hit is at line 2, so it belongs to the second finding, not the first.
    expect(attached?.lineStart).toBe(2);
  });

  it("stops the run when a hit was called a finding but no finding exists", async () => {
    // A hit pointing at nothing reads as handled in the ledger and cannot be
    // traced back to anything, which is worse than leaving it open.
    await expect(
      run({
        ...BASE_ANSWERS,
        s3_adversarial: {
          findings: [],
          clearedHunks: [{ path: "app/orders.ts", hunkIndex: 0, reason: "nothing wrong" }],
          sweepDispositions: [
            {
              path: "app/orders.ts",
              line: 2,
              ruleCode: "3",
              disposition: "finding",
              reason: "claimed to be a finding",
            },
          ],
        },
        s5_verification: { verdicts: [] },
      }),
    ).rejects.toThrow(SweepDispositionUnmatchedError);
  });

  it("stops the run when the only finding in the file is on another line", async () => {
    // The hit is at line 2 and the finding at line 3. Attaching it to the
    // nearest finding marked the hit handled by a finding about something
    // else, so the cast at line 2 was never accounted for.
    await expect(
      run({
        ...BASE_ANSWERS,
        s3_adversarial: {
          ...COMPLETE_ADVERSARIAL,
          findings: [
            {
              ...COMPLETE_ADVERSARIAL.findings[0]!,
              lineStart: 3,
              lineEnd: 3,
              issue: "Float money sum",
            },
          ],
        },
        s5_verification: { verdicts: [] },
      }),
    ).rejects.toThrow(SweepDispositionUnmatchedError);
  });

  it("never stores a hit against an empty finding id", async () => {
    await run({ ...BASE_ANSWERS, s5_verification: { verdicts: [] } });
    for (const hit of listSweepHits(db, reviewId)) {
      if (hit.disposition === "finding") expect(hit.findingId).not.toBe("");
    }
  });
});

describe("dividing the adversarial work by profile", () => {
  const RULES_MANY = [
    rule("3", ["typescript"], ["\\bas\\b"]),
    rule("5", ["async"]),
    rule("8", ["numeric"]),
    rule("9", ["general"]),
  ];

  /** Answers every request with a complete accounting of what it was given. */
  function accountingRunner(seen: string[]) {
    return async (request: StageRequest): Promise<StageResponse> => {
      seen.push(request.stage);
      if (request.stage === "s3_adversarial") {
        // Each request accounts for the hunk and, on the request that carries
        // it, the sweep hit. Duplicated dispositions across requests are
        // harmless: reconciliation runs once over the union.
        const mentionsHit = request.prompt.includes("rule 3");
        return {
          output: {
            findings: [],
            clearedHunks: [{ path: "app/orders.ts", hunkIndex: 0, reason: "checked" }],
            sweepDispositions: mentionsHit
              ? [
                  {
                    path: "app/orders.ts",
                    line: 2,
                    ruleCode: "3",
                    disposition: "cleared",
                    reason: "cast is on a local literal",
                  },
                ]
              : [],
          },
          sessionId: "s",
        };
      }
      return {
        output:
          request.stage === "s5_verification"
            ? { verdicts: [] }
            : (BASE_ANSWERS[request.stage as keyof typeof BASE_ANSWERS] ?? {}),
        sessionId: "s",
      };
    };
  }

  it("makes one request on a full-context model", async () => {
    const seen: string[] = [];
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: FILES,
      rules: RULES_MANY,
      profile: "full-context",
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: accountingRunner(seen),
    });
    expect(result.adversarialRequests).toBe(1);
    expect(seen.filter((stage) => stage === "s3_adversarial")).toHaveLength(1);
  });

  it("makes one request per rule theme on a chunked model, and still reconciles", async () => {
    const seen: string[] = [];
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: FILES,
      rules: RULES_MANY,
      profile: "chunked",
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: accountingRunner(seen),
    });

    // Four themes, so four requests, whose union covers the change set.
    expect(result.adversarialRequests).toBe(4);
    expect(result.coverage.pendingHunks).toBe(0);
    expect(result.coverage.pendingSweepHits).toBe(0);
  });

  it("records what a narrowing profile did not check", async () => {
    const seen: string[] = [];
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      // A markdown file: the typescript and async themes do not apply to it.
      files: [
        ...FILES,
        ...parseUnifiedDiff(
          [
            "diff --git a/notes.md b/notes.md",
            "--- a/notes.md",
            "+++ b/notes.md",
            "@@ -1,1 +1,2 @@",
            " existing",
            "+added line",
            "",
          ].join("\n"),
        ).map((file) => ({ repo: "primary" as const, slug: "app", file })),
      ],
      rules: RULES_MANY,
      profile: "decomposed",
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: async (request) => {
        seen.push(request.stage);
        if (request.stage === "s3_adversarial") {
          return {
            output: {
              findings: [],
              clearedHunks: [
                { path: "app/orders.ts", hunkIndex: 0, reason: "checked" },
                { path: "app/notes.md", hunkIndex: 0, reason: "prose only" },
              ],
              sweepDispositions: request.prompt.includes("rule 3")
                ? [
                    {
                      path: "app/orders.ts",
                      line: 2,
                      ruleCode: "3",
                      disposition: "cleared",
                      reason: "local literal",
                    },
                  ]
                : [],
            },
            sessionId: "s",
          };
        }
        return {
          output:
            request.stage === "s5_verification"
              ? { verdicts: [] }
              : request.stage === "s1_risk"
                ? { files: [] }
                : request.stage === "s2_comprehension"
                  ? { files: [] }
                  : { findings: [], reviewedDeletions: [] },
          sessionId: "s",
        };
      },
    });

    // A narrowed review must never look identical to a complete one.
    expect(result.excludedPairs).toBeGreaterThan(0);
    const notes = readRunNotes(requireReview(db, reviewId));
    const excluded = notes.find((note) => note.kind === "excluded-pairs");
    expect(excluded?.message).toContain("did not check");
    expect(excluded?.message).toContain("notes.md");
  });

  it("reports a prompt that cannot fit even alone, rather than sending it silently", async () => {
    const seen: string[] = [];
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: FILES,
      rules: RULES_MANY,
      profile: "full-context",
      // Smaller than the single file's prompt, so the guard has to act and
      // there is nothing left to divide.
      contextWindow: 100,
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: accountingRunner(seen),
    });

    expect(result.coverage.pendingHunks).toBe(0);
    const notes = readRunNotes(requireReview(db, reviewId));
    // One file cannot be split further, so it is sent alone and reported.
    expect(notes.some((note) => note.kind === "oversized-prompt")).toBe(true);
  });

  it("makes a single request when no context window is known", async () => {
    // Guessing at a limit would either waste requests or fail anyway.
    const seen: string[] = [];
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: FILES,
      rules: RULES_MANY,
      profile: "full-context",
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: accountingRunner(seen),
    });
    expect(result.adversarialRequests).toBe(1);
  });
});

describe("cross-repo contract changes", () => {
  const SYMBOLS = [
    { name: "Prefs", path: "types.ts", kind: "interface" as const, change: "modified" as const },
  ];

  function linkedRun(adversarial: unknown) {
    return runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: FILES,
      rules: RULES,
      profile: "full-context",
      changedSymbols: SYMBOLS,
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: scripted({
        ...BASE_ANSWERS,
        s3_adversarial: adversarial,
        s5_verification: { verdicts: [] },
      }),
    });
  }

  const CLEARED_HUNK = { path: "app/orders.ts", hunkIndex: 0, reason: "checked" };
  const CLEARED_SWEEP = {
    path: "app/orders.ts",
    line: 2,
    ruleCode: "3",
    disposition: "cleared" as const,
    reason: "local literal",
  };

  it("accepts a symbol verified against named consumers", async () => {
    const result = await linkedRun({
      findings: [],
      clearedHunks: [CLEARED_HUNK],
      sweepDispositions: [CLEARED_SWEEP],
      symbolDispositions: [
        {
          symbol: "Prefs",
          path: "types.ts",
          consumersChecked: ["app/settings.ts"],
          verdict: "all_consumers_verified",
          reason: "The only consumer reads the new field name.",
        },
      ],
    });
    expect(result.coverage.pendingHunks).toBe(0);
  });

  it("fails when a changed contract was never dispositioned", async () => {
    // A contract change that still compiles where it is declared is exactly
    // the kind that only breaks at the consumer, so silence is not an answer.
    await expect(
      linkedRun({
        findings: [],
        clearedHunks: [CLEARED_HUNK],
        sweepDispositions: [CLEARED_SWEEP],
        symbolDispositions: [],
      }),
    ).rejects.toThrow(/undispositioned/);
  });

  it("fails when the stage dispositions a symbol that did not change", async () => {
    await expect(
      linkedRun({
        findings: [],
        clearedHunks: [CLEARED_HUNK],
        sweepDispositions: [CLEARED_SWEEP],
        symbolDispositions: [
          {
            symbol: "Invented",
            path: "types.ts",
            consumersChecked: ["a.ts"],
            verdict: "all_consumers_verified",
            reason: "made up",
          },
          {
            symbol: "Prefs",
            path: "types.ts",
            consumersChecked: ["a.ts"],
            verdict: "all_consumers_verified",
            reason: "fine",
          },
        ],
      }),
    ).rejects.toThrow(/did not change/);
  });

  it("refuses a verified verdict that names no consumer", async () => {
    // Claiming every consumer checks out without naming one is an assertion,
    // not a check.
    await expect(
      linkedRun({
        findings: [],
        clearedHunks: [CLEARED_HUNK],
        sweepDispositions: [CLEARED_SWEEP],
        symbolDispositions: [
          {
            symbol: "Prefs",
            path: "types.ts",
            consumersChecked: [],
            verdict: "all_consumers_verified",
            reason: "trust me",
          },
        ],
      }),
    ).rejects.toThrow(SymbolVerdictUnbackedError);
  });

  it("accepts no consumers found as its own answer", async () => {
    // A newly exported symbol genuinely has none, and forcing that into
    // "all verified" with an empty list would make the check meaningless.
    const result = await linkedRun({
      findings: [],
      clearedHunks: [CLEARED_HUNK],
      sweepDispositions: [CLEARED_SWEEP],
      symbolDispositions: [
        {
          symbol: "Prefs",
          path: "types.ts",
          consumersChecked: [],
          verdict: "no_consumers_found",
          reason: "Nothing imports this yet.",
        },
      ],
    });
    expect(result.coverage.pendingHunks).toBe(0);
  });

  it("refuses a finding verdict with no finding behind it", async () => {
    await expect(
      linkedRun({
        findings: [],
        clearedHunks: [CLEARED_HUNK],
        sweepDispositions: [CLEARED_SWEEP],
        symbolDispositions: [
          {
            symbol: "Prefs",
            path: "types.ts",
            consumersChecked: ["app/orders.ts"],
            verdict: "finding",
            reason: "consumer is broken",
          },
        ],
      }),
    ).rejects.toThrow(/no finding cites/);
  });

  it("accepts a finding verdict backed by a finding citing a consumer", async () => {
    const result = await linkedRun({
      findings: [
        {
          path: "app/orders.ts",
          lineStart: 2,
          lineEnd: 2,
          severity: "CRITICAL",
          ruleCode: null,
          issue: "Consumer still reads the old field name.",
          comment: "The renamed field leaves this read undefined at runtime.",
          mechanism: "Prefs.reportAutoNavigate was renamed; this consumer was not migrated",
        },
      ],
      clearedHunks: [],
      sweepDispositions: [
        { ...CLEARED_SWEEP, disposition: "finding", reason: "the cast in the broken consumer" },
      ],
      symbolDispositions: [
        {
          symbol: "Prefs",
          path: "types.ts",
          consumersChecked: ["app/orders.ts"],
          verdict: "finding",
          reason: "One consumer was not migrated.",
        },
      ],
    });
    expect(result.candidatesRaised).toBe(1);
  });

  it("requires nothing extra of a review with no linked repository", async () => {
    const result = await run({ ...BASE_ANSWERS, s5_verification: { verdicts: [] } });
    expect(result.coverage.pendingHunks).toBe(0);
  });
});

/**
 * A change set that removes a whole file, which nothing else in this suite
 * covers. A deleted file is the case the ledger cannot notice on its own: it
 * leaves no hunk in the file it used to be, so if the deletion stage simply
 * omits it, every other count still adds up.
 */
const DELETING_PATCH = [
  "diff --git a/legacy.ts b/legacy.ts",
  "deleted file mode 100644",
  "--- a/legacy.ts",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  "-export function guardRate(value: number) {",
  "-  if (value < 0) throw new Error('negative');",
  "-}",
  "",
].join("\n");

const DELETING_FILES = parseUnifiedDiff(DELETING_PATCH).map((file) => ({
  repo: "primary" as const,
  slug: "app",
  file,
}));

const DELETION_BASE_ANSWERS = {
  s1_risk: { files: [{ path: "app/legacy.ts", riskTags: [], reason: "removed" }] },
  s2_comprehension: {
    files: [
      {
        path: "app/legacy.ts",
        summary: "The whole file goes.",
        chainFilesRead: [],
        uncertainties: [],
      },
    ],
  },
  s3_adversarial: {
    findings: [],
    clearedHunks: [
      { path: "app/legacy.ts", hunkIndex: 0, reason: "The removal itself is the change." },
    ],
    sweepDispositions: [],
  },
  s5_verification: { verdicts: [] },
};

function runDeleting(s4: unknown, overrides: Record<string, unknown> = {}) {
  return runReviewPipeline({
    db,
    reviewId,
    worktreeRoot,
    files: DELETING_FILES,
    rules: [rule("9", ["typescript"])],
    profile: "full-context",
    systemPromptFor: (stage) => `prompt for ${stage}`,
    run: scripted({ ...DELETION_BASE_ANSWERS, s4_deletions: s4 }),
    ...overrides,
  });
}

const ACCOUNTED = {
  path: "app/legacy.ts",
  behaviourRemoved: "A guard that rejected negative rates.",
  dependents: [],
  reason: "Searched the worktree; nothing calls it.",
};

describe("the deletion stage's account of what was removed", () => {
  it("completes when every removed file is accounted for", async () => {
    const result = await runDeleting({ findings: [], reviewedDeletions: [ACCOUNTED] });
    expect(result.coverage.pendingFiles).toBe(0);
  });

  it("fails when a removed file is never mentioned", async () => {
    await expect(runDeleting({ findings: [], reviewedDeletions: [] })).rejects.toThrow(
      DeletionsNotAccountedError,
    );
  });

  it("names the file it was not told about", async () => {
    await expect(runDeleting({ findings: [], reviewedDeletions: [] })).rejects.toThrow(
      /app\/legacy\.ts/,
    );
  });

  it("fails when a file is accounted for that the change set does not remove", async () => {
    await expect(
      runDeleting({
        findings: [],
        reviewedDeletions: [ACCOUNTED, { ...ACCOUNTED, path: "app/invented.ts" }],
      }),
    ).rejects.toThrow(/does not remove/);
  });

  it("fails when one file is accounted for twice, which hides another behind it", async () => {
    await expect(
      runDeleting({ findings: [], reviewedDeletions: [ACCOUNTED, ACCOUNTED] }),
    ).rejects.toThrow(/more than once/);
  });

  it("closes the file in the ledger once its deletion is accounted for", async () => {
    await runDeleting({ findings: [], reviewedDeletions: [ACCOUNTED] });
    const [file] = listLedgerFiles(db, reviewId);
    expect(file?.status).toBe("reviewed");
  });

  it("leaves the file unreviewed in the ledger when the stage skipped it", async () => {
    // The run refuses to continue, and the ledger must agree with the refusal:
    // a file whose deletion nobody accounted for stays open, so the audit and
    // the coverage panel both still owe it.
    await expect(runDeleting({ findings: [], reviewedDeletions: [] })).rejects.toThrow(
      DeletionsNotAccountedError,
    );
    const [file] = listLedgerFiles(db, reviewId);
    expect(file?.status).toBe("pending");
  });

  it("strikes the rejected answer so a resume asks the stage again", async () => {
    // Without this, the refused answer sits checkpointed as succeeded, every
    // resume replays it byte for byte, and the review can never recover.
    const struck: { stage: string; reason: string }[] = [];
    await expect(
      runDeleting(
        { findings: [], reviewedDeletions: [] },
        { invalidate: (stage: string, reason: string) => struck.push({ stage, reason }) },
      ),
    ).rejects.toThrow(DeletionsNotAccountedError);

    expect(struck).toHaveLength(1);
    expect(struck[0]?.stage).toBe("s4_deletions");
    expect(struck[0]?.reason).toMatch(/app\/legacy\.ts/);
  });

  it("strikes nothing when the answer is accepted", async () => {
    const struck: string[] = [];
    await runDeleting(
      { findings: [], reviewedDeletions: [ACCOUNTED] },
      { invalidate: (stage: string) => struck.push(stage) },
    );
    expect(struck).toEqual([]);
  });
});

describe("where a deletion finding may point", () => {
  const finding = (path: string) => ({
    path,
    lineStart: 3,
    lineEnd: 3,
    severity: "CRITICAL",
    ruleCode: "9",
    issue: "A caller still uses the removed guard.",
    comment: "The call now fails at load time.",
    mechanism: "imports guardRate from the deleted module",
  });

  it("keeps a finding in a file the change never touched", async () => {
    // Who depended on the removed code is what this stage is for, and that
    // caller is usually outside the change set (D-98).
    const result = await runDeleting({
      findings: [finding("app/src/caller.ts")],
      reviewedDeletions: [ACCOUNTED],
    });
    expect(result.candidatesRaised).toBe(1);
  });

  it("refuses a finding whose path climbs out of the repository", async () => {
    // The 4.1 audit's path, which was verified with the file's contents
    // quoted into the report before reads were contained.
    const struck: string[] = [];
    await expect(
      runDeleting(
        { findings: [finding("app/../../outside-secret.txt")], reviewedDeletions: [ACCOUNTED] },
        { invalidate: (stage: string) => struck.push(stage) },
      ),
    ).rejects.toThrow(/"app\/\.\.\/\.\.\/outside-secret\.txt", which has a "\.\." segment/);
    expect(struck).toEqual(["s4_deletions"]);
    expect(listFindings(db, reviewId)).toHaveLength(0);
  });

  it("refuses a finding in a repository the review does not have", async () => {
    await expect(
      runDeleting({ findings: [finding("other/src/caller.ts")], reviewedDeletions: [ACCOUNTED] }),
    ).rejects.toThrow(/is not in any repository of this review \(app\)/);
  });

  it("refuses a finding that names a repository and no file in it", async () => {
    await expect(
      runDeleting({ findings: [finding("app")], reviewedDeletions: [ACCOUNTED] }),
    ).rejects.toThrow(/names no file/);
  });

  it("accepts a repository that changed nothing, when the review has one", async () => {
    // A linked review's other side can hold the dependent while every change
    // is in this one; the service names both directories.
    const result = await runDeleting(
      { findings: [finding("shared-core/src/use.ts")], reviewedDeletions: [ACCOUNTED] },
      {
        repositories: [
          { slug: "app", repo: "primary" },
          { slug: "shared-core", repo: "linked" },
        ],
      },
    );
    expect(result.candidatesRaised).toBe(1);
    // Recorded against the repository it is in, which the file context
    // shown beside it is read from.
    expect(listFindings(db, reviewId)[0]?.repo).toBe("linked");
  });
});

const RISK_PATCH = ["orders", "billing", "theme", "session"]
  .map((name) =>
    [
      `diff --git a/${name}.ts b/${name}.ts`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${name}.ts`,
      "@@ -0,0 +1,2 @@",
      `+export const ${name} = 1;`,
      `+export const ${name}Extra = 2;`,
      "",
    ].join("\n"),
  )
  .join("");

const RISK_FILES = parseUnifiedDiff(RISK_PATCH).map((file) => ({
  repo: "primary" as const,
  slug: "app",
  file,
}));

/**
 * Tagged so the expected order is none that could arise by accident: not the
 * inventory order, not its reverse, and not alphabetical either way. Only a
 * real reading of the risk tags produces it.
 */
const RISK_ANSWERS: Record<string, unknown> = {
  s1_risk: {
    files: [
      { path: "app/orders.ts", riskTags: [], reason: "plain" },
      { path: "app/billing.ts", riskTags: ["money", "destructive"], reason: "money" },
      { path: "app/theme.ts", riskTags: [], reason: "plain" },
      { path: "app/session.ts", riskTags: ["auth"], reason: "auth" },
    ],
  },
  s2_comprehension: {
    files: RISK_FILES.map((entry) => ({
      path: `app/${entry.file.path}`,
      summary: "read",
      chainFilesRead: [],
      uncertainties: [],
    })),
  },
  s4_deletions: { findings: [], reviewedDeletions: [] },
  s5_verification: { verdicts: [] },
};

/** Records every prompt, and clears every hunk so any division reconciles. */
function runRisk(profile: "full-context" | "decomposed", prompts: string[]) {
  return runReviewPipeline({
    db,
    reviewId,
    worktreeRoot,
    files: RISK_FILES,
    rules: [rule("9", ["typescript"])],
    profile,
    systemPromptFor: (stage) => `prompt for ${stage}`,
    run: async (request) => {
      prompts.push(`${request.stage} ${request.prompt}`);
      if (request.stage === "s3_adversarial") {
        return {
          output: {
            findings: [],
            clearedHunks: RISK_FILES.map((entry) => ({
              path: `app/${entry.file.path}`,
              hunkIndex: 0,
              reason: "Nothing wrong here.",
            })),
            sweepDispositions: [],
          },
          sessionId: "s",
        };
      }
      return { output: RISK_ANSWERS[request.stage] ?? {}, sessionId: "s" };
    },
  });
}

describe("working the highest-risk files first", () => {
  it("shows the later stages the risk-tagged files before the untagged ones", async () => {
    // 03 asks for this and S1 has always produced the tags; nothing read them
    // back, so the column was written on every review and used by nothing.
    const prompts: string[] = [];
    await runRisk("full-context", prompts);

    const comprehension = prompts.find((entry) => entry.startsWith("s2_comprehension"))!;
    const at = (path: string) => comprehension.indexOf(path);
    expect(at("app/billing.ts")).toBeLessThan(at("app/session.ts"));
    expect(at("app/session.ts")).toBeLessThan(at("app/orders.ts"));
    expect(at("app/orders.ts")).toBeLessThan(at("app/theme.ts"));
  });

  it("sends the first adversarial request about the highest-risk file", async () => {
    // Under a profile that works file by file, the order is not merely how the
    // prompt reads: it is which file the model is asked about first, which is
    // what high-risk-first has to mean to be worth anything.
    const prompts: string[] = [];
    await runRisk("decomposed", prompts);

    const first = prompts.find((entry) => entry.startsWith("s3_adversarial"))!;
    // Keyed on the hunk header: every request carries the whole change
    // summary, so every path appears in every prompt.
    expect(first).toContain("hunk 0 of app/billing.ts");
    expect(first).not.toContain("hunk 0 of app/theme.ts");
  });

  it("records on the run which files it worked first", async () => {
    const prompts: string[] = [];
    await runRisk("full-context", prompts);

    const note = readRunNotes(requireReview(db, reviewId)).find((entry) =>
      entry.message.startsWith("Worked "),
    );
    expect(note?.message).toContain("app/billing.ts");
    expect(note?.message).toContain("money");
    expect(note?.message).toContain("destructive");
  });

  it("reviews every file whatever the order", async () => {
    // The invariant ordering must never break: a permutation cannot drop
    // work, and the coverage audit is what would catch it if it did.
    const prompts: string[] = [];
    const result = await runRisk("full-context", prompts);
    expect(result.coverage.pendingHunks).toBe(0);
    expect(result.coverage.pendingFiles).toBe(0);
    expect(listLedgerFiles(db, reviewId)).toHaveLength(RISK_FILES.length);
  });
});

describe("the paths a symbol is spoken of by", () => {
  const LINKED_PATCH = [
    "diff --git a/types.ts b/types.ts",
    "--- a/types.ts",
    "+++ b/types.ts",
    "@@ -1,2 +1,2 @@",
    " export interface Prefs {",
    "+  theme: string;",
    "",
  ].join("\n");

  const LINKED_FILES = [
    ...FILES,
    ...parseUnifiedDiff(LINKED_PATCH).map((file) => ({
      repo: "linked" as const,
      slug: "shared-core",
      file,
    })),
  ];

  const LINKED_SYMBOLS = [
    { name: "Prefs", path: "types.ts", kind: "interface" as const, change: "modified" as const },
  ];

  it("lists a symbol under the path the worktree gives it", async () => {
    // The first live run answered with the worktree path, correctly in
    // substance, and was refused on spelling: the prompt was the one place
    // in the pipeline still speaking repo-relative paths. The listing now
    // names the file as the model will actually find it.
    const prompts: string[] = [];
    await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: LINKED_FILES,
      rules: RULES,
      profile: "full-context",
      changedSymbols: LINKED_SYMBOLS,
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: async (request) => {
        prompts.push(request.prompt);
        if (request.stage === "s3_adversarial") {
          return {
            output: {
              findings: [],
              clearedHunks: [
                { path: "app/orders.ts", hunkIndex: 0, reason: "checked" },
                { path: "shared-core/types.ts", hunkIndex: 0, reason: "checked" },
              ],
              sweepDispositions: [
                {
                  path: "app/orders.ts",
                  line: 2,
                  ruleCode: "3",
                  disposition: "cleared",
                  reason: "local literal",
                },
              ],
              symbolDispositions: [
                {
                  symbol: "Prefs",
                  path: "shared-core/types.ts",
                  consumersChecked: ["app/orders.ts"],
                  verdict: "all_consumers_verified",
                  reason: "The one consumer reads the new shape.",
                },
              ],
            },
            sessionId: "s",
          };
        }
        return {
          output:
            request.stage === "s4_deletions"
              ? { findings: [], reviewedDeletions: [] }
              : request.stage === "s5_verification"
                ? { verdicts: [] }
                : { files: [] },
          sessionId: "s",
        };
      },
    });

    const adversarial = prompts.find((prompt) => prompt.includes("exported symbol"))!;
    expect(adversarial).toContain("in shared-core/types.ts");
    expect(adversarial).toContain("copied exactly as printed here");
  });

  it("reconciles a stage that echoes the listing verbatim", async () => {
    // The class of bug the fake gate is structurally blind to: the ideal
    // answers echo the expectation, so a prompt whose spelling drifts from
    // the expectation passes every fake run and fails every real one. This
    // runner answers the way a model does, by reading the prompt it was
    // given, so any future drift between the two fails here first.
    const echoed = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: LINKED_FILES,
      rules: RULES,
      profile: "full-context",
      changedSymbols: LINKED_SYMBOLS,
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: async (request) => {
        if (request.stage !== "s3_adversarial") {
          return {
            output:
              request.stage === "s4_deletions"
                ? { findings: [], reviewedDeletions: [] }
                : request.stage === "s5_verification"
                  ? { verdicts: [] }
                  : { files: [] },
            sessionId: "s",
          };
        }
        const listed = [...request.prompt.matchAll(/^- (\S+) \([^)]+\) in (\S+)$/gm)];
        return {
          output: {
            findings: [],
            clearedHunks: [
              { path: "app/orders.ts", hunkIndex: 0, reason: "checked" },
              { path: "shared-core/types.ts", hunkIndex: 0, reason: "checked" },
            ],
            sweepDispositions: [
              {
                path: "app/orders.ts",
                line: 2,
                ruleCode: "3",
                disposition: "cleared",
                reason: "local literal",
              },
            ],
            symbolDispositions: listed.map(([, symbol, path]) => ({
              symbol,
              path,
              consumersChecked: ["app/orders.ts"],
              verdict: "all_consumers_verified",
              reason: "Echoed from the listing, as a model does.",
            })),
          },
          sessionId: "s",
        };
      },
    });
    expect(echoed.coverage.pendingHunks).toBe(0);
  });
});

describe("counting what rests only on refuted findings (D-102)", () => {
  // The only hunk is lines 3 to 9 after the change.
  const SOURCE_LINES = ["l1", "l2", "l3", "l4", "l5", "added", "l6", "l7", "l8", "l9", "l10", ""];
  const FILES_ONE_HUNK = parseUnifiedDiff(
    [
      "diff --git a/long.ts b/long.ts",
      "--- a/long.ts",
      "+++ b/long.ts",
      "@@ -3,6 +3,7 @@",
      " l3",
      " l4",
      " l5",
      "+added",
      " l6",
      " l7",
      " l8",
      "",
    ].join("\n"),
  ).map((file) => ({ repo: "primary" as const, slug: "app", file }));

  const raised = (lineStart: number, lineEnd: number, issue = "x") => ({
    ...COMPLETE_ADVERSARIAL.findings[0]!,
    path: "app/long.ts",
    lineStart,
    lineEnd,
    issue,
  });
  const verdict = (
    ref: string,
    verdictKind: "verified" | "killed",
    lineStart: number,
    lineEnd: number,
  ) => ({
    ref,
    verdict: verdictKind,
    quotedCode: SOURCE_LINES.slice(lineStart - 1, lineEnd).join("\n"),
    lineStart,
    lineEnd,
    note: verdictKind === "killed" ? "Refuted." : "checked",
  });

  function runOneHunk(
    s3: (batch: number) => Record<string, unknown>,
    verdicts: unknown[],
    overrides: Record<string, unknown> = {},
  ) {
    writeFileSync(join(worktreeRoot, "app", "long.ts"), SOURCE_LINES.join("\n"));
    return runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: FILES_ONE_HUNK,
      rules: RULES,
      profile: "full-context",
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: async (request) => ({
        sessionId: "s",
        output:
          request.stage === "s3_adversarial"
            ? { clearedHunks: [], sweepDispositions: [], ...s3(request.batchNumber ?? 1) }
            : request.stage === "s4_deletions"
              ? { findings: [], reviewedDeletions: [] }
              : request.stage === "s5_verification"
                ? { verdicts }
                : { files: [] },
      }),
      ...overrides,
    });
  }

  it("does not call a hunk refuted when verification moved a standing finding off it", async () => {
    // Raised at 9 to 10, so it accounted for the hunk; verified at line 10,
    // just past it. Nothing was refuted.
    const result = await runOneHunk(
      () => ({ findings: [raised(9, 10)] }),
      [verdict("C1", "verified", 10, 10)],
    );
    expect(result.killed).toBe(0);
    expect(result.coverage.refutedOnlyHunks).toBe(0);
  });

  it("still says so when a corrected range moved another finding onto the hunk", async () => {
    // F at line 6 is the hunk's only finding and is refuted. G, raised at 10
    // to 11 outside the hunk, is verified at 9 to 10, inside it.
    const result = await runOneHunk(
      () => ({ findings: [raised(6, 6, "F"), raised(10, 11, "G")] }),
      [verdict("C1", "killed", 6, 6), verdict("C2", "verified", 9, 10)],
    );
    expect(result.coverage.refutedOnlyHunks).toBe(1);
  });

  it("does not call a sweep hit refuted when its standing finding was moved off its line", async () => {
    const result = await run({
      ...BASE_ANSWERS,
      s3_adversarial: {
        ...COMPLETE_ADVERSARIAL,
        findings: [{ ...COMPLETE_ADVERSARIAL.findings[0]!, lineStart: 2, lineEnd: 3 }],
      },
      s5_verification: {
        verdicts: [
          {
            ref: "C1",
            verdict: "verified",
            quotedCode: SOURCE.split("\n")[2],
            lineStart: 3,
            lineEnd: 3,
            note: "checked",
          },
        ],
      },
    });
    expect(result.verified).toBe(1);
    expect(result.coverage.refutedOnlySweepHits).toBe(0);
  });

  it("states no refutation while a resume has removed the findings", async () => {
    const result = await runOneHunk(
      () => ({ findings: [raised(6, 6)] }),
      [verdict("C1", "killed", 6, 6)],
    );
    expect(result.coverage.refutedOnlyHunks).toBe(1);

    // What a resume does before running again: the findings go, the ledger's
    // marks stay until the stages are replayed.
    deleteAllForReview(db, reviewId);
    expect(coverageReport(db, reviewId).refutedOnlyHunks).toBe(0);
  });

  it("does not say a hunk rests only on a refutation when another request cleared it", async () => {
    const result = await runOneHunk(
      (batch) =>
        batch === 1
          ? { findings: [], clearedHunks: [{ path: "app/long.ts", hunkIndex: 0, reason: "fine" }] }
          : { findings: [raised(6, 6)] },
      [verdict("C1", "killed", 6, 6)],
      { profile: "chunked", rules: [rule("1", ["typescript"]), rule("2", ["security"])] },
    );
    expect(result.adversarialRequests).toBe(2);
    expect(result.coverage.refutedOnlyHunks).toBe(0);
    const [file] = listLedgerFiles(db, reviewId);
    expect(listHunks(db, file!.id)[0]?.clearReason).toBe("fine");
  });
});

describe("verifying a finding in a file the change deleted (D-106)", () => {
  const BEFORE = [
    "export function guardRate(value: number) {",
    "  if (value < 0) throw new Error('negative');",
    "}",
    "",
  ].join("\n");
  const GUARD_GONE = {
    path: "app/legacy.ts",
    lineStart: 2,
    lineEnd: 2,
    severity: "CRITICAL",
    ruleCode: "9",
    issue: "The negative-rate guard is gone.",
    comment: "Negative rates are now accepted.",
    mechanism: "the guard at line 2 was removed with its file",
  };

  async function verifyDeleted(quotedCode: string) {
    const prompts: string[] = [];
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot,
      files: DELETING_FILES,
      rules: [rule("9", ["typescript"])],
      profile: "full-context",
      baseContents: new Map([["app/legacy.ts", BEFORE]]),
      systemPromptFor: (stage) => `prompt for ${stage}`,
      run: async (request: StageRequest): Promise<StageResponse> => {
        if (request.stage === "s5_verification") prompts.push(request.prompt);
        const answers: Record<string, unknown> = {
          ...DELETION_BASE_ANSWERS,
          s4_deletions: { findings: [GUARD_GONE], reviewedDeletions: [ACCOUNTED] },
          s5_verification: {
            verdicts: [
              { ref: "C1", verdict: "verified", quotedCode, lineStart: 2, lineEnd: 2, note: "ok" },
            ],
          },
        };
        return { sessionId: "s", output: answers[request.stage] ?? {} };
      },
    });
    return { result, prompts };
  }

  it("checks the quotation against the file as it was, and verifies it", async () => {
    // The worktree has no such file, so this used to be killed as unreadable
    // every time: the finding the deletion stage exists to raise could not
    // survive verification.
    const { result, prompts } = await verifyDeleted(
      "  if (value < 0) throw new Error('negative');",
    );
    expect(result.verified).toBe(1);
    expect(statusOf(listFindings(db, reviewId)[0]!)).toBe("verified");
    // And the verifier was handed what it quoted from.
    expect(prompts[0]).toContain("contentsBeforeDeletion");
    expect(prompts[0]).toContain("     2    if (value < 0) throw new Error('negative');");
  });

  it("still kills a quotation that is not what the file held", async () => {
    const { result } = await verifyDeleted("  if (value <= 0) throw new Error('negative');");
    expect(result.killedByQuoteCheck).toBe(1);
    expect(listFindings(db, reviewId)[0]?.verificationNote).toContain("did not match the file");
  });
});
