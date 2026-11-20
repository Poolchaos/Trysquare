/**
 * How long a review's run took, in milliseconds, for every screen that says
 * so: from its start to when it stopped, never to when the review was
 * completed, which is later by the wait for a person's decisions (D-248).
 *
 * Null where no time can honestly be said: the run has not stopped, nobody
 * saw it stop (a server death), or it is paused or interrupted and will run
 * again, so what it has taken so far is not what it took.
 */
export function runTimeMs(review: {
  status: string;
  startedAt: string | null;
  runEndedAt: string | null;
}): number | null {
  if (review.status === "paused_limit" || review.status === "interrupted") return null;
  return spanMs(review.startedAt, review.runEndedAt);
}

/**
 * From a run's start to its end, for the report, which is written of a
 * completed review only and so carries no status. Null as `runTimeMs` is.
 */
export function spanMs(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * A time in words, the same on every screen and in the report: whole
 * seconds passed, never rounded up to one not reached, and hours past the
 * sixtieth minute. The report had a formatter of its own, which rounded
 * and counted minutes without end.
 */
export function runTimeWords(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
