"use client";

/**
 * The scoreboard: what this machine has measured, across every review it ran.
 *
 * The root used to redirect to Projects, so the app opened on a list of
 * repositories and never once said what any of the work had produced. Every
 * measurement on this screen was already in the database and shown nowhere:
 * what the reviews cost, how often a finding survived a person's judgment,
 * how often the engine cited code that was not there, and which rules of a
 * protocol ever earn a place in a report.
 *
 * The rule this screen is built under (D-68): a figure not measured from
 * local data does not render. A rate with no denominator shows a dash, not a
 * zero, because zero percent is a claim and "nothing has been decided yet" is
 * the truth.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loading, PageBody, PageHeader } from "@/components/page";
import { send } from "@/components/request";
import { Badge, Card, Empty, Mono, StatTile, statusLabel, statusTone } from "@/components/ui";

interface Row {
  id: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  model: string;
  status: string;
  confirmed: number;
  total: number;
  costUsd: number;
  durationMs: number | null;
  createdAt: string;
}

interface AwaitingRow {
  id: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  decided: number;
  total: number;
  since: string;
}

interface ProjectRow {
  id: string;
  name: string;
  reviews: number;
  latest: { id: string; status: string; confirmed: number; total: number; at: string } | null;
}

interface Scoreboard {
  spendUsd: number;
  reviewsCompleted: number;
  reviewsTotal: number;
  precision: number | null;
  inventionRate: number | null;
  awaiting: number;
  awaitingReviews: AwaitingRow[];
  spendHistory: number[];
  recent: Row[];
  ruleYield: { ruleCode: string; confirmed: number; total: number }[];
  projects: ProjectRow[];
}

interface LiveRun {
  id: string;
  status: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  currentStage: string | null;
  startedAt: string | null;
  costEquivalentUsd: number;
}

/** The pipeline, for the live widget's gauge. Mirrors the review screen's. */
const STAGE_ORDER = [
  "s0_prepare",
  "s1_risk",
  "s2_comprehension",
  "s3_adversarial",
  "s4_deletions",
  "s5_verification",
  "s6_audit",
];

const STAGE_NAMES: Record<string, string> = {
  s0_prepare: "Prepare",
  s1_risk: "Risk",
  s2_comprehension: "Comprehension",
  s3_adversarial: "Adversarial",
  s4_deletions: "Deletions",
  s5_verification: "Verification",
  s6_audit: "Audit",
};

