"use client";

/**
 * What a project's own checks found, decided as code findings are (WP-I,
 * D-197): a failing install, test or e2e command, its output where the code
 * would be. Above the queue, so a red suite is seen before the first line
 * of code is.
 */

import { useState } from "react";
import { Badge, Button, Card, Input, Mono, Problem, severityTone } from "@/components/ui";
import { send } from "@/components/request";

export interface CheckFindingRow {
  id: string;
  kind: string;
  step: string | null;
  command: string | null;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string | null;
  /**
   * The screenshot a design finding is about, by its name under the
   * review's screenshots, and its grade (WP-I step 4).
   */
  screenshotPath: string | null;
  grade: string | null;
  severity: string;
  issue: string;
  evidence: string;
  status: string;
  verificationNote: string | null;
  dismissReason: string | null;
  /** What it was when a person dismissed it: an open question is left out (D-190). */
  dismissedFrom?: string | null;
}

const UNDECIDED = new Set(["verified", "open_question"]);

export function isUndecidedCheck(row: CheckFindingRow): boolean {
  return UNDECIDED.has(row.status);
}

function CheckFindingCard({
  row,
  deciding,
  onChanged,
}: {
  row: CheckFindingRow;
  deciding: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [imageGone, setImageGone] = useState(false);
  // An open question is left out unproven, not judged harmless (D-190), as
  // in the code queue.
  const open = row.status === "open_question";
  const leftOut = row.status === "dismissed" && row.dismissedFrom === "open_question";
  const screenshotUrl = `/api/check-findings/${row.id}/screenshot`;
  const decide = async (action: "confirm" | "dismiss") => {
    setBusy(true);
    setProblem("");
    try {
      const sent = await send(
        `/api/check-findings/${row.id}/${action}`,
        {
          method: "POST",
          ...(action === "dismiss" ? { body: JSON.stringify({ reason }) } : {}),
        },
        action === "confirm" ? "It could not be confirmed" : "It could not be dismissed",
      );
      if (!sent.ok) setProblem(sent.error);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="min-w-0 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>
        {row.status === "confirmed" ? <Badge tone="good">confirmed</Badge> : null}
        {open ? <Badge tone="question">open question</Badge> : null}
        {row.status === "dismissed" ? (
          <Badge tone="neutral">{leftOut ? "left out" : "dismissed"}</Badge>
        ) : null}
        {row.command ? (
          <Mono className="min-w-0 text-xs break-all text-[var(--color-ink-muted)]">
            {row.command}
          </Mono>
        ) : null}
      </div>
      <h3 className="mt-2 font-medium">{row.issue}</h3>
      {row.screenshotPath !== null ? (
        imageGone ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            The screenshot, <Mono className="break-all">{row.screenshotPath}</Mono>, could not be
            loaded: its review&apos;s files may have been removed.
          </p>
        ) : (
          // The screen itself, where a code finding shows its code: a grade
          // is only as good as the look a person can take at what was
          // graded. Capped here, so a full page opens whole on its own.
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshotUrl}
              alt={
                `The screen ${row.screenshotPath}` +
                (row.grade ? `, graded ${row.grade}` : "") +
                `. What is off: ${row.evidence}`
              }
              onError={() => setImageGone(true)}
              className="mt-3 max-h-96 w-auto max-w-full rounded border border-[var(--color-border)] object-contain"
            />
            <a
              href={screenshotUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-[var(--color-accent)] underline underline-offset-2"
            >
              Open the screenshot full size
            </a>
          </>
        )
      ) : null}
      {/* A screen's grader says what is off in words, under the screen and
          before the second grader's note; set as command output it read as
          code and ran off a phone. */}
      {row.kind === "design" && row.evidence.trim() !== "" ? (
        <p className="mt-2 text-sm">
          <span className="font-medium">What is off: </span>
          {row.evidence}
        </p>
      ) : null}
      {row.verificationNote ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{row.verificationNote}</p>
      ) : null}
      {row.kind !== "design" && row.evidence.trim() !== "" ? (
        <pre
          tabIndex={0}
          role="group"
          aria-label="Where it failed"
          className="mt-3 max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs"
        >
          <code className="font-[family-name:var(--font-mono)]">{row.evidence}</code>
        </pre>
      ) : null}
      {row.logPath ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          The whole output: <Mono className="break-all">{row.logPath}</Mono>
        </p>
      ) : null}
      {row.dismissReason ? (
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
          {leftOut ? "Left out" : "Dismissed"}: {row.dismissReason}
        </p>
      ) : null}
      {problem ? (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      ) : null}
      {deciding && isUndecidedCheck(row) ? (
        <div className="mt-3 grid gap-2 border-t border-[var(--color-border)] pt-3">
          {open ? (
            // No Confirm, as the queue offers none for an open question
            // (D-185): said rather than a button that does nothing.
            <p className="text-sm text-[var(--color-ink-muted)]">
              The two graders did not agree, so this is not proven and cannot be confirmed. Left
              out, it is listed in the report as possibly real.
            </p>
          ) : (
            <div>
              {/* Named for its finding: two cards, a failing test run and a
                  failing e2e run, made two buttons named only Confirm. */}
              <Button
                variant="primary"
                aria-label={`Confirm: ${row.issue}`}
                disabled={busy}
                onClick={() => void decide("confirm")}
              >
                Confirm
              </Button>
            </div>
          )}
          {/* A form, as the queue's dismissal is, so Enter in the reason
              dismisses and the label names only its box (review round 7). */}
          <form
            className="grid gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim() !== "") void decide("dismiss");
            }}
          >
            <label htmlFor={`dismiss-${row.id}`} className="text-sm font-medium">
              {open ? "Why leave it out?" : "Why is this not a problem?"}
            </label>
            <span className="flex gap-2">
              <Input
                id={`dismiss-${row.id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  row.kind === "design"
                    ? "A layout agreed with design"
                    : "A flaky test, tracked elsewhere"
                }
              />
              <Button
                type="submit"
                // "Leave out" broke over two lines beside the reason's box.
                className="shrink-0 whitespace-nowrap"
                aria-label={`${open ? "Leave out" : "Dismiss"}: ${row.issue}`}
                disabled={busy || reason.trim() === ""}
              >
                {open ? "Leave out" : "Dismiss"}
              </Button>
            </span>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

export function CheckFindings({
  rows,
  deciding,
  onChanged,
}: {
  rows: CheckFindingRow[];
  /** While the review waits on a person; otherwise only read. */
  deciding: boolean;
  onChanged: () => void | Promise<void>;
}) {
  return (
    // Marked so the queue's keys leave it alone (review round 7).
    <section aria-label="Tests and design" data-check-findings className="mb-6">
      <h2 className="mb-1 text-heading font-semibold">Tests and design</h2>
      <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
        What the project&apos;s own checks found on this branch, decided as code findings are: a
        confirmed one is a finding in the report, and one dismissed or left out is listed there with
        your reason.
      </p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {rows.map((row) => (
          <li key={row.id}>
            <CheckFindingCard row={row} deciding={deciding} onChanged={onChanged} />
          </li>
        ))}
      </ul>
    </section>
  );
}
