"use client";

/**
 * The left rail.
 *
 * Four destinations and a chip that appears only while something is running.
 * The chip is the reason this is a client component: a review takes minutes,
 * and a person who navigates away still needs a way back to it.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/projects", label: "Projects" },
  { href: "/reviews", label: "Reviews" },
  { href: "/rulesets", label: "Rulesets" },
  { href: "/settings", label: "Settings" },
];

interface ActiveReview {
  id: string;
  status: string;
  projectName: string;
  fromBranch: string;
}

export function Rail() {
  const pathname = usePathname();
  const [active, setActive] = useState<ActiveReview | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/reviews");
        if (!response.ok) return;
        const body = (await response.json()) as { reviews: ActiveReview[]; active: string[] };
        const running = body.reviews.find(
          (review) => body.active.includes(review.id) || review.status === "paused_limit",
        );
        if (!cancelled) setActive(running ?? null);
      } catch {
        // A rail that cannot reach the server is not worth an error message.
      }
    };
    const timer = setInterval(() => void check(), 4000);
    void check();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <Link href="/" className="mb-4 px-2 text-sm font-semibold tracking-tight">
        Trysquare
      </Link>

      {LINKS.map((link) => {
        const current = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
              current
                ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}

      {active ? (
        <Link
          href={`/reviews/${active.id}`}
          className="mt-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs"
        >
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] ${
                active.status === "paused_limit" ? "" : "pulse"
              }`}
            />
            <span className="font-medium">
              {active.status === "paused_limit" ? "Paused" : "Reviewing"}
            </span>
          </span>
          <span className="mt-1 block truncate text-[var(--color-ink-muted)]">
            {active.projectName} {active.fromBranch}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
