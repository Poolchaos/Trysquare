"use client";

/**
 * A review while it runs, and what it found when it stops.
 *
 * The page opens on a snapshot read from the database and then follows the
 * event stream, so a reload mid-review shows the same run rather than starting
 * the story again. When the stream says the run is over it stops on its own
 * rather than holding the connection open.
 */

import { use, useEffect, useState } from "react";
import {
  canTransitionReview,
  isResumableReview,
  type ReviewStatus,
} from "@/lib/domain/state-machines";
import { ConfirmationQueue, type Finding } from "@/components/confirmation";
import { PageBody, PageHeader } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Empty,
  Mono,
  Problem,
  Sha,
  severityTone,
  statusTone,
} from "@/components/ui";

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
  ["s6_audit", "Audit", "Refuse to finish while anything is undispositioned"],
] as const;

/** Stages that run as app code, so they never write a stage_executions row. */
const DETERMINISTIC_STAGES = new Set(["s0_prepare", "s6_audit"]);

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
    pausedReason: string | null;
    pausedResetsAt: number | null;
    mergedDetectedAt: string | null;
    usageInputTokens: number;
    usageOutputTokens: number;
    usageCacheReadTokens: number;
    costEquivalentUsd: number;
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
  };
  notes: { kind: string; message: string; at: string }[];
  findings: Finding[];
  running: boolean;
  queued: boolean;
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
  if (stage === "s5_verification" && done.has("s5_verification")) return "s6_audit";
  return stage;
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
}: {
  coverage: Snapshot["coverage"];
  running: boolean;
}) {
  if (coverage.totalFiles === 0) {
    return running ? (
      <Card className="mb-6 p-4">
        <h2 className="mb-1 text-sm font-medium">Coverage</h2>
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
      <h2 className="mb-3 text-sm font-medium">Coverage</h2>
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
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        {outstanding === 0
          ? "Everything the change touched ended with a finding or an explicit clear."
          : `${outstanding} still outstanding. The review cannot finish while anything is.`}
      </p>
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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(true);
  // Bumped after a resume, so a fresh stream is opened for the fresh run.
  // The old one is gone: the server closes a stream when its run ends.
  const [watchEpoch, setWatchEpoch] = useState(0);
  const [report, setReport] = useState<string | null>(null);
  const [exported, setExported] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState("");

  async function fetchSnapshot(): Promise<Snapshot | null> {
    const response = await fetch(`/api/reviews/${id}`);
    return response.ok ? ((await response.json()) as Snapshot) : null;
  }

  async function reload() {
    const fresh = await fetchSnapshot();
    if (fresh) setSnapshot(fresh);
  }

  /** A new run needs a new stream: the old one was closed by the run that ended. */
  function watchAgain() {
    setStreaming(true);
    setWatchEpoch((epoch) => epoch + 1);
  }

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    // The server ends the stream when the run ends, which the browser can
    // only see as an error. This flag is what tells that apart from a
    // genuinely dropped connection, which is the one case worth polling over.
    let runEnded = false;

    void (async () => {
      const fresh = await fetchSnapshot();
      if (fresh && !cancelled) setSnapshot(fresh);
    })();

    const source = new EventSource(`/api/reviews/${id}/events`);

    source.addEventListener("update", (event) => {
      const parsed = JSON.parse((event as MessageEvent<string>).data) as {
        kind: string;
        stage?: string;
        phase?: string;
        status?: string;
        note?: { message: string };
        detail?: string;
      };

      // Kept as a bounded tail: a long run emits thousands of engine lines,
      // and the page only ever shows the most recent of them. The archive is
      // the event log, not component state.
      const push = (line: string) => setLive((lines) => [...lines, line].slice(-200));
      if (parsed.kind === "stage") push(`${parsed.stage} ${parsed.phase}`);
      if (parsed.kind === "engine") push(`  ${parsed.detail}`);
      if (parsed.kind === "note") push(`note: ${parsed.note?.message}`);

      if (parsed.kind === "done") runEnded = true;

      // Durable facts are written before they are announced, so a read here
      // always finds the row already changed.
      if (parsed.kind === "status" || parsed.kind === "done") void reload();
    });

    // D-15's fallback. Polls every two seconds only while a live run has no
    // stream to speak for it, and stops itself once nothing is running or
    // waiting, because from then on the page only changes when the user acts
    // on it. Without the stop, every finished review kept polling forever.
    source.onerror = () => {
      source.close();
      setStreaming(false);
      if (runEnded || poll !== undefined) return;
      poll = setInterval(() => {
        if (cancelled) return;
        void (async () => {
          const fresh = await fetchSnapshot();
          if (cancelled || !fresh) return;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, watchEpoch]);

  if (!snapshot) return <PageBody>Loading...</PageBody>;

  const { review, findings } = snapshot;
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
                {finding.status === "dismissed" ? <Badge tone="neutral">dismissed</Badge> : null}
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
          <span className="flex items-center gap-2">
            <Mono>{review.fromBranch}</Mono>
            <span className="text-[var(--color-ink-faint)]">into</span>
            <Mono>{review.intoBranch}</Mono>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(review.status)}>
              {snapshot.queued ? "queued" : review.status.replace(/_/g, " ")}
            </Badge>
            {review.mergedDetectedAt ? <Badge tone="good">merged</Badge> : null}
            <Sha value={review.fromCommit} />
            <span>{review.model}</span>
            <span>effort {review.effort}</span>
          </span>
        }
        actions={
          <>
            {isResumableReview(review.status as ReviewStatus) ? (
              <Button
                variant="primary"
                onClick={async () => {
                  // No ruleset needed: a resumed review already carries the
                  // one it was frozen with.
                  await fetch(`/api/reviews/${id}/start`, { method: "POST" });
                  watchAgain();
                }}
              >
                Resume
              </Button>
            ) : null}

            {/* The machine, not a status list: a list here would be the fourth
                place to forget one, and it was (paused and interrupted reviews
                had no way to be cancelled from the screen). */}
            {snapshot.queued || canTransitionReview(review.status as ReviewStatus, "cancelled") ? (
              <Button
                onClick={async () => {
                  await fetch(`/api/reviews/${id}/cancel`, { method: "POST" });
                  await reload();
                }}
              >
                Cancel
              </Button>
            ) : null}

            {!snapshot.running && !snapshot.queued ? (
              confirmingDelete ? (
                <>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const response = await fetch(`/api/reviews/${id}`, { method: "DELETE" });
                      if (response.ok) window.location.href = "/reviews";
                      else
                        setActionError(
                          ((await response.json()) as { error?: string }).error ??
                            "The review could not be deleted.",
                        );
                    }}
                  >
                    Yes, delete
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button onClick={() => setConfirmingDelete(true)}>Delete</Button>
              )
            ) : null}
          </>
        }
      />
      <PageBody>
        {actionError ? <Problem>{actionError}</Problem> : null}
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
            <Card className="mb-6 p-4">
              <h2 className="mb-3 text-sm font-medium">Stages</h2>
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
                    <li
                      key={stage}
                      className="border-t border-[var(--color-border)] py-2 first:border-0"
                    >
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
                        <span
                          className={succeeded || failed ? "" : "text-[var(--color-ink-muted)]"}
                        >
                          {label}
                        </span>
                        {attempts.length > 1 ? (
                          <span className="text-xs text-[var(--color-ink-muted)]">
                            {attempts.length} attempts
                          </span>
                        ) : null}
                        <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-muted)]">
                          {last ? formatDuration(last.startedAt, last.endedAt) : null}
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

            <CoveragePanel coverage={snapshot.coverage} running={snapshot.running} />

            {snapshot.notes.length > 0 ? (
              <Card className="mb-6 p-4">
                <h2 className="mb-2 text-sm font-medium">What this run recorded</h2>
                {/* Persisted, unlike the live activity tail, so how a run
                    divided its work survives a reload. */}
                <ul className="grid gap-2">
                  {snapshot.notes.map((note, index) => (
                    <li key={`${note.at}-${index}`} className="text-xs">
                      <span className="text-[var(--color-ink-muted)]">
                        {new Date(note.at).toLocaleTimeString()}
                      </span>{" "}
                      {note.message}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {review.status === "complete" ? (
              <ReportPanel
                reviewId={id}
                report={report}
                exported={exported}
                onLoaded={setReport}
                onExported={setExported}
              />
            ) : null}

            {review.status === "awaiting_confirmation" && reported.length > 0 ? (
              <ConfirmationQueue
                reviewId={id}
                findings={findings}
                onChanged={() => void reload()}
              />
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold">
                  Findings{reported.length > 0 ? ` (${reported.length})` : ""}
                </h2>
                {renderReadOnly()}
              </>
            )}
          </div>

          <aside className="grid gap-4 self-start">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">What it cost</h2>
              <dl className="grid gap-1.5 text-sm">
                <Stat label="Fresh input" value={review.usageInputTokens.toLocaleString("en-US")} />
                <Stat
                  label="Cached read"
                  value={review.usageCacheReadTokens.toLocaleString("en-US")}
                />
                <Stat label="Output" value={review.usageOutputTokens.toLocaleString("en-US")} />
                <Stat label="Cost equivalent" value={`$${review.costEquivalentUsd.toFixed(4)}`} />
              </dl>
            </Card>

            {review.intent ? (
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold">What it was meant to do</h2>
                <p className="text-sm text-[var(--color-ink-muted)]">{review.intent}</p>
              </Card>
            ) : null}

            {(snapshot.running || snapshot.queued) && !streaming ? (
              <Card className="mb-6 p-4">
                <p className="text-xs text-[var(--color-ink-muted)]">
                  The live stream dropped, so this is checking every two seconds instead. The run
                  itself is unaffected; only this page lost its connection to it.
                </p>
              </Card>
            ) : null}

            {live.length > 0 ? (
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold">Activity</h2>
                <ul
                  tabIndex={0}
                  role="group"
                  aria-label="Activity log"
                  className="max-h-64 overflow-y-auto text-xs text-[var(--color-ink-muted)]"
                >
                  {live.slice(-40).map((line, index) => (
                    <li key={index} className="font-[family-name:var(--font-mono)] leading-5">
                      {line}
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (report !== null) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/reviews/${reviewId}/report`);
      const body = (await response.json()) as { markdown?: string; error?: string };
      if (cancelled) return;
      if (response.ok && body.markdown) onLoaded(body.markdown);
      else setError(body.error ?? "The report could not be built.");
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewId, report, onLoaded]);

  return (
    <section className="mb-6">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Report</h2>
        <span className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (report) void navigator.clipboard?.writeText(report);
            }}
            disabled={!report}
          >
            Copy
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const response = await fetch(`/api/reviews/${reviewId}/export`, { method: "POST" });
              const body = (await response.json()) as { path?: string; error?: string };
              if (response.ok && body.path) onExported(body.path);
              else setError(body.error ?? "The report could not be exported.");
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
        <p className="text-sm text-[var(--color-ink-muted)]">Building the report...</p>
      ) : (
        <Card className="max-h-[32rem] overflow-auto p-4">
          <pre
            tabIndex={0}
            role="group"
            aria-label="Report"
            className="text-xs leading-5 whitespace-pre-wrap"
          >
            <code className="font-[family-name:var(--font-mono)]">{report}</code>
          </pre>
        </Card>
      )}
    </section>
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
