/**
 * The handful of settings this app has.
 *
 * Only catalogued keys, each with its own schema. An unknown key is refused
 * rather than written, because a settings table that accepts anything becomes
 * a place where typos live silently and a reader cannot tell which keys are
 * real.
 */

import { z } from "zod";
import { SETTING_KEYS, readSettingOr, writeSettings } from "@/server/db/repositories/settings";
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
    const { db, manager } = runtime();
    // The object JSON.parse made, not a copy: zod's record drops a
    // "__proto__" key, which then answered 200 having written nothing
    // (D-136). JSON.parse keeps it as an own key, and the check below refuses it.
    const body = await readJson(
      request,
      z.custom<Record<string, unknown>>(
        (value) => typeof value === "object" && value !== null && !Array.isArray(value),
        "the body must be an object of settings",
      ),
    );

    // Every key is judged before any is written: one at a time, a refused
    // value left the keys before it stored by a request that answered 400.
    const accepted: [string, unknown][] = [];
    for (const [key, value] of Object.entries(body)) {
      // An own key only: "constructor" found Object's constructor on the
      // catalogue, which has no schema, and the route crashed (5.8, A3).
      const entry = Object.hasOwn(CATALOGUE, key) ? CATALOGUE[key as Key] : undefined;
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
      accepted.push([key, parsed.data]);
    }
    writeSettings(db, accepted);
    // A raised limit is room for a waiting review now, not when a run ends.
    if (SETTING_KEYS.maxConcurrentReviews in body) manager.startQueued();

    return (await GET()) as Response;
  });
}
