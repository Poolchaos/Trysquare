/**
 * The one place a review is actually started.
 *
 * A local single-user tool still needs a scheduler, because reviews are slow,
 * expensive, and share one account's usage. Running two at once would race for
 * the same rate limit and make both slower for no gain, so by default one runs
 * and the rest wait.
 *
 * The manager owns three things the service deliberately does not: how many
 * reviews may run at once, the AbortController that makes cancelling possible,
 * and the bus that lets a browser watch. It announces only what the database
 * already says, so a page that reloads mid-review sees the same run it saw a
 * moment ago rather than a different story.
 */

import { z } from "zod";
import type { EngineEvent } from "@/lib/engine/events";
import type { ReviewStage } from "@/lib/domain/enums";
import { canTransitionReview, type ReviewStatus } from "@/lib/domain/state-machines";
import { resolveDataDir } from "@/lib/paths";
import { homedir } from "node:os";
import type { Db } from "../db/client";
import { listFindings, statusOf as findingStatusOf } from "../db/repositories/findings";
import { coverageReport, type CoverageReport } from "../db/repositories/ledger";
import { registerCandidate } from "../db/repositories/models";
import { markOrphanedClonesFailed } from "../db/repositories/projects";
import {
  getReview,
  markOrphanedReviewsInterrupted,
  readRunNotes,
  requireReview,
  statusOf,
  transitionReview,
  type RunNote,
} from "../db/repositories/reviews";
import { SETTING_KEYS, readSettingOr } from "../db/repositories/settings";
import { listForReview, usageTotals } from "../db/repositories/stage-executions";
import { DEFAULT_MODEL_CANDIDATES } from "../engine/probe";
import { prepareAndRun, type PrepareAndRunOptions, type RunOutcome } from "../review/service";
import { createReviewBus, type ReviewEvent, type ReviewListener } from "./bus";

/** One at a time. Two reviews share one account's rate limit and one disk. */
const DEFAULT_MAX_CONCURRENT = 1;

export interface ManagerInit {
  db: Db;
  dataDir?: string;
  claudePath?: string;
}

export type StartState = "running" | "queued" | "already-running";

export interface ReviewSnapshot {
  review: ReturnType<typeof requireReview>;
  stages: ReturnType<typeof listForReview>;
  notes: RunNote[];
  usage: ReturnType<typeof usageTotals>;
  /** What the ledger says is still outstanding, which is what S6 gates on. */
  coverage: CoverageReport;
  findings: { total: number; verified: number; openQuestions: number; confirmed: number };
  running: boolean;
  queued: boolean;
}

interface ActiveRun {
  controller: AbortController;
  settled: Promise<RunOutcome>;
}

export class JobManager {
  private readonly bus = createReviewBus();
  private readonly active = new Map<string, ActiveRun>();
  private readonly queue: { reviewId: string; options: PrepareAndRunOptions }[] = [];
  private db: Db | undefined;
  private dataDir: string | undefined;
  private claudePath: string | undefined;

  /**
   * Called once per server start, after the database has been migrated.
   *
   * Recovering orphans belongs here rather than in a request handler: a review
   * still marked running cannot be running, and a clone still marked in flight
   * cannot be in flight, because nothing survived the restart that could be
   * doing either. Leaving the rows that way would make the review
   * un-startable and un-cancellable, and the clone a permanent "cloning" the
   * projects screen polls forever.
   */
  init(options: ManagerInit): void {
    this.db = options.db;
    this.dataDir = options.dataDir ?? resolveDataDir(process.env, homedir());
    this.claudePath = options.claudePath ?? process.env.TRYSQUARE_CLAUDE_PATH;

    markOrphanedReviewsInterrupted(options.db);
    markOrphanedClonesFailed(options.db);
    for (const candidate of DEFAULT_MODEL_CANDIDATES) registerCandidate(options.db, candidate);
  }

  subscribe(reviewId: string, listener: ReviewListener): () => void {
    return this.bus.subscribe(reviewId, listener);
  }

  listenerCount(reviewId: string): number {
    return this.bus.listenerCount(reviewId);
  }

  isRunning(reviewId: string): boolean {
    return this.active.has(reviewId);
  }

  queueDepth(): number {
    return this.queue.length;
  }

