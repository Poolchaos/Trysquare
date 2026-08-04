/**
 * The picker's law, tested where it is pure.
 *
 * 06 section 2: only a fresh probe makes a model selectable; a probe older
 * than a day renders as unknown rather than assumed-good; recommended models
 * lead. The screen reads these functions, so what is proven here is what the
 * picker does.
 */

import { describe, expect, it } from "vitest";
import {
  PROBE_FRESHNESS_MS,
  availabilityOf,
  isSelectable,
  pickerOrder,
  probeAgeInWords,
} from "@/lib/models/availability";

const NOW = Date.parse("2026-08-04T12:00:00Z");
const probedAgo = (ms: number) => new Date(NOW - ms).toISOString();

describe("what a probe result means", () => {
  it("treats a never-probed model as unknown, not as working", () => {
    expect(availabilityOf({ available: null, lastProbedAt: null }, NOW)).toBe("unknown");
  });

  it("trusts a fresh probe and distrusts one a day old", () => {
    const fresh = { available: true, lastProbedAt: probedAgo(PROBE_FRESHNESS_MS - 60_000) };
    const old = { available: true, lastProbedAt: probedAgo(PROBE_FRESHNESS_MS + 60_000) };
    expect(availabilityOf(fresh, NOW)).toBe("available");
    expect(availabilityOf(old, NOW)).toBe("stale");
  });

  it("keeps a failed probe as unavailable however fresh it is", () => {
    expect(availabilityOf({ available: false, lastProbedAt: probedAgo(1000) }, NOW)).toBe(
      "unavailable",
    );
  });

  it("lets only a current voucher through the picker", () => {
    // The exact set listSelectable uses on the server: a screen offering
    // stale or unknown models would offer what the run cannot promise.
    expect(isSelectable("available")).toBe(true);
    expect(isSelectable("stale")).toBe(false);
    expect(isSelectable("unknown")).toBe(false);
    expect(isSelectable("unavailable")).toBe(false);
  });
});

describe("the order the picker shows", () => {
  const entry = (id: string, family: string, recommended: boolean, sortOrder: number) => ({
    id,
    family,
    recommended,
    sortOrder,
  });

  it("puts recommended families first, and recommended models first within one", () => {
    const ordered = pickerOrder([
      entry("claude-haiku-4-5-20251001", "haiku", false, 1),
      entry("claude-sonnet-5", "sonnet", false, 2),
      entry("claude-fable-5", "fable", false, 4),
      entry("claude-fable-5[1m]", "fable", true, 3),
    ]);
    expect(ordered.map((model) => model.id)).toEqual([
      "claude-fable-5[1m]",
      "claude-fable-5",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-5",
    ]);
  });

  it("keeps registry order inside a family when nothing is recommended", () => {
    const ordered = pickerOrder([entry("b", "opus", false, 2), entry("a", "opus", false, 1)]);
    expect(ordered.map((model) => model.id)).toEqual(["a", "b"]);
  });

  it("does not let one recommendation drag an unrelated family forward", () => {
    // The family jumps because its member is recommended; the others keep
    // their relative registry order behind it.
    const ordered = pickerOrder([
      entry("h", "haiku", false, 1),
      entry("s", "sonnet", false, 2),
      entry("o", "opus", true, 9),
    ]);
    expect(ordered.map((model) => model.id)).toEqual(["o", "h", "s"]);
  });
});

describe("a probe's age in words", () => {
  it("says never, just now, minutes, hours, then days", () => {
    expect(probeAgeInWords(null, NOW)).toBe("never probed");
    expect(probeAgeInWords(probedAgo(30_000), NOW)).toBe("probed just now");
    expect(probeAgeInWords(probedAgo(5 * 60_000), NOW)).toBe("probed 5 min ago");
    expect(probeAgeInWords(probedAgo(3 * 3_600_000), NOW)).toBe("probed 3 h ago");
    expect(probeAgeInWords(probedAgo(72 * 3_600_000), NOW)).toBe("probed 3 days ago");
  });
});
