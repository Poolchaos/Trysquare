/**
 * The small vocabulary every screen is built from.
 *
 * Kept deliberately short. A reviewer's tool needs a handful of shapes used
 * consistently, not a component library; anything that appears once belongs in
 * the screen that uses it.
 */

import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[var(--color-ink-muted)]">{hint}</span> : null}
    </label>
  );
}

// min-h is the 04 section 4 floor (40px), applied at the kit rather than per
// screen: a control that meets it only where someone remembered is a control
// that does not meet it.
const CONTROL =
  "min-h-[var(--hit-target)] w-full rounded-md border border-[var(--color-border)] " +
  "bg-[var(--color-surface)] px-3 py-2 text-sm outline-none transition-colors " +
  "focus:border-[var(--color-accent)]";

// Props with `ref`, so a caller that has to move focus (the confirmation
// queue answers a key with it) can use these rather than hand-rolling a
// control and drifting from the shared styling.
export function Input(props: React.ComponentPropsWithRef<"input">) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={`${CONTROL} resize-y ${props.className ?? ""}`} />;
}

export function Select(props: React.ComponentPropsWithRef<"select">) {
  return <select {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function Button({
  variant = "secondary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
}) {
  const styles = {
    primary:
      "bg-[var(--color-accent)] text-[var(--color-accent-ink)] border-transparent hover:opacity-90",
    secondary:
      "bg-[var(--color-surface)] border-[var(--color-border-strong)] hover:bg-[var(--color-surface-sunken)]",
    quiet: "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
  }[variant];

  return (
    <button
      {...props}
      className={
        `inline-flex min-h-[var(--hit-target)] items-center gap-2 rounded-md border px-3 py-2 ` +
        `text-sm font-medium transition-all disabled:cursor-not-allowed ` +
        `disabled:opacity-45 ${styles} ${props.className ?? ""}`
      }
    />
  );
}

export function Mono({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={`font-[family-name:var(--font-mono)] ${className}`} title={title}>
      {children}
    </span>
  );
}

/** A short commit, because forty characters of hash tells a person nothing. */
export function Sha({ value }: { value: string }) {
  return (
    <Mono className="text-xs text-[var(--color-ink-muted)]" title={value}>
      {value.slice(0, 8)}
    </Mono>
  );
}

const TONES = {
  neutral: "border-[var(--color-border)] text-[var(--color-ink-muted)]",
  critical:
    "border-[var(--color-critical)] bg-[var(--color-critical-soft)] text-[var(--color-critical)]",
  warning:
    "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  question:
    "border-[var(--color-question)] bg-[var(--color-question-soft)] text-[var(--color-question)]",
  good: "border-[var(--color-good)] bg-[var(--color-good-soft)] text-[var(--color-good)]",
  accent: "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function severityTone(severity: string): keyof typeof TONES {
  if (severity === "CRITICAL") return "critical";
  if (severity === "WARNING") return "warning";
  return "neutral";
}

export function statusTone(status: string): keyof typeof TONES {
  if (status === "running" || status === "verifying") return "accent";
  if (status === "complete" || status === "awaiting_confirmation") return "good";
  if (status === "failed" || status === "cancelled") return "critical";
  if (status === "paused_limit" || status === "interrupted") return "warning";
  return "neutral";
}

/**
 * What a screen shows when there is nothing yet.
 *
 * Designed rather than defaulted: an empty state that teaches the next step is
 * the difference between an app that looks broken on first run and one that
 * looks ready.
 */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** An error shown as the message the failure actually produced. */
export function Problem({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-md border border-[var(--color-critical)] bg-[var(--color-critical-soft)] px-3 py-2 text-sm text-[var(--color-critical)]">
      {children}
    </p>
  );
}
