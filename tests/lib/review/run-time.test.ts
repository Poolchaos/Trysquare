import { describe, expect, it } from "vitest";
import { runTimeMs } from "@/lib/review/run-time";

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
