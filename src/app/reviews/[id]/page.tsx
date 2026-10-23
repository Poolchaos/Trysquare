"use client";

/**
 * A review while it runs, and what it found when it stops.
 *
 * The page opens on a snapshot read from the database and then follows the
 * event stream, so a reload mid-review shows the same run rather than starting
 * the story again. When the stream says the run is over it stops on its own
 * rather than holding the connection open.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import {
  canTransitionReview,
  isResumableReview,
  type ReviewStatus,
} from "@/lib/domain/state-machines";
import { completeness, refutedOnlySentence } from "@/lib/review/report";
import { ConfirmationQueue, type Finding } from "@/components/confirmation";
import { Loading, PageBody, PageHeader, PageLoading } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Empty,
  Mono,
  Problem,
  Select,
  Sha,
  severityTone,
  StatTile,
  statusLabel,
  statusTone,
} from "@/components/ui";
import { asSentence, send } from "@/components/request";
import {
  BillingNotice,
  billingOf,
  SignInLine,
  TerminalEnvironmentNote,
  type Billing,
} from "@/components/billing-notice";
import {
  ManagedPolicyNotice,
  managedPolicyOf,
  type ManagedPolicy,
} from "@/components/managed-policy-notice";
import type { SignIn } from "@/lib/engine/sign-in-command";

/**
 * The whole pipeline, not only the stages that call a model.
 *
 * S0 and S6 are deterministic app code and write no stage_executions row, so
 * their rows here are derived from the review itself. They belong on the
 * timeline because they are the two halves of a review that cannot be blamed
 * on a model: preparing the change set, and the audit that refuses to finish
 * while anything is outstanding.
 */
const STAGES = [
  ["s0_prepare", "Prepare", "Fetch, pin, check out, build the bundle, run the sweeps"],
  ["s1_risk", "Risk", "Classify each changed file"],
  ["s2_comprehension", "Comprehension", "Read the code, including what it calls into"],
  ["s3_adversarial", "Adversarial", "Hunt against the rules"],
  ["s4_deletions", "Deletions", "Account for what the change removed"],
  ["s5_verification", "Verification", "Re-check every candidate in a fresh session"],
  [
    "s5b_second_verification",
    "Second verifier",
    "Prove each verified finding again on the other strong family",
  ],
  ["s6_audit", "Audit", "Refuse to finish while anything is undispositioned"],
] as const;

/** Stages that run as app code, so they never write a stage_executions row. */
const DETERMINISTIC_STAGES = new Set(["s0_prepare", "s6_audit"]);

const STAGE_LABELS = new Map<string, string>(STAGES.map(([stage, label]) => [stage, label]));

/**
 * A stage as a person would say it.
 *
 * The feed printed the internal id, so a five-minute wait was narrated in
 * the pipeline's private language while the same page already had the human
 * label two panels away.
 */
function stageLabel(stage: string): string {
  return STAGE_LABELS.get(stage) ?? stage.replace(/^s\d+_/, "").replace(/_/g, " ");
}

/**
 * What the activity feed is made of.
 *
 * Three different kinds of thing used to be one string array told apart by
 * leading spaces: a stage changing state, the engine reaching for a tool, and
 * a durable note about the run. They read as one undifferentiated wall, which
 * is exactly what a person watching a long run cannot use.
 */
type LiveEntry =
  | { kind: "stage"; stage: string; phase: string; batch?: { number: number; count: number } }
  | { kind: "engine"; detail: string }
  | { kind: "note"; message: string };

interface Snapshot {
  review: {
    id: string;
    status: string;
    currentStage: string | null;
    fromBranch: string;
    intoBranch: string;
    fromCommit: string;
    model: string;
    effort: string;
    intent: string | null;
    engineMode: string;
    /** The model that proves each finding again (WP-E); null before it first ran. */
    verifierModel?: string | null;
    pausedReason: string | null;
    pausedResetsAt: number | null;
    mergedDetectedAt: string | null;
    usageInputTokens: number;
    usageOutputTokens: number;
    usageCacheReadTokens: number;
    usageCacheCreationTokens: number;
    costEquivalentUsd: number;
    startedAt: string | null;
    completedAt: string | null;
  };
  stages: {
    stage: string;
    status: string;
    attempt: number;
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    costEquivalentUsd: number;
    errorClass: string | null;
    errorText: string | null;
    logPath: string | null;
    startedAt: string;
    endedAt: string | null;
  }[];
  coverage: {
    totalFiles: number;
    totalHunks: number;
    pendingHunks: number;
    totalSweepHits: number;
    pendingSweepHits: number;
    pendingFiles: number;
    unresolvedCandidates: number;
    refutedOnlyHunks: number;
    refutedOnlySweepHits: number;
  };
  notes: { kind: string; message: string; at: string }[];
  findings: Finding[];
  /** Null only if the project was deleted out from under the review. */
  project: { id: string; name: string } | null;
  /** Median milliseconds per stage for this model, measured on this machine. */
  stageMedians: Record<string, number>;
  running: boolean;
  queued: boolean;
}

interface ReportFinding {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: string;
  ruleCode: string | null;
  issue: string;
  comment: string;
  mechanism: string;
  quotedCode: string;
  dismissReason?: string | null;
}

