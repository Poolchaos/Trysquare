/**
 * Whose branches count as the person's, asked at the moment it is needed.
 *
 * The emails kept in Settings, or, while none is kept, the one this
 * machine's git commits as (D-69, D-243). Read each time rather than once at
 * startup, so a list saved in Settings is the one the next branch list uses.
 */

import { identitiesSchema } from "@/lib/settings/identities";
import type { Db } from "./db/client";
import { SETTING_KEYS, readSettingOr } from "./db/repositories/settings";
import { globalUserEmail } from "./gitops/identity";

export async function identitiesInEffect(db: Db): Promise<string[]> {
  const kept = readSettingOr(db, SETTING_KEYS.identities, identitiesSchema, []);
  if (kept.length > 0) return kept;
  const email = await globalUserEmail();
  return email === null ? [] : [email];
}
