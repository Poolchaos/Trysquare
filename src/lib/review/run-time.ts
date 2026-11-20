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
 * Whether an earlier run of the review asked a model anything. A resumed
 * run is a new one (D-248), so the run's time leaves the earlier run out
 * while the review's tokens and cost keep it, and the time is then said as
 * the last run's. The evidence is a stage row older than this run's start:
 * a run that stopped before its first stage spent nothing, so nothing
 * beside the time is more than this run's.
 *
 * @param firstStageAt When the review's oldest stage row started, a finding
 * verified again left out: that is no run.
 */
export function ranBefore(
  startedAt: string | null,
  firstStageAt: string | null | undefined,
): boolean {
  if (!startedAt || !firstStageAt) return false;
  return Date.parse(firstStageAt) < Date.parse(startedAt);
}

/** A run's time as a list gives it: said as the last run's where an earlier one spent something. */
export function runTimeSaid(ms: number, earlierRun: boolean): string {
  return runTimeParts(ms, earlierRun).join(" ");
}

/** The same words in their parts, for a cell that may break between them and nowhere else. */
export function runTimeParts(ms: number, earlierRun: boolean): string[] {
  return earlierRun ? ["last run", runTimeWords(ms)] : [runTimeWords(ms)];
}

/**
 * A time in words, the same on every screen and in the report (D-249):
 * whole seconds passed, never rounded up to one not reached. A time short
 * of its first second is said so: "0s" read as no time at all (D-258).
 */
export function runTimeWords(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 1) return "under a second";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
