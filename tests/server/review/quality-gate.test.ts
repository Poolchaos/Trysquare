/**
 * The engine quality gate.
 *
 * Runs the whole pipeline over the seeded fixture, driven by a reviewer built
 * from the manifest: one that finds exactly the planted defects, quotes them
 * accurately, and says nothing about the files that changed correctly. If the
 * pipeline cannot carry a correct review through to a correct report, no
 * amount of prompt work will help, so this runs before any prompt is tuned and
 * again after every change to one.
 *
 * It also runs the opposite case. A reviewer that invents a finding, or quotes
 * code that is not there, must have that finding discarded rather than
 * reported, and the run must still complete.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseUnifiedDiff, type ParsedFile } from "@/lib/git/diff";
import { changedExportedSymbols } from "@/lib/git/symbols";
import { importProtocol } from "@/lib/rulesets/import";
import type { Db } from "@/server/db/client";
import { listFindings, statusOf } from "@/server/db/repositories/findings";
import { listLedgerFiles } from "@/server/db/repositories/ledger";
import { cloneBare, diffText, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { addWorktree } from "@/server/gitops/worktree";
import type { ReviewProfile } from "@/lib/domain/enums";
import { runReviewPipeline } from "@/server/review/pipeline";
// @ts-expect-error -- plain JavaScript so it can also be run from a shell.
import { buildSeededRepos } from "../../fixtures/build-seeded-repos.mjs";
import {
  buildIdealStageOutputs,
  idealRunner,
  type SeededDefect as Defect,
  type SeededManifest,
} from "../../helpers/ideal-answers";
import { makeTestDb, seedProject, type TestDb } from "../db/helpers";
import { createReview, readRunNotes, requireReview } from "@/server/db/repositories/reviews";

const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
);

interface FixedVariant {
  branch: string;
  defects: Defect[];
  cleanFiles: string[];
  verifiedConsumers: Record<string, string[]>;
}

let root: string;
let worktreeRoot: string;
let manifest: SeededManifest & { fixedVariant: FixedVariant };
let appFiles: ParsedFile[];
let coreFiles: ParsedFile[];
let fixedAppFiles: ParsedFile[];
let fixedWorktreeRoot: string;

let ctx: TestDb;
let db: Db;
let reviewId: string;

/** Every changed file, qualified by repository as the model sees it. */
function entries() {
  return [
    ...appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
    ...coreFiles.map((file) => ({ repo: "linked" as const, slug: "shared-core", file })),
  ];
}

/** The repaired change set: the fixed app branch against the same dependency. */
function fixedEntries() {
  return [
    ...fixedAppFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
    ...coreFiles.map((file) => ({ repo: "linked" as const, slug: "shared-core", file })),
  ];
}

function fixedManifest(): SeededManifest {
  return {
    defects: manifest.fixedVariant.defects,
    cleanFiles: manifest.fixedVariant.cleanFiles,
    verifiedConsumers: manifest.fixedVariant.verifiedConsumers,
  };
}

function qualified(defect: Defect): string {
  return `${defect.repo === "app" ? "app" : "shared-core"}/${defect.file}`;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-gate-"));
  const built = buildSeededRepos(root);
  manifest = built.manifest;

  const appClone = join(root, "app.git");
  const coreClone = join(root, "core.git");
  await cloneBare(built.appDir, appClone);
  await cloneBare(built.coreDir, coreClone);

  const appBase = await mergeBase(appClone, "main", "feature/rename-prefs");
  const appHead = await resolveCommit(appClone, "feature/rename-prefs");
  const coreBase = await mergeBase(coreClone, "main", "feature/rename-prefs");
  const coreHead = await resolveCommit(coreClone, "feature/rename-prefs");

  appFiles = parseUnifiedDiff(await diffText(appClone, appBase, appHead));
  coreFiles = parseUnifiedDiff(await diffText(coreClone, coreBase, coreHead));

  // Both repositories side by side, which is what a linked review reads.
  worktreeRoot = join(root, "worktree");
  await addWorktree(appClone, join(worktreeRoot, "app"), appHead);
  await addWorktree(coreClone, join(worktreeRoot, "shared-core"), coreHead);

  // The fixed variant: same dependency change, repaired app branch, its own
  // checkout. Files, manifest and worktree swap together in runGate.
  const fixedBranch = manifest.fixedVariant.branch;
  const fixedBase = await mergeBase(appClone, "main", fixedBranch);
  const fixedHead = await resolveCommit(appClone, fixedBranch);
  fixedAppFiles = parseUnifiedDiff(await diffText(appClone, fixedBase, fixedHead));
  fixedWorktreeRoot = join(root, "worktree-fixed");
  await addWorktree(appClone, join(fixedWorktreeRoot, "app"), fixedHead);
  await addWorktree(coreClone, join(fixedWorktreeRoot, "shared-core"), coreHead);
}, 180_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  const project = seedProject(db, "seeded");
  reviewId = createReview(db, {
    projectId: project.id,
    fromBranch: "feature/rename-prefs",
    fromCommit: "a".repeat(40),
    intoBranch: "main",
    intoCommit: "b".repeat(40),
    mergeBaseCommit: "c".repeat(40),
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
  }).id;
  return () => ctx.cleanup();
});

