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

const STAGES = [
  ["s1_risk", "Risk"],
  ["s2_comprehension", "Comprehension"],
  ["s3_adversarial", "Adversarial"],
  ["s4_deletions", "Deletions"],
  ["s5_verification", "Verification"],
] as const;

interface Snapshot {
  review: {
    id: string;
    status: string;
    fromBranch: string;
    intoBranch: string;
    fromCommit: string;
    model: string;
    effort: string;
    intent: string | null;
    pausedReason: string | null;
    usageInputTokens: number;
    usageOutputTokens: number;
    usageCacheReadTokens: number;
    costEquivalentUsd: number;
  };
  stages: { stage: string; status: string; attempt: number }[];
  notes: { kind: string; message: string; at: string }[];
  findings: Finding[];
  running: boolean;
}

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<string[]>([]);

  async function reload() {
    const response = await fetch(`/api/reviews/${id}`);
    if (response.ok) setSnapshot((await response.json()) as Snapshot);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/reviews/${id}`);
      if (response.ok && !cancelled) setSnapshot((await response.json()) as Snapshot);
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

      // Durable facts are written before they are announced, so a read here
      // always finds the row already changed.
      if (parsed.kind === "status" || parsed.kind === "done") void reload();
    });

    source.onerror = () => source.close();
    return () => {
      cancelled = true;
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!snapshot) return <PageBody>Loading...</PageBody>;

  const { review, findings } = snapshot;
  const done = new Set(
    snapshot.stages.filter((row) => row.status === "succeeded").map((r) => r.stage),
  );
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
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{finding.comment}</p>
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
            <Badge tone={statusTone(review.status)}>{review.status.replace(/_/g, " ")}</Badge>
            <Sha value={review.fromCommit} />
            <span>{review.model}</span>
            <span>effort {review.effort}</span>
          </span>
        }
        actions={
          snapshot.running ? (
            <Button
              onClick={async () => {
                await fetch(`/api/reviews/${id}/cancel`, { method: "POST" });
                await reload();
              }}
            >
              Cancel
            </Button>
          ) : null
        }
      />
      <PageBody>
        {review.pausedReason ? <Problem>{review.pausedReason}</Problem> : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <Card className="mb-6 p-4">
              <ol className="grid gap-1.5">
                {STAGES.map(([stage, label]) => {
                  const finished = done.has(stage);
                  const current = snapshot.running && !finished && done.size > 0;
                  return (
                    <li key={stage} className="flex items-center gap-3 text-sm">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          finished
                            ? "bg-[var(--color-good)]"
                            : current
                              ? "bg-[var(--color-accent)] pulse"
                              : "bg-[var(--color-border-strong)]"
                        }`}
                      />
                      <span className={finished ? "" : "text-[var(--color-ink-muted)]"}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Card>

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

            {live.length > 0 ? (
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold">Activity</h2>
                <ul className="max-h-64 overflow-y-auto text-xs text-[var(--color-ink-muted)]">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
