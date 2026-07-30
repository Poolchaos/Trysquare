/**
 * Identifiers and timestamps.
 *
 * ULIDs rather than UUIDs because they sort by creation time, so listing
 * reviews or findings in insertion order needs no extra index and no
 * tie-breaking on equal timestamps.
 */

import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

/** Every stored timestamp is ISO-8601 in UTC, so string ordering is time order. */
export function nowIso(): string {
  return new Date().toISOString();
}
