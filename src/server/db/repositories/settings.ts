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

export const SETTING_KEYS = {
  maxConcurrentReviews: "maxConcurrentReviews",
  stageTimeoutMinutes: "stageTimeoutMinutes",
  /** USD-equivalent ceiling per engine call. Zero disables the ceiling. */
  stageMaxBudgetUsd: "stageMaxBudgetUsd",
} as const;
