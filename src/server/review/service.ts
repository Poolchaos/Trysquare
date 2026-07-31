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
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { EngineEvent } from "@/lib/engine/events";
import {
  reviewEffortSchema,
  reviewProfileSchema,
  type ReviewStage,
  type RulesetTier,
} from "@/lib/domain/enums";
import {
  ACTIVE_REVIEW_STATUSES,
  canTransitionReview,
  type ReviewStatus,
} from "@/lib/domain/state-machines";
import { repoSlug } from "@/lib/git/url";
import {
  bundleDir as bundleDirFor,
  logsDir as logsDirFor,
  resolveDataDir,
  runDir as runDirFor,
  worktreeRepoDir,
  worktreeRootDir,
} from "@/lib/paths";
import { outputContractFor, stageSchemaFor } from "@/lib/review/stage-schemas";
import { composeSystemPrompt } from "@/lib/rulesets/compose";
import type { ImportedRuleset } from "@/lib/rulesets/model";
import type { Db } from "../db/client";
import { deleteAllForReview } from "../db/repositories/findings";
import { listDependencyLinks, requireProject, recordFetch } from "../db/repositories/projects";
import {
  appendRunNote,
  deleteReview,
  requireReview,
  setContextWindow,
  setCurrentStage,
  statusOf,
  transitionReview,
} from "../db/repositories/reviews";
import { availabilityOf, getModel } from "../db/repositories/models";
import {
  hasReviewSnapshot,
  readReviewSnapshot,
  saveImportedRuleset,
  writeReviewSnapshot,
} from "../db/repositories/rulesets";
import { SETTING_KEYS, readSettingOr } from "../db/repositories/settings";
import { StageFailedError } from "../engine/headless";
import { buildBundle, type RepoSpec } from "../gitops/bundle";
import { fetchAll, resolveCommit } from "../gitops/repo";
import {
  addWorktree,
  assertWorktreeClean,
  removeWorktree,
  worktreeCommit,
} from "../gitops/worktree";
import { createCheckpointingRunner, type CheckpointingRunner } from "./checkpointing-runner";
import type { ChangedFileEntry } from "./content";
import { createEngineRunner } from "./engine-runner";
import { runReviewPipeline, type PipelineResult, type StageRequest } from "./pipeline";

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
      `Review ${reviewId} is ${status}, so it cannot be started. Only a draft, ` +
        "a review paused on a usage limit, or one interrupted by a restart can run.",
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
}