/**
 * A reviewer that does the job correctly.
 *
 * Its answers come from the shared helper, which builds them from the
 * manifest rather than from a model, so this test measures the pipeline
 * rather than today's model behaviour. The service tests drive the same
 * answers through the fake CLI, so the two cannot drift apart.
 * `extraFindings` lets a test add something untrue and watch it be discarded.
 */
function runGate(
  options: {
    extraFindings?: Record<string, unknown>[];
    misquote?: boolean;
    profile?: ReviewProfile;
    /** "fixed" swaps files, manifest and worktree together; they must never mix. */
    variant?: "fixed";
  } = {},
) {
  const files = options.variant === "fixed" ? fixedEntries() : entries();
  const activeManifest = options.variant === "fixed" ? fixedManifest() : manifest;
  const activeWorktree = options.variant === "fixed" ? fixedWorktreeRoot : worktreeRoot;

  const outputs = buildIdealStageOutputs({
    ...options,
    files,
    manifest: activeManifest,
    worktreeRoot: activeWorktree,
    rules: PROTOCOL.ruleset.rules,
  });

  return runReviewPipeline({
    db,
    reviewId,
    worktreeRoot: activeWorktree,
    files,
    rules: PROTOCOL.ruleset.rules,
    profile: options.profile ?? "full-context",
    changedSymbols: changedExportedSymbols(coreFiles),
    systemPromptFor: () => "system",
    run: idealRunner(outputs),
  });
}

describe("a correct review of the seeded fixture", () => {
  it("completes with every part of the change set accounted for", async () => {
    const result = await runGate();
    expect(result.coverage.pendingHunks).toBe(0);
    expect(result.coverage.pendingSweepHits).toBe(0);
    expect(result.coverage.pendingFiles).toBe(0);
    expect(result.coverage.unresolvedCandidates).toBe(0);
  }, 60_000);

  it("verifies every seeded defect, at the file and line the manifest states", async () => {
    // The gate's central claim: a correct review of this change set survives
    // the pipeline intact.
    await runGate();
    const verified = listFindings(db, reviewId).filter(
      (finding) => statusOf(finding) === "verified",
    );

    for (const defect of manifest.defects) {
      const match = verified.find(
        (finding) => finding.filePath === qualified(defect) && finding.lineStart === defect.line,
      );
      expect(match, `${defect.id} at ${qualified(defect)}:${defect.line}`).toBeDefined();
      expect(match?.severity).toBe(defect.severity);
      expect(match?.ruleCode).toBe(defect.ruleCode);
    }
  }, 60_000);

  it("finds both defects that exist only across the two repositories", async () => {
    // Neither line changed in the app; the contract under each moved in the
    // other repository. The length is pinned so silently dropping one of the
    // cross-repo plants fails loudly rather than shrinking the answer key.
    await runGate();
    const crossRepo = manifest.defects.filter((defect) => defect.kind === "cross-repo");
    expect(crossRepo).toHaveLength(2);

    for (const defect of crossRepo) {
      const found = listFindings(db, reviewId).find(
        (finding) => finding.filePath === qualified(defect) && finding.lineStart === defect.line,
      );
      expect(found, `${defect.id} at ${qualified(defect)}:${defect.line}`).toBeDefined();
      expect(statusOf(found!)).toBe("verified");
      expect(found!.ruleCode).toBe(defect.ruleCode);
    }
  }, 60_000);

  it("finds the defect that exists only as removed code", async () => {
    await runGate();
    const deletion = manifest.defects.find((defect) => defect.kind === "deletion")!;
    const found = listFindings(db, reviewId).find(
      (finding) => finding.filePath === qualified(deletion),
    );
    expect(statusOf(found!)).toBe("verified");
  }, 60_000);

  it("reports the deletion the diff cannot show, from the stage that reads removals", async () => {
    // The caller is not in the change set at all, so this finding can only
    // come from S4: an S3 finding citing a file without a hunk is rejected.
    await runGate();
    const defect = manifest.defects.find((entry) => entry.kind === "deleted-file")!;

    const found = listFindings(db, reviewId).find(
      (finding) => finding.filePath === qualified(defect) && finding.lineStart === defect.line,
    );
    expect(found, `a verified finding in the untouched caller ${defect.file}`).toBeDefined();
    expect(statusOf(found!)).toBe("verified");

    // Not just the finding: the deleted file itself is accounted for in the
    // coverage ledger, which is the S4 bookkeeping being proven.
    const ledger = listLedgerFiles(db, reviewId).find(
      (file) => file.path === `app/${defect.deletedFile}`,
    );
    expect(ledger, `${defect.deletedFile} has a ledger row`).toBeDefined();
    expect(ledger?.status).toBe("reviewed");
  }, 60_000);

  it("reports nothing about the files that changed correctly", async () => {
    // A false positive fails this gate as surely as a miss does.
    await runGate();
    const reported = listFindings(db, reviewId).filter(
      (finding) => statusOf(finding) === "verified",
    );

    for (const clean of manifest.cleanFiles) {
      const wrongly = reported.find((finding) => finding.filePath === `app/${clean}`);
      expect(wrongly, `no finding should be raised in ${clean}`).toBeUndefined();
    }
  }, 60_000);

  it("discards nothing that was quoted accurately", async () => {
    const result = await runGate();
    expect(result.killedByQuoteCheck).toBe(0);
    expect(result.verified).toBe(manifest.defects.length);
  }, 60_000);
});

