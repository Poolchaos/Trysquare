"use client";

/**
 * The confirmation queue: the screen the whole app exists to reach.
 *
 * Designed for someone working through twenty findings, not admiring one. The
 * keyboard is the primary interface (D-16), because the mouse round trip per
 * finding is what makes a review feel like paperwork.
 *
 * Two panes, because deciding a finding is a comparison and a single column
 * makes it a scroll: the list on the left keeps the shape of the queue and
 * what has been decided, while the pane on the right holds everything the
 * decision needs at once. That includes the rule's verbatim text, since the
 * question being answered is usually whether the rule says what the engine
 * claims it says, and the diff hunk beside the file, since the question after
 * that is whether this change caused it.
 *
 * Decided findings stay in the list rather than vanishing, so the record of
 * what was dismissed and why stays on the page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, Mono, Problem, Textarea, severityTone } from "@/components/ui";

export interface Finding {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: string;
  ruleCode: string | null;
  issue: string;
  comment: string;
  editedComment: string | null;
  mechanism: string;
  quotedCode: string;
  status: string;
  verificationNote: string | null;
  dismissReason: string | null;
}

interface SnapshotRule {
  code: string;
  title: string;
  severity: string;
  group: string;
  raw: string;
}

interface FileContext {
  lines: { number: number; text: string }[];
  hunk: { header: string; lines: string[] } | null;
}

const UNDECIDED = new Set(["verified", "open_question"]);

/** Worst first: a queue is worked from the top, so the top must be the worst. */
const SEVERITY_ORDER = ["CRITICAL", "WARNING", "NITPICK"];