  /**
   * Starts a review, or puts it in line.
   *
   * The queue is in memory only. On a restart it is empty and the reviews that
   * were waiting are still drafts, which is the honest behaviour for a local
   * tool: nothing was promised to them, nothing was spent on them, and the user
   * can start them again. Persisting a queue would mean a crash could start
   * work nobody was watching.
   */
  start(reviewId: string, options: PrepareAndRunOptions = {}): StartState {
    const db = this.requireDb();
    // Reads the row so an unknown id fails here rather than inside a promise
    // nobody is awaiting.
    requireReview(db, reviewId);

    if (this.active.has(reviewId)) return "already-running";
    if (this.queue.some((entry) => entry.reviewId === reviewId)) return "queued";

    if (this.active.size >= this.maxConcurrent()) {
      this.queue.push({ reviewId, options });
      return "queued";
    }

    this.launch(reviewId, options);
    return "running";
  }

  /** Same as start; the service is what decides whether the status allows it. */
  resume(reviewId: string, options: PrepareAndRunOptions = {}): StartState {
    return this.start(reviewId, options);
  }

  cancel(reviewId: string): boolean {
    // Dequeueing alone is not a cancellation the rest of the app can see: the
    // row would still say draft, the Cancel button would still show, and a
    // second tab would wait on a queue entry that no longer exists. So the
    // entry is removed and then the row is judged like any other.
    const queuedAt = this.queue.findIndex((entry) => entry.reviewId === reviewId);
    if (queuedAt !== -1) this.queue.splice(queuedAt, 1);

    const run = this.active.get(reviewId);
    if (run) {
      run.controller.abort();
      return true;
    }

    // Nothing is executing, but the review may still be cancellable: a draft
    // (queued or not), one waiting on a person, or one stopped at a usage
    // limit. The state machine already knows which, so this asks it rather
    // than keeping a second list that would drift from the first. Without
    // this the only way to be rid of such a review was to delete it, which
    // also throws away its findings.
    const db = this.requireDb();
    const status = statusOf(requireReview(db, reviewId));
    if (canTransitionReview(status, "cancelled")) {
      transitionReview(db, reviewId, "cancelled");
      this.bus.emit(reviewId, { kind: "status", status: "cancelled" });
      return true;
    }

    // A dequeued review whose status has no cancel transition (a failed one
    // waiting to resume) keeps its status; taking it out of the line is still
    // a real effect worth reporting as one.
    return queuedAt !== -1;
  }

  /**
   * Takes a review out of the queue without judging its status.
   *
   * For the delete paths: a queued review is about to stop existing, and the
   * queue holds ids rather than rows. Separate from `cancel` because there is
   * nothing to cancel once the row is going, and transitioning a row that is
   * about to be deleted would be work nobody reads.
   */
  dequeue(reviewId: string): boolean {
    const at = this.queue.findIndex((entry) => entry.reviewId === reviewId);
    if (at === -1) return false;
    this.queue.splice(at, 1);
    return true;
  }

  /** Resolves when the review stops running, for callers that must wait. */
  settled(reviewId: string): Promise<RunOutcome> | undefined {
    return this.active.get(reviewId)?.settled;
  }

  /** Cancels everything and waits, so a test or a shutdown leaves nothing running. */
  async drain(): Promise<void> {
    this.queue.length = 0;
    for (const [, run] of this.active) run.controller.abort();
    await Promise.allSettled([...this.active.values()].map((run) => run.settled));
  }

  snapshot(reviewId: string): ReviewSnapshot {
    const db = this.requireDb();
    const review = requireReview(db, reviewId);
    const findings = listFindings(db, reviewId);
    const countOf = (status: string) =>
      findings.filter((finding) => findingStatusOf(finding) === status).length;

    return {
      review,
      stages: listForReview(db, reviewId),
      notes: readRunNotes(review),
      usage: usageTotals(db, reviewId),
      coverage: coverageReport(db, reviewId),
      findings: {
        total: findings.length,
        verified: countOf("verified"),
        openQuestions: countOf("open_question"),
        confirmed: countOf("confirmed"),
      },
      running: this.active.has(reviewId),
      queued: this.queue.some((entry) => entry.reviewId === reviewId),
    };
  }

  private maxConcurrent(): number {
    return readSettingOr(
      this.requireDb(),
      SETTING_KEYS.maxConcurrentReviews,
      z.number().int().positive(),
      DEFAULT_MAX_CONCURRENT,
    );
  }

  private requireDb(): Db {
    if (!this.db) throw new Error("The job manager was used before init() was called.");
    return this.db;
  }

