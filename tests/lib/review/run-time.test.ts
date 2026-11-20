import { describe, expect, it } from "vitest";
import { ranBefore, runTimeMs, runTimeSaid, runTimeWords } from "@/lib/review/run-time";

const RAN = {
  status: "complete",
  startedAt: "2026-08-18T10:00:00.000Z",
  runEndedAt: "2026-08-18T10:10:00.000Z",
};

describe("how long a run took", () => {
  it("is the run's own span, whatever the review's status since", () => {
    for (const status of ["awaiting_confirmation", "complete", "failed", "cancelled"]) {
      expect(runTimeMs({ ...RAN, status }), status).toBe(600_000);
    }
  });

  it("is not said of a run that will carry on", () => {
    // Paused on a limit after ten minutes, it has not taken ten minutes.
    expect(runTimeMs({ ...RAN, status: "paused_limit" })).toBeNull();
    expect(runTimeMs({ ...RAN, status: "interrupted" })).toBeNull();
  });

  it("is not said where either end is missing or the two are out of order", () => {
    expect(runTimeMs({ ...RAN, runEndedAt: null })).toBeNull();
    expect(runTimeMs({ ...RAN, startedAt: null })).toBeNull();
    expect(runTimeMs({ ...RAN, runEndedAt: "2026-08-18T09:00:00.000Z" })).toBeNull();
    expect(runTimeMs({ ...RAN, runEndedAt: "not a time" })).toBeNull();
  });
});

describe("a run's time in words", () => {
  it("is whole seconds already passed, never rounded up to one not reached", () => {
    expect(runTimeWords(0)).toBe("0s");
    expect(runTimeWords(59_600)).toBe("59s");
    expect(runTimeWords(60_000)).toBe("1m 00s");
    expect(runTimeWords(270_000)).toBe("4m 30s");
    expect(runTimeWords(245_900)).toBe("4m 05s");
  });

  it("counts in hours past the sixtieth minute", () => {
    expect(runTimeWords(3_599_999)).toBe("59m 59s");
    expect(runTimeWords(3_930_600)).toBe("1h 05m");
  });
});

describe("a run's time beside totals that sum every run", () => {
  // The seventeenth grade, AE6: a resumed run is a new one (D-248), so its
  // time is the last run's, while the tokens and cost beside it are every
  // run's, and no word said so.
  const STARTED = "2026-08-18T10:00:00.000Z";

  it("knows an earlier run asked a model by a stage row older than the run", () => {
    expect(ranBefore(STARTED, "2026-08-18T09:40:00.000Z")).toBe(true);
    expect(ranBefore(STARTED, "2026-08-18T10:00:01.000Z")).toBe(false);
  });

  it("says nothing of an earlier run with no stage row or no run to compare", () => {
    // A run that stopped before its first stage spent nothing.
    expect(ranBefore(STARTED, null)).toBe(false);
    expect(ranBefore(STARTED, undefined)).toBe(false);
    expect(ranBefore(null, "2026-08-18T09:40:00.000Z")).toBe(false);
  });

  it("says whose time it is where an earlier run spent something", () => {
    expect(runTimeSaid(30_000, true)).toBe("last run 30s");
    expect(runTimeSaid(30_000, false)).toBe("30s");
  });
});
