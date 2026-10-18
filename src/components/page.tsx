import Link from "next/link";
import type { ReactNode } from "react";

/** Every screen opens the same way: what this is, then what you can do here. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-8 py-4">
      <div className="min-w-0">
        <h1 className="font-[family-name:var(--font-mono)] text-title leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <div className="mt-1 text-body text-[var(--color-ink-muted)]">{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="px-8 py-6">{children}</div>;
}

/**
 * A screen whose data has not arrived, or never will.
 *
 * Three detail screens used to render a bare "Loading..." with no header and
 * no error path: a fetch that failed looked exactly like one that was slow,
 * for as long as the person was willing to wait. Keeping the header while
 * loading also stops the page jumping when the content lands.
 */
export function PageLoading({
  title,
  error,
  onRetry,
  back,
}: {
  title: ReactNode;
  error?: string;
  onRetry?: () => void;
  back?: { href: string; label: string };
}) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <Loading
          {...(error === undefined ? {} : { error })}
          {...(onRetry ? { onRetry } : {})}
          {...(back ? { back } : {})}
        />
      </PageBody>
    </>
  );
}

/**
 * What stands where content will be: "Loading..." until it arrives, or why it
 * could not be read, with a way to try again. A whole page waiting for its
 * subject uses it, and so does a list inside a page, which used to stay on
 * "Loading..." when its read failed (5.13, U9).
 */
export function Loading({
  error,
  onRetry,
  back,
}: {
  error?: string;
  onRetry?: () => void;
  /**
   * Where to go instead, for a subject that does not exist: Try again
   * offered there could never succeed (D-138).
   */
  back?: { href: string; label: string };
}) {
  return error ? (
    <div className="grid max-w-xl gap-3">
      <p className="text-sm text-[var(--color-critical)]">{error}</p>
      {back ? (
        <Link href={back.href} className="w-fit text-sm text-[var(--color-accent)] hover:underline">
          {back.label}
        </Link>
      ) : onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="w-fit rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm hover:bg-[var(--color-surface-sunken)]"
        >
          Try again
        </button>
      ) : null}
    </div>
  ) : (
    <p className="text-sm text-[var(--color-ink-muted)]">Loading...</p>
  );
}
