/**
 * Running a review from a database row to a set of findings.
 *
 * Everything expensive or destructive is decided here rather than by the
 * pipeline: which commits are checked out, what the model is judged against,
 * where the run's evidence lives, and what a failure means. The pipeline is
 * kept ignorant of all of it so it stays testable against a plain function.
 *
 * The two rules this file exists to enforce:
 *
 * A review describes fixed commits. This fetches so those commits stay
 * reachable after a prune or a restart, and then re-resolves them. It never
 * re-pins. A resumed run that quietly moved to a newer tip would be reviewing
 * something other than what its findings already record, and the coverage
 * ledger would be counting two different change sets. Freshness is guaranteed
 * one step earlier, when the draft is created and pins from refs fetched
 * moments before.
 *
 * A review is judged against the ruleset frozen onto it, never the live
 * tables. Editing a rule tomorrow cannot change what yesterday's review was
 * judged against, including when yesterday's review is resumed tomorrow.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { EngineEvent } from "@/lib/engine/events";
import { SHUTDOWN } from "@/lib/domain/shutdown";
import {
  engineModeSchema,
  reviewEffortSchema,
  reviewProfileSchema,
  type ReviewStage,
  type RulesetTier,
} from "@/lib/domain/enums";
import {
  ACTIVE_REVIEW_STATUSES,
  canTransitionReview,
  isResumableReview,
  type ReviewStatus,
} from "@/lib/domain/state-machines";
import { repoSlug } from "@/lib/git/url";
import {
  bundleDir as bundleDirFor,
  logsDir as logsDirFor,
  resolveDataDir,
  runDir as runDirFor,
  worktreeBaselinePath,
  worktreeRepoDir,
  worktreeRootDir,
} from "@/lib/paths";
import { runSummary } from "@/lib/review/run-summary";
import { outputContractFor, stageSchemaFor } from "@/lib/review/stage-schemas";
import { composeSystemPrompt } from "@/lib/rulesets/compose";
import type { ImportedRuleset } from "@/lib/rulesets/model";
import type { Db } from "../db/client";
import {
  deleteAllForReview,
  markOpenQuestion,
  requireFinding,
  ReviewNotDecidingError,
  statusOf as findingStatusOf,
} from "../db/repositories/findings";
import { listLedgerFiles } from "../db/repositories/ledger";
import { listDependencyLinks, requireProject, recordFetch } from "../db/repositories/projects";
import {
  appendRunNote,
  deleteReview,
  requireReview,
  setContextWindow,
  setVerifierModel,
  setCurrentStage,
  statusOf,
  transitionReview,
} from "../db/repositories/reviews";
import { availabilityOf } from "@/lib/models/availability";
import { pairedVerifierFor } from "@/lib/models/pairing";
import { getModel } from "../db/repositories/models";
import {
  hasReviewSnapshot,
  readReviewSnapshot,
  saveImportedRuleset,
  writeReviewSnapshot,
} from "../db/repositories/rulesets";
import { SETTING_KEYS, readSettingOr } from "../db/repositories/settings";
import { describeCli } from "../engine/cli";
import { StageFailedError } from "../engine/headless";
import { buildBundle, readBaseContents, type RepoSpec } from "../gitops/bundle";
import { getProjectChecks } from "../db/repositories/project-checks";
import {
  deleteCheckFindingsForReview,
  recordFailedCommand,
} from "../db/repositories/check-findings";
import { runChecksForReview, type ChecksResult } from "./project-checks";
import { screenshotFile, screenshotsDir } from "./screenshots";
import { fetchAll, resolveCommit } from "../gitops/repo";
import {
  addWorktree,
  assertWorktreeClean,
  removeWorktree,
  worktreeBaseline,
  worktreeBaselineSchema,
  worktreeCommit,
  type WorktreeBaseline,
} from "../gitops/worktree";
import { createCheckpointingRunner, type CheckpointingRunner } from "./checkpointing-runner";
import type { ChangedFileEntry } from "./content";
import type { ReviewEngine } from "../engine/adapter";
import { createInteractiveEngine } from "../engine/interactive";
import { createEngineRunner } from "./engine-runner";
import { runReviewPipeline, type PipelineResult, type StageRequest } from "./pipeline";
import {
  applySecondVerdicts,
  applyVerdicts,
  parseVerdicts,
  renderVerificationFor,
} from "./verification";

/** Twenty minutes. A stage that reads a large change set is not quick. */
const DEFAULT_STAGE_TIMEOUT_MINUTES = 20;

/**
 * The default USD-equivalent ceiling per engine call.
 *
 * High enough that no honest stage on a large change set hits it, low enough
 * that a runaway one is bounded. Zero in the setting disables the flag, which
 * is a choice someone has to make on purpose.
 */