interface ReportData {
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  fromCommit: string;
  mergeBaseCommit: string;
  intent?: string | null;
  confirmed: ReportFinding[];
  dismissed: ReportFinding[];
  leftOutUnproven: ReportFinding[];
  coverage: {
    totalFiles: number;
    totalHunks: number;
    totalSweepHits: number;
    refutedOnlyHunks: number;
    refutedOnlySweepHits: number;
  };
  chainFilesRead: number;
  rulesetName: string;
  rulesetVersion: number;
  model: string;
  effort: string;
  profile: string;
  usage: { costEquivalentUsd: number };
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * The CLI reports a limit reset as unix seconds. Shown in the reader's own
 * timezone, because the only question being asked is when to come back.
 */
function formatResetTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * S0 and S6 write no row, so their state is derived from evidence instead.
 *
 * S0 is done once any stage attempt exists at all, even a failed one, because
 * nothing can be attempted before the worktree and the bundle exist; and once
 * the status is one only reachable on the far side of preparation. S6 is done
 * when the audit's own condition holds: verification finished and the ledger
 * has nothing outstanding. Reading the status alone got both wrong: a first
 * attempt that failed left Prepare grey, and cancelling a review after its
 * findings were on the table left Audit grey.
 */
function deterministicDone(stage: string, snapshot: Snapshot, done: ReadonlySet<string>): boolean {
  if (stage === "s0_prepare") {
    return (
      snapshot.stages.length > 0 ||
      ["verifying", "awaiting_confirmation", "complete"].includes(snapshot.review.status)
    );
  }
  // Not asked when the first verifier proved nothing; a review that reached a
  // person has passed it either way (WP-E).
  if (stage === "s5b_second_verification") {
    return ["awaiting_confirmation", "complete"].includes(snapshot.review.status);
  }
  if (stage === "s6_audit") {
    if (["awaiting_confirmation", "complete"].includes(snapshot.review.status)) return true;
    const { coverage } = snapshot;
    const outstanding =
      coverage.pendingFiles +
      coverage.pendingHunks +
      coverage.pendingSweepHits +
      coverage.unresolvedCandidates;
    return coverage.totalFiles > 0 && outstanding === 0 && done.has("s5_verification");
  }
  return false;
}

/**
 * The one stage actually executing, so exactly one dot pulses.
 *
 * `currentStage` is stamped on every stage lifecycle, live or replayed, so it
 * names the AI stage in flight; before the first lifecycle the run is
 * preparing, and once verification has answered but the review has not yet
 * reached confirmation, the audit is what is running.
 */
function executingStage(snapshot: Snapshot, done: ReadonlySet<string>): string | null {
  if (!snapshot.running) return null;
  const stage = snapshot.review.currentStage ?? "s0_prepare";
  // After S5 the second verifier runs, or, when S5 proved nothing, the
  // audit: the stage is stamped only when it runs.
  if (stage === "s5_verification" && done.has("s5_verification")) return "s6_audit";
  if (stage === "s5b_second_verification" && done.has("s5b_second_verification")) {
    return "s6_audit";
  }
  return stage;
}

/**
 * How long a run has been going, in words that stay readable past an hour.
 *
 * A review takes minutes, so seconds alone stop meaning anything quickly and
 * a bare millisecond count means nothing at any point.
 */
function elapsedBetween(fromMs: number, toMs: number): string {
  const seconds = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function elapsedSince(startedAt: string, now: number): string {
  return elapsedBetween(new Date(startedAt).getTime(), now);
}

/** A finished run's wall clock, from the two columns that always held it. */
function totalRunTime(startedAt: string, completedAt: string): string {
  return elapsedBetween(new Date(startedAt).getTime(), new Date(completedAt).getTime());
}

function formatDuration(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * What the review still owes an account of.
 *
 * This is the number that tells "nothing is wrong" apart from "nothing was
 * looked at", which is the distinction the whole app exists to make.
 */
function CoveragePanel({
  coverage,
  running,
  /** False when the caller already states it above the fold, so it is said once. */
  withSentence = true,
}: {
  coverage: Snapshot["coverage"];
  running: boolean;
  withSentence?: boolean;
}) {
  if (coverage.totalFiles === 0) {
    return running ? (
      <Card className="mb-6 p-4">
        <h2 className="mb-1 text-heading font-medium">Coverage</h2>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Counted once the change set has been read.
        </p>
      </Card>
    ) : null;
  }

  const rows = [
    ["Files", coverage.totalFiles, coverage.pendingFiles],
    ["Hunks", coverage.totalHunks, coverage.pendingHunks],
    ["Sweep hits", coverage.totalSweepHits, coverage.pendingSweepHits],
  ] as const;
  const outstanding = coverage.pendingFiles + coverage.pendingHunks + coverage.pendingSweepHits;

  return (
    <Card className="mb-6 p-4">
      <h2 className="mb-3 text-heading font-medium">Coverage</h2>
      <ul className="grid gap-2">
        {rows.map(([label, total, pending]) => (
          <li key={label} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-[var(--color-ink-muted)]">{label}</span>
            <span className="tabular-nums">
              {total - pending} of {total} accounted for
            </span>
          </li>
        ))}
      </ul>
      {withSentence ? (
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
          {outstanding === 0
            ? "Everything the change touched ended with a finding or an explicit clear."
            : `${outstanding} still outstanding. The review cannot finish while anything is.`}
        </p>
      ) : null}
      {withSentence && refutedOnlySentence(coverage) ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {refutedOnlySentence(coverage)}
        </p>
      ) : null}
      {coverage.unresolvedCandidates > 0 ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {coverage.unresolvedCandidates} candidate finding(s) awaiting verification.
        </p>
      ) : null}
    </Card>
  );
}

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<LiveEntry[]>([]);
  // Read by a stream reopening after a wait, when this render's snapshot is
  // stale: whether there is still a run to follow, and how many tries since
  // the last stream that opened.
  const runLive = useRef<boolean | null>(null);
  // The last reading of the review answered 404: it does not exist.
  const missing = useRef(false);
  const reconnects = useRef(0);
  const [streaming, setStreaming] = useState(true);
  const [loadError, setLoadError] = useState("");
  // The review does not exist: the screen offers the way back, not a Try
  // again that could never work (D-138).
  const [loadMissing, setLoadMissing] = useState(false);
  const lastReadError = useRef("");
  // Which request of how many is in flight, for the stage that divides its
  // work. Cleared when a stage without batches starts, so it never describes
  // the stage before it.
  const [batch, setBatch] = useState<{ number: number; count: number } | null>(null);
  // The scan takes the screen while it runs; minimizing steps back to the
  // ordinary page without touching the run. What is stored is which run was
  // minimized, not a flag, so the next run (a new startedAt) opens on the
  // theater again without an effect having to reset anything.
  const [minimizedRun, setMinimizedRun] = useState<string | null>(null);
  // Hidden, the theater took the focus with it and left it on the page, so
  // Tab began again from the top (review of the D-147 fixes). It goes to
  // Scan view, which brings the theater back.
  const scanViewRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (minimizedRun !== null) scanViewRef.current?.focus();
  }, [minimizedRun]);
  // Ticks only while something is running, so a finished review is not
  // re-rendered once a second forever.
  const [now, setNow] = useState(() => Date.now());
  // Bumped after a resume, so a fresh stream is opened for the fresh run.
  // The old one is gone: the server closes a stream when its run ends.
  const [watchEpoch, setWatchEpoch] = useState(0);
  const [report, setReport] = useState<string | null>(null);
  const [exported, setExported] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** The status a Cancel was asked under, or null when none is being asked. */
  const [confirmingCancelFor, setConfirmingCancelFor] = useState<string | null>(null);
  const [cancellingHere, setCancellingHere] = useState(false);
  const [actionError, setActionError] = useState("");
  // Shown once the server refuses a Start or Resume for a sign-in billing per
  // token this page had not said, and sent with the next (review of D-161).
  const [billing, setBilling] = useState<Billing | null>(null);
  // Kept with the refusal it came with, so another action's error never
  // shows it.
  const [refusedSignIn, setRefusedSignIn] = useState<{ error: string; signIn: SignIn } | null>(
    null,
  );
  // A draft is a review the new-review screen made and then could not start.
  // Nothing is frozen onto it yet, so starting it takes a ruleset; its screen
  // used to offer only Resume, which a draft is not (5.11, U7).
  const [draftRulesets, setDraftRulesets] = useState<{ id: string; name: string }[] | null>(null);
  const [draftRuleset, setDraftRuleset] = useState("");
  const [draftReadProblem, setDraftReadProblem] = useState("");
  const [draftReadAttempt, setDraftReadAttempt] = useState(0);
  // Shown once, when completing left the checkout behind; after a reload it
  // is in the run notes, folded under Run detail.
  const [checkoutLeft, setCheckoutLeft] = useState("");

  async function fetchSnapshot(): Promise<Snapshot | null> {
    // A dropped request reads as no picture, as a refusal does. Thrown, it
    // escaped the theater's cancel, which then said nothing at all when the
    // server had gone away (review of 5.1 to 5.4).
    const sent = await send<Snapshot>(`/api/reviews/${id}`, {}, "This review could not be read");
    // No such review is no run to follow: its stream is not opened again and
    // the poll stops, where both went on for as long as the tab stayed open
    // (D-137).
    missing.current = !sent.ok && sent.status === 404;
    if (missing.current) runLive.current = false;
    if (!sent.ok) {
      lastReadError.current = sent.error;
      return null;
    }
    return sent.body;
  }

  /**
   * Asks the server to cancel, and says why when it did not: a dropped
   * request, a refusal, or a review with nothing left to cancel. The answer
   * used to be ignored, so a cancel that failed looked like one that worked
   * (5.1). Empty when the cancel took.
   */
  async function cancelReview(): Promise<string> {
    const response = await fetch(`/api/reviews/${id}/cancel`, { method: "POST" }).catch(
      (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    );
    if (response instanceof Error) return `The review could not be cancelled: ${response.message}`;
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      cancelled?: boolean;
    };
    if (!response.ok) return body.error ?? "The review could not be cancelled.";
    if (body.cancelled === false) return "Nothing was cancelled: the review had already ended.";
    return "";
  }

  async function reload() {
    const fresh = await fetchSnapshot();
    if (fresh) setSnapshot(fresh);
  }

  /** A new run needs a new stream: the old one was closed by the run that ended. */
  function watchAgain() {
    // Unknown again, which counts as live: a run just started or resumed was
    // still "not live" from before until a reading landed, and a stream that
    // dropped in that moment was never opened again (D-139).
    runLive.current = null;
    setStreaming(true);
    setWatchEpoch((epoch) => epoch + 1);
  }

  /**
   * Starts a draft with the ruleset chosen for it, or resumes a stopped run,
   * which sends none: it already carries the ruleset it was frozen with. A
   * refusal, such as a review another tab already cancelled, is said, and the
   * page shows where the review really is.
   */
  async function start(rulesetId?: string) {
    setActionError("");
    const sent = await send(
      `/api/reviews/${id}/start`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(rulesetId === undefined ? {} : { rulesetId }),
          ...(billing === null ? {} : { billingShown: billing.state }),
        }),
      },
      `The review could not be ${rulesetId === undefined ? "resumed" : "started"}`,
    );
    if (!sent.ok) {
      if (sent.body.code === "BillingNotShown") {
        setBilling(
          billingOf(
            sent.body.cli as { state?: unknown } | undefined,
            sent.body.signIn as SignIn | undefined,
          ),
        );
      }
      if (sent.body.code === "CliNotReady") {
        // The sign-in a notice spoke of is gone (review of the D-162 fixes).
        setBilling(null);
        if (sent.body.signIn !== undefined) {
          setRefusedSignIn({ error: sent.error, signIn: sent.body.signIn as SignIn });
        }
      }
      setActionError(sent.error);
      await reload();
      return;
    }
    // Said for this start; the next is asked afresh.
    setBilling(null);
    watchAgain();
  }

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    // The server ends the stream when the run ends, which the browser can
    // only see as an error. This flag is what tells that apart from a
    // genuinely dropped connection, which is the one case worth polling over.
    let runEnded = false;

    void (async () => {
      const fresh = await fetchSnapshot();
      if (cancelled) return;
      // A review that cannot be read is not a review that is slow to read.
      if (fresh) setSnapshot(fresh);
      else {
        // The server's words, which a fixed sentence replaced (D-138).
        setLoadError(lastReadError.current);
        setLoadMissing(missing.current);
      }
    })();

    const source = new EventSource(`/api/reviews/${id}/events`);

    source.onopen = () => {
      reconnects.current = 0;
      setStreaming(true);
    };

    source.addEventListener("update", (event) => {
      const parsed = JSON.parse((event as MessageEvent<string>).data) as {
        kind: string;
        stage?: string;
        phase?: string;
        status?: string;
        note?: { message: string };
        detail?: string;
        batchNumber?: number;
        batchCount?: number;
      };

      // Kept as a bounded tail: a long run emits thousands of engine lines,
      // and the page only ever shows the most recent of them. The archive is
      // the event log, not component state.
      const push = (entry: LiveEntry) => setLive((all) => [...all, entry].slice(-200));
      if (parsed.kind === "stage" && parsed.stage && parsed.phase) {
        push({
          kind: "stage",
          stage: parsed.stage,
          phase: parsed.phase,
          ...(parsed.batchNumber !== undefined && parsed.batchCount !== undefined
            ? { batch: { number: parsed.batchNumber, count: parsed.batchCount } }
            : {}),
        });
        setBatch(
          parsed.batchNumber !== undefined && parsed.batchCount !== undefined
            ? { number: parsed.batchNumber, count: parsed.batchCount }
            : null,
        );
      }
      if (parsed.kind === "engine" && parsed.detail) {
        push({ kind: "engine", detail: parsed.detail });
      }
      if (parsed.kind === "note" && parsed.note?.message) {
        push({ kind: "note", message: parsed.note.message });
      }

      if (parsed.kind === "done") runEnded = true;

      // Durable facts are written before they are announced, so a read here
      // always finds the row already changed. A stage's start too: the
      // status does not change between Risk and Verification, and read on
      // status alone the page named Risk while the later stages ran
      // (proof-and-steps plan, WP-A).
      if (parsed.kind === "status" || parsed.kind === "done" || parsed.kind === "stage") {
        void reload();
      }
    });

    // The server let this stream go because the page fell behind, and says so
    // last. A new stream opens with the whole picture; polling would lose the
    // live stage for the rest of the run.
    source.addEventListener("reconnect", () => {
      source.close();
      watchAgain();
    });

    // D-15's fallback. Polls every two seconds only while a live run has no
    // stream to speak for it, and stops itself once nothing is running or
    // waiting, because from then on the page only changes when the user acts
    // on it. Without the stop, every finished review kept polling forever.
    source.onerror = () => {
      source.close();
      // A run that ended closes its stream on purpose: no notice and no
      // reopening. Marked down first, the theater said "being opened again" at
      // the end of every run (D-137). The poll below still runs, and stops at
      // its first reading with nothing running: when the reading after the
      // end failed, nothing else would correct the page (D-138).
      if (!runEnded) {
        setStreaming(false);
        // Opened again too, after a wait that doubles from one second to thirty,
        // and only while the run is still live by then: the poll keeps the
        // status moving, but the feed and the request line are fed by the
        // stream alone, and stopped with it (5.12, U8).
        const wait = Math.min(1000 * 2 ** reconnects.current, 30_000);
        reconnects.current += 1;
        reopen = setTimeout(() => {
          // Unknown, before the first snapshot arrives, counts as live.
          if (!cancelled && runLive.current !== false) setWatchEpoch((epoch) => epoch + 1);
        }, wait);
      }
      if (poll !== undefined) return;
      poll = setInterval(() => {
        if (cancelled) return;
        void (async () => {
          const fresh = await fetchSnapshot();
          if (cancelled) return;
          if (!fresh) {
            // A review that does not exist, or one a reading showed not
            // live: a run just started or resumed is unknown, so a dropped
            // reading keeps the poll going for it (D-138, D-139).
            if ((missing.current || runLive.current === false) && poll !== undefined) {
              clearInterval(poll);
              poll = undefined;
            }
            return;
          }
          setSnapshot(fresh);
          if (!fresh.running && !fresh.queued && poll !== undefined) {
            clearInterval(poll);
            poll = undefined;
          }
        })();
      }, 2000);
    };

    return () => {
      cancelled = true;
      source.close();
      if (poll !== undefined) clearInterval(poll);
      clearTimeout(reopen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, watchEpoch]);

  useEffect(() => {
    if (!snapshot?.running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [snapshot?.running]);

  useEffect(() => {
    if (snapshot) runLive.current = snapshot.running || snapshot.queued;
  }, [snapshot]);

  // A draft waiting in the queue is no draft to start: its screen offered
  // Start with a ruleset the run would not use,
  // and starting it answered 200 and dropped the choice (D-137).
  const isDraft = snapshot?.review.status === "draft" && !snapshot.queued && !snapshot.running;
  useEffect(() => {
    if (!isDraft) return;
    let cancelled = false;
    void (async () => {
      const sent = await send<{ rulesets: { id: string; name: string }[] }>(
        "/api/rulesets",
        {},
        "The rulesets could not be read",
      );
      if (cancelled) return;
      setDraftReadProblem(sent.ok ? "" : sent.error);
      if (!sent.ok) return;
      setDraftRulesets(sent.body.rulesets);
      setDraftRuleset((current) => current || (sent.body.rulesets[0]?.id ?? ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [isDraft, draftReadAttempt]);

  // Asked as the screen opens while the review can still be started or
  // resumed, for a managed policy every review runs under (D-174 item 3).
  // An interactive review starts no CLI here, so the server asks nothing of
  // it, but the commands it prints run this one, so its billing is said here
  // too (review of the D-163 fixes); a headless one's the server refuses
  // until a page has said it.
  const toStart =
    snapshot !== null &&
    !snapshot.running &&
    !snapshot.queued &&
    (snapshot.review.status === "draft" ||
      isResumableReview(snapshot.review.status as ReviewStatus));
  const interactiveToStart = toStart && snapshot.review.engineMode === "interactive";
  // The last answer whole, a failure included, so an older one never stands
  // for it (review of the D-164 fixes); dropped when the review stops being
  // startable, so coming back to it waits for a new one, and Start and
  // Resume wait with it (review of the D-165 fixes).
  const [startCheck, setStartCheck] = useState<{
    billing: Billing | null;
    managedPolicy: ManagedPolicy | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!toStart) return;
    let cancelled = false;
    void (async () => {
      // As its commands see it, reading no settings (D-174).
      const sent = await send<{
        cli: { state: string; authMethod?: string };
        signIn?: SignIn;
        managedPolicy?: ManagedPolicy;
      }>("/api/auth", {}, "The CLI could not be checked");
      if (cancelled) return;
      setStartCheck(
        sent.ok
          ? {
              billing: billingOf(sent.body.cli, sent.body.signIn),
              managedPolicy: managedPolicyOf(sent.body.managedPolicy),
              error: "",
            }
          : { billing: null, managedPolicy: null, error: sent.error },
      );
    })();
    return () => {
      cancelled = true;
      setStartCheck(null);
    };
  }, [toStart]);
  const awaitingCheck = interactiveToStart && startCheck === null;

  if (!snapshot) {
    return (
      <PageLoading
        title="Review"
        {...(loadError === "" ? {} : { error: loadError })}
        {...(loadMissing
          ? { back: { href: "/reviews", label: "All reviews" } }
          : {
              onRetry: () => {
                setLoadError("");
                watchAgain();
              },
            })}
      />
    );
  }

  const { review, findings } = snapshot;

  const scanMinimized = minimizedRun !== null && minimizedRun === review.startedAt;
  if (snapshot.running && !scanMinimized) {
    return (
      <ScanTheater
        snapshot={snapshot}
        live={live}
        now={now}
        batch={batch}
        streaming={streaming}
        onMinimize={() => setMinimizedRun(review.startedAt)}
        onCancel={async () => {
          const problem = await cancelReview();
          await reload();
          return problem;
        }}
      />
    );
  }

  const queueRows = findings.filter((finding) => finding.status !== "killed");
  const undecidedRows = queueRows.filter((finding) =>
    ["verified", "open_question"].includes(finding.status),
  ).length;
  const decidedRows = queueRows.length - undecidedRows;
  const done = new Set(
    snapshot.stages.filter((row) => row.status === "succeeded").map((r) => r.stage),
  );
  const executing = executingStage(snapshot, done);
  const reported = findings.filter((finding) => finding.status !== "killed");

  /**
   * The findings as a list you can only read.
   *
   * Used while a review is still running, and after it is complete. Between
   * those two the confirmation queue takes over, because that is the one
   * moment the findings are a thing to act on rather than a thing to look at.
   */
  const renderReadOnly = () =>
    reported.length === 0 ? (
      <Empty title={snapshot.running ? "Nothing reported yet" : "No findings"}>
        {snapshot.running
          ? "Findings appear once the adversarial pass has run and each one has been checked against the file."
          : "Every hunk was accounted for and nothing survived verification."}
      </Empty>
    ) : (
      <ul className="grid gap-3">
        {reported.map((finding) => (
          <li key={finding.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
                {finding.status === "confirmed" ? <Badge tone="good">confirmed</Badge> : null}
                {finding.status === "dismissed" ? (
                  <Badge tone="neutral">
                    {finding.dismissedFrom === "open_question" ? "left out" : "dismissed"}
                  </Badge>
                ) : null}
                {finding.status === "open_question" ? (
                  <Badge tone="question">open question</Badge>
                ) : null}
                <Mono className="text-xs text-[var(--color-ink-muted)]">
                  {finding.filePath}:{finding.lineStart}
                </Mono>
              </div>
              <p className="mt-2 font-medium">{finding.issue}</p>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {finding.editedComment ?? finding.comment}
              </p>
              {finding.dismissReason ? (
                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                  Dismissed: {finding.dismissReason}
                </p>
              ) : null}
              {finding.quotedCode ? (
                <pre className="mt-3 overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs">
                  <code className="font-[family-name:var(--font-mono)]">{finding.quotedCode}</code>
                </pre>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-col gap-1">
            {/* The way back up. This screen is the deepest in the app and
                named neither its project nor a route to one, so the only
                exit was the top bar. */}
            {snapshot.project ? (
              <a
                href={`/projects/${snapshot.project.id}`}
                className="w-fit text-xs font-normal text-[var(--color-ink-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                {snapshot.project.name}
              </a>
            ) : null}
            {/* Wraps between the names, not inside one: kept on one row, a
                phone broke the branch mid-word with "into main" beside it. */}
            <span className="flex flex-wrap items-baseline gap-x-2">
              <Mono className="min-w-0 break-all">{review.fromBranch}</Mono>
              <span className="text-[var(--color-ink-faint)]">into</span>
              <Mono className="min-w-0 break-all">{review.intoBranch}</Mono>
            </span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(review.status)}>
              {snapshot.queued ? "queued" : statusLabel(review.status)}
            </Badge>
            {review.mergedDetectedAt ? <Badge tone="good">merged</Badge> : null}
            <Sha value={review.fromCommit} />
            <span>{review.model}</span>
            <span>effort {review.effort}</span>
            {/* Where the run is and how long it has been there. A five-minute
                wait used to offer one pulsing dot and no way to tell a slow
                stage from a stuck one. */}
            {snapshot.running && executing ? (
              <span className="text-[var(--color-ink)]">
                {stageLabel(executing)}, stage {STAGES.findIndex(([s]) => s === executing) + 1} of{" "}
                {STAGES.length}
              </span>
            ) : null}
            {review.startedAt && snapshot.running ? (
              <span className="tabular-nums">{elapsedSince(review.startedAt, now)} elapsed</span>
            ) : null}
            {review.startedAt && review.completedAt ? (
              <span className="tabular-nums">
                took {totalRunTime(review.startedAt, review.completedAt)}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            {snapshot.running ? (
              <Button ref={scanViewRef} variant="quiet" onClick={() => setMinimizedRun(null)}>
                Scan view
              </Button>
            ) : null}
            {review.status === "awaiting_confirmation" && queueRows.length > 0 ? (
              <span className="mr-2 flex items-center gap-2 text-dense">
                <span className="text-[var(--color-ink-muted)] tabular-nums">
                  {decidedRows} of {queueRows.length} decided
                </span>
                <span
                  role="progressbar"
                  aria-valuenow={decidedRows}
                  aria-valuemin={0}
                  aria-valuemax={queueRows.length}
                  aria-label="Findings decided"
                  className="gauge-track h-1.5 w-32 overflow-hidden rounded-sm"
                >
                  <span
                    className="block h-full bg-[var(--color-accent)] transition-[width] duration-[var(--motion-considered)]"
                    style={{
                      width: `${queueRows.length === 0 ? 0 : (decidedRows / queueRows.length) * 100}%`,
                    }}
                  />
                </span>
              </span>
            ) : null}
            {isDraft && draftReadProblem ? (
              <>
                <span className="text-sm text-[var(--color-critical)]">{draftReadProblem}</span>
                <Button
                  onClick={() => {
                    // Cleared first, so a retry in flight reads as one: the
                    // old message stayed until the answer came (D-138).
                    setDraftReadProblem("");
                    setDraftRulesets(null);
                    setDraftReadAttempt((attempt) => attempt + 1);
                  }}
                >
                  Try again
                </Button>
              </>
            ) : isDraft && draftRulesets !== null && draftRulesets.length === 0 ? (
              <span className="text-sm text-[var(--color-ink-muted)]">
                No ruleset to start it with yet:{" "}
                <Link href="/rulesets" className="text-[var(--color-accent)] hover:underline">
                  import one
                </Link>
                .
              </span>
            ) : isDraft && draftRulesets === null ? (
              <span className="text-sm text-[var(--color-ink-muted)]">Reading the rulesets...</span>
            ) : isDraft ? (
              <>
                <Select
                  aria-label="Ruleset to start with"
                  value={draftRuleset}
                  onChange={(event) => setDraftRuleset(event.target.value)}
                >
                  {(draftRulesets ?? []).map((ruleset) => (
                    <option key={ruleset.id} value={ruleset.id}>
                      {ruleset.name}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="primary"
                  disabled={draftRuleset === "" || awaitingCheck}
                  onClick={() => void start(draftRuleset)}
                >
                  Start review
                </Button>
              </>
            ) : null}
            {isResumableReview(review.status as ReviewStatus) ? (
              <Button variant="primary" disabled={awaitingCheck} onClick={() => void start()}>
                Resume
              </Button>
            ) : null}

            {/* The machine, not a status list: a list here would be the fourth
                place to forget one, and it was (paused and interrupted reviews
                had no way to be cancelled from the screen). */}
            {snapshot.queued || canTransitionReview(review.status as ReviewStatus, "cancelled") ? (
              // Asks first: cancelled is terminal, and one click used to end
              // a review (5.1). The question belongs to the status it was
              // asked under: left armed, it outlived a run finishing, and one
              // click then cancelled a paid-for review (review of 5.1 to 5.4).
              confirmingCancelFor === review.status ? (
                <>
                  <Button
                    variant="primary"
                    disabled={cancellingHere}
                    onClick={async () => {
                      setCancellingHere(true);
                      try {
                        setActionError(await cancelReview());
                        await reload();
                      } finally {
                        setCancellingHere(false);
                        setConfirmingCancelFor(null);
                      }
                    }}
                  >
                    {cancellingHere ? "Cancelling..." : "Yes, cancel"}
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={cancellingHere}
                    onClick={() => setConfirmingCancelFor(null)}
                  >
                    No, keep it
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => {
                    setConfirmingDelete(false);
                    setConfirmingCancelFor(review.status);
                  }}
                >
                  Cancel
                </Button>
              )
            ) : null}

            {!snapshot.running && !snapshot.queued ? (
              confirmingDelete ? (
                <>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const sent = await send(
                        `/api/reviews/${id}`,
                        { method: "DELETE" },
                        "The review could not be deleted",
                      );
                      if (sent.ok) router.push("/reviews");
                      else setActionError(sent.error);
                    }}
                  >
                    Yes, delete
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => {
                    setConfirmingCancelFor(null);
                    setConfirmingDelete(true);
                  }}
                >
                  Delete
                </Button>
              )
            ) : null}
          </>
        }
      />
      <PageBody>
        {actionError ? <Problem>{actionError}</Problem> : null}
        {actionError !== "" && refusedSignIn?.error === actionError ? (
          <SignInLine signIn={refusedSignIn.signIn} />
        ) : null}
        {billing === null ? null : <BillingNotice billing={billing} />}
        {interactiveToStart && startCheck?.error ? (
          <Problem>
            {asSentence(startCheck.error)} Whether the commands this review prints would cost API
            usage is not known.
          </Problem>
        ) : null}
        {/* Said for a headless review too, which the check asks for a policy
            alone: taken as none, a failure said nothing (review of D-174's
            changes). */}
        {toStart && !interactiveToStart && startCheck?.error ? (
          <Problem>
            {asSentence(startCheck.error)} Whether this review would run under a managed Claude Code
            policy is not known.
          </Problem>
        ) : null}
        {interactiveToStart && startCheck?.billing ? (
          <BillingNotice billing={startCheck.billing} what="interactive" />
        ) : null}
        {interactiveToStart ? <TerminalEnvironmentNote /> : null}
        {toStart && startCheck?.managedPolicy ? (
          <ManagedPolicyNotice policy={startCheck.managedPolicy} />
        ) : null}
        {review.pausedReason ? (
          <Problem>
            {review.pausedReason}
            {review.pausedResetsAt === null ? null : (
              <>
                {" "}
                The limit clears at {formatResetTime(review.pausedResetsAt)}; resuming before then
                will pause again.
              </>
            )}
          </Problem>
        ) : null}
        {review.mergedDetectedAt ? (
          <p className="mb-4 text-sm text-[var(--color-ink-muted)]">
            This branch has since merged into {review.intoBranch}. The review is kept until you
            delete it.
          </p>
        ) : null}
        {snapshot.queued ? (
          <p className="mb-4 text-sm text-[var(--color-ink-muted)]">
            Waiting for the running review to finish. One runs at a time, because two would race for
            the same usage limit.
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            {/*
             * The screen composes itself around what the person is here to do,
             * and that changes completely with the review's state while the
             * layout used not to change at all. Running: the run is the
             * subject. Waiting on a decision: the queue is the subject and the
             * finished run folds behind a summary. Complete: the report is.
             */}
            {review.status === "awaiting_confirmation" && reported.length > 0 ? (
              <>
                <ConfirmationQueue
                  reviewId={id}
                  model={review.model}
                  verifierModel={review.verifierModel ?? null}
                  findings={findings}
                  onChanged={() => void reload()}
                  onCheckoutLeft={setCheckoutLeft}
                />
                <div className="mt-6">
                  <RunDetail snapshot={snapshot} done={done} executing={executing} folded />
                </div>
              </>
            ) : review.status === "complete" ? (
              <>
                {checkoutLeft ? (
                  <p className="mb-4 text-sm text-[var(--color-ink-muted)]">{checkoutLeft}</p>
                ) : null}
                <ReportPanel
                  reviewId={id}
                  report={report}
                  exported={exported}
                  onLoaded={setReport}
                  onExported={setExported}
                />
                <RunDetail snapshot={snapshot} done={done} executing={executing} folded />
              </>
            ) : (
              <>
                <RunDetail snapshot={snapshot} done={done} executing={executing} folded={false} />
                <h2 className="mb-3 text-heading font-semibold">
                  Findings{reported.length > 0 ? ` (${reported.length})` : ""}
                </h2>
                {renderReadOnly()}
              </>
            )}
          </div>

          <aside className="grid min-w-0 gap-4 self-start">
            {/* The two figures a person actually checks, at the weight the
                mock gives them; the token breakdown stays, beneath, at the
                weight it deserves. */}
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="$ cost" value={`$${review.costEquivalentUsd.toFixed(2)}`} />
              <StatTile
                label="Duration"
                value={
                  snapshot.running && review.startedAt
                    ? elapsedSince(review.startedAt, now)
                    : review.startedAt && review.completedAt
                      ? totalRunTime(review.startedAt, review.completedAt)
                      : "-"
                }
              />
            </div>
            <Card className="p-4">
              <p className="mb-2 text-aside tracking-wide text-[var(--color-ink-muted)] uppercase">
                Tokens
              </p>
              <dl className="grid gap-1.5 text-dense">
                <Stat label="Fresh input" value={review.usageInputTokens.toLocaleString("en-US")} />
                {/* Written into the cache by this review, which is what makes
                    the cached reads below cost a fraction of fresh input. It
                    is charged, so leaving it out understated what a run
                    spent. */}
                <Stat
                  label="Cache write"
                  value={review.usageCacheCreationTokens.toLocaleString("en-US")}
                />
                <Stat
                  label="Cached read"
                  value={review.usageCacheReadTokens.toLocaleString("en-US")}
                />
                <Stat label="Output" value={review.usageOutputTokens.toLocaleString("en-US")} />
              </dl>
            </Card>

            {review.intent ? (
              <Card className="p-4">
                <p className="mb-2 text-aside tracking-wide text-[var(--color-ink-muted)] uppercase">
                  What it was meant to do
                </p>
                <p className="text-sm text-[var(--color-ink-muted)]">{review.intent}</p>
              </Card>
            ) : null}

            {(snapshot.running || snapshot.queued) && !streaming ? (
              <Card className="mb-6 p-4">
                <p className="text-xs text-[var(--color-ink-muted)]">
                  The live stream dropped, so this checks every two seconds while the stream is
                  opened again. The run itself is unaffected; only this page lost its connection to
                  it.
                </p>
              </Card>
            ) : null}

            {live.length > 0 ? (
              <Card className="p-4">
                <p className="mb-2 text-aside tracking-wide text-[var(--color-ink-muted)] uppercase">
                  Activity
                </p>
                <ul
                  tabIndex={0}
                  role="group"
                  aria-label="Activity log"
                  className="max-h-64 overflow-auto text-aside text-[var(--color-ink-muted)]"
                >
                  {live.slice(-40).map((entry, index) => (
                    // Engine output is arbitrary text, including whole JSON
                    // answers on one line. Without a wrap rule it widened its
                    // container until the page itself scrolled sideways, which
                    // 04 forbids outright.
                    <li key={index} className="leading-5 break-words">
                      {entry.kind === "stage" ? (
                        <span className="text-[var(--color-ink)]">
                          {stageLabel(entry.stage)}{" "}
                          <span className="text-[var(--color-ink-faint)]">
                            {entry.batch
                              ? `request ${entry.batch.number} of ${entry.batch.count}`
                              : entry.phase}
                          </span>
                        </span>
                      ) : entry.kind === "note" ? (
                        <span className="block border-l-2 border-[var(--color-border-strong)] py-0.5 pl-2">
                          {entry.message}
                        </span>
                      ) : (
                        // The engine reaching for a tool. Indented and quiet:
                        // it is the texture of work happening, not a fact to
                        // read line by line.
                        <span className="block overflow-hidden pl-3 font-[family-name:var(--font-mono)] break-all text-[var(--color-ink-faint)]">
                          {entry.detail}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </aside>
        </div>
      </PageBody>
    </>
  );
}

/**
 * The report, once a person has decided everything.
 *
 * Fetched on demand rather than with the page: it is the last thing anyone
 * looks at, and a review that is still running has no report to speak of.
 */
function ReportPanel({
  reviewId,
  report,
  exported,
  onLoaded,
  onExported,
}: {
  reviewId: string;
  report: string | null;
  exported: string;
  onLoaded: (markdown: string) => void;
  onExported: (path: string) => void;
}) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  // Why the report could not be read, said where it would be, with Try again:
  // a dropped connection or an error page that was not JSON threw past the
  // read, and "Building the report..." stayed for good (D-137).
  const [readError, setReadError] = useState("");
  const [readAttempt, setReadAttempt] = useState(0);
  // A copy that says nothing is a copy someone presses twice to be sure.
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (report !== null) return;
    let cancelled = false;
    void (async () => {
      const sent = await send<{ markdown?: string; report?: ReportData }>(
        `/api/reviews/${reviewId}/report`,
        {},
        "The report could not be built",
      );
      if (cancelled) return;
      if (sent.ok && sent.body.markdown) {
        setReadError("");
        onLoaded(sent.body.markdown);
        if (sent.body.report) setData(sent.body.report);
      } else setReadError(sent.ok ? "The report could not be built." : sent.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewId, report, onLoaded, readAttempt]);

  return (
    <section className="mb-6">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading font-semibold">Report</h2>
        <span className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (!report) return;
              void navigator.clipboard?.writeText(report).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            disabled={!report}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const sent = await send<{ path?: string; htmlPath?: string }>(
                `/api/reviews/${reviewId}/export`,
                { method: "POST" },
                "The report could not be exported",
              );
              if (sent.ok && sent.body.path) onExported(sent.body.htmlPath ?? sent.body.path);
              else setError(sent.ok ? "The report could not be exported." : sent.error);
            }}
          >
            Export
          </Button>
        </span>
      </header>

      {error ? <Problem>{error}</Problem> : null}
      {exported ? (
        <p className="mb-2 text-xs text-[var(--color-good)]">Written to {exported}</p>
      ) : null}

      {report === null ? (
        readError ? (
          <Loading
            error={readError}
            onRetry={() => {
              setReadError("");
              setReadAttempt((attempt) => attempt + 1);
            }}
          />
        ) : (
          <p className="text-body text-[var(--color-ink-muted)]">Building the report...</p>
        )
      ) : data ? (
        <RenderedReport data={data} />
      ) : (
        // Only when the structured build is missing, which means an older
        // response shape. The document still reads; it just is not typeset.
        <Card className="max-h-[32rem] overflow-auto p-4">
          <pre
            tabIndex={0}
            role="group"
            aria-label="Report"
            className="text-aside leading-5 whitespace-pre-wrap"
          >
            <code className="font-[family-name:var(--font-mono)]">{report}</code>
          </pre>
        </Card>
      )}
    </section>
  );
}

/**
 * Everything the run itself did: its stages, its coverage, and the notes it
 * left behind.
 *
 * Folded away once the review is waiting on a person or finished, because at
 * that point it is context rather than the subject, and reaching the
 * decisions used to mean scrolling past all of it. The coverage sentence
 * stays on the surface when folded: it is the claim the product exists to
 * make, and putting "was anything skipped" behind a disclosure would be
 * answering the question by hiding it.
 */
function RunDetail({
  snapshot,
  done,
  executing,
  folded,
}: {
  snapshot: Snapshot;
  done: ReadonlySet<string>;
  executing: string | null;
  folded: boolean;
}) {
  const { coverage } = snapshot;
  const outstanding = coverage.pendingFiles + coverage.pendingHunks + coverage.pendingSweepHits;
  const refuted = snapshot.findings.filter((finding) => finding.status === "killed");
  const usualFor = (stage: string): string | null => {
    const ms = snapshot.stageMedians[stage];
    return ms === undefined ? null : elapsedBetween(0, ms);
  };

  const body = (
    <>
      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-heading font-medium">Stages</h2>
        <ol className="grid gap-1">
          {STAGES.map(([stage, label, description]) => {
            const attempts = snapshot.stages.filter((row) => row.stage === stage);
            const last = attempts[attempts.length - 1];
            // A stage aborted by the user is recorded as failed with its
            // own error class; painting it critical-red would dress a
            // decision up as a fault.
            const wasCancelled = last?.status === "failed" && last.errorClass === "cancelled";
            const failed = last?.status === "failed" && !wasCancelled;
            const succeeded =
              deterministicDone(stage, snapshot, done) || last?.status === "succeeded";
            const current = stage === executing;

            return (
              <li key={stage} className="border-t border-[var(--color-border)] py-2 first:border-0">
                <div className="flex items-baseline gap-3 text-sm">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      current
                        ? "bg-[var(--color-accent)] pulse"
                        : failed
                          ? "bg-[var(--color-critical)]"
                          : succeeded
                            ? "bg-[var(--color-good)]"
                            : "bg-[var(--color-border-strong)]"
                    }`}
                  />
                  <span className={succeeded || failed ? "" : "text-[var(--color-ink-muted)]"}>
                    {label}
                  </span>
                  {attempts.length > 1 ? (
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {attempts.length} attempts
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-muted)]">
                    {/* A stage in flight says what this machine has measured
                        it taking before, so a slow stage is distinguishable
                        from a stuck one. Nothing is shown until the same
                        stage has been timed enough times for a median to
                        mean something. */}
                    {last
                      ? formatDuration(last.startedAt, last.endedAt)
                      : current && usualFor(stage) !== null
                        ? `usually ${usualFor(stage)}`
                        : null}
                  </span>
                </div>

                {last && !DETERMINISTIC_STAGES.has(stage) ? (
                  <p className="mt-1 pl-[1.125rem] text-xs text-[var(--color-ink-muted)]">
                    {last.inputTokens.toLocaleString("en-US")} fresh,{" "}
                    {last.cacheReadTokens.toLocaleString("en-US")} cached,{" "}
                    {last.outputTokens.toLocaleString("en-US")} out, $
                    {last.costEquivalentUsd.toFixed(4)}
                  </p>
                ) : (
                  <p className="mt-1 pl-[1.125rem] text-xs text-[var(--color-ink-muted)]">
                    {description}
                  </p>
                )}

                {(failed || wasCancelled) && last ? (
                  <div className="mt-2 pl-[1.125rem] text-xs">
                    <p
                      className={
                        wasCancelled
                          ? "text-[var(--color-ink-muted)]"
                          : "text-[var(--color-critical)]"
                      }
                    >
                      {wasCancelled
                        ? "Cancelled mid-stage."
                        : `${last.errorClass}: ${last.errorText}`}
                    </p>
                    {last.logPath ? (
                      // The transcript is the evidence behind a failure,
                      // and it is on this machine. Naming the file is the
                      // difference between a diagnosable run and a shrug.
                      <Mono className="mt-1 block break-all text-[var(--color-ink-muted)]">
                        {last.logPath}
                      </Mono>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Card>

      <CoveragePanel
        coverage={snapshot.coverage}
        running={snapshot.running}
        withSentence={!folded}
      />

      {refuted.length > 0 ? (
        <Card className="mb-6 p-4">
          <h2 className="mb-1 text-heading font-medium">Refuted in verification</h2>
          {/* Every one, not only those a hunk rested on (D-97): a list
              titled refuted that left some out would be its own silence. */}
          <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
            Raised by the review, then refuted by verification or discarded by the quotation check,
            each with its reason. None of these reach the report.
          </p>
          <ul className="grid gap-3">
            {refuted.map((finding) => (
              <li key={finding.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
                  <Mono className="text-xs text-[var(--color-ink-muted)]">
                    {finding.filePath}:{finding.lineStart}
                  </Mono>
                </div>
                <p className="mt-1">{finding.issue}</p>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  {finding.verificationNote ?? "No reason was recorded."}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {snapshot.notes.length > 0 ? (
        <Card className="mb-6 p-4">
          <h2 className="mb-2 text-heading font-medium">What this run recorded</h2>
          {/* Persisted, unlike the live activity tail, so how a run
              divided its work survives a reload. */}
          <ul className="grid gap-2">
            {snapshot.notes.map((note, index) => (
              <li key={`${note.at}-${index}`} className="text-aside break-words">
                <span className="text-[var(--color-ink-muted)]">
                  {new Date(note.at).toLocaleTimeString()}
                </span>{" "}
                {note.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );

  if (!folded) return body;

  return (
    <div className="mb-6">
      {/* Above the fold, never inside it. Whether anything went unaccounted
          for is the one thing a reader must not have to open a disclosure to
          learn, so the sentence stays out here and only the detail behind it
          folds. */}
      {coverage.totalFiles > 0 ? (
        <p className="mb-2 text-sm text-[var(--color-ink-muted)]">
          {outstanding === 0
            ? "Everything the change touched ended with a finding or an explicit clear."
            : `${outstanding} still outstanding. The review cannot finish while anything is.`}
          {refutedOnlySentence(coverage) ? ` ${refutedOnlySentence(coverage)}` : null}
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm">
          <span className="font-medium">Run detail</span>
          <span className="ml-2 text-[var(--color-ink-muted)]">
            {coverage.totalFiles > 0
              ? `${coverage.totalFiles} file(s), ${coverage.totalHunks} hunk(s), stages and run notes`
              : "stages, coverage and run notes"}
          </span>
        </summary>
        <div className="mt-3">{body}</div>
      </details>
    </div>
  );
}

/**
 * The report as a document rather than a dump.
 *
 * The renderer builds a structured thing, a summary line, a completeness
 * statement, findings grouped by severity, dismissals with their reasons, and
 * the whole of it used to arrive on screen as unrendered markdown inside a
 * scrolling monospace box: the payoff of a five-minute run with less
 * hierarchy than the queue the reader had just left.
 *
 * Typeset from the same input the markdown is written from, so the page and
 * the exported document cannot say different things, and no markdown parser
 * has to be trusted to work out what a heading was.
 */
function RenderedReport({ data }: { data: ReportData }) {
  const groups = [
    { key: "confirmed", label: "Confirmed", findings: data.confirmed, reason: "" },
    {
      key: "unproven",
      label: "Left out unproven",
      findings: data.leftOutUnproven,
      reason: "Left out",
    },
    { key: "dismissed", label: "Dismissed", findings: data.dismissed, reason: "Dismissed" },
  ].filter((group) => group.findings.length > 0);

  const bySeverity = (findings: ReportFinding[]) => {
    const order = ["CRITICAL", "WARNING", "NITPICK"];
    return [...findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  };
  const counts = data.confirmed.reduce<Record<string, number>>((all, finding) => {
    all[finding.severity] = (all[finding.severity] ?? 0) + 1;
    return all;
  }, {});

  return (
    <Card className="p-6">
      <h3 className="flex flex-wrap items-center gap-2 text-title font-semibold tracking-tight">
        <Mono>{data.fromBranch}</Mono>
        <span className="text-[var(--color-ink-faint)]">into</span>
        <Mono>{data.intoBranch}</Mono>
      </h3>

      {/* The sentence a reader wants before any of the detail. */}
      <p className="mt-3 text-heading font-semibold">
        {data.confirmed.length} confirmed finding{data.confirmed.length === 1 ? "" : "s"}
        {Object.keys(counts).length > 0
          ? `: ${["CRITICAL", "WARNING", "NITPICK"]
              .filter((severity) => counts[severity])
              .map((severity) => `${counts[severity]} ${severity.toLowerCase()}`)
              .join(", ")}`
          : ""}
        .
      </p>

      <h4 className="mt-5 text-body font-medium">What was examined</h4>
      <p className="mt-1 text-body text-[var(--color-ink-muted)]">{completeness(data)}</p>

      {data.intent ? (
        <>
          <h4 className="mt-5 text-body font-medium">What the change was for</h4>
          <blockquote className="mt-1 border-l-2 border-[var(--color-border-strong)] pl-3 text-body text-[var(--color-ink-muted)]">
            {data.intent}
          </blockquote>
        </>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="mt-6">
          <h4 className="text-body font-semibold tracking-wide uppercase text-[var(--color-ink-muted)]">
            {group.label} ({group.findings.length})
          </h4>
          {/* One column no wider than the card: an auto column grew to the
              longest quoted line, and on a phone every card ran off the screen. */}
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">
            {bySeverity(group.findings).map((finding, index) => (
              <li
                key={`${finding.filePath}-${finding.lineStart}-${index}`}
                className="flex gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              >
                <span
                  aria-hidden
                  className={`w-0.5 shrink-0 self-stretch rounded ${
                    finding.severity === "CRITICAL"
                      ? "bg-[var(--color-critical)]"
                      : finding.severity === "WARNING"
                        ? "bg-[var(--color-warning)]"
                        : "bg-[var(--color-border-strong)]"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-body font-medium">{finding.issue}</span>
                    <Mono className="text-aside text-[var(--color-ink-muted)]">
                      {finding.filePath}:{finding.lineStart}
                    </Mono>
                    {finding.ruleCode ? (
                      <span className="text-aside text-[var(--color-ink-faint)]">
                        rule {finding.ruleCode}
                      </span>
                    ) : null}
                  </div>
                  {/* Prose first, code subordinate: the reader is deciding what
                      to do, not reading a diff. */}
                  <p className="mt-1 text-body text-[var(--color-ink-muted)]">{finding.comment}</p>
                  {finding.dismissReason ? (
                    <p className="mt-1 text-aside text-[var(--color-ink-faint)]">
                      {group.reason}: {finding.dismissReason}
                    </p>
                  ) : null}
                  {finding.quotedCode ? (
                    <pre className="mt-2 overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-2 text-aside">
                      <code className="font-[family-name:var(--font-mono)]">
                        {finding.quotedCode}
                      </code>
                    </pre>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="mt-6 border-t border-[var(--color-border)] pt-3 text-aside text-[var(--color-ink-faint)]">
        <Mono>{data.model}</Mono> at effort {data.effort}, {data.profile} profile, against{" "}
        {data.rulesetName} v{data.rulesetVersion}. Commit <Sha value={data.fromCommit} />, merge
        base <Sha value={data.mergeBaseCommit} />. Cost equivalent $
        {data.usage.costEquivalentUsd.toFixed(4)}.
      </footer>
    </Card>
  );
}

/**
 * The scan, given the whole screen.
 *
 * A review is minutes of real work, and the ordinary page showed it as one
 * pulsing dot beside a sidebar log. While a run is live this takes over:
 * the stages as a ruled gauge across the top, the current stage named large
 * with what it usually takes on this machine, the engine's activity
 * streaming center-stage, and the clock and the meter running where they can
 * be seen from across a room. Every figure on it is the run's own.
 *
 * It covers the top bar deliberately. Watching a scan is a mode, not a
 * page, and Escape or Hide steps back out without touching the run.
 */
function ScanTheater({
  snapshot,
  live,
  now,
  batch,
  streaming,
  onMinimize,
  onCancel,
}: {
  snapshot: Snapshot;
  live: LiveEntry[];
  now: number;
  batch: { number: number; count: number } | null;
  /** False while the event stream is down and being opened again. */
  streaming: boolean;
  onMinimize: () => void;
  /** Resolves with why the cancel failed, or empty when it took. */
  onCancel: () => Promise<string>;
}) {
  const { review, coverage } = snapshot;
  const done = new Set(
    snapshot.stages.filter((row) => row.status === "succeeded").map((row) => row.stage),
  );
  const executing = executingStage(snapshot, done);
  const stageIndex = STAGES.findIndex(([stage]) => stage === executing);
  const usual = executing !== null ? snapshot.stageMedians[executing] : undefined;
  const feedRef = useRef<HTMLDivElement>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelProblem, setCancelProblem] = useState("");

  // The feed follows the work. New entries arrive several times a second
  // while the engine reads, and a stream someone must scroll by hand is a
  // stream nobody watches.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [live.length]);

  // A modal dialog: the page beneath, top bar too, is out of reach of Tab
  // and of a screen reader while a run is watched, and focus starts inside.
  // It was a plain div covering the page (5.14, audit U12). Escape is the
  // dialog's own cancel, which hides the view rather than closing it here.
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Watching the review of ${review.fromBranch} into ${review.intoBranch}`}
      onCancel={(event) => {
        event.preventDefault();
        onMinimize();
      }}
      className="m-0 h-full max-h-none w-full max-w-none border-0 bg-[var(--color-surface)] p-0 text-[var(--color-ink)]"
    >
      <div className="flex h-full flex-col px-8 py-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <svg viewBox="0 0 16 16" aria-hidden className="h-5 w-5 shrink-0">
              <path
                d="M2 2 L2 14 L14 14"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2"
                strokeLinecap="square"
              />
              <path d="M5 11 L11 11 L11 5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
            <Mono className="truncate text-heading">
              {review.fromBranch} <span className="text-[var(--color-ink-faint)]">into</span>{" "}
              {review.intoBranch}
            </Mono>
            <Badge tone={statusTone(review.status)}>
              {snapshot.queued ? "queued" : statusLabel(review.status)}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            {review.startedAt ? (
              <span className="font-[family-name:var(--font-mono)] text-title font-semibold tabular-nums">
                {elapsedSince(review.startedAt, now)}
              </span>
            ) : null}
            <Button variant="quiet" onClick={onMinimize}>
              Hide
            </Button>
            {confirmingCancel ? (
              <>
                <Button
                  variant="primary"
                  disabled={cancelling}
                  onClick={() => {
                    setCancelling(true);
                    void onCancel()
                      .then((problem) => {
                        setCancelProblem(problem);
                        setConfirmingCancel(false);
                      })
                      .finally(() => setCancelling(false));
                  }}
                >
                  Yes, cancel
                </Button>
                <Button
                  variant="quiet"
                  // Not while the cancel is on its way: taking it back then
                  // showed Cancel again over a review being cancelled anyway.
                  disabled={cancelling}
                  onClick={() => setConfirmingCancel(false)}
                >
                  No, keep it
                </Button>
              </>
            ) : (
              <Button variant="quiet" onClick={() => setConfirmingCancel(true)}>
                Cancel
              </Button>
            )}
          </div>
        </header>
        {cancelProblem ? (
          <div className="mt-3">
            <Problem>{cancelProblem}</Problem>
          </div>
        ) : null}

        {/* The pipeline as a ruled gauge: seven segments, filled as they land,
          the live one glowing. */}
        <div className="mt-5">
          <div className="flex gap-1.5" aria-hidden>
            {STAGES.map(([stage]) => {
              const isDone = deterministicDone(stage, snapshot, done) || done.has(stage);
              const isCurrent = stage === executing;
              return (
                <span
                  key={stage}
                  className={`h-1.5 flex-1 rounded-sm ${
                    isCurrent
                      ? "pulse bg-[var(--color-accent)]"
                      : isDone
                        ? "bg-[var(--color-accent)] opacity-60"
                        : "gauge-track"
                  }`}
                />
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-[family-name:var(--font-mono)] text-title font-semibold">
              {executing !== null && stageIndex !== -1
                ? `${stageLabel(executing)}`
                : snapshot.queued
                  ? "Waiting for the running review"
                  : "Preparing"}
            </span>
            {stageIndex !== -1 ? (
              <span className="text-body text-[var(--color-ink-muted)]">
                stage {stageIndex + 1} of {STAGES.length}
                {/* A stage that divides its work says which division is in
                  flight, so nine requests do not look like one long one. */}
                {batch ? ` · request ${batch.number} of ${batch.count}` : ""}
                {usual !== undefined ? ` · usually ${elapsedBetween(0, usual)} here` : ""}
              </span>
            ) : null}
            {stageIndex !== -1 ? (
              <span className="text-body text-[var(--color-ink-faint)]">
                {STAGES[stageIndex]?.[2]}
              </span>
            ) : null}
          </div>
        </div>

        {streaming ? null : (
          // Here too, where a run is watched: the feed below stops while the
          // stream is down, and it used to stop without a word (5.12, U8).
          <p className="mt-5 text-aside text-[var(--color-ink-muted)]">
            The live stream dropped and is being opened again. The run itself is unaffected.
          </p>
        )}
        {/* The work itself, streaming. This is the panel the whole mode exists
          for: files being opened, stages turning over, the run narrating. */}
        <div
          ref={feedRef}
          tabIndex={0}
          role="log"
          aria-label="Scan activity"
          className="mt-5 min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4 shadow-[inset_0_1px_0_0_var(--color-edge)]"
        >
          {live.length === 0 ? (
            <p className="text-body text-[var(--color-ink-muted)]">
              Fetching, pinning and checking out the change set...
            </p>
          ) : (
            <ul className="grid gap-0.5 text-dense">
              {live.slice(-120).map((entry, index) => (
                <li key={index} className="leading-6 break-words">
                  {entry.kind === "stage" ? (
                    <span className="font-medium text-[var(--color-ink)]">
                      {stageLabel(entry.stage)}{" "}
                      <span className="font-normal text-[var(--color-ink-faint)]">
                        {entry.phase}
                      </span>
                    </span>
                  ) : entry.kind === "note" ? (
                    <span className="block border-l-2 border-[var(--color-border-strong)] py-0.5 pl-2 text-[var(--color-ink-muted)]">
                      {entry.message}
                    </span>
                  ) : (
                    <span className="block overflow-hidden font-[family-name:var(--font-mono)] break-all text-[var(--color-ink-faint)]">
                      {entry.detail}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-6">
            <span className="text-dense text-[var(--color-ink-muted)]">
              <span className="font-[family-name:var(--font-mono)] text-heading font-semibold text-[var(--color-ink)] tabular-nums">
                ${review.costEquivalentUsd.toFixed(2)}
              </span>{" "}
              so far
            </span>
            {coverage.totalFiles > 0 ? (
              <span className="text-dense text-[var(--color-ink-muted)]">
                <span className="font-[family-name:var(--font-mono)] text-heading font-semibold text-[var(--color-ink)] tabular-nums">
                  {coverage.totalFiles - coverage.pendingFiles}/{coverage.totalFiles}
                </span>{" "}
                files accounted for
              </span>
            ) : null}
            {coverage.totalHunks > 0 ? (
              <span className="text-dense text-[var(--color-ink-muted)]">
                <span className="font-[family-name:var(--font-mono)] text-heading font-semibold text-[var(--color-ink)] tabular-nums">
                  {coverage.totalHunks - coverage.pendingHunks}/{coverage.totalHunks}
                </span>{" "}
                hunks
              </span>
            ) : null}
          </div>
          <span className="text-aside text-[var(--color-ink-faint)]">
            Esc hides this view; the run keeps going either way.
          </span>
        </footer>
      </div>
    </dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
