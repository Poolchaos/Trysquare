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
import { useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/page";
import { Badge, Button, Card, Empty, Mono, Problem, Select, statusTone } from "@/components/ui";

interface Row {
  id: string;
  projectId: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  status: string;
  createdAt: string;
  mergedDetectedAt: string | null;
}

/** Statuses that own a running process, so the row offers no delete. */
const RUNNING = new Set(["running", "verifying"]);

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Row[] | null>(null);
  const [project, setProject] = useState("");
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
  const shown = (reviews ?? []).filter((review) => project === "" || review.projectId === project);

  return (
    <>
      <PageHeader
        title="Reviews"
        actions={
          projects.length > 1 ? (
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
          ) : null
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
          <Empty title="No reviews for that project">
            Every review is still here; only this filter is hiding them.
          </Empty>
        ) : (
          <ul className="grid gap-2">
            {shown.map((review) => (
              <li key={review.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <Link
                    href={`/reviews/${review.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    <Badge tone={statusTone(review.status)}>
                      {review.status.replace(/_/g, " ")}
                    </Badge>
                    {review.mergedDetectedAt ? <Badge tone="good">merged</Badge> : null}
                    <span className="text-sm font-medium">{review.projectName}</span>
                    <Mono className="truncate text-xs text-[var(--color-ink-muted)]">
                      {review.fromBranch} into {review.intoBranch}
                    </Mono>
                  </Link>
                  <span className="flex items-center gap-3">
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
