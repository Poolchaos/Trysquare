export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-medium tracking-tight">Trysquare</h1>
      <p className="text-[var(--color-ink-muted)]">
        Scaffold only. No review functionality is implemented yet: the projects, ruleset, and review
        surfaces arrive with WP-H and WP-I of the build plan.
      </p>
      <p className="text-sm text-[var(--color-ink-muted)]">
        Progress is tracked in <code className="font-mono">docs/PROJECT-STATE.md</code>.
      </p>
    </main>
  );
}