describe("the repaired change set", () => {
  // pipeline.test.ts already drives all_consumers_verified through a whole
  // linked run against a named consumer. What this adds is the consumer list
  // derived from a real repaired tree rather than written into the test. The
  // pipeline does not persist symbol dispositions, so the end-to-end claim
  // is that a repaired change set produces clears the pipeline accepts.
  it("completes with both symbols cleared and every remaining defect found", async () => {
    const result = await runGate({ variant: "fixed" });

    // Completing at all is the symbol proof: a clear whose evidence does not
    // back it is rejected by assertSymbolVerdictsAreBacked and fails the run.
    expect(result.coverage.pendingHunks).toBe(0);
    expect(result.coverage.pendingSweepHits).toBe(0);
    expect(result.coverage.pendingFiles).toBe(0);
    expect(result.coverage.unresolvedCandidates).toBe(0);
    expect(result.killedByQuoteCheck).toBe(0);
    expect(result.verified).toBe(manifest.fixedVariant.defects.length);
  }, 60_000);

  it("claims only consumers that exist in the fixed tree and use the symbol", () => {
    // "All consumers verified" said about an absent or unrelated file would
    // be a hollow clear; the claim has to be about real code.
    const { verifiedConsumers } = manifest.fixedVariant;
    expect(Object.keys(verifiedConsumers).sort()).toEqual(["DEFAULT_TIMEOUT_SECONDS", "Prefs"]);

    for (const [symbol, consumers] of Object.entries(verifiedConsumers)) {
      expect(consumers.length, `${symbol} has a consumer`).toBeGreaterThan(0);
      for (const consumer of consumers) {
        const contents = readFileSync(join(fixedWorktreeRoot, consumer), "utf8");
        expect(new RegExp(`\\b${symbol}\\b`).test(contents), `${symbol} in ${consumer}`).toBe(true);
      }
    }
  });
});

