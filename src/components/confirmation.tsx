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
import { z } from "zod";
import { Badge, Button, Card, Input, Mono, Problem, Textarea, severityTone } from "@/components/ui";
import { send } from "@/components/request";

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
  /** The finder's severity, when the verifier's replaced it (PG-3, D-185). */
  raisedSeverity?: string | null;
  /** The verifier's proof as stored, read by proofOf. */
  proofJson?: string | null;
}

const proofSchema = z.object({
  trigger: z.string(),
  evidence: z.array(
    z.object({ path: z.string(), lineStart: z.number(), lineEnd: z.number(), quote: z.string() }),
  ),
  guardsSearched: z.array(z.string()),
});

/**
 * How the verifier proved a finding, every step already checked against the
 * code (proof-and-steps plan, WP-C); null for a finding without one.
 */
function proofOf(finding: Finding): z.infer<typeof proofSchema> | null {
  if (!finding.proofJson) return null;
  try {
    const parsed = proofSchema.safeParse(JSON.parse(finding.proofJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
  /** The change deleted the file, so the checkout has no copy of it. */
  deleted?: boolean;
  /** Why the checkout's copy could not be read, its hunk still shown. */
  readError?: string;
  /** The new name of a file the finding cites by its old one. */
  renamedTo?: string;
  /** A link the change made, leading out of the checkout: never read. */
  outside?: boolean;
  /** A link the change made to something that is not there. */
  brokenLink?: boolean;
}

const UNDECIDED = new Set(["verified", "open_question"]);
// Only a proven finding can go into the report; an open question can only
// be dismissed (PG-2 (a), D-185).
const CONFIRMABLE = new Set(["verified"]);

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
  onCheckoutLeft,
}: {
  reviewId: string;
  findings: Finding[];
  onChanged: () => void | Promise<void>;
  /** Completed, but the review's checkout would not go: the server's note saying so. */
  onCheckoutLeft: (note: string) => void;
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
  // The error rides with the read it came from: a failed read was taken
  // for an empty file, and the pane said "The checkout is no longer
  // available for this review", untrue for a 500 or a refused path (D-138).
  const [context, setContext] = useState<{
    forId: string;
    data: FileContext;
    error?: string;
  } | null>(null);
  // Null until read, so a read in flight is not mistaken for a rule missing
  // from the ruleset (D-138).
  const [rules, setRules] = useState<SnapshotRule[] | null>(null);
  // Why the frozen rules could not be read. Dropped, the panel said a cited
  // rule "is not in the ruleset the review was frozen with", which was
  // untrue, on the screen where findings are decided (D-137).
  const [rulesProblem, setRulesProblem] = useState("");
  const [rulesAttempt, setRulesAttempt] = useState(0);
  const [ruleOpenFor, setRuleOpenFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  // The first half of a `g g`. Held in a ref because a pending key is not
  // something the screen renders.
  const pendingG = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const completeRef = useRef<HTMLButtonElement>(null);

  // The last decision took the focused control with it and focus fell to the
  // page, leaving the keyboard nowhere to go (5.14, audit U12). Complete
  // review is where the work goes next; it takes the focus once the decision
  // has settled and the button is on, unless the person has gone elsewhere.
  const lastDecided = useRef(false);
  const wereUndecided = useRef(undecided.length > 0);
  useEffect(() => {
    // A decision undone before the last one settled leaves nothing to move to.
    if (undecided.length > 0) lastDecided.current = false;
    else if (wereUndecided.current) lastDecided.current = true;
    wereUndecided.current = undecided.length > 0;
    if (!lastDecided.current || busy) return;
    lastDecided.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      completeRef.current?.focus();
    }
  }, [undecided.length, busy]);

  // A mouse click on one of the queue's buttons leaves no focus on it, so the
  // keyboard drives the queue after the mouse has been used: kept on a
  // clicked row, Enter re-clicked that row, the selection jumped back to it
  // and no code opened (review of 5.1 to 5.4). A click from the keyboard
  // reports no click count and keeps its focus.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    function onClick(event: MouseEvent) {
      if (event.detail === 0) return;
      (event.target as HTMLElement | null)?.closest("button")?.blur();
    }
    section.addEventListener("click", onClick);
    return () => section.removeEventListener("click", onClick);
  }, []);
  // Counts every move a person makes through the queue, so a decision whose
  // reply lands later can tell whether they went somewhere in the meantime.
  const moves = useRef(0);
  const focusedAtMove = useRef<Element | null>(null);
  const moveTo = useCallback((next: number | ((index: number) => number)) => {
    moves.current += 1;
    focusedAtMove.current = document.activeElement;
    setSelected(next);
  }, []);

  const current = queue[Math.min(selected, Math.max(queue.length - 1, 0))];
  const currentProof = current ? proofOf(current) : null;
  // An open question is left out unproven, not judged harmless (D-190).
  const reasonQuestion =
    current?.status === "open_question" ? "Why leave it out?" : "Why is this not a problem?";

  // A move onto a finding without the control that had the focus, Confirm
  // onto an open question, took the control away and the focus fell to the
  // page, so Tab began again from the top (review round R8). The finding's
  // title takes it instead.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const before = focusedAtMove.current;
    focusedAtMove.current = null;
    if (before && before !== document.body && !before.isConnected) titleRef.current?.focus();
  }, [current?.id]);
  const currentRule = rules?.find((rule) => rule.code === current?.ruleCode);
  const editing = current !== undefined && editingFor === current.id;
  const ruleOpen = current !== undefined && ruleOpenFor === current.id;
  const showContext = current !== undefined && contextFor === current.id;
  const shownContext = current && context?.forId === current.id ? context.data : null;
  const contextError = current && context?.forId === current.id ? context.error : undefined;
  const reason = current ? (reasons[current.id] ?? "") : "";

  // Fetched once per review rather than with each snapshot poll: the frozen
  // ruleset cannot change while the review is being decided.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sent = await send<{ rules: SnapshotRule[] }>(
        `/api/reviews/${reviewId}/rules`,
        {},
        "The review's rules could not be read",
      );
      if (cancelled) return;
      setRulesProblem(sent.ok ? "" : sent.error);
      if (sent.ok) setRules(sent.body.rules);
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewId, rulesAttempt]);

  const act = useCallback(
    async (finding: Finding, action: "confirm" | "dismiss", detail?: string) => {
      setError("");
      setBusy(true);
      const movesWhenSent = moves.current;
      try {
        // A request that never got an answer, the connection dropped or the
        // server gone, used to reject with nothing to catch it: the decision
        // vanished without a word, and the person took it as made.
        const response = await fetch(`/api/findings/${finding.id}/${action}`, {
          method: "POST",
          body: JSON.stringify(
            action === "dismiss" ? { reason: detail } : { comment: detail ?? "" },
          ),
        }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
        if (response instanceof Error) {
          setError(`The decision could not be sent: ${response.message}`);
          return;
        }
        if (!response.ok) {
          // A server error page is not JSON, and reading it as JSON threw
          // past this message, so the refusal went unsaid.
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "The decision could not be recorded.");
          // A review completed or cancelled elsewhere: shown as it now is,
          // rather than still offering decisions the server will refuse.
          if (response.status === 409) await onChanged();
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
        // is what someone working down the queue actually wants. Only if they
        // have not moved since the decision was sent: one who went elsewhere
        // while it was in flight keeps where they went, rather than being
        // taken away when the reply lands (seen on CI, run 39005536267, where
        // `g g` back to the same row was overridden).
        if (moves.current !== movesWhenSent) return;
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
      const sent = await send<FileContext>(
        `/api/reviews/${reviewId}/context?path=${encodeURIComponent(filePath)}&line=${lineStart}`,
        {},
        "The file could not be read",
      );
      if (cancelled) return;
      setContext(
        !sent.ok
          ? { forId: id, data: { lines: [], hunk: null }, error: sent.error }
          : sent.body.readError
            ? {
                forId: id,
                data: sent.body,
                error: `The file could not be read from the review's checkout: ${sent.body.readError}`,
              }
            : { forId: id, data: sent.body },
      );
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
      // Enter on a button, a link or a select is that element's own: the
      // queue's Enter, which opens the code pane, used to take it and cancel
      // it, so Enter on a focused Confirm confirmed nothing (5.4). A mouse
      // click leaves no focus on a queue button (below), so this is the
      // keyboard's case only.
      if (
        event.key === "Enter" &&
        target?.closest("button, a[href], select, summary, [role='button']")
      ) {
        pendingG.current = false;
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
        if (wasPendingG) moveTo(0);
        else pendingG.current = true;
      } else if (event.key === "j") moveTo((index) => Math.min(index + 1, queue.length - 1));
      else if (event.key === "k") moveTo((index) => Math.max(index - 1, 0));
      else if (event.key === "G") moveTo(queue.length - 1);
      // Shift+C, not a bare c: one stray lowercase keystroke confirmed the
      // finding in front of it, and no decision can be taken back (5.5,
      // MG-6, D-132). Shift decides, not the letter's case: Caps Lock turns
      // Shift+C into "c" and a bare c into "C".
      else if (
        event.shiftKey &&
        event.key.toLowerCase() === "c" &&
        CONFIRMABLE.has(current.status)
      ) {
        if (!busy) void act(current, "confirm", drafts[current.id]);
      } else if (event.key === "d" && UNDECIDED.has(current.status)) {
        reasonRef.current?.focus();
      } else if (event.key === "e" && CONFIRMABLE.has(current.status)) {
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
  }, [act, busy, current, drafts, moveTo, queue.length]);

  async function complete() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/reviews/${reviewId}/complete`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The review could not be completed.");
        if (response.status === 409) await onChanged();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { cleanupNote?: string };
      if (body.cleanupNote) onCheckoutLeft(body.cleanupNote);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const draft = current ? (drafts[current.id] ?? current.editedComment ?? current.comment) : "";

  return (
    <section ref={sectionRef}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {/* The decided count and its bar live in the page toolbar; what only
            this header can say is what remains, by severity. */}
        <p className="text-dense text-[var(--color-ink-muted)]" aria-live="polite">
          {undecided.length === 0
            ? `All ${queue.length} decided.`
            : SEVERITY_ORDER.filter((severity) =>
                undecided.some((finding) => finding.severity.toUpperCase() === severity),
              )
                .map(
                  (severity) =>
                    `${undecided.filter((finding) => finding.severity.toUpperCase() === severity).length} ${severity.toLowerCase()}`,
                )
                .join(", ") + " left to decide"}
        </p>
        <Button
          ref={completeRef}
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

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <nav aria-label="Findings" tabIndex={0} className="lg:max-h-[42rem] lg:overflow-y-auto">
          {SEVERITY_ORDER.filter((severity) =>
            queue.some((finding) => finding.severity.toUpperCase() === severity),
          ).map((severity) => (
            <div key={severity} className="mb-3">
              <h3 className="mb-1 flex items-center gap-2 font-[family-name:var(--font-mono)] text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
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
                        onClick={() => moveTo(index)}
                        aria-current={index === selected ? "true" : undefined}
                        className={`flex w-full items-stretch gap-2 overflow-hidden rounded-md border pr-2.5 text-left text-xs transition-colors ${
                          index === selected
                            ? "border-[var(--color-accent)] bg-[var(--color-surface-raised)]"
                            : "border-transparent hover:bg-[var(--color-surface-sunken)]"
                        }`}
                      >
                        {/* An element rather than a border utility: the
                            selected state sets a border colour on all four
                            sides, and which of the two wins would come down
                            to stylesheet order. */}
                        <span
                          aria-hidden
                          className={`w-0.5 shrink-0 self-stretch ${severityEdge(finding.severity)}`}
                        />
                        <span className="flex items-center gap-2 py-2">
                          <StateChip status={finding.status} />
                        </span>
                        <span className="min-w-0 flex-1 py-2">
                          {/* The path leads the row. A reviewer's first
                              question on any finding is where am I, and a
                              queue that answers it only in the detail pane
                              makes every scan a click (D-68). */}
                          <Mono className="block truncate text-[var(--color-ink-muted)]">
                            {finding.filePath}:{finding.lineStart}
                          </Mono>
                          <span className="block truncate">{finding.issue}</span>
                        </span>
                        {/* Redundant with the group heading on purpose: on a
                            long queue the heading scrolls away, and severity
                            is the one thing a row must never make someone
                            scroll up to recover. */}
                        <span className="self-center py-2">
                          <Badge tone={severityTone(finding.severity)}>
                            {finding.severity.toLowerCase()}
                          </Badge>
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
              {current.raisedSeverity && current.raisedSeverity !== current.severity ? (
                <span className="text-xs text-[var(--color-ink-muted)]">
                  Finder said {current.raisedSeverity}
                </span>
              ) : null}
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

            <h3 ref={titleRef} tabIndex={-1} className="mt-2 font-medium">
              {current.issue}
            </h3>

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
                {ruleOpen && rulesProblem ? (
                  <div className="mt-2 grid gap-2">
                    <Problem>{rulesProblem}</Problem>
                    <div>
                      <Button
                        onClick={() => {
                          setRulesProblem("");
                          setRules(null);
                          setRulesAttempt((attempt) => attempt + 1);
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
                ) : ruleOpen ? (
                  <pre
                    tabIndex={0}
                    role="group"
                    aria-label={`Rule ${current.ruleCode} in full`}
                    className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs whitespace-pre-wrap"
                  >
                    <code className="font-[family-name:var(--font-mono)]">
                      {rules === null
                        ? "Reading the review's rules..."
                        : (currentRule?.raw ??
                          "This rule is not in the ruleset the review was frozen with.")}
                    </code>
                  </pre>
                ) : null}
              </div>
            ) : null}

            {current.quotedCode ? (
              <figure className="mt-3">
                {/* Numbered from the finding's own lineStart. The quotation
                    was byte-checked against the file at those lines before it
                    could be verified, so these numbers are read off the
                    record rather than guessed at. */}
                <figcaption className="flex items-center justify-between gap-3 rounded-t border border-b-0 border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5">
                  <Mono className="truncate text-xs text-[var(--color-ink-muted)]">
                    {current.filePath}
                  </Mono>
                  <span className="shrink-0 text-[0.65rem] text-[var(--color-ink-faint)]">
                    {current.lineEnd > current.lineStart
                      ? `lines ${current.lineStart}-${current.lineEnd}`
                      : `line ${current.lineStart}`}
                  </span>
                </figcaption>
                <pre className="overflow-x-auto rounded-b border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs">
                  <code className="font-[family-name:var(--font-mono)]">
                    {current.quotedCode.split("\n").map((line, offset) => (
                      <span key={offset} className="block">
                        <span className="mr-3 inline-block w-8 shrink-0 text-right text-[var(--color-ink-faint)]">
                          {current.lineStart + offset}
                        </span>
                        {line}
                      </span>
                    ))}
                  </code>
                </pre>
              </figure>
            ) : null}

            {current.mechanism ? (
              <p className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs">
                <span className="font-medium">Failure mechanism </span>
                <span className="text-[var(--color-ink-muted)]">{current.mechanism}</span>
              </p>
            ) : null}

            {/* A finding verification could not settle claims no proof, though
                one was kept from a verifier that gave it. */}
            {currentProof && current.status !== "open_question" ? (
              <section
                aria-label="How it was proven"
                className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs"
              >
                <p>
                  <span className="font-medium">Proven from </span>
                  <span className="text-[var(--color-ink-muted)]">{currentProof.trigger}</span>
                </p>
                {/* Every step was found at its lines in the checkout before the
                    finding could be verified; the last is the failure. */}
                <ol className="mt-2 grid gap-2">
                  {currentProof.evidence.map((step, index) => (
                    <li key={index} className="min-w-0">
                      <Mono className="text-[var(--color-ink-muted)]">
                        {index + 1}. {step.path}:{step.lineStart}
                        {step.lineEnd > step.lineStart ? `-${step.lineEnd}` : ""}
                      </Mono>
                      {/* Focusable, as the code panes are, so a long line
                          scrolls from the keyboard too. */}
                      <pre
                        tabIndex={0}
                        role="group"
                        aria-label={`Step ${index + 1}, as quoted`}
                        className="mt-1 overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-2"
                      >
                        <code className="font-[family-name:var(--font-mono)]">{step.quote}</code>
                      </pre>
                    </li>
                  ))}
                </ol>
                <p className="mt-2">
                  <span className="font-medium">Guards searched </span>
                  <span className="text-[var(--color-ink-muted)]">
                    {currentProof.guardsSearched.join("; ")}
                  </span>
                </p>
              </section>
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

                {contextError ? (
                  <div className="grid gap-2">
                    <Problem>{contextError}</Problem>
                    <div>
                      <Button onClick={() => setContext(null)}>Try again</Button>
                    </div>
                  </div>
                ) : null}

                <div>
                  <h4 className="mb-1 text-xs font-medium">The file as it stands</h4>
                  {shownContext?.renamedTo ? (
                    <p className="mb-1 text-xs text-[var(--color-ink-muted)]">
                      The change renamed this file to <Mono>{shownContext.renamedTo}</Mono>, so it
                      is shown from there.
                    </p>
                  ) : null}
                  <pre
                    tabIndex={0}
                    role="group"
                    aria-label="The file around this finding"
                    className="max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs"
                  >
                    <code className="font-[family-name:var(--font-mono)]">
                      {shownContext === null
                        ? "Reading the file..."
                        : contextError
                          ? "Not read."
                          : shownContext.brokenLink
                            ? "This file is a link to something that is not there, so there is nothing to show: the change above says where it points."
                            : shownContext.outside
                              ? "This file is a link that leads out of the review's checkout, so where it leads is not shown: the change above says where it points."
                              : shownContext.deleted
                                ? shownContext.hunk
                                  ? "This file is not in the review's checkout: the change deleted it, and the change above is all there is of it."
                                  : "This file is not in the review's checkout: the change deleted it."
                                : shownContext.lines.length === 0
                                  ? "No lines of this file to show here."
                                  : shownContext.lines.map((line) => (
                                      <span
                                        key={line.number}
                                        className={`block ${
                                          line.number >= current.lineStart &&
                                          line.number <= current.lineEnd
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
                {CONFIRMABLE.has(current.status) ? null : (
                  <p className="text-xs" data-testid="not-proven">
                    <span className="font-medium">
                      Not proven, so it cannot go into the report.{" "}
                    </span>
                    {/* Why is said above it, as every finding's note is. */}
                    <span className="text-[var(--color-ink-muted)]">
                      Dismiss it with a reason below.
                    </span>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {CONFIRMABLE.has(current.status) ? (
                    <>
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
                    </>
                  ) : null}
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
                    {reasonQuestion}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id={`dismiss-reason-${current.id}`}
                      ref={reasonRef}
                      value={reason}
                      onChange={(event) =>
                        setReasons((all) => ({ ...all, [current.id]: event.target.value }))
                      }
                      placeholder={reasonQuestion}
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

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-aside text-[var(--color-ink-faint)]">
        <Key label="j / k" action="next / previous" />
        {/* Only what works on the finding in front: an open question has no
            confirm and no comment to edit (PG-2 (a), D-185). */}
        {current && !CONFIRMABLE.has(current.status) ? null : (
          <Key label="Shift+C" action="confirm" />
        )}
        <Key label="d" action="dismiss" />
        {current && !CONFIRMABLE.has(current.status) ? null : (
          <Key label="e" action="edit comment" />
        )}
        <Key label="enter" action="show code" />
        <Key label="g g" action="first" />
        <Key label="G" action="last" />
      </footer>
    </section>
  );
}

/**
 * A severity stripe down the row's leading edge.
 *
 * Redundant with the group heading, deliberately: on a protocol with fifty
 * rules the heading scrolls out of sight long before the group does, and
 * severity is the one thing a queue must never make someone scroll up to
 * recover.
 */
function severityEdge(severity: string): string {
  const upper = severity.toUpperCase();
  if (upper === "CRITICAL") return "bg-[var(--color-critical)]";
  if (upper === "WARNING") return "bg-[var(--color-warning)]";
  return "bg-[var(--color-border-strong)]";
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
