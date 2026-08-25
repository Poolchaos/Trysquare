"use client";

/**
 * Every review this app has run, newest first.
 *
 * A review that is still running is not deletable from here: it owns a process
 * and a checked-out worktree, and the run screen is where it can be stopped.
 * Everything else can go, because a finished review's working files are dead
 * weight once its report has been exported.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Empty,
  Mono,
  Problem,
  Select,
  statusLabel,
  statusTone,
} from "@/components/ui";

interface Row {
  id: string;
  projectId: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  status: string;
  createdAt: string;
  mergedDetectedAt: string | null;
  model: string;
  costEquivalentUsd: number;
  startedAt: string | null;
  completedAt: string | null;
  findings: { total: number; confirmed: number; dismissed: number; killed: number };
}

/** A finished review's wall clock, from columns the list already receives. */
function ranFor(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const seconds = Math.max(
    0,
    Math.floor((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Statuses that own a running process, so the row offers no delete. */
const RUNNING = new Set(["running", "verifying"]);

function ReviewsList() {
  const search = useSearchParams();
  const [reviews, setReviews] = useState<Row[] | null>(null);
  const [project, setProject] = useState("");
  // Seeded from the URL so the awaiting badge in the top bar can land on the
  // filtered list rather than on every review ever run, which is the list
  // someone pressing a count of three is least interested in.
  const [status, setStatus] = useState(() =>
    search.get("status") === "awaiting" ? "awaiting" : "",
  );
  const [confirming, setConfirming] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const body = (await (await fetch("/api/reviews")).json()) as { reviews: Row[] };
    setReviews(body.reviews);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const body = (await (await fetch("/api/reviews")).json()) as { reviews: Row[] };
      if (!cancelled) setReviews(body.reviews);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(id: string) {
    setError("");
    setBusy(id);
    try {
      const response = await fetch(`/api/reviews/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "The review could not be deleted.");
        return;
      }
      setConfirming("");
      await load();
    } finally {
      setBusy("");
    }
  }

  // Keyed by id rather than name, because two remotes can end in the same
  // repository name and a filter that merged them would hide reviews while
  // claiming to show all of that project's. First-seen order is
  // newest-review-first: today's project sits at the top of the filter.
  const projects = [
    ...new Map((reviews ?? []).map((review) => [review.projectId, review.projectName])),
  ];
  const shown = (reviews ?? []).filter(
    (review) =>
      (project === "" || review.projectId === project) &&
      (status === "" ||
        (status === "awaiting"
          ? review.status === "awaiting_confirmation"
          : review.status === status)),
  );
  const awaiting = (reviews ?? []).filter(
    (review) => review.status === "awaiting_confirmation",
  ).length;

  return (
    <>
      <PageHeader
        title="Reviews"
        actions={
          <span className="flex flex-wrap items-center gap-3">
            {/* The one filter worth reaching for first: which of these still
                want something from me. Offered only when the answer is not
                none, so it never advertises an empty set. */}
            {awaiting > 0 ? (
              <Button
                variant={status === "awaiting" ? "primary" : "quiet"}
                // It is a toggle, so it says whether it is on rather than
                // leaving that to colour alone.
                aria-pressed={status === "awaiting"}
                onClick={() => setStatus(status === "awaiting" ? "" : "awaiting")}
              >
                {awaiting} awaiting your decision
              </Button>
            ) : null}
            {projects.length > 1 ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-[var(--color-ink-muted)]">Project</span>
                <Select
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                  className="w-auto"
                >
                  <option value="">All</option>
                  {projects.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
          </span>
        }
      />
      <PageBody>
        {error ? (
          <div className="mb-4">
            <Problem>{error}</Problem>
          </div>
        ) : null}

        {reviews === null ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Loading...</p>
        ) : reviews.length === 0 ? (
          <Empty title="No reviews yet">Open a project and choose a branch to review.</Empty>
        ) : shown.length === 0 ? (
          <Empty title="No reviews match these filters">
            Every review is still here; only the filters are hiding them.
          </Empty>
        ) : (
          <ul className="grid gap-2">
            {shown.map((review) => (
              <li key={review.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <Link
                    href={`/reviews/${review.id}`}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    <Badge tone={statusTone(review.status)}>{statusLabel(review.status)}</Badge>
                    {review.mergedDetectedAt ? <Badge tone="good">merged</Badge> : null}
                    <span className="text-dense font-medium">{review.projectName}</span>
                    {/* The branch pair is the row's longest and least
                        essential-to-read-whole part, so it is the part that
                        gives: full width of its own line on a phone, truncated
                        beside everything else on a desktop. */}
                    <Mono className="w-full truncate text-aside text-[var(--color-ink-muted)] sm:w-auto sm:min-w-0 sm:flex-1">
                      {review.fromBranch} into {review.intoBranch}
                    </Mono>
                  </Link>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* What the review actually produced. Without these a
                        three-hour run that confirmed twelve criticals read
                        exactly like a cancelled one. */}
                    {review.findings.total > 0 ? (
                      <span className="text-xs text-[var(--color-ink-muted)] tabular-nums">
                        {review.findings.confirmed} of {review.findings.total} confirmed
                      </span>
                    ) : null}
                    {ranFor(review.startedAt, review.completedAt) ? (
                      <span className="text-xs text-[var(--color-ink-muted)] tabular-nums">
                        {ranFor(review.startedAt, review.completedAt)}
                      </span>
                    ) : null}
                    {review.costEquivalentUsd > 0 ? (
                      <span className="text-xs text-[var(--color-ink-muted)] tabular-nums">
                        ${review.costEquivalentUsd.toFixed(2)}
                      </span>
                    ) : null}
                    <span className="hidden text-xs text-[var(--color-ink-faint)] sm:inline">
                      {review.model}
                    </span>
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {review.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                    {RUNNING.has(review.status) ? null : confirming === review.id ? (
                      <>
                        <Button
                          variant="primary"
                          disabled={busy !== ""}
                          onClick={() => void remove(review.id)}
                        >
                          Yes, delete
                        </Button>
                        <Button variant="quiet" onClick={() => setConfirming("")}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button variant="quiet" onClick={() => setConfirming(review.id)}>
                        Delete
                      </Button>
                    )}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {reviews && reviews.length > 0 ? (
          <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
            Deleting a review removes its worktrees, bundle and logs. An exported report lives
            outside all of that and stays.
          </p>
        ) : null}
      </PageBody>
    </>
  );
}

export default function ReviewsPage() {
  // Required because the list reads a search param. The fallback is the header
  // it is about to render anyway, so nothing flashes empty.
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Reviews" />
          <PageBody>
            <p className="text-body text-[var(--color-ink-muted)]">Reading the reviews...</p>
          </PageBody>
        </>
      }
    >
      <ReviewsList />
    </Suspense>
  );
}
