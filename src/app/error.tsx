"use client";

/**
 * The last resort when a screen throws.
 *
 * It shows the real message rather than an apology, because this is a local
 * tool run by the person who can fix it: the actual error is the useful part,
 * and hiding it behind "something went wrong" would mean opening a terminal to
 * learn anything at all. The digest is Next's own id for the server-side
 * stack, which is what makes a production trace findable in the log.
 */

import Link from "next/link";
import { useEffect } from "react";
import { PageBody, PageHeader } from "@/components/page";
import { Button, Card, Mono } from "@/components/ui";

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept out of the swallow: a boundary that renders quietly and logs
    // nothing is how an intermittent fault stays invisible.
    console.error("A screen failed to render:", error);
  }, [error]);

  return (
    <>
      <PageHeader title="This screen could not be shown" />
      <PageBody>
        <Card className="max-w-2xl p-4">
          <p className="text-sm">{error.message || "The error carried no message."}</p>
          {error.digest ? (
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
              Server trace id <Mono>{error.digest}</Mono>
            </p>
          ) : null}
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            Nothing was written by the attempt to draw this page. A review already running is
            unaffected; only this view failed.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
            <Link href="/projects">
              <Button variant="quiet">Back to projects</Button>
            </Link>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
