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
import { PageBody, PageHeader } from "@/components/page";
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

interface Scoreboard {
  spendUsd: number;
  reviewsCompleted: number;
  reviewsTotal: number;
  precision: number | null;
  inventionRate: number | null;
  awaiting: number;
  spendHistory: number[];
  recent: Row[];
  ruleYield: { ruleCode: string; confirmed: number; total: number }[];
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
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/scoreboard");
        if (cancelled) return;
        if (!response.ok) {
          setError("The scoreboard could not be read.");
          return;
        }
        setBoard((await response.json()) as Scoreboard);
      } catch {
        if (!cancelled) setError("The scoreboard could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const percent = (rate: number | null) => (rate === null ? "-" : `${Math.round(rate * 100)}%`);

  return (
    <>
      <PageHeader
        title="Review scoreboard"
        subtitle="Everything here is counted from reviews this machine has run."
      />
      <PageBody>
        {error ? <p className="text-body text-[var(--color-critical)]">{error}</p> : null}
        {board === null ? (
          !error ? (
            <p className="text-body text-[var(--color-ink-muted)]">Loading...</p>
          ) : null
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
                note={board.precision === null ? "nothing decided yet" : "confirmed of decided"}
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

            <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
              <Card className="min-w-0 overflow-x-auto">
                <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-heading font-semibold">
                  Recent reviews
                </h2>
                <table className="w-full text-dense">
                  <thead className="text-aside tracking-wide text-[var(--color-ink-muted)] uppercase">
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
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
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
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
