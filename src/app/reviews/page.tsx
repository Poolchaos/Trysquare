"use client";

/** Every review this app has run, newest first. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/page";
import { Badge, Card, Empty, Mono, statusTone } from "@/components/ui";

interface Row {
  id: string;
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  status: string;
  createdAt: string;
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Row[] | null>(null);

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

  return (
    <>
      <PageHeader title="Reviews" />
      <PageBody>
        {reviews === null ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Loading...</p>
        ) : reviews.length === 0 ? (
          <Empty title="No reviews yet">Open a project and choose a branch to review.</Empty>
        ) : (
          <ul className="grid gap-2">
            {reviews.map((review) => (
              <li key={review.id}>
                <Link href={`/reviews/${review.id}`}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-3 hover:border-[var(--color-border-strong)]">
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge tone={statusTone(review.status)}>
                        {review.status.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-sm font-medium">{review.projectName}</span>
                      <Mono className="truncate text-xs text-[var(--color-ink-muted)]">
                        {review.fromBranch} into {review.intoBranch}
                      </Mono>
                    </span>
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {review.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
