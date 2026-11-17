/**
 * The README says nothing is reported about how the app is used. Next.js
 * records usage from `next dev` and `next build` unless
 * NEXT_TELEMETRY_DISABLED is set by the time its config has been read, so
 * the config sets it (D-233).
 */

import { describe, expect, it } from "vitest";

describe("Next.js telemetry", () => {
  it("is turned off by reading next.config.ts, whatever the shell had", async () => {
    delete process.env.NEXT_TELEMETRY_DISABLED;
    await import("../../next.config");
    expect(process.env.NEXT_TELEMETRY_DISABLED).toBe("1");
  });
});
