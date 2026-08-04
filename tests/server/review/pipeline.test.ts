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
import { SweepIncompleteError } from "@/lib/review/sweep";
import type { Db } from "@/server/db/client";
import { listFindings, statusOf } from "@/server/db/repositories/findings";
import {
  IncompleteCoverageError,
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

  it("rejects a malformed stage answer rather than working around it", async () => {
    await expect(run({ ...BASE_ANSWERS, s1_risk: { wrong: "shape" } })).rejects.toThrow();
  });

  it("stops the run when a sweep pattern could not be executed", async () => {
    await expect(
      runReviewPipeline({
        db,
        reviewId,
        worktreeRoot,
        files: FILES,
        rules: [rule("9", ["general"], ["([unclosed"])],
        profile: "full-context",
        systemPromptFor: (stage) => `prompt for ${stage}`,
        run: scripted(BASE_ANSWERS),
      }),
    ).rejects.toThrow(SweepIncompleteError);
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

  it("still passes the audit after a finding is killed", async () => {
    // A killed finding is resolved, not outstanding.
    const { result } = await verifyWith("wrong code", 2, 2);
    expect(result.coverage.unresolvedCandidates).toBe(0);
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
