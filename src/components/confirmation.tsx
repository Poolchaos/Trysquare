"use client";

/**
 * The confirmation queue: the screen the whole app exists to reach.
 *
 * Designed for someone working through twenty findings, not admiring one. The
 * keyboard is the primary interface (j and k to move, c to confirm, d to
 * dismiss, enter for the code around it), because the mouse round trip per
 * finding is what makes a review feel like paperwork. Decided findings
 * collapse to a single line rather than vanishing, so the record of what was
 * dismissed and why stays on the page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Mono, Problem, severityTone } from "@/components/ui";

export interface Finding {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: string;
  ruleCode: string | null;
  issue: string;
  comment: string;
  mechanism: string;
  quotedCode: string;
  status: string;
  verificationNote: string | null;
  dismissReason: string | null;
}

interface ContextLines {
  lines: { number: number; text: string }[];
}

const UNDECIDED = new Set(["verified", "open_question"]);

export function ConfirmationQueue({
  reviewId,
  findings,
  onChanged,
}: {
  reviewId: string;
  findings: Finding[];
  onChanged: () => void | Promise<void>;
}) {
  const queue = findings.filter((finding) => finding.status !== "killed");
  const undecided = queue.filter((finding) => UNDECIDED.has(finding.status));

  const [selected, setSelected] = useState(0);
  const [reason, setReason] = useState("");
  const [openContext, setOpenContext] = useState<string | null>(null);
  const [context, setContext] = useState<ContextLines | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);

  const current = queue[selected];

  const act = useCallback(
    async (finding: Finding, action: "confirm" | "dismiss", withReason?: string) => {
      setError("");
      setBusy(true);
      try {
        const response = await fetch(`/api/findings/${finding.id}/${action}`, {
          method: "POST",
          body: JSON.stringify(action === "dismiss" ? { reason: withReason } : {}),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          setError(body.error ?? "The decision could not be recorded.");
          return;
        }
        setReason("");
        await onChanged();
        // Moves to the next undecided finding rather than the next row, which
        // is what someone working down the queue actually wants.
        setSelected((index) => {
          const next = queue.findIndex(
            (row, position) => position > index && UNDECIDED.has(row.status),
          );
          return next === -1 ? index : next;
        });
      } finally {
        setBusy(false);
      }
    },
    [onChanged, queue],
  );

  const loadContext = useCallback(
    async (finding: Finding) => {
      if (openContext === finding.id) {
        setOpenContext(null);
        return;
      }
      setOpenContext(finding.id);
      setContext(null);
      const response = await fetch(
        `/api/reviews/${reviewId}/context?path=${encodeURIComponent(finding.filePath)}&line=${finding.lineStart}`,
      );
      setContext(response.ok ? ((await response.json()) as ContextLines) : { lines: [] });
    },
    [openContext, reviewId],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Typing a reason must not also drive the queue.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        if (event.key === "Escape") target.blur();
        return;
      }
      if (!current) return;

      if (event.key === "j") setSelected((index) => Math.min(index + 1, queue.length - 1));
      else if (event.key === "k") setSelected((index) => Math.max(index - 1, 0));
      else if (event.key === "G") setSelected(queue.length - 1);
      else if (event.key === "c" && UNDECIDED.has(current.status)) void act(current, "confirm");
      else if (event.key === "d" && UNDECIDED.has(current.status)) reasonRef.current?.focus();
      else if (event.key === "Enter") void loadContext(current);
      else return;

      event.preventDefault();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, current, loadContext, queue.length]);

  async function complete() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/reviews/${reviewId}/complete`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "The review could not be completed.");
        return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const decided = queue.length - undecided.length;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {decided} of {queue.length} decided
        </h2>
        <Button
          variant="primary"
          onClick={() => void complete()}
          disabled={undecided.length > 0 || busy}
          title={
            undecided.length > 0
              ? `${undecided.length} finding(s) still need a decision`
              : "Close the review and write the report"
          }
        >
          Complete review
        </Button>
      </header>

      {error ? (
        <div className="mb-3">
          <Problem>{error}</Problem>
        </div>
      ) : null}

      <ul className="grid gap-2">
        {queue.map((finding, index) => {
          const isCurrent = index === selected;
          const isDecided = !UNDECIDED.has(finding.status);

          if (isDecided) {
            return (
              <li key={finding.id}>
                <Card
                  className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${
                    isCurrent ? "border-[var(--color-accent)]" : ""
                  }`}
                >
                  <Badge tone={finding.status === "confirmed" ? "good" : "neutral"}>
                    {finding.status}
                  </Badge>
                  <Mono className="text-xs text-[var(--color-ink-muted)]">
                    {finding.filePath}:{finding.lineStart}
                  </Mono>
                  <span className="min-w-0 truncate text-[var(--color-ink-muted)]">
                    {finding.issue}
                  </span>
                  {finding.dismissReason ? (
                    <span className="w-full text-xs text-[var(--color-ink-faint)]">
                      Dismissed: {finding.dismissReason}
                    </span>
                  ) : null}
                </Card>
              </li>
            );
          }

          return (
            <li key={finding.id}>
              <Card
                className={`p-4 ${isCurrent ? "border-[var(--color-accent)]" : ""}`}
                aria-current={isCurrent ? "true" : undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
                  {finding.status === "open_question" ? (
                    <Badge tone="question">open question</Badge>
                  ) : null}
                  {finding.ruleCode ? (
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      rule {finding.ruleCode}
                    </span>
                  ) : null}
                  <Mono className="text-xs text-[var(--color-ink-muted)]">
                    {finding.filePath}:{finding.lineStart}
                  </Mono>
                </div>

                <p className="mt-2 font-medium">{finding.issue}</p>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{finding.comment}</p>
                {finding.mechanism ? (
                  <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                    How it fails: {finding.mechanism}
                  </p>
                ) : null}

                {finding.quotedCode ? (
                  <pre className="mt-3 overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs">
                    <code className="font-[family-name:var(--font-mono)]">
                      {finding.quotedCode}
                    </code>
                  </pre>
                ) : null}

                {openContext === finding.id ? (
                  <pre className="mt-2 max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs">
                    <code className="font-[family-name:var(--font-mono)]">
                      {context === null
                        ? "Reading the file..."
                        : context.lines.length === 0
                          ? "The checkout is no longer available for this review."
                          : context.lines.map((line) => (
                              <span
                                key={line.number}
                                className={`block ${
                                  line.number >= finding.lineStart && line.number <= finding.lineEnd
                                    ? "bg-[var(--color-accent-soft)]"
                                    : ""
                                }`}
                              >
                                <span className="mr-3 inline-block w-10 text-right text-[var(--color-ink-faint)]">
                                  {line.number}
                                </span>
                                {line.text}
                              </span>
                            ))}
                    </code>
                  </pre>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void act(finding, "confirm")}
                  >
                    Confirm
                  </Button>
                  <Button variant="quiet" onClick={() => void loadContext(finding)}>
                    {openContext === finding.id ? "Hide code" : "Show code"}
                  </Button>
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(finding, "dismiss", reason);
                    }}
                  >
                    <input
                      ref={isCurrent ? reasonRef : undefined}
                      value={isCurrent ? reason : ""}
                      onChange={(event) => {
                        setSelected(index);
                        setReason(event.target.value);
                      }}
                      placeholder="Why is this not a problem?"
                      className="min-w-40 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                    />
                    <Button
                      type="submit"
                      disabled={busy || (isCurrent ? reason.trim() === "" : true)}
                    >
                      Dismiss
                    </Button>
                  </form>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <footer className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--color-ink-faint)]">
        <Key label="j / k" action="move" />
        <Key label="c" action="confirm" />
        <Key label="d" action="dismiss" />
        <Key label="enter" action="show code" />
        <Key label="G" action="last" />
      </footer>
    </section>
  );
}

function Key({ label, action }: { label: string; action: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-[family-name:var(--font-mono)]">
        {label}
      </kbd>
      {action}
    </span>
  );
}
