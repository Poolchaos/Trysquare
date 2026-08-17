"use client";

/**
 * The left rail.
 *
 * Four destinations, a count of the reviews waiting on a decision, and a chip
 * that appears only while something is running. Both are the reason this is a
 * client component: a review takes minutes, and a person who navigates away
 * needs both a way back to it and a way to be told it finished without them.
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

interface Attention {
  active: ActiveReview | null;
  /** Reviews that have stopped and are waiting on a person. */
  awaiting: number;
}

export function Rail() {
  const pathname = usePathname();
  const [active, setActive] = useState<ActiveReview | null>(null);
  const [awaiting, setAwaiting] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        // The narrow endpoint, not the whole reviews list: this runs every
        // four seconds on every screen for the lifetime of the tab.
        const response = await fetch("/api/reviews/attention");
        if (!response.ok) return;
        const body = (await response.json()) as Attention;
        if (cancelled) return;
        setActive(body.active);
        setAwaiting(body.awaiting);
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
    <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3">
      <Link href="/" className="mb-5 flex items-center gap-2 px-2 py-1">
        {/* The try square itself: two arms meeting at a right angle, which is
            the tool the app is named for and the thing it does to a diff.
            Drawn rather than imported so it inherits the accent and needs no
            asset. */}
        <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 shrink-0">
          <path
            d="M2 2 L2 14 L14 14"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="square"
          />
          <path d="M5 11 L11 11 L11 5" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
        <span className="text-body font-semibold tracking-tight">Trysquare</span>
      </Link>

      {LINKS.map((link) => {
        const current = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-md border-l-2 px-2 py-1.5 text-body transition-colors ${
              current
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                : "border-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-ink)]"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              {link.label}
              {/* The state that wants something from a person, said where a
                  person can see it from any screen. It used to be visible
                  only by opening the reviews list and reading the chips. */}
              {link.href === "/reviews" && awaiting > 0 ? (
                <span
                  aria-label={`${awaiting} awaiting your decision`}
                  className="rounded-full bg-[var(--color-question-soft)] px-1.5 text-[0.65rem] font-medium text-[var(--color-question)] tabular-nums"
                >
                  {awaiting}
                </span>
              ) : null}
            </span>
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
