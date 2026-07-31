/**
 * The handful of settings this app has.
 *
 * Only catalogued keys, each with its own schema. An unknown key is refused
 * rather than written, because a settings table that accepts anything becomes
 * a place where typos live silently and a reader cannot tell which keys are
 * real.
 */

import { z } from "zod";
import { SETTING_KEYS, readSettingOr, writeSetting } from "@/server/db/repositories/settings";
import { handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** Every setting, its schema, and what it means when nobody has set it. */
const CATALOGUE = {
  [SETTING_KEYS.maxConcurrentReviews]: { schema: z.number().int().positive(), fallback: 1 },
  [SETTING_KEYS.stageTimeoutMinutes]: { schema: z.number().int().positive(), fallback: 20 },
  [SETTING_KEYS.stageMaxBudgetUsd]: { schema: z.number().nonnegative(), fallback: 15 },
} as const;

type Key = keyof typeof CATALOGUE;

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const settings = Object.fromEntries(
      (Object.keys(CATALOGUE) as Key[]).map((key) => [
        key,
        readSettingOr(db, key, CATALOGUE[key].schema, CATALOGUE[key].fallback),
      ]),
    );
    return ok({ settings });
  });
}

export function PUT(request: Request): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const body = await readJson(request, z.record(z.string(), z.unknown()));

    for (const [key, value] of Object.entries(body)) {
      const entry = CATALOGUE[key as Key];
      if (!entry) {
        throw Response.json(
          { error: `There is no setting called "${key}".`, code: "UnknownSetting" },
          { status: 400 },
        );
      }
      const parsed = entry.schema.safeParse(value);
      if (!parsed.success) {
        throw Response.json(
          {
            error: `${key}: ${parsed.error.issues[0]?.message ?? "is not valid"}`,
            code: "Invalid",
          },
          { status: 400 },
        );
      }
      writeSetting(db, key, parsed.data);
    }

    return (await GET()) as Response;
  });
}
