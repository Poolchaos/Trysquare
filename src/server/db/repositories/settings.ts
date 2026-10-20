/**
 * Key/value application settings, stored as JSON text and read through zod.
 */

import { eq } from "drizzle-orm";
import type { z } from "zod";
import { nowIso } from "@/lib/ids";
import type { Db } from "../client";
import { settings } from "../schema";
import { parseJsonColumn, serialiseJsonColumn } from "./json";

export function readSetting<T>(db: Db, key: string, schema: z.ZodType<T>): T | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return undefined;
  return parseJsonColumn(`settings.${key}`, row.value, schema);
}

export function readSettingOr<T>(db: Db, key: string, schema: z.ZodType<T>, fallback: T): T {
  return readSetting(db, key, schema) ?? fallback;
}

export function writeSetting(db: Db, key: string, value: unknown): void {
  const row = { key, value: serialiseJsonColumn(value), updatedAt: nowIso() };
  db.insert(settings)
    .values(row)
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: row.value, updatedAt: row.updatedAt },
    })
    .run();
}

/** All of them or none, so a write that fails part way leaves no half a change. */
export function writeSettings(db: Db, entries: readonly (readonly [string, unknown])[]): void {
  // better-sqlite3 runs a transaction on its one connection, so the writes
  // made through `db` are inside it.
  db.transaction(() => {
    for (const [key, value] of entries) writeSetting(db, key, value);
  });
}

export const SETTING_KEYS = {
  maxConcurrentReviews: "maxConcurrentReviews",
  stageTimeoutMinutes: "stageTimeoutMinutes",
  /** USD-equivalent ceiling per engine call. Zero disables the ceiling. */
  stageMaxBudgetUsd: "stageMaxBudgetUsd",
  /** The CLI reviews run through, the first setting that is not a number (6.1). */
  claudePath: "claudePath",
} as const;
