/**
 * When the review page says how a watched run ended.
 *
 * The words go into a live region a moment after the run's theater has gone:
 * its modal dialog keeps the rest of the page from a screen reader, and words
 * set as the region came back within reach were no change to hear (review
 * round 15). A reading that shows the review running or back in the line
 * empties the region and withdraws words still waiting, so a Resume pressed
 * inside that moment is not followed by "The run is over" beside a badge
 * saying queued (review round 16).
 *
 * The timers are passed in, so the moment can be stepped through in a test.
 */

export interface RunReading {
  running: boolean;
  queued: boolean;
}

export interface EndingNotice {
  /** Takes one reading of the review; `words` is asked only when a run has just ended. */
  show(reading: RunReading, words: () => string): void;
  /** Withdraws words still waiting, as the page goes. */
  dispose(): void;
}

export const ENDING_DELAY_MS = 150;

interface Timers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const REAL_TIMERS: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createEndingNotice(
  say: (words: string) => void,
  timers: Timers = REAL_TIMERS,
): EndingNotice {
  let shownRunning = false;
  let waiting: unknown;

  return {
    show(reading, words) {
      if (reading.running || reading.queued) {
        timers.clear(waiting);
        say("");
      } else if (shownRunning) {
        const ending = words();
        waiting = timers.set(() => say(ending), ENDING_DELAY_MS);
      }
      shownRunning = reading.running;
    },
    dispose() {
      timers.clear(waiting);
    },
  };
}