/** How long ago, in the words someone would use out loud. */
function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** A widget: the machined panel with the uppercase mono label. */
function Widget({
  label,
  action,
  className = "",
  children,
}: {
  label: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`min-w-0 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-[family-name:var(--font-mono)] text-aside tracking-wide text-[var(--color-ink-muted)] uppercase">
          {label}
        </p>
        {action}
      </div>
      {children}
    </Card>
  );
}

function duration(ms: number | null): string {
  if (ms === null) return "";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The shape of what each completed review cost, drawn from the costs
 * themselves.
 *
 * Deliberately not a trend line or a projection: it is one mark per review,
 * in the order they ran. Fewer than two reviews draws nothing, because a line
 * through one point is a shape invented for decoration.
 */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const top = Math.max(...values);
  if (top <= 0) return null;
  const step = 100 / (values.length - 1);
  const points = values
    .map((value, index) => `${(index * step).toFixed(2)},${(24 - (value / top) * 22).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden className="mt-2 h-6 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function HomePage() {
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [boardAttempt, setBoardAttempt] = useState(0);

  // The same narrow endpoint the bar polls, so a running review appears here
  // without a second source of truth about what is running.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/reviews/attention");
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { active: LiveRun | null };
        if (!cancelled) setLive(body.active);
      } catch {
        // A dashboard that cannot reach the server says so through the
        // scoreboard's own error, not twice.
      }
    };
    const timer = setInterval(() => void check(), 4000);
    void check();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Ticks only while something is running, so a quiet dashboard is not
  // re-rendered once a second for ever. Keyed to whether a run exists rather
  // than to the polled object, which is a new identity every four seconds and
  // would restart the clock each time it arrived.
  const running = live !== null;
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The server's words, with Try again: a fixed sentence and no way to
      // read again was all a failure said (D-138).
      const sent = await send<Scoreboard>(
        "/api/scoreboard",
        {},
        "The scoreboard could not be read",
      );
      if (cancelled) return;
      if (sent.ok) setBoard(sent.body);
      else setError(sent.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardAttempt]);

  const percent = (rate: number | null) => (rate === null ? "-" : `${Math.round(rate * 100)}%`);

  return (
    <>
      <PageHeader
        title="Review scoreboard"
        subtitle="Everything here is counted from reviews this machine has run."
      />
      <PageBody>
        {board === null ? (
          <Loading
            {...(error === "" ? {} : { error })}
            onRetry={() => {
              setError("");
              setBoardAttempt((attempt) => attempt + 1);
            }}
          />
        ) : board.reviewsTotal === 0 ? (
          <Empty title="Nothing has been reviewed yet">
            Add a project, import a protocol as a ruleset, then pick two branches and run a review.
            What it finds, what it costs and which rules earn their place all appear here.
          </Empty>
        ) : (
          <div className="grid gap-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Total spend" value={`$${board.spendUsd.toFixed(2)}`}>
                <Sparkline values={board.spendHistory} />
              </StatTile>
              <StatTile
                label="Reviews completed"
                value={String(board.reviewsCompleted)}
                note={
                  board.reviewsTotal > board.reviewsCompleted
                    ? `${board.reviewsTotal} started`
                    : undefined
                }
              />
              <StatTile
                label="Precision"
                value={percent(board.precision)}
                note={
                  board.precision === null
                    ? "nothing decided yet"
                    : "confirmed of decided, unproven aside"
                }
              />
              <StatTile
                label="Invention rate"
                value={percent(board.inventionRate)}
                note={
                  board.inventionRate === null
                    ? "nothing raised yet"
                    : "killed by the quotation check"
                }
              />
            </div>

            {/* Live before archive: something happening now outranks
                everything that already did. Hidden entirely when nothing is
                running, because an empty "live" panel is a dashboard
                claiming to have something to watch. */}
            {live ? (
              <Widget
                label="Live scan"
                action={
                  <Link
                    href={`/reviews/${live.id}`}
                    className="text-aside text-[var(--color-accent)] underline underline-offset-2"
                  >
                    Open scan view
                  </Link>
                }
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <Mono className="text-heading">
                    {live.fromBranch} <span className="text-[var(--color-ink-faint)]">into</span>{" "}
                    {live.intoBranch}
                  </Mono>
                  <span className="text-body text-[var(--color-ink-muted)]">
                    {live.currentStage ? STAGE_NAMES[live.currentStage] : "Preparing"}
                    {live.currentStage
                      ? ` · stage ${STAGE_ORDER.indexOf(live.currentStage) + 1} of ${STAGE_ORDER.length}`
                      : ""}
                  </span>
                  {live.startedAt ? (
                    <span className="font-[family-name:var(--font-mono)] text-body tabular-nums">
                      {ago(live.startedAt, now).replace(" ago", "")} elapsed
                    </span>
                  ) : null}
                  <span className="font-[family-name:var(--font-mono)] text-body tabular-nums">
                    ${live.costEquivalentUsd.toFixed(2)}
                  </span>
                </div>
                <div className="mt-3 flex gap-1.5" aria-hidden>
                  {STAGE_ORDER.map((stage, index) => {
                    const at = live.currentStage ? STAGE_ORDER.indexOf(live.currentStage) : 0;
                    return (
                      <span
                        key={stage}
                        className={`h-1.5 flex-1 rounded-sm ${
                          index === at
                            ? "pulse bg-[var(--color-accent)]"
                            : index < at
                              ? "bg-[var(--color-accent)] opacity-60"
                              : "gauge-track"
                        }`}
                      />
                    );
                  })}
                </div>
              </Widget>
            ) : null}

            {/* The work that wants a person, above the record of work that
                does not. */}
            <Widget label="Needs you">
              {board.awaitingReviews.length === 0 ? (
                <p className="text-body text-[var(--color-ink-muted)]">
                  Nothing is waiting on you.
                </p>
              ) : (
                <ul className="grid gap-1">
                  {board.awaitingReviews.map((row) => (
                    <li key={row.id}>
                      <Link
                        href={`/reviews/${row.id}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-[var(--color-question)] bg-[var(--color-question-soft)] px-3 py-2 transition-colors hover:border-[var(--color-question)]"
                      >
                        <span className="min-w-0">
                          <Mono className="block truncate text-dense">
                            {row.fromBranch} into {row.intoBranch}
                          </Mono>
                          <span className="text-aside text-[var(--color-ink-muted)]">
                            {row.projectName}
                          </span>
                        </span>
                        <span className="text-dense tabular-nums">
                          {row.total > 0 ? `${row.decided} of ${row.total} decided` : "no findings"}
                          <span className="ml-3 text-[var(--color-ink-muted)]">
                            waiting {ago(row.since, now)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
            <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
              <Card className="min-w-0 overflow-x-auto">
                <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-heading font-semibold">
                  Recent reviews
                </h2>
                <table className="w-full text-dense">
                  <thead className="font-[family-name:var(--font-mono)] text-aside tracking-wide text-[var(--color-ink-muted)] uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Branch pair</th>
                      <th className="px-4 py-2 text-left font-medium">Model</th>
                      <th className="px-4 py-2 text-right font-medium">Findings</th>
                      <th className="px-4 py-2 text-right font-medium">Cost</th>
                      <th className="px-4 py-2 text-right font-medium">Took</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.recent.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-t border-[var(--color-border)] ${
                          row.status === "awaiting_confirmation"
                            ? "bg-[var(--color-question-soft)]"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-2">
                          <Link href={`/reviews/${row.id}`} className="block min-w-0">
                            <Mono className="block truncate">
                              {row.fromBranch} into {row.intoBranch}
                            </Mono>
                            <span className="text-aside text-[var(--color-ink-faint)]">
                              {row.projectName}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-[var(--color-ink-muted)]">{row.model}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.total > 0 ? `${row.confirmed} of ${row.total}` : "-"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.costUsd > 0 ? `$${row.costUsd.toFixed(2)}` : "-"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">
                          {duration(row.durationMs) || "-"}
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card className="self-start p-4">
                <h2 className="text-heading font-semibold">Rule yield</h2>
                <p className="mt-1 text-aside text-[var(--color-ink-muted)]">
                  How often each rule&apos;s findings survive to a report. A rule that fires and is
                  never confirmed is costing review attention for nothing.
                </p>
                {board.ruleYield.length === 0 ? (
                  <p className="mt-3 text-aside text-[var(--color-ink-faint)]">
                    No finding has cited a rule yet.
                  </p>
                ) : (
                  <ul className="mt-3 grid gap-2">
                    {board.ruleYield.slice(0, 8).map((rule) => {
                      const share = rule.confirmed / rule.total;
                      return (
                        <li key={rule.ruleCode} className="text-dense">
                          <div className="flex items-baseline justify-between gap-2">
                            <span>Rule {rule.ruleCode}</span>
                            <span className="text-aside text-[var(--color-ink-muted)] tabular-nums">
                              {rule.confirmed}/{rule.total}
                            </span>
                          </div>
                          <div className="gauge-track mt-1 h-1.5 w-full overflow-hidden rounded-sm">
                            <div
                              className={`h-full ${
                                share === 0
                                  ? "bg-[var(--color-critical)]"
                                  : share < 0.5
                                    ? "bg-[var(--color-warning)]"
                                    : "bg-[var(--color-good)]"
                              }`}
                              style={{ width: `${Math.max(share * 100, 2)}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Widget label="Projects" className="self-start">
                <ul className="grid gap-2">
                  {board.projects.map((project) => (
                    <li
                      key={project.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                    >
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-dense underline-offset-2 hover:underline"
                      >
                        {project.name}
                      </Link>
                      {project.latest ? (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-aside">
                          {/* The outcome is the way into the review that
                              produced it: a status worth reading is a status
                              worth opening. */}
                          <Link href={`/reviews/${project.latest.id}`}>
                            <Badge tone={statusTone(project.latest.status)}>
                              {statusLabel(project.latest.status)}
                            </Badge>
                          </Link>
                          <span className="text-[var(--color-ink-muted)] tabular-nums">
                            {project.latest.total > 0
                              ? `${project.latest.confirmed} of ${project.latest.total} confirmed`
                              : "no findings"}
                          </span>
                          {/* When, and how many times. A project reviewed once
                              last March is a different thing from one reviewed
                              nine times this week, and the widget said neither. */}
                          <span className="text-[var(--color-ink-faint)]">
                            {ago(project.latest.at, now)}
                            {project.reviews > 1 ? ` · ${project.reviews} reviews` : ""}
                          </span>
                          <Link
                            href={`/reviews/new?projectId=${project.id}`}
                            className="text-[var(--color-accent)] underline underline-offset-2"
                          >
                            Review
                          </Link>
                        </span>
                      ) : (
                        <Link
                          href={`/reviews/new?projectId=${project.id}`}
                          className="text-aside text-[var(--color-accent)] underline underline-offset-2"
                        >
                          Review a branch
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </Widget>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