const DEFAULT_STAGE_BUDGET_USD = 15;

export class ReviewNotRunnableError extends Error {
  constructor(
    readonly reviewId: string,
    readonly status: string,
  ) {
    super(
      `Review ${reviewId} is ${status}, so it cannot be started. Only a draft, or one ` +
        "paused on a usage limit, interrupted by a restart, or failed, can run.",
    );
    this.name = "ReviewNotRunnableError";
  }
}

export class PinnedCommitMissingError extends Error {
  constructor(
    readonly reviewId: string,
    readonly commit: string,
    readonly where: string,
  ) {
    super(
      `Review ${reviewId} is pinned to commit ${commit}, which ${where} no longer has. ` +
        "The review describes commits that cannot move, so it cannot be run against a " +
        "different one. A force-push or a history rewrite is the usual cause; start a new review.",
    );
    this.name = "PinnedCommitMissingError";
  }
}

export class LinkedReviewIncompleteError extends Error {
  constructor(
    readonly reviewId: string,
    readonly linkedProjectName: string,
  ) {
    super(
      `Review ${reviewId} names ${linkedProjectName} as a linked repository but records no ` +
        "pinned commits for it, so half of the change it was created to examine cannot be read.",
    );
    this.name = "LinkedReviewIncompleteError";
  }
}

export class RulesetRequiredError extends Error {
  constructor(readonly reviewId: string) {
    super(
      `Review ${reviewId} has no frozen ruleset and none was supplied. A review must ` +
        "record what it was judged against before it runs, or its findings could never " +
        "be reproduced.",
    );
    this.name = "RulesetRequiredError";
  }
}

export interface StageLifecycleEvent {
  stage: ReviewStage;
  /** A replayed stage costs nothing and spawns nothing. */
  kind: "live" | "replayed";
  /** Present only for a stage that divides its work into several requests. */
  batch?: { number: number; count: number } | undefined;
}

export interface PrepareAndRunOptions {
  /** Defaults to the configured data directory. Tests pass a temporary one. */
  dataDir?: string | undefined;
  /**
   * The CLI, as the caller resolved it: the manager passes configuredClaudePath
   * (D-152). Not looked up again here, so there is one order, not two.
   * Undefined is the CLI npm install put in node_modules, then PATH.
   */
  claudePath?: string | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((stage: ReviewStage, event: EngineEvent) => void) | undefined;
  onStageLifecycle?: ((event: StageLifecycleEvent) => void) | undefined;
  /** Required the first time a review runs; ignored once one is frozen. */
  ruleset?:
    | { imported: ImportedRuleset; name: string; tier: RulesetTier; sourceDoc?: string | undefined }
    | undefined;
}

export type RunOutcome =
  | { kind: "completed"; result: PipelineResult }
  | { kind: "paused"; reason: string }
  | { kind: "cancelled"; reason: string }
  | { kind: "interrupted"; reason: string }
  | { kind: "failed"; reason: string; logPath?: string | undefined };

interface RepoSide {
  slug: string;
  clonePath: string;
  worktreeDir: string;
  /** What the checkout reported changed when it was made (D-107). */
  baselinePath: string;
  headCommit: string;
  mergeBaseCommit: string;
  role: "primary" | "linked";
  projectName: string;
}

/**
 * Runs a review to the point a human has to look at it.
 *
 * Returns an outcome rather than throwing, because every ending here is a
 * real result the caller has to record: a usage limit is not a bug, and a
 * cancelled run is what the user asked for. Only a caller error, a review in
 * the wrong state or one with no ruleset, throws.
 */
