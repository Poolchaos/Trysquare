/**
 * What a probe result means, and how a picker orders what it knows.
 *
 * Pure and structural, because the same judgment is needed on both sides of
 * the wire: the server decides what may run a review, and the picker decides
 * what may be chosen, and those two answers drifting apart is how a screen
 * ends up offering what the server refuses (06 section 2).
 */

export interface ProbeState {
  /** null means never probed, which is shown as unknown rather than assumed. */
  available: boolean | null;
  lastProbedAt: string | null;
}

/** Probes older than this are shown as unknown rather than trusted. */
export const PROBE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export type ModelAvailability = "available" | "unavailable" | "unknown" | "stale";

export function availabilityOf(model: ProbeState, now: number = Date.now()): ModelAvailability {
  if (model.available === null || model.lastProbedAt === null) return "unknown";
  if (!model.available) return "unavailable";
  const probedAt = Date.parse(model.lastProbedAt);
  if (Number.isNaN(probedAt)) return "unknown";
  return now - probedAt > PROBE_FRESHNESS_MS ? "stale" : "available";
}

/**
 * Whether the picker lets this model be chosen.
 *
 * Only a probe currently vouching for the model counts (the same rule as the
 * server's `listSelectable`). A stale probe is yesterday's evidence and an
 * absent one is none; both render as unknown, with a probe control beside
 * them, rather than as a working option that fails at start time.
 */
export function isSelectable(availability: ModelAvailability): boolean {
  return availability === "available";
}

export interface PickerEntry {
  id: string;
  family: string;
  recommended: boolean;
  sortOrder: number;
}

/**
 * Picker order: recommended families first, recommended models first inside
 * each family, registry order as the tiebreak.
 *
 * The order is computed rather than stored because "recommended first" is a
 * statement about the whole list: a family becomes a front-runner because one
 * of its members is recommended, which no per-row sort column can express.
 */
export function pickerOrder<T extends PickerEntry>(models: readonly T[]): T[] {
  const familyRank = new Map<string, number>();
  for (const model of models) {
    const rank = (model.recommended ? 0 : 1000) + model.sortOrder;
    familyRank.set(model.family, Math.min(familyRank.get(model.family) ?? Infinity, rank));
  }

  return [...models].sort(
    (a, b) =>
      familyRank.get(a.family)! - familyRank.get(b.family)! ||
      a.family.localeCompare(b.family) ||
      Number(b.recommended) - Number(a.recommended) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
}

/**
 * A probe's age in words, for the picker's per-model line.
 *
 * Coarse on purpose: the question being answered is "should I trust this
 * probe", and the day boundary is where the answer changes (24 hours renders
 * as unknown), so minutes and hours are all the precision that decision uses.
 */
export function probeAgeInWords(lastProbedAt: string | null, now: number = Date.now()): string {
  if (lastProbedAt === null) return "never probed";
  const probedAt = Date.parse(lastProbedAt);
  if (Number.isNaN(probedAt)) return "never probed";

  const minutes = Math.floor((now - probedAt) / 60_000);
  if (minutes < 1) return "probed just now";
  if (minutes < 60) return `probed ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `probed ${hours} h ago`;
  return `probed ${Math.floor(hours / 24)} days ago`;
}
