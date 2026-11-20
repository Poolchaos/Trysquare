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
  if (!review.startedAt || !review.runEndedAt) return null;
  if (review.status === "paused_limit" || review.status === "interrupted") return null;
  const ms = Date.parse(review.runEndedAt) - Date.parse(review.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