export async function prepareAndRun(
  db: Db,
  reviewId: string,
  options: PrepareAndRunOptions = {},
): Promise<RunOutcome> {
  const dataDir = options.dataDir ?? resolveDataDir(process.env, homedir());

  const review = requireReview(db, reviewId);
  const startingStatus = statusOf(review);
  if (startingStatus !== "draft" && !isResumableReview(startingStatus)) {
    throw new ReviewNotRunnableError(reviewId, startingStatus);
  }

  const project = requireProject(db, review.projectId);
  const linkedProject =
    review.linkedProjectId === null ? undefined : requireProject(db, review.linkedProjectId);

  // The ruleset is settled before anything is transitioned or written, so a
  // review that was never going to be able to run does not first look started.
  if (!hasReviewSnapshot(db, reviewId)) {
    if (!options.ruleset) throw new RulesetRequiredError(reviewId);
    const { rulesetId } = saveImportedRuleset(db, {
      name: options.ruleset.name,
      tier: options.ruleset.tier,
      imported: options.ruleset.imported,
      ...(options.ruleset.sourceDoc === undefined ? {} : { sourceDoc: options.ruleset.sourceDoc }),
    });
    writeReviewSnapshot(db, reviewId, rulesetId);
    // Frozen at the same moment and for the same reason as the ruleset. This
    // is the only place the registry is consulted: everywhere downstream reads
    // the frozen column, so a probe expiring mid-review cannot change how an
    // already-started review batches its work.
    const known = getModel(db, review.model);
    setContextWindow(
      db,
      reviewId,
      known && availabilityOf(known) === "available" ? (known.contextWindow ?? null) : null,
    );
  }
  const snapshot = readReviewSnapshot(db, reviewId);
  // Frozen as the ruleset is, so a resume asks the same second verifier; a
  // review that first ran before the column takes it now (WP-E).
  const verifierModel =
    review.verifierModel ?? pairedVerifierFor(getModel(db, review.model)?.family);
  if (review.verifierModel === null) setVerifierModel(db, reviewId, verifierModel);
  // Read before the review is marked running: an unreadable value fails the
  // start here, rather than leaving a row that says running with nothing
  // behind it.
  const interactive = engineModeSchema.parse(review.engineMode) === "interactive";

  transitionReview(db, reviewId, "running", { currentStage: null });

  // Which binary answers matters as much as which model: a fake-versus-real
  // mixup must be readable from the run itself, not deduced from token counts.
  // Mode B starts no process, so it reports no version, and passes no effort:
  // the person's own session decides how hard it thinks.
  appendRunNote(db, reviewId, {
    kind: "note",
    message: interactive
      ? `Engine: interactive, answered in your own session, model ${review.model}.`
      : `Engine: ${await describeCli(options.claudePath)}, ` +
        `model ${review.model}, effort ${review.effort}.`,
  });

  try {
    const sides = sidesOf(review, project, linkedProject, dataDir, reviewId);
    if (sides.length === 2 && repoSlug(project.name) === repoSlug(linkedProject?.name ?? "")) {
      appendRunNote(db, reviewId, {
        kind: "note",
        message:
          `Both repositories are named ${project.name}, so the dependency is checked out ` +
          `as ${sides[1]?.slug} to keep the two apart in every path the model sees.`,
      });
    }

    for (const side of sides) {
      await fetchAll(side.clonePath);
      await assertPinnedCommitsExist(side, reviewId);
    }
    recordFetch(db, project.id);
    if (linkedProject) recordFetch(db, linkedProject.id);

    for (const side of sides) {
      const baseline = await ensureWorktree(side);
      if (baseline && baseline.changes.length > 0) {
        appendRunNote(db, reviewId, {
          kind: "note",
          message:
            `The checkout of ${side.projectName} already reported ${baseline.changes.length} ` +
            `changed file(s), as its .gitattributes normalises them: ` +
            `${baseline.changes.slice(0, 5).join(", ")}. The end check holds them to their ` +
            `content at checkout.`,
        });
      }
    }

    const packageName = linkedProject
      ? (listDependencyLinks(db, project.id).find(
          (link) => link.dependencyProjectId === linkedProject.id,
        )?.packageName ?? null)
      : null;

    const bundle = await buildBundle({
      bundleDir: bundleDirFor(dataDir, reviewId),
      repos: sides.map((side): RepoSpec => ({
        role: side.role,
        slug: side.slug,
        repoDir: side.clonePath,
        mergeBaseCommit: side.mergeBaseCommit,
        headCommit: side.headCommit,
      })),
      packageName,
    });

    const files: ChangedFileEntry[] = sides.flatMap((side) =>
      (bundle.parsedByRepo.get(side.role) ?? []).map((file) => ({
        repo: side.role,
        slug: side.slug,
        file,
      })),
    );

    // A deleted file is not in the worktree, so the only way the deletion
    // stage can read one is from the copy the bundle took at the merge base.
    const { contents: baseContents, missing } = await readBaseContents(
      bundleDirFor(dataDir, reviewId),
      files,
    );
    for (const miss of missing) {
      // Not fatal, and not hidden either: the prompt says outright when it is
      // judging a deletion it could not open, and this says which one.
      appendRunNote(db, reviewId, {
        kind: "note",
        message:
          `No pre-change copy of ${miss.path}, so its deletion is reviewed from ` +
          `the diff alone: ${miss.reason}`,
      });
    }

    // The project's own tests and e2e, when a person turned them on (WP-I,
    // D-191): run on a throwaway copy of the commit under review, before
    // any model is asked. The dependency's are not run; it is reviewed as
    // the code the primary consumes.
    const checks = getProjectChecks(db, project.id);
    const primary = sides.find((side) => side.role === "primary");
    // Made again from the result each time, as code findings are from the
    // stages' answers, so a resume does not add a second copy (D-197).
    deleteCheckFindingsForReview(db, reviewId);
    let ranChecks: ChecksResult | undefined;
    if (checks.enabled && primary !== undefined) {
      // Before the copy: the fetch and the bundle above may have been
      // cancelled, and nothing since has asked.
      assertNotCancelled(options.signal);
      const ran = await runChecksForReview(db, {
        reviewId,
        dataDir,
        clonePath: primary.clonePath,
        commit: primary.headCommit,
        checks,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      assertNotCancelled(options.signal);
      // A failing command is proven by the app itself: its exit code or its
      // time limit, and its output (WP-I, step 3).
      for (const command of ran.commands) {
        if (command.cancelled || (command.exitCode === 0 && !command.timedOut)) continue;
        recordFailedCommand(db, reviewId, command);
      }
      ranChecks = ran;
    }

    // Candidates and their verdicts are derived entirely from stage answers,
    // and every stage answer is checkpointed. Clearing them lets a resumed run
    // recreate them from the stored answers instead of adding a second copy
    // beside the first.
    deleteAllForReview(db, reviewId);

    const runner = buildRunner(db, reviewId, {
      dataDir,
      review,
      snapshot,
      options,
    });

    // The frozen value, not the registry's current answer.
    const contextWindow = requireReview(db, reviewId).contextWindow ?? undefined;
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot: worktreeRootDir(dataDir, reviewId),
      files,
      repositories: sides.map((side) => ({ slug: side.slug, repo: side.role })),
      rules: snapshot.rules,
      // Parsed rather than asserted: the column is text, and a profile the
      // code does not know would otherwise reach the batch planner as a
      // silently unrecognised value.
      profile: reviewProfileSchema.parse(review.profileId),
      ...(review.intent === null ? {} : { intent: review.intent }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      changedSymbols: bundle.inventory.changedExportedSymbols,
      baseContents,
      secondVerifier: verifierModel,
      // The screens the project's own e2e saved, graded in S4b and S5c (WP-I
      // step 4), only once there are some to grade.
      ...(ranChecks !== undefined && ranChecks.screenshots.length > 0
        ? {
            design: {
              screenshotsDir: screenshotsDir(dataDir, reviewId),
              // The copy keeps only names the lookup takes (isScreenshotName);
              // one it would not is left out rather than sent as no path.
              screenshots: ranChecks.screenshots.flatMap((shot) => {
                const path = screenshotFile(dataDir, reviewId, shot.name);
                return path === null ? [] : [{ ...shot, path }];
              }),
              standard: ranChecks.designStandard ?? null,
            },
          }
        : {}),
      systemPromptFor: (stage, batch) =>
        composeSystemPrompt({
          directives: snapshot.directives,
          rules: batch?.rules ?? snapshot.rules,
          stage,
          includeFullRules: stage === "s3_adversarial",
          outputContract: outputContractFor(stageSchemaFor(stage)),
        }),
      run: cancellableRunner(runner, options.signal),
      invalidate: (stage, reason) => runner.invalidate(stage, reason),
    });

    // The app never writes inside a checked-out review, so this is not a
    // formality: a dirty worktree means something did, and every quotation
    // checked against it is suspect.
    for (const side of sides) {
      await assertWorktreeClean(side.worktreeDir, await readBaseline(side.baselinePath));
    }

    appendRunNote(db, reviewId, { kind: "note", message: runSummary(files.length, result) });

    // Checked once more before the review is called finished. A cancel that
    // landed during the last stage's bookkeeping has no other boundary left.
    assertNotCancelled(options.signal);

    ensureVerifying(db, reviewId);
    transitionReview(db, reviewId, "awaiting_confirmation", { currentStage: null });
    return { kind: "completed", result };
  } catch (error) {
    return recordFailure(db, reviewId, dataDir, error, options.signal);
  }
}

export class NotAnOpenQuestionError extends Error {
  constructor(
    readonly findingId: string,
    readonly status: string,
  ) {
    super(
      `This finding is ${status.replace(/_/g, " ")}, not an open question, so there is ` +
        "nothing to verify again.",
    );
    this.name = "NotAnOpenQuestionError";
  }
}

/** Why an open question cannot be verified again now, in words a person can act on. */
export class VerifyAgainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyAgainUnavailableError";
  }
}

