/**
 * Which path a review's CLI is found from, asked at the moment it is needed.
 *
 * TRYSQUARE_CLAUDE_PATH first, as the person starting the server chose it for
 * this run of it, then the path kept in Settings, then nothing, which leaves
 * the resolver to the CLI `npm install` put in node_modules and then PATH
 * (D-92, D-152). Read each time rather than once at startup, so a path saved
 * in Settings is the one the next review and the next check use.
 */

import type { Db } from "./db/client";
import { SETTING_KEYS, readSetting } from "./db/repositories/settings";
import { claudePathSchema } from "@/lib/settings/claude-path";

export function configuredClaudePath(db: Db): string | undefined {
  const fromEnvironment = environmentClaudePath();
  if (fromEnvironment !== undefined) return fromEnvironment;
  const stored = readSetting(db, SETTING_KEYS.claudePath, claudePathSchema) ?? "";
  return stored === "" ? undefined : stored;
}

/** The variable's path, or undefined when it is unset or only spaces. */
export function environmentClaudePath(): string | undefined {
  const value = process.env.TRYSQUARE_CLAUDE_PATH?.trim() ?? "";
  return value === "" ? undefined : value;
}