  private launch(reviewId: string, options: PrepareAndRunOptions): void {
    const db = this.requireDb();
    const controller = new AbortController();

    // Announced only after the database says so, so a listener that reads the
    // row on hearing an event always finds it already changed.
    let lastStatus: ReviewStatus | undefined;
    let notesAnnounced = readRunNotes(requireReview(db, reviewId)).length;

    const announceDurable = (): void => {
      const review = getReview(db, reviewId);
      if (!review) return;

      const notes = readRunNotes(review);
      for (const note of notes.slice(notesAnnounced)) {
        this.bus.emit(reviewId, { kind: "note", note });
      }
      notesAnnounced = notes.length;

      const status = statusOf(review);
      if (status === lastStatus) return;
      lastStatus = status;
      this.bus.emit(reviewId, {
        kind: "status",
        status,
        ...(review.pausedReason === null ? {} : { pausedReason: review.pausedReason }),
      });
    };

    const settled = prepareAndRun(db, reviewId, {
      ...options,
      dataDir: options.dataDir ?? this.dataDir,
      claudePath: options.claudePath ?? this.claudePath,
      signal: controller.signal,
      onStageLifecycle: (event) => {
        announceDurable();
        this.bus.emit(reviewId, {
          kind: "stage",
          stage: event.stage,
          phase: event.kind === "replayed" ? "replayed" : "started",
        });
        options.onStageLifecycle?.(event);
      },
      onEvent: (stage: ReviewStage, event: EngineEvent) => {
        this.forwardEngineEvent(reviewId, stage, event);
        options.onEvent?.(stage, event);
      },
    })
      .then((outcome) => {
        announceDurable();
        this.bus.emit(reviewId, {
          kind: "done",
          outcome: outcome.kind,
          ...(outcome.kind === "completed" ? {} : { reason: outcome.reason }),
        });
        return outcome;
      })
      .catch((error: unknown) => {
        // prepareAndRun maps every run failure to an outcome, so reaching here
        // means the review could not be started at all: a bad status, a missing
        // ruleset. It is still an ending, and a watcher must be told.
        announceDurable();
        const reason = error instanceof Error ? error.message : String(error);
        this.bus.emit(reviewId, { kind: "done", outcome: "failed", reason });
        return { kind: "failed", reason } satisfies RunOutcome;
      })
      .finally(() => {
        this.active.delete(reviewId);
        this.startNextQueued();
      });

    this.active.set(reviewId, { controller, settled });
  }

  private forwardEngineEvent(reviewId: string, stage: ReviewStage, event: EngineEvent): void {
    if (event.kind === "tool-use") {
      this.bus.emit(reviewId, {
        kind: "engine",
        stage,
        event: "tool-use",
        detail: event.tool,
      });
      return;
    }
    if (event.kind === "text") {
      this.bus.emit(reviewId, { kind: "engine", stage, event: "text", detail: event.text });
      return;
    }
    if (event.kind === "rate-limit") {
      this.bus.emit(reviewId, {
        kind: "rate-limit",
        status: event.status,
        ...(event.resetsAt === undefined ? {} : { resetsAt: event.resetsAt }),
      });
    }
  }

  /**
   * Starts whatever is next in line, and survives what it finds there.
   *
   * This runs from the `finally` of the run that just ended, where nothing is
   * awaiting it and nothing would catch a throw. A queued review whose row was
   * deleted while it waited used to throw here, which both escaped as an
   * unhandled rejection and abandoned the loop, stranding every review behind
   * it in a queue nothing would ever drain again. A gone review is now simply
   * dropped, and any other fault is reported to the watchers of the review it
   * belongs to rather than taking the scheduler down with it.
   */
  private startNextQueued(): void {
    while (this.active.size < this.maxConcurrent()) {
      const next = this.queue.shift();
      if (!next) return;

      if (!getReview(this.requireDb(), next.reviewId)) continue;

      try {
        this.launch(next.reviewId, next.options);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.bus.emit(next.reviewId, { kind: "done", outcome: "failed", reason });
      }
    }
  }
}

/**
 * One manager per server process.
 *
 * Stored on globalThis rather than in a module-level constant because Next
 * reloads modules in development: a second manager would mean two schedulers
 * disagreeing about what is running, and a cancel that aborts nothing.
 */
const MANAGER_KEY = Symbol.for("trysquare.jobs.manager");

interface ManagerHolder {
  [MANAGER_KEY]?: JobManager;
}

export function jobManager(): JobManager {
  const holder = globalThis as ManagerHolder;
  holder[MANAGER_KEY] ??= new JobManager();
  return holder[MANAGER_KEY];
}

export type { ReviewEvent, ReviewListener };