describe("a review that reports something untrue", () => {
  it("kills a finding whose quotation is not what is at those lines", async () => {
    // The failure mode the verification stage exists for: a plausible finding
    // citing code that is not there.
    const result = await runGate({
      misquote: true,
      extraFindings: [
        {
          path: "app/src/utils/format.ts",
          lineStart: 1,
          lineEnd: 1,
          severity: "CRITICAL",
          ruleCode: "3",
          issue: "Invented defect",
          comment: "This describes code that does not exist.",
          mechanism: "fabricated",
        },
      ],
    });

    expect(result.killedByQuoteCheck).toBe(1);
    const killed = listFindings(db, reviewId).filter((finding) => statusOf(finding) === "killed");
    expect(killed).toHaveLength(1);
    expect(killed[0]?.issue).toBe("Invented defect");
    // Everything true still came through.
    expect(result.verified).toBe(manifest.defects.length);
  }, 60_000);

  it("still reports a finding about correct code when it was quoted accurately", async () => {
    // Worth stating plainly: the byte check catches misquotation, not
    // misjudgement. A wrong-but-accurately-quoted finding survives to the
    // confirmation screen, which is the human's job, not the machine's.
    const result = await runGate({
      extraFindings: [
        {
          path: "app/src/utils/format.ts",
          lineStart: 1,
          lineEnd: 1,
          severity: "NITPICK",
          ruleCode: "3",
          issue: "Debatable defect",
          comment: "A judgement call, quoted correctly.",
          mechanism: "quoted accurately but arguably wrong",
        },
      ],
    });

    expect(result.killedByQuoteCheck).toBe(0);
    expect(result.verified).toBe(manifest.defects.length + 1);
  }, 60_000);

  it("kills a finding that cites a line the file does not have", async () => {
    const result = await runGate({
      extraFindings: [
        {
          path: "app/src/utils/format.ts",
          lineStart: 9000,
          lineEnd: 9000,
          severity: "CRITICAL",
          ruleCode: "3",
          issue: "Cites a line past the end of the file",
          comment: "Nothing is there.",
          mechanism: "fabricated",
        },
      ],
    });

    expect(result.killedByQuoteCheck).toBeGreaterThan(0);
    const killed = listFindings(db, reviewId).filter((finding) => statusOf(finding) === "killed");
    expect(killed.some((finding) => finding.lineStart === 9000)).toBe(true);
  }, 60_000);
});

/**
 * The same change set under every profile that judges.
 *
 * docs/06 section 3 promises the completeness invariant does not adapt: a
 * profile changes how the work is divided into requests, never how much of
 * the protocol is applied. That is only a claim until the weaker divisions
 * are measured against the same answer key, which is what this does.
 */
describe.each(["full-context", "chunked", "decomposed"] as const)(
  "a correct review under the %s profile",
  (profile) => {
    it("finds every seeded defect and leaves nothing undispositioned", async () => {
      const result = await runGate({ profile });

      expect(result.coverage.pendingHunks).toBe(0);
      expect(result.coverage.pendingSweepHits).toBe(0);
      expect(result.coverage.pendingFiles).toBe(0);
      expect(result.coverage.unresolvedCandidates).toBe(0);
      expect(result.killedByQuoteCheck).toBe(0);

      const verified = listFindings(db, reviewId).filter(
        (finding) => statusOf(finding) === "verified",
      );
      for (const defect of manifest.defects) {
        const match = verified.find(
          (finding) => finding.filePath === qualified(defect) && finding.lineStart === defect.line,
        );
        expect(match, `${defect.id} under ${profile}`).toBeDefined();
      }
    }, 120_000);

    it("reports nothing in the files that are deliberately correct", async () => {
      await runGate({ profile });
      const verified = listFindings(db, reviewId).filter(
        (finding) => statusOf(finding) === "verified",
      );
      for (const clean of manifest.cleanFiles) {
        expect(
          verified.find((finding) => finding.filePath === `app/${clean}`),
          `${clean} under ${profile}`,
        ).toBeUndefined();
      }
    }, 120_000);
  },
);

describe("what a narrower profile costs", () => {
  it("divides the same work into more requests as the profile narrows", async () => {
    // The trade docs/06 records: the same rules, applied in more and smaller
    // requests. If this ever inverts, a profile is dropping work rather than
    // dividing it.
    const full = await runGate({ profile: "full-context" });
    const chunked = await runGate({ profile: "chunked" });
    const decomposed = await runGate({ profile: "decomposed" });

    expect(chunked.adversarialRequests).toBeGreaterThan(full.adversarialRequests);
    expect(decomposed.adversarialRequests).toBeGreaterThanOrEqual(chunked.adversarialRequests);
  }, 180_000);

  it("names every rule and file pair a narrowing profile did not check", async () => {
    // Narrowing is legitimate; narrowing invisibly is not. This fixture's
    // change set touches README.md, whose only theme is general, so decomposed
    // genuinely excludes the technology-themed rules against it; the count
    // must be real and the pairs must be written onto the run.
    const full = await runGate({ profile: "full-context" });
    expect(full.excludedPairs).toBe(0);

    const decomposed = await runGate({ profile: "decomposed" });
    expect(decomposed.excludedPairs).toBeGreaterThan(0);

    const note = readRunNotes(requireReview(db, reviewId)).find(
      (entry) => entry.kind === "excluded-pairs",
    );
    expect(note?.message).toContain(`${decomposed.excludedPairs} rule/file pair(s)`);
    expect(note?.message).toContain("README.md");
  }, 120_000);
});