export interface PrepareAndRunOptions {
  /** Defaults to the configured data directory. Tests pass a temporary one. */
  dataDir?: string | undefined;
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
  | { kind: "failed"; reason: string; logPath?: string | undefined };

interface RepoSide {
  slug: string;
  clonePath: string;
  worktreeDir: string;
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
  if (
    startingStatus !== "draft" &&
    startingStatus !== "paused_limit" &&
    startingStatus !== "interrupted"
  ) {
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

  transitionReview(db, reviewId, "running", { currentStage: null });

  // Which binary answers matters as much as which model: a fake-versus-real
  // mixup must be readable from the run itself, not deduced from token counts.
  const enginePath = options.claudePath ?? process.env.TRYSQUARE_CLAUDE_PATH;
  appendRunNote(db, reviewId, {
    kind: "note",
    message:
      `Engine: ${enginePath ?? "claude on PATH"}, model ${review.model}, ` +
      `effort ${review.effort}.`,
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

    for (const side of sides) await ensureWorktree(side);

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

    // Candidates and their verdicts are derived entirely from stage answers,
    // and every stage answer is checkpointed. Clearing them lets a resumed run
    // recreate them from the stored answers instead of adding a second copy
    // beside the first.
    deleteAllForReview(db, reviewId);

    const runner = buildRunner(db, reviewId, {
      dataDir,
      review,
      snapshot,
      sides,
      options,
    });

    // The frozen value, not the registry's current answer.
    const contextWindow = requireReview(db, reviewId).contextWindow ?? undefined;
    const result = await runReviewPipeline({
      db,
      reviewId,
      worktreeRoot: worktreeRootDir(dataDir, reviewId),
      files,
      rules: snapshot.rules,
      // Parsed rather than asserted: the column is text, and a profile the
      // code does not know would otherwise reach the batch planner as a
      // silently unrecognised value.
      profile: reviewProfileSchema.parse(review.profileId),
      ...(review.intent === null ? {} : { intent: review.intent }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      changedSymbols: bundle.inventory.changedExportedSymbols,
      systemPromptFor: (stage, batch) =>
        composeSystemPrompt({
          directives: snapshot.directives,
          rules: batch?.rules ?? snapshot.rules,
          stage,
          includeFullRules: stage === "s3_adversarial",
          outputContract: outputContractFor(stageSchemaFor(stage)),
        }),
      run: cancellableRunner(runner, options.signal),
    });

    // The app never writes inside a checked-out review, so this is not a
    // formality: a dirty worktree means something did, and every quotation
    // checked against it is suspect.
    for (const side of sides) await assertWorktreeClean(side.worktreeDir);

    appendRunNote(db, reviewId, {
      kind: "note",
      message:
        `Reviewed ${files.length} changed file(s): ${result.candidatesRaised} candidate(s) ` +
        `raised, ${result.verified} verified, ${result.killed} refuted, ` +
        `${result.openQuestions} left open, ${result.killedByQuoteCheck} discarded for ` +
        "quoting code that was not there.",
    });

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
async function ensureWorktree(side: RepoSide): Promise<void> {
  if (existsSync(join(side.worktreeDir, ".git"))) {
    const present = await worktreeCommit(side.worktreeDir).catch(() => null);
    if (present === side.headCommit) return;
    await removeWorktree(side.clonePath, side.worktreeDir);
  }
  await addWorktree(side.clonePath, side.worktreeDir, side.headCommit);
}

function buildRunner(
  db: Db,
  reviewId: string,
  context: {
    dataDir: string;
    review: ReturnType<typeof requireReview>;
    snapshot: { directives: ImportedRuleset["directives"]; rules: ImportedRuleset["rules"] };
    sides: RepoSide[];
    options: PrepareAndRunOptions;
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

  const noteStage = (stage: ReviewStage, kind: "live" | "replayed"): void => {
    setCurrentStage(db, reviewId, stage);
    // Driven by replays as well as live calls. A fully resumed run makes no
    // live call at all, and a review that never reached verifying could not
    // then reach awaiting_confirmation.
    if (stage === "s5_verification") ensureVerifying(db, reviewId);
    options.onStageLifecycle?.({ stage, kind });
  };

  // The engine reports attempts to the wrapper, and the wrapper delegates to
  // the engine, so one of them has to be reachable before it exists.
  const built: { wrapper?: CheckpointingRunner } = {};
  const engine = createEngineRunner({
    worktreeRoot: worktreeRootDir(dataDir, reviewId),
    logsDir: logsDirFor(dataDir, reviewId),
    model: review.model,
    timeoutMs: timeoutMinutes * 60_000,
    effort: reviewEffortSchema.parse(review.effort),
    directives: snapshot.directives,
    rules: snapshot.rules,
    ...(budget > 0 ? { maxBudgetUsd: budget } : {}),
    ...((options.claudePath ?? process.env.TRYSQUARE_CLAUDE_PATH)
      ? { claudePath: options.claudePath ?? process.env.TRYSQUARE_CLAUDE_PATH }
      : {}),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    onStageComplete: (info) => built.wrapper?.noteAttempt(info),
  });

  built.wrapper = createCheckpointingRunner({
    db,
    reviewId,
    inner: engine.run,
    onLiveAttempt: (stage) => noteStage(stage, "live"),
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
    settle(db, reviewId, "paused_limit", { pausedReason: message });
    return { kind: "paused", reason: message };
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
  options: { pausedReason?: string } = {},
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
