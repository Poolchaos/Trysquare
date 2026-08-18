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
}: {
  title: ReactNode;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        {error ? (
          <div className="grid max-w-xl gap-3">
            <p className="text-sm text-[var(--color-critical)]">{error}</p>
            {onRetry ? (
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
        )}
      </PageBody>
    </>
  );
}
