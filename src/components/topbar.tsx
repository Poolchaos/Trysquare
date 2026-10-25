"use client";

/**
 * The top bar.
 *
 * Navigation moved off the left edge so the dashboard can use the full width
 * and the drafting-board ground can run edge to edge (D-81). What the bar
 * owes every screen is three things: where you are, what is running, and
 * what is waiting on you.
 *
 * Dashboard is a real destination rather than the wordmark's job, because
 * every screen must mark exactly one current link and `/` is a screen.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { send } from "@/components/request";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "M2 8h4v6H2zM7 4h4v10H7zM12 9h2v5h-2z" },
  { href: "/projects", label: "Projects", icon: "M2 4h4l2 2h6v7H2z" },
  { href: "/reviews", label: "Reviews", icon: "M2 4h8M2 8h12M2 12h8" },
  { href: "/rulesets", label: "Rulesets", icon: "M4 2h8v12H4zM4 2v12" },
  {
    href: "/settings",
    label: "Settings",
    icon: "M8 5.5A2.5 2.5 0 1 0 8 10.5 2.5 2.5 0 0 0 8 5.5zM8 1v2M8 13v2M1 8h2M13 8h2",
  },
];

interface ActiveReview {
  id: string;
  status: string;
  projectName: string;
  fromBranch: string;
}

interface Attention {
  active: ActiveReview | null;
  awaiting: number;
}

/**
 * Exact for the dashboard, prefix for the rest.
 *
 * Every path begins with "/", so a prefix test would mark the dashboard
 * current on every screen and the app would claim to be in two places.
 */
function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function TopBar() {
  const pathname = usePathname();
  const [active, setActive] = useState<ActiveReview | null>(null);
  const [awaiting, setAwaiting] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      // The narrow endpoint, not the whole reviews list: this runs every
      // four seconds on every screen for the lifetime of the tab. A bar that
      // cannot reach the server is not worth an error message.
      const sent = await send<Attention>(
        "/api/reviews/attention",
        {},
        "What waits on you could not be read",
      );
      if (!sent.ok || cancelled) return;
      setActive(sent.body.active);
      setAwaiting(sent.body.awaiting);
    };
    const timer = setInterval(() => void check(), 4000);
    void check();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4">
      <Link href="/" className="mr-3 flex shrink-0 items-center gap-2 py-1">
        {/* The try square: two arms meeting at a right angle, the tool the
            app is named for. Drawn rather than imported so it takes the
            accent and needs no asset. */}
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
        {/* The wordmark is the first thing to go at phone width; the mark
            keeps the identity and the labels keep the navigation. */}
        <span className="hidden font-[family-name:var(--font-mono)] text-body font-semibold tracking-tight sm:inline">
          Trysquare
        </span>
      </Link>

      <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {LINKS.map((link) => {
          const current = isCurrent(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-md border-b-2 px-2.5 py-1.5 text-body transition-colors ${
                current
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                  : "border-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-ink)]"
              }`}
            >
              {/* Icons drop before labels at narrow widths: a label without
                  an icon still navigates, an icon without a label guesses. */}
              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="hidden h-4 w-4 shrink-0 opacity-70 sm:block"
              >
                <path
                  d={link.icon}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {awaiting > 0 ? (
          <Link
            href="/reviews?status=awaiting"
            aria-label={`${awaiting} awaiting your decision`}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-question)] bg-[var(--color-question-soft)] px-2 py-1 text-aside font-medium text-[var(--color-question)]"
          >
            <span className="tabular-nums">{awaiting}</span>
            <span className="hidden sm:inline">awaiting you</span>
          </Link>
        ) : null}

        {active ? (
          <Link
            href={`/reviews/${active.id}`}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-aside"
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] ${
                active.status === "paused_limit" ? "" : "pulse"
              }`}
            />
            <span className="font-medium">
              {active.status === "paused_limit" ? "Paused" : "Reviewing"}
            </span>
            <span className="hidden max-w-40 truncate text-[var(--color-ink-muted)] md:inline">
              {active.projectName} {active.fromBranch}
            </span>
          </Link>
        ) : null}
      </div>
    </header>
  );
}
