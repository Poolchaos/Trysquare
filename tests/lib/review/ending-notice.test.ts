/**
 * When the review page says how a watched run ended, stepped through with
 * the clock held: the 150 ms between a run's end and its words is too short
 * for a browser test to press Resume inside (review round 17).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEndingNotice, ENDING_DELAY_MS } from "@/lib/review/ending-notice";

const RUNNING = { running: true, queued: false };
const QUEUED = { running: false, queued: true };
const AT_REST = { running: false, queued: false };
const failed = () => "The run is over: it failed.";

describe("how a watched run's ending is said", () => {
  let said: string[];
  let notice: ReturnType<typeof createEndingNotice>;

  beforeEach(() => {
    vi.useFakeTimers();
    said = [];
    notice = createEndingNotice((words) => said.push(words));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says it a moment after the run ends, and not before", () => {
    notice.show(RUNNING, failed);
    notice.show(AT_REST, failed);
    vi.advanceTimersByTime(ENDING_DELAY_MS - 1);
    expect(said).toEqual([""]);

    vi.advanceTimersByTime(1);
    expect(said).toEqual(["", "The run is over: it failed."]);
  });

  it("says nothing of a review that was never seen running", () => {
    notice.show(AT_REST, failed);
    vi.advanceTimersByTime(ENDING_DELAY_MS * 10);
    expect(said).toEqual([]);
  });

  it("withdraws the words when the review is back in the line before they were said", () => {
    notice.show(RUNNING, failed);
    notice.show(AT_REST, failed);
    vi.advanceTimersByTime(ENDING_DELAY_MS - 50);
    notice.show(QUEUED, failed);
    vi.advanceTimersByTime(ENDING_DELAY_MS * 10);

    expect(said).toEqual(["", ""]);
  });

  it("empties what was said once the review is queued or running again", () => {
    notice.show(RUNNING, failed);
    notice.show(AT_REST, failed);
    vi.advanceTimersByTime(ENDING_DELAY_MS);
    notice.show(QUEUED, failed);
    notice.show(RUNNING, failed);

    expect(said).toEqual(["", "The run is over: it failed.", "", ""]);
  });

  it("says nothing once the page has gone", () => {
    notice.show(RUNNING, failed);
    notice.show(AT_REST, failed);
    notice.dispose();
    vi.advanceTimersByTime(ENDING_DELAY_MS * 10);

    expect(said).toEqual([""]);
  });
});