function severityRank(severity: string): number {
  const rank = SEVERITY_ORDER.indexOf(severity.toUpperCase());
  // An unrecognised severity sorts last rather than first: inventing urgency
  // for something the protocol did not classify would be the worse guess.
  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

export function ConfirmationQueue({
  reviewId,
  findings,
  onChanged,
}: {
  reviewId: string;
  findings: Finding[];
  onChanged: () => void | Promise<void>;
}) {
  // Grouped by severity, and that grouping is the order j and k walk, so what
  // the eye follows and what the keyboard follows are the same sequence.
  const queue = findings
    .filter((finding) => finding.status !== "killed")
    .slice()
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        a.filePath.localeCompare(b.filePath) ||
        a.lineStart - b.lineStart,
    );
  const undecided = queue.filter((finding) => UNDECIDED.has(finding.status));

  const [selected, setSelected] = useState(0);
  // Keyed by finding, exactly like the drafts below. One shared string meant
  // typing a reason on one finding, moving on, and dismissing a different one
  // with it: a permanent record of why something was not a problem, written
  // about something else.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // What is open is recorded per finding id rather than as a bare flag, so
  // moving the selection closes everything for free instead of needing an
  // effect to reset it behind the cursor.
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [contextFor, setContextFor] = useState<string | null>(null);
  const [context, setContext] = useState<{ forId: string; data: FileContext } | null>(null);
  const [rules, setRules] = useState<SnapshotRule[]>([]);
  const [ruleOpenFor, setRuleOpenFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  // The first half of a `g g`. Held in a ref because a pending key is not
  // something the screen renders.
  const pendingG = useRef(false);

  const current = queue[Math.min(selected, Math.max(queue.length - 1, 0))];
  const currentRule = rules.find((rule) => rule.code === current?.ruleCode);
  const editing = current !== undefined && editingFor === current.id;
  const ruleOpen = current !== undefined && ruleOpenFor === current.id;
  const showContext = current !== undefined && contextFor === current.id;
  const shownContext = current && context?.forId === current.id ? context.data : null;
  const reason = current ? (reasons[current.id] ?? "") : "";

  // Fetched once per review rather than with each snapshot poll: the frozen
  // ruleset cannot change while the review is being decided.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/reviews/${reviewId}/rules`);
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as { rules: SnapshotRule[] };
      if (!cancelled) setRules(body.rules);
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const act = useCallback(
    async (finding: Finding, action: "confirm" | "dismiss", detail?: string) => {
      setError("");
      setBusy(true);
      try {
        const response = await fetch(`/api/findings/${finding.id}/${action}`, {
          method: "POST",
          body: JSON.stringify(
            action === "dismiss" ? { reason: detail } : { comment: detail ?? "" },
          ),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          setError(body.error ?? "The decision could not be recorded.");
          return;
        }
        setEditingFor(null);
        setDrafts((all) => {
          const rest = { ...all };
          delete rest[finding.id];
          return rest;
        });
        setReasons((all) => {
          const rest = { ...all };
          delete rest[finding.id];
          return rest;
        });
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

  // Fetches the code around the finding whose context pane is open, once per
  // finding. State changes only in the fetch callback, never synchronously.
  useEffect(() => {
    if (!current || contextFor !== current.id || context?.forId === current.id) return;
    const { id, filePath, lineStart } = current;
    let cancelled = false;
    void (async () => {
      const response = await fetch(
        `/api/reviews/${reviewId}/context?path=${encodeURIComponent(filePath)}&line=${lineStart}`,
      );
      const data = response.ok
        ? ((await response.json()) as FileContext)
        : { lines: [], hunk: null };
      if (!cancelled) setContext({ forId: id, data });
    })();
    return () => {
      cancelled = true;
    };
  }, [contextFor, current, context?.forId, reviewId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Typing a reason or a comment must not also drive the queue.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        if (event.key === "Escape") target.blur();
        return;
      }
      if (!current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A held key must not walk the queue deciding findings nobody read, and
      // a decision in flight must not be sent twice: the second lands on a
      // finding the first already moved, and the report's whole premise is
      // that a person accepted each one.
      if (event.repeat) return;

      const wasPendingG = pendingG.current;
      pendingG.current = false;

      if (event.key === "g") {
        if (wasPendingG) setSelected(0);
        else pendingG.current = true;
      } else if (event.key === "j") setSelected((index) => Math.min(index + 1, queue.length - 1));
      else if (event.key === "k") setSelected((index) => Math.max(index - 1, 0));
      else if (event.key === "G") setSelected(queue.length - 1);
      else if (event.key === "c" && UNDECIDED.has(current.status)) {
        if (!busy) void act(current, "confirm", drafts[current.id]);
      } else if (event.key === "d" && UNDECIDED.has(current.status)) {
        reasonRef.current?.focus();
      } else if (event.key === "e" && UNDECIDED.has(current.status)) {
        setEditingFor(current.id);
        // After the textarea exists, or there is nothing to focus.
        queueMicrotask(() => editRef.current?.focus());
      } else if (event.key === "Enter") {
        setContextFor((open) => (open === current.id ? null : current.id));
      } else return;

      event.preventDefault();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, busy, current, drafts, queue.length]);

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
  const draft = current ? (drafts[current.id] ?? current.editedComment ?? current.comment) : "";

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-48 flex-1">
          <h2 className="text-sm font-semibold" aria-live="polite">
            {decided} of {queue.length} decided
          </h2>
          <div
            role="progressbar"
            aria-valuenow={decided}
            aria-valuemin={0}
            aria-valuemax={queue.length}
            aria-label="Findings decided"
            className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
          >
            <div
              className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
              style={{ width: `${queue.length === 0 ? 0 : (decided / queue.length) * 100}%` }}
            />
          </div>
        </div>
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

      {/* Named rather than read out wholesale: moving through a queue should
          announce which finding is now active, not recite its whole card. */}
      <p className="sr-only" aria-live="polite">
        {current
          ? `Finding ${selected + 1} of ${queue.length}. ${current.severity}. ` +
            `${current.filePath} line ${current.lineStart}. ${current.issue}`
          : "No findings."}
      </p>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="Findings" tabIndex={0} className="lg:max-h-[42rem] lg:overflow-y-auto">
          {SEVERITY_ORDER.filter((severity) =>
            queue.some((finding) => finding.severity.toUpperCase() === severity),
          ).map((severity) => (
            <div key={severity} className="mb-3">
              <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                {severity}
                <span className="tabular-nums">
                  ({queue.filter((finding) => finding.severity.toUpperCase() === severity).length})
                </span>
              </h3>
              <ul className="grid gap-1">
                {queue.map((finding, index) =>
                  finding.severity.toUpperCase() === severity ? (
                    <li key={finding.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(index)}
                        aria-current={index === selected ? "true" : undefined}
                        className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                          index === selected
                            ? "border-[var(--color-accent)] bg-[var(--color-surface-raised)]"
                            : "border-transparent hover:bg-[var(--color-surface-sunken)]"
                        }`}
                      >
                        <StateChip status={finding.status} />
                        <span className="min-w-0 flex-1">
                          <Mono className="block truncate text-[var(--color-ink-muted)]">
                            {finding.filePath}:{finding.lineStart}
                          </Mono>
                          <span className="block truncate">{finding.issue}</span>
                        </span>
                      </button>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          ))}
        </nav>

        {current ? (
          <Card className="min-w-0 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={severityTone(current.severity)}>{current.severity}</Badge>
              {current.status === "open_question" ? (
                <Badge tone="question">open question</Badge>
              ) : null}
              {current.status === "confirmed" ? <Badge tone="good">confirmed</Badge> : null}
              {current.status === "dismissed" ? <Badge tone="neutral">dismissed</Badge> : null}
              <Mono className="text-xs text-[var(--color-ink-muted)]">
                {current.filePath}:{current.lineStart}
                {current.lineEnd > current.lineStart ? `-${current.lineEnd}` : ""}
              </Mono>
            </div>

            <h3 className="mt-2 font-medium">{current.issue}</h3>

            {editing ? (
              <div className="mt-2">
                <label className="mb-1 block text-xs font-medium" htmlFor={`comment-${current.id}`}>
                  Comment, as it will appear in the report
                </label>
                <Textarea
                  id={`comment-${current.id}`}
                  ref={editRef}
                  rows={4}
                  value={draft}
                  onChange={(event) =>
                    setDrafts((all) => ({ ...all, [current.id]: event.target.value }))
                  }
                />
                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                  The engine&apos;s own wording is kept either way; it is how the prompts get
                  judged.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {current.editedComment ?? current.comment}
                {current.editedComment ? (
                  <span className="ml-2 text-xs text-[var(--color-ink-faint)]">(edited)</span>
                ) : null}
              </p>
            )}

            {current.mechanism ? (
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                How it fails: {current.mechanism}
              </p>
            ) : null}

            {current.verificationNote ? (
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                Verification: {current.verificationNote}
              </p>
            ) : null}

            {current.dismissReason ? (
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                Dismissed: {current.dismissReason}
              </p>
            ) : null}

            {current.ruleCode ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setRuleOpenFor(ruleOpen ? null : current.id)}
                  aria-expanded={ruleOpen}
                  className="text-xs text-[var(--color-ink-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
                >
                  Rule {current.ruleCode}
                  {currentRule ? `: ${currentRule.title}` : ""}
                </button>
                {ruleOpen ? (
                  <pre
                    tabIndex={0}
                    role="group"
                    aria-label={`Rule ${current.ruleCode} in full`}
                    className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs whitespace-pre-wrap"
                  >
                    <code className="font-[family-name:var(--font-mono)]">
                      {currentRule?.raw ??
                        "This rule is not in the ruleset the review was frozen with."}
                    </code>
                  </pre>
                ) : null}
              </div>
            ) : null}

            {current.quotedCode ? (
              <pre className="mt-3 overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs">
                <code className="font-[family-name:var(--font-mono)]">{current.quotedCode}</code>
              </pre>
            ) : null}

            {showContext ? (
              <div className="mt-3 grid gap-3">
                {shownContext?.hunk ? (
                  <div>
                    <h4 className="mb-1 text-xs font-medium">What the change did here</h4>
                    <pre
                      tabIndex={0}
                      role="group"
                      aria-label="The change at this line"
                      className="max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs"
                    >
                      <code className="font-[family-name:var(--font-mono)]">
                        <span className="block text-[var(--color-ink-faint)]">
                          {shownContext.hunk.header}
                        </span>
                        {shownContext.hunk.lines.map((line, index) => (
                          <span
                            key={index}
                            className={`block ${
                              line.startsWith("+")
                                ? "text-[var(--color-good)]"
                                : line.startsWith("-")
                                  ? "text-[var(--color-critical)]"
                                  : ""
                            }`}
                          >
                            {line}
                          </span>
                        ))}
                      </code>
                    </pre>
                  </div>
                ) : null}

                <div>
                  <h4 className="mb-1 text-xs font-medium">The file as it stands</h4>
                  <pre
                    tabIndex={0}
                    role="group"
                    aria-label="The file around this finding"
                    className="max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs"
                  >
                    <code className="font-[family-name:var(--font-mono)]">
                      {shownContext === null
                        ? "Reading the file..."
                        : shownContext.lines.length === 0
                          ? "The checkout is no longer available for this review."
                          : shownContext.lines.map((line) => (
                              <span
                                key={line.number}
                                className={`block ${
                                  line.number >= current.lineStart && line.number <= current.lineEnd
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
                </div>
              </div>
            ) : null}

            {UNDECIDED.has(current.status) ? (
              <div className="mt-4 grid gap-3 border-t border-[var(--color-border)] pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void act(current, "confirm", drafts[current.id])}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => setEditingFor(editing ? null : current.id)}
                  >
                    {editing ? "Stop editing" : "Edit comment"}
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => setContextFor(showContext ? null : current.id)}
                  >
                    {showContext ? "Hide code" : "Show code"}
                  </Button>
                </div>

                <form
                  className="grid gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(current, "dismiss", reason);
                  }}
                >
                  <label className="text-xs font-medium" htmlFor={`dismiss-reason-${current.id}`}>
                    Why is this not a problem?
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id={`dismiss-reason-${current.id}`}
                      ref={reasonRef}
                      value={reason}
                      onChange={(event) =>
                        setReasons((all) => ({ ...all, [current.id]: event.target.value }))
                      }
                      placeholder="Why is this not a problem?"
                      className="min-w-40 flex-1"
                    />
                    <Button type="submit" disabled={busy || reason.trim() === ""}>
                      Dismiss
                    </Button>
                  </div>
                </form>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>

      <footer className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--color-ink-faint)]">
        <Key label="j / k" action="next / previous" />
        <Key label="c" action="confirm" />
        <Key label="d" action="dismiss" />
        <Key label="e" action="edit comment" />
        <Key label="enter" action="show code" />
        <Key label="g g" action="first" />
        <Key label="G" action="last" />
      </footer>
    </section>
  );
}

function StateChip({ status }: { status: string }) {
  const label = { confirmed: "in report", dismissed: "dropped", open_question: "?" }[status] ?? "";
  if (label === "") {
    return (
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-border-strong)]"
      />
    );
  }
  return (
    <span className="shrink-0 rounded border border-[var(--color-border)] px-1 py-0.5 text-[0.65rem] text-[var(--color-ink-muted)]">
      {label}
    </span>
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