/**
 * Asks verification about one open question again, in a fresh session, and
 * holds the answer to S5's checks (proof-and-steps plan, WP-D2). Proven, it
 * can be confirmed; refuted, it is killed; unsettled, it stays open with the
 * newer note. A paid request, so never replayed from the last answer.
 */
export async function verifyAgain(
  db: Db,
  findingId: string,
  options: Pick<PrepareAndRunOptions, "dataDir" | "claudePath" | "signal"> = {},
): Promise<{ status: string }> {
  const dataDir = options.dataDir ?? resolveDataDir(process.env, homedir());
  const { finding, review, worktreeRoot } = assertCanVerifyAgain(db, findingId, dataDir);

  try {
    const snapshot = readReviewSnapshot(db, review.id);
    const { contents: baseContents } = await readBaseContents(
      bundleDirFor(dataDir, review.id),
      listLedgerFiles(db, review.id)
        .filter((file) => file.changeType === "deleted")
        .map((file) => {
          const [slug = "", ...rest] = file.path.split("/");
          return {
            slug,
            file: {
              path: rest.join("/"),
              oldPath: file.oldPath ?? undefined,
              changeType: "deleted" as const,
              isBinary: false,
            },
          };
        }),
    );
    const context = { db, worktreeRoot, baseContents, rules: snapshot.rules };
    const runner = buildRunner(db, review.id, {
      dataDir,
      review,
      snapshot,
      options,
      alone: true,
    });
    // A request abandoned before the CLI started, a tab closed or a drain,
    // asks nothing: the engine stops a call in flight, not one not yet made.
    assertNotCancelled(options.signal);
    const response = await runner.run({
      stage: "s5_verification",
      systemPrompt: composeSystemPrompt({
        directives: snapshot.directives,
        rules: snapshot.rules,
        stage: "s5_verification",
        includeFullRules: false,
        outputContract: outputContractFor(stageSchemaFor("s5_verification")),
      }),
      prompt: renderVerificationFor([finding], context),
      fresh: true,
      findingId: finding.id,
    });
    const verdicts = parseVerdicts(response.output, 1);
    const { held, ...tally } = await applyVerdicts(context, [finding], verdicts, { hold: true });
    // No verdict for it, or only for a ref it was not given: still open, and
    // the old note would read as this answer's.
    if (tally.verified + tally.killed + tally.openQuestions === 0) {
      markOpenQuestion(db, finding.id, "Verification returned no verdict for this finding.");
    }
    // Proven by the first, then asked of the second, as in a run: a finding
    // proven again is proven by both, or left open naming the one that did
    // not agree (WP-E, D-188). Fresh too, so a press never replays.
    if (held.length > 0) {
      const verifierModel =
        review.verifierModel ?? pairedVerifierFor(getModel(db, review.model)?.family);
      // Frozen now if it was not, so the card can name it afterwards.
      if (review.verifierModel === null) setVerifierModel(db, review.id, verifierModel);
      assertNotCancelled(options.signal);
      const second = await runner.run({
        stage: "s5b_second_verification",
        systemPrompt: composeSystemPrompt({
          directives: snapshot.directives,
          rules: snapshot.rules,
          stage: "s5b_second_verification",
          includeFullRules: false,
          outputContract: outputContractFor(stageSchemaFor("s5b_second_verification")),
        }),
        prompt: renderVerificationFor(
          held.map((proven) => proven.finding),
          context,
          held.map((proven) => proven.ref),
        ),
        model: verifierModel,
        fresh: true,
        findingId: finding.id,
      });
      await applySecondVerdicts(context, held, parseVerdicts(second.output, 1), verifierModel);
    }
    const after = findingStatusOf(requireFinding(db, finding.id));
    appendRunNote(db, review.id, {
      kind: "note",
      message:
        `Verified again: ${finding.filePath}:${finding.lineStart} ${finding.issue} is now ` +
        `${after.replace(/_/g, " ")}` +
        (tally.killedByQuoteCheck > 0 ? ", its proof not matching the code." : "."),
    });
    return { status: after };
  } catch (error) {
    appendRunNote(db, review.id, {
      kind: "note",
      message:
        `Verifying ${finding.filePath}:${finding.lineStart} again did not finish, so it is ` +
        `still an open question: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}

/**
 * Everything that refuses a verify-again before anything is asked, so a route
 * can answer it before the CLI is checked or a request is sent.
 */
export function assertCanVerifyAgain(db: Db, findingId: string, dataDir: string) {
  const finding = requireFinding(db, findingId);
  const status = findingStatusOf(finding);
  if (status !== "open_question") throw new NotAnOpenQuestionError(findingId, status);
  const review = requireReview(db, finding.reviewId);
  const reviewStatus = statusOf(review);
  if (reviewStatus !== "awaiting_confirmation") {
    throw new ReviewNotDecidingError(review.id, reviewStatus);
  }
  // The person's own session answers an interactive review, which this
  // request cannot wait on from a button.
  if (engineModeSchema.parse(review.engineMode) === "interactive") {
    throw new VerifyAgainUnavailableError(
      "This review is answered in your own session, so a finding cannot be verified again " +
        "from here.",
    );
  }
  const worktreeRoot = worktreeRootDir(dataDir, review.id);
  // Without the checkout every step would read as unreadable and the finding
  // would be killed for a missing file, not for its proof. Each repository's,
  // not only the folder that holds them (review round 2, F15).
  const slugs = new Set(listLedgerFiles(db, review.id).map((file) => file.path.split("/")[0]!));
  if (
    !existsSync(worktreeRoot) ||
    [...slugs].some((slug) => !existsSync(worktreeRepoDir(dataDir, review.id, slug)))
  ) {
    throw new VerifyAgainUnavailableError(
      "This review's checkout is gone, so there is no code to verify the finding against.",
    );
  }

  return { finding, review, worktreeRoot };
}

function sidesOf(
  review: ReturnType<typeof requireReview>,
  project: ReturnType<typeof requireProject>,
  linkedProject: ReturnType<typeof requireProject> | undefined,
  dataDir: string,
  reviewId: string,
): RepoSide[] {
  const primarySlug = repoSlug(project.name);
  const sides: RepoSide[] = [
    {
      slug: primarySlug,
      clonePath: project.clonePath,
      worktreeDir: worktreeRepoDir(dataDir, reviewId, primarySlug),
      baselinePath: worktreeBaselinePath(dataDir, reviewId, primarySlug),
      headCommit: review.fromCommit,
      mergeBaseCommit: review.mergeBaseCommit,
      role: "primary",
      projectName: project.name,
    },
  ];

  if (linkedProject) {
    if (!review.linkedFromCommit || !review.linkedMergeBaseCommit) {
      // Silently reviewing the primary alone would be the worst outcome: the
      // run would look complete while the half of the change that motivated
      // linking the two repositories went unread.
      throw new LinkedReviewIncompleteError(reviewId, linkedProject.name);
    }
    // Two projects can share a name. The suffix is deterministic rather than
    // uniquified with a counter, so the same review always lays out the same
    // paths and a resumed run finds the worktrees it left behind.
    const candidate = repoSlug(linkedProject.name);
    const slug = candidate === primarySlug ? `${candidate}-dep` : candidate;
    sides.push({
      slug,
      clonePath: linkedProject.clonePath,
      worktreeDir: worktreeRepoDir(dataDir, reviewId, slug),
      baselinePath: worktreeBaselinePath(dataDir, reviewId, slug),
      headCommit: review.linkedFromCommit,
      mergeBaseCommit: review.linkedMergeBaseCommit,
      role: "linked",
      projectName: linkedProject.name,
    });
  }

  return sides;
}

async function assertPinnedCommitsExist(side: RepoSide, reviewId: string): Promise<void> {
  for (const commit of [side.mergeBaseCommit, side.headCommit]) {
    try {
      await resolveCommit(side.clonePath, commit);
    } catch {
      throw new PinnedCommitMissingError(reviewId, commit, side.projectName);
    }
  }
}

/**
 * Puts the pinned commit in the worktree, whatever was there before.
 *
 * A worktree is disposable and the pin is not, so a worktree sitting at the
 * wrong commit is replaced rather than trusted. That case is not hypothetical:
 * a resumed review finds whatever the interrupted one left behind.
 */
async function ensureWorktree(side: RepoSide): Promise<WorktreeBaseline | null> {
  if (existsSync(join(side.worktreeDir, ".git"))) {
    const present = await worktreeCommit(side.worktreeDir).catch(() => null);
    // Without a baseline it can read, the end check cannot tell a checkout
    // that was already changed from one something wrote to, so it is made
    // again. A file cut short by a crash is no baseline.
    const kept = await readBaseline(side.baselinePath).catch(() => undefined);
    if (present === side.headCommit && kept !== undefined) return null;
    await removeWorktree(side.clonePath, side.worktreeDir);
  }
  await addWorktree(side.clonePath, side.worktreeDir, side.headCommit);
  const baseline = await worktreeBaseline(side.worktreeDir);
  await mkdir(dirname(side.baselinePath), { recursive: true });
  // Written whole or not at all, so a crash cannot leave half a baseline.
  const partial = `${side.baselinePath}.writing-${process.pid}`;
  await writeFile(partial, JSON.stringify(baseline), "utf8");
  await rename(partial, side.baselinePath);
  return baseline;
}

async function readBaseline(path: string): Promise<WorktreeBaseline | undefined> {
  if (!existsSync(path)) return undefined;
  return worktreeBaselineSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

function buildRunner(
  db: Db,
  reviewId: string,
  context: {
    dataDir: string;
    review: ReturnType<typeof requireReview>;
    snapshot: { directives: ImportedRuleset["directives"]; rules: ImportedRuleset["rules"] };
    options: Pick<PrepareAndRunOptions, "claudePath" | "signal" | "onEvent" | "onStageLifecycle">;
    /** One question asked of a review that is not running: its stage is left as it is. */
    alone?: boolean;
  },
): CheckpointingRunner {
  const { dataDir, review, snapshot, options } = context;
  const timeoutMinutes = readSettingOr(
    db,
    SETTING_KEYS.stageTimeoutMinutes,
    z.number().int().positive(),
    DEFAULT_STAGE_TIMEOUT_MINUTES,
  );
  const budget = readSettingOr(
    db,
    SETTING_KEYS.stageMaxBudgetUsd,
    z.number().nonnegative(),
    DEFAULT_STAGE_BUDGET_USD,
  );

  const noteStage = (
    stage: ReviewStage,
    kind: "live" | "replayed",
    batch?: { number: number; count: number },
  ): void => {
    if (context.alone) return;
    setCurrentStage(db, reviewId, stage);
    // Driven by replays as well as live calls. A fully resumed run makes no
    // live call at all, and a review that never reached verifying could not
    // then reach awaiting_confirmation.
    if (stage === "s5_verification") ensureVerifying(db, reviewId);
    options.onStageLifecycle?.({ stage, kind, ...(batch === undefined ? {} : { batch }) });
  };

  // The engine reports attempts to the wrapper, and the wrapper delegates to
  // the engine, so one of them has to be reachable before it exists.
  const built: { wrapper?: CheckpointingRunner } = {};

  // Which engine answers is the review's own frozen decision, not a live
  // setting: a review that started in one mode must finish in it, or a resume
  // would change what the run means half way through.
  const engine: ReviewEngine =
    engineModeSchema.parse(review.engineMode) === "interactive"
      ? createInteractiveEngine({
          exchangeDir: bundleDirFor(dataDir, reviewId),
          worktreeRoot: worktreeRootDir(dataDir, reviewId),
          model: review.model,
          directives: snapshot.directives,
          rules: snapshot.rules,
          timeoutMs: timeoutMinutes * 60_000,
          // The CLI the printed command runs, resolved as a headless stage's.
          claudePath: options.claudePath,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
        })
      : createEngineRunner({
          worktreeRoot: worktreeRootDir(dataDir, reviewId),
          logsDir: logsDirFor(dataDir, reviewId),
          model: review.model,
          timeoutMs: timeoutMinutes * 60_000,
          effort: reviewEffortSchema.parse(review.effort),
          directives: snapshot.directives,
          rules: snapshot.rules,
          ...(budget > 0 ? { maxBudgetUsd: budget } : {}),
          ...(options.claudePath ? { claudePath: options.claudePath } : {}),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
          onStageComplete: (info) => built.wrapper?.noteAttempt(info),
        });

  built.wrapper = createCheckpointingRunner({
    db,
    reviewId,
    inner: engine.run,
    onLiveAttempt: (stage, batch) => noteStage(stage, "live", batch),
    onReplay: (stage) => noteStage(stage, "replayed"),
    logPathFor: (stage) => join(logsDirFor(dataDir, reviewId), `${stage}.log`),
  });
  return built.wrapper;
}

/**
 * The runner, with the cancel signal checked at every stage boundary.
 *
 * The engine hands the signal to the process it spawns, which covers a cancel
 * arriving while a stage is in flight. It does not cover one arriving between
 * stages, when no child exists to kill: without this the run would carry on to
 * the next stage and finish, and the user who pressed cancel would be handed a
 * completed review. Stage boundaries are where a run can stop cleanly, having
 * already checkpointed everything it paid for.
 */
function cancellableRunner(runner: CheckpointingRunner, signal: AbortSignal | undefined) {
  return (request: StageRequest) => {
    assertNotCancelled(signal);
    return runner.run(request);
  };
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new StageFailedError("cancelled", "The review was cancelled.");
}

/** Moves a running review into verifying, and does nothing if it is already. */
function ensureVerifying(db: Db, reviewId: string): void {
  if (statusOf(requireReview(db, reviewId)) === "running") {
    transitionReview(db, reviewId, "verifying");
  }
}

async function recordFailure(
  db: Db,
  reviewId: string,
  dataDir: string,
  error: unknown,
  signal: AbortSignal | undefined,
): Promise<RunOutcome> {
  const message = error instanceof Error ? error.message : String(error);
  const errorClass = error instanceof StageFailedError ? error.errorClass : undefined;
  const logPath = error instanceof StageFailedError ? error.detail.logPath : undefined;

  if (errorClass === "limit") {
    const resetsAt = error instanceof StageFailedError ? error.detail.resetsAt : undefined;
    settle(db, reviewId, "paused_limit", {
      pausedReason: message,
      ...(resetsAt === undefined ? {} : { pausedResetsAt: resetsAt }),
    });
    return { kind: "paused", reason: message };
  }

  // Before the cancel branch, which an abort would otherwise reach. The
  // worktrees stay: a resumed run checks them out again only if they are gone.
  if (signal?.aborted === true && signal.reason === SHUTDOWN) {
    settle(db, reviewId, "interrupted");
    return { kind: "interrupted", reason: "The server stopped while this review was running." };
  }

  if (errorClass === "cancelled" || signal?.aborted === true) {
    settle(db, reviewId, "cancelled");
    await discardWorktrees(db, reviewId, dataDir);
    return { kind: "cancelled", reason: message };
  }

  appendRunNote(db, reviewId, {
    kind: "note",
    message: logPath ? `${message} The stage log is at ${logPath}.` : message,
  });
  settle(db, reviewId, "failed");
  await discardWorktrees(db, reviewId, dataDir);
  return { kind: "failed", reason: message, logPath };
}

/**
 * Removes the checked-out copies after a run that will not resume (D-12:
 * cancelled and failed here, complete when the confirmation flow lands).
 * Best effort on purpose: a cleanup failure becomes a note, never a mask
 * over the outcome that actually matters.
 */
async function discardWorktrees(db: Db, reviewId: string, dataDir: string): Promise<void> {
  try {
    await removeReviewWorktrees(db, reviewId, dataDir);
  } catch (error) {
    appendRunNote(db, reviewId, {
      kind: "note",
      message: `The worktrees could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Records how a run ended, without letting the recording throw.
 *
 * Something else may have moved the review while this run was failing: a
 * cancel from the job manager is the obvious case, and cancelled is terminal.
 * Transitioning anyway would throw from inside the catch block and replace a
 * real diagnosis with a state-machine complaint, which is the one error nobody
 * needs. The outcome returned still describes what actually went wrong.
 */
function settle(
  db: Db,
  reviewId: string,
  to: ReviewStatus,
  options: { pausedReason?: string; pausedResetsAt?: number } = {},
): void {
  const current = statusOf(requireReview(db, reviewId));
  if (!canTransitionReview(current, to)) return;
  transitionReview(db, reviewId, to, options);
}

/**
 * Removes the checked-out copies, keeping the evidence.
 *
 * Called when a review reaches an ending it will not resume from. The bundle
 * and the stage logs stay: they are how a finding is explained after the fact,
 * and a failed run is exactly when someone wants to read them.
 */
export async function removeReviewWorktrees(
  db: Db,
  reviewId: string,
  dataDir?: string,
): Promise<void> {
  const root = dataDir ?? resolveDataDir(process.env, homedir());
  const review = requireReview(db, reviewId);
  const project = requireProject(db, review.projectId);
  const linkedProject =
    review.linkedProjectId === null ? undefined : requireProject(db, review.linkedProjectId);

  for (const side of sidesOf(review, project, linkedProject, root, reviewId)) {
    if (existsSync(side.worktreeDir)) await removeWorktree(side.clonePath, side.worktreeDir);
  }
  // The registration outlives the directory, so a later worktree add at the
  // same path would be refused by git without this.
  await rm(worktreeRootDir(root, reviewId), { recursive: true, force: true });
}

/** Everything on disk for a review, including the evidence. Deletion only. */
export async function removeReviewArtifacts(
  db: Db,
  reviewId: string,
  dataDir?: string,
): Promise<void> {
  const root = dataDir ?? resolveDataDir(process.env, homedir());
  await removeReviewWorktrees(db, reviewId, root);
  await rm(runDirFor(root, reviewId), { recursive: true, force: true });
}

export class ReviewStillRunningError extends Error {
  constructor(
    readonly reviewId: string,
    readonly status: string,
  ) {
    super(
      `Review ${reviewId} is ${status} and cannot be deleted while it runs. ` +
        "Cancel it first, so the process it owns is stopped rather than orphaned.",
    );
    this.name = "ReviewStillRunningError";
  }
}

export async function deleteReviewEntirely(
  db: Db,
  reviewId: string,
  dataDir?: string,
): Promise<void> {
  const status = statusOf(requireReview(db, reviewId));
  if ((ACTIVE_REVIEW_STATUSES as readonly string[]).includes(status)) {
    throw new ReviewStillRunningError(reviewId, status);
  }
  await removeReviewArtifacts(db, reviewId, dataDir);
  deleteReview(db, reviewId);
}
