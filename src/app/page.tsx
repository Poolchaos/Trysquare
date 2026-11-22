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
import { Fragment, useEffect, useState, useRef } from "react";
import { Loading, PageBody, PageHeader } from "@/components/page";
import { asSentence, send } from "@/components/request";
import {
  Badge,
  Card,
  Empty,
  Mono,
  Problem,
  StatTile,
  statusLabel,
  statusTone,
} from "@/components/ui";
import { needsYouLine, type NeedsYouStatus } from "@/lib/review/needs-you";
import { runTimeParts } from "@/lib/review/run-time";

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
  ranBefore: boolean;
  createdAt: string;
  /** Who authored the reviewed branch's newest commit; null where none was kept (D-297). */
  author: { name: string; email: string } | null;
  /** That author is the person, by the emails a branch list goes by. */
  mine: boolean;
}

interface AwaitingRow {
  id: string;
  status: NeedsYouStatus;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  decided: number;
  total: number;
  /** When its run ended; null where no row says (D-248). */
  since: string | null;
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
  proofsDiscardedRate: number | null;
  awaiting: number;
  awaitingReviews: AwaitingRow[];
  spendHistory: number[];
  recent: Row[];
  ruleYield: {
    ruleCode: string;
    /** The ruleset the rule is in; null where its review froze none. */
    rulesetName?: string | null;
    confirmed: number;
    total: number;
  }[];
  projects: ProjectRow[];
  /** Git's words when the emails that count as the person's could not be read. */
  identitiesProblem: string | null;
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
  "s4b_design_grading",
  "s5_verification",
  "s5b_second_verification",
  "s5c_design_second",
  "s6_audit",
];

/**
 * A stage this page has no name for, from a server newer than it, read by
 * its id rather than shown as nothing and "stage 0 of 10", as the review
 * screen already does (audit finding U10).
 */
/** How many rules Rule yield lists; with more cited, it says how many there are. */
const RULES_LISTED = 8;

function stageName(stage: string): string {
  return STAGE_NAMES[stage] ?? stage.replace(/^s\d+[a-z]?_/, "").replace(/_/g, " ");
}

