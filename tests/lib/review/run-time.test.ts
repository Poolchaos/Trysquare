import { describe, expect, it } from "vitest";
import { runTimeMs, runTimeWords } from "@/lib/review/run-time";

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