const STAGE_NAMES: Record<string, string> = {
  s0_prepare: "Prepare",
  s1_risk: "Risk",
  s2_comprehension: "Comprehension",
  s3_adversarial: "Adversarial",
  s4_deletions: "Deletions",
  s5_verification: "Verification",
  s4b_design_grading: "Design grading",
  s5b_second_verification: "Second verifier",
  s5c_design_second: "Second grader",
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

/** How long a run or a wait has gone on: "just now elapsed" read as no span at all. */
function elapsed(iso: string, now: number): string {
  const since = ago(iso, now);
  return since === "just now" ? "under a minute" : since.replace(" ago", "");
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

function duration(ms: number | null, earlierRun: boolean): string[] {
  return ms === null ? [] : runTimeParts(ms, earlierRun);
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
  const boardShown = useRef(false);

  // The same narrow endpoint the bar polls, so a running review appears here
  // without a second source of truth about what is running. What it says is
  // kept, so the scoreboard is read again when it changes, a run started or
  // ended or a review newly waiting on a person: read once, its Needs you
  // list drifted from the bar's (audit finding U3).
  const lastAttention = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let asked = 0;
    let shown = 0;
    const check = async () => {
      const mine = ++asked;
      const sent = await send<{ active: LiveRun | null; awaiting: number }>(
        "/api/reviews/attention",
        {},
        "What is running could not be read",
      );
      // A reading older than one already shown says nothing: applied as it
      // landed, a run just started vanished for a poll, or one ended came
      // back (audit finding U4). Older than shown, not than asked: dropped
      // once a later poll was sent, a server slower than the poll showed
      // nothing at all (review round 15).
      if (mine < shown) return;
      // A dashboard that cannot reach the server says so through the
      // scoreboard's own error, not twice.
      if (!sent.ok || cancelled) return;
      shown = mine;
      setLive(sent.body.active);
      const said = `${sent.body.active?.id ?? ""}|${sent.body.active?.status ?? ""}|${sent.body.awaiting}`;
      if (lastAttention.current !== null && lastAttention.current !== said) {
        setBoardAttempt((attempt) => attempt + 1);
      }
      lastAttention.current = said;
    };
    const timer = setInterval(() => void check(), 4000);
    void check();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Every second while something is running, every minute otherwise: the
  // waiting and last-reviewed times are relative too, and on a quiet
  // dashboard they froze (audit finding U3). Keyed to whether a run exists
  // rather than to the polled object, which is a new identity every four
  // seconds and would restart the clock each time it arrived.
  //
  // The bar is told of a review paused at the usage limit too, and says
  // Paused. Nothing of it is live: drawn here it was a scan in progress, its
  // clock counting through the pause (the seventeenth grade, AE1).
  const scan = live !== null && live.status !== "paused_limit" ? live : null;
  const running = scan !== null;
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), running ? 1000 : 60_000);
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
      if (sent.ok) {
        boardShown.current = true;
        setError("");
        setBoard(sent.body);
      } else {
        setError(sent.error);
        // A re-read that failed is read again at the next poll: it was said
        // nowhere while the board stood, and nothing asked again until what
        // the bar polls next changed (review round 15). A first read that
        // failed waits for Try again, as D-138 has it.
        if (boardShown.current) lastAttention.current = "unread";
      }
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
        {/* Said above what it could not refresh: retried at the next poll, a
            failed re-read still left the board looking current (review round
            16). In a region there from the start, so a screen reader hears
            it come: it arrives with no one having asked (review round 17).
            Not "the figures": over a board with nothing reviewed yet, there
            are none. */}
        <div role="status" data-testid="scoreboard-status">
          {board !== null && error !== "" ? (
            <div className="mb-4">
              <Problem>
                {asSentence(error)} What is shown is the last reading, and it is read again shortly.
              </Problem>
            </div>
          ) : null}
        </div>
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
            Add a project, start a ruleset from a template or from your own protocol, then pick two
            branches and run a review. What it finds, what it costs and which rules earn their place
            all appear here.
          </Empty>
        ) : (
          <div className="grid gap-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* What the CLI says the usage would cost at API prices: on a
                  subscription none of it is spent (D-250). */}
              <StatTile label="Cost equivalent" value={`$${board.spendUsd.toFixed(2)}`}>
                <Sparkline values={board.spendHistory} />
              </StatTile>
              <StatTile
                label="Reviews completed"
                value={String(board.reviewsCompleted)}
                note={
                  board.reviewsTotal > board.reviewsCompleted
                    ? `${board.reviewsTotal} in all`
                    : undefined
                }
              />
              <StatTile
                label="Precision"
                value={percent(board.precision)}
                note={
                  board.precision === null
                    ? "no proven finding decided yet"
                    : "confirmed of the proven findings decided"
                }
              />
              {/* Named for what is counted: the check also discards a proof
                  that quotes true code off the cited lines, which is no
                  invention (D-252). */}
              <StatTile
                label="Proofs discarded"
                value={percent(board.proofsDiscardedRate)}
                note={
                  board.proofsDiscardedRate === null
                    ? "nothing raised yet"
                    : "by the quotation check, of findings raised"
                }
              />
            </div>

            {/* Live before archive: something happening now outranks
                everything that already did. Hidden entirely when nothing is
                running, because an empty "live" panel is a dashboard
                claiming to have something to watch. */}
            {scan ? (
              <Widget
                label="Live scan"
                action={
                  <Link
                    href={`/reviews/${scan.id}`}
                    className="text-aside text-[var(--color-accent)] underline underline-offset-2"
                  >
                    Open scan view
                  </Link>
                }
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <Mono className="text-heading">
                    {scan.fromBranch} <span className="text-[var(--color-ink-faint)]">into</span>{" "}
                    {scan.intoBranch}
                  </Mono>
                  <span className="text-body text-[var(--color-ink-muted)]">
                    {scan.currentStage ? stageName(scan.currentStage) : "Preparing"}
                    {scan.currentStage && STAGE_ORDER.includes(scan.currentStage)
                      ? ` · stage ${STAGE_ORDER.indexOf(scan.currentStage) + 1} of up to ${STAGE_ORDER.length}`
                      : ""}
                  </span>
                  {scan.startedAt ? (
                    <span className="font-[family-name:var(--font-mono)] text-body tabular-nums">
                      {elapsed(scan.startedAt, now)} elapsed
                    </span>
                  ) : null}
                  <span className="font-[family-name:var(--font-mono)] text-body tabular-nums">
                    ${scan.costEquivalentUsd.toFixed(2)}
                  </span>
                </div>
                <div className="mt-3 flex gap-1.5" aria-hidden>
                  {STAGE_ORDER.map((stage, index) => {
                    const at = scan.currentStage ? STAGE_ORDER.indexOf(scan.currentStage) : 0;
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
                <ul className="grid gap-1" aria-label="Needs you">
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
                        {/* A row waiting on a Resume says more than a phone's
                            width holds: the wait goes under the line whole,
                            and the line is balanced, where it left its last
                            word alone on a second one (D-259). */}
                        <span className="flex flex-wrap gap-x-3 text-dense tabular-nums">
                          <span className="text-balance">{needsYouLine(row)}</span>
                          <span className="text-[var(--color-ink-muted)]">
                            {/* A wait is a span, so "waiting 2m", as a run's
                                elapsed time is said, not "waiting 2m ago". */}
                            {row.since === null ? "waiting" : `waiting ${elapsed(row.since, now)}`}
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
                      <th className="py-2 pr-2.5 pl-4 text-left font-medium">Branch pair</th>
                      <th className="px-2.5 py-2 text-left font-medium">Author</th>
                      <th className="px-2.5 py-2 text-right font-medium">Findings</th>
                      <th className="px-2.5 py-2 text-right font-medium whitespace-nowrap">
                        Cost equivalent
                      </th>
                      <th className="px-2.5 py-2 text-right font-medium">Took</th>
                      <th className="py-2 pr-4 pl-2.5 text-left font-medium">Status</th>
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
                        {/* The column that gives: it takes the room the others
                            leave and truncates, never widening the table,
                            down to a floor under which the card scrolls. At
                            a fixed 18rem the author's column pushed the
                            table 35px past its card at desk width (D-297).
                            The floor is lower beside the rule yield, where
                            the card is narrowest for its screen. */}
                        <td className="w-full max-w-0 min-w-[18rem] py-2 pr-2.5 pl-4 xl:min-w-[12rem]">
                          {/* The model rides under the pair, with the project:
                              as a column of its own it was the part that gave,
                              its id broken at the hyphens. The pair truncates,
                              whole in its title, as the reviews list's does. */}
                          <Link
                            href={`/reviews/${row.id}`}
                            title={`${row.fromBranch} into ${row.intoBranch}`}
                            className="block min-w-0"
                          >
                            <Mono className="block truncate">
                              {row.fromBranch} into {row.intoBranch}
                            </Mono>
                            <span className="block truncate text-aside text-[var(--color-ink-faint)]">
                              {row.projectName} ·{" "}
                              <span className="whitespace-nowrap">{row.model}</span>
                            </span>
                          </Link>
                        </td>
                        {/* Whose branch it was (WP-L, D-297): "You" by the
                            emails a branch list goes by, else the name the
                            commit was made with, the email in its title. A
                            review made before the author was kept has none. */}
                        <td className="px-2.5 py-2">
                          {row.author === null ? (
                            <span className="text-[var(--color-ink-muted)]">-</span>
                          ) : (
                            <span
                              title={row.author.email}
                              className={`block max-w-[9rem] truncate ${
                                row.mine ? "font-medium" : "text-[var(--color-ink-muted)]"
                              }`}
                            >
                              {row.mine ? "You" : row.author.name || row.author.email}
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums">
                          {row.total > 0 ? `${row.confirmed} of ${row.total}` : "-"}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums">
                          {row.costUsd > 0 ? `$${row.costUsd.toFixed(2)}` : "-"}
                        </td>
                        {/* "last run" and the time each whole: one word to a
                            line on a phone read as noise, and one line at
                            desk width pushed the table past its card. */}
                        <td className="px-2.5 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">
                          {duration(row.durationMs, row.ranBefore).length === 0
                            ? "-"
                            : duration(row.durationMs, row.ranBefore).map((part, index) => (
                                <Fragment key={part}>
                                  {index > 0 ? " " : null}
                                  <span className="whitespace-nowrap">{part}</span>
                                </Fragment>
                              ))}
                        </td>
                        {/* One line: "awaiting your decision" broke over three
                            on a phone, where the table scrolls sideways. */}
                        <td className="py-2 pr-4 pl-2.5 whitespace-nowrap">
                          <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {board.identitiesProblem ? (
                  <p className="border-t border-[var(--color-border)] px-4 py-2 text-aside text-[var(--color-critical)]">
                    Which of these branches are yours is not known, because git&apos;s config could
                    not be read: {board.identitiesProblem}
                  </p>
                ) : null}
              </Card>

              <Card className="self-start p-4">
                <h2 className="text-heading font-semibold">Rule yield</h2>
                <p className="mt-1 text-aside text-[var(--color-ink-muted)]">
                  How often each rule&apos;s findings are confirmed. A rule that fires and is never
                  confirmed is costing review attention for nothing.
                </p>
                {board.ruleYield.length === 0 ? (
                  <p className="mt-3 text-aside text-[var(--color-ink-faint)]">
                    No finding has cited a rule yet.
                  </p>
                ) : (
                  <ul className="mt-3 grid gap-2">
                    {board.ruleYield.slice(0, RULES_LISTED).map((rule, index) => {
                      const share = rule.confirmed / rule.total;
                      return (
                        // The place in the list is the key: a rule is its
                        // ruleset and its number, and two rulesets since
                        // deleted can have had one name.
                        <li key={index} className="text-dense">
                          <div className="flex items-baseline justify-between gap-2">
                            {/* With its ruleset: a number names a rule in
                                one ruleset, not across them (AF3). */}
                            <span
                              className="min-w-0 truncate"
                              title={rule.rulesetName ? rule.rulesetName : undefined}
                            >
                              <span>Rule {rule.ruleCode}</span>
                              {rule.rulesetName ? (
                                <span className="text-aside text-[var(--color-ink-muted)]">
                                  {" "}
                                  in {rule.rulesetName}
                                </span>
                              ) : null}
                            </span>
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
                {/* The list arrives worst yield first, so the ones left out
                    are the rules confirmed most often. */}
                {board.ruleYield.length > RULES_LISTED ? (
                  <p
                    className="mt-3 text-aside text-[var(--color-ink-muted)]"
                    data-testid="rules-not-listed"
                  >
                    The {RULES_LISTED} confirmed least often, of {board.ruleYield.length} rules
                    cited.
                  </p>
                ) : null}
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
                          {/* "no findings" is a result, said only of a review
                              that ran to one: beside a pause or a failure it
                              read as a clean review (AE16). */}
                          {project.latest.total > 0 ? (
                            <span className="text-[var(--color-ink-muted)] tabular-nums">
                              {project.latest.confirmed} of {project.latest.total} confirmed
                            </span>
                          ) : project.latest.status === "awaiting_confirmation" ||
                            project.latest.status === "complete" ? (
                            <span className="text-[var(--color-ink-muted)]">no findings</span>
                          ) : null}
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
