/**
 * Stores a protocol document as a ruleset, with the same refusals as the
 * Rulesets import route (src/app/api/rulesets/import/route.ts): a document
 * with no rules, or with lines the importer cannot place, is not stored.
 *
 * It takes the data-directory lock the app holds, so it refuses while the app
 * runs (DataDirLockError), rather than writing beside a live server.
 */

import { dbPath } from "@/lib/paths";
import type { RulesetTier } from "@/lib/domain/enums";
import { importProtocol } from "@/lib/rulesets/import";
import { acquireDataDirLock } from "@/server/data-dir-lock";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  rulesetAnImportWouldReplace,
  saveImportedRuleset,
} from "@/server/db/repositories/rulesets";

/** A document refused for a reason the person can fix in the document or the command. */
export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefusedError";
  }
}

export interface SeedOptions {
  dataDir: string;
  markdown: string;
  name: string;
  tier: RulesetTier;
  replace: boolean;
  sourceDoc: string;
}

export interface SeedResult {
  /** False when the stored ruleset already held exactly this document. */
  changed: boolean;
  version: number;
  ruleCount: number;
}

export function seedRuleset(options: SeedOptions): SeedResult {
  const { ruleset: imported, coverage } = importProtocol(options.markdown);
  if (imported.rules.length === 0) {
    throw new SeedRefusedError(
      "That document produced no rules, so a review using it would check nothing. Check the rule headings.",
    );
  }
  const lost = coverage.unmapped.filter((entry) => entry.text.trim() !== "");
  if (lost.length > 0) {
    throw new SeedRefusedError(
      `${lost.length} line(s) of that document do not belong to any rule or directive, so importing ` +
        `it would silently drop them. First unmapped line: ${JSON.stringify(lost[0]?.text)}`,
    );
  }

  const release = acquireDataDirLock(options.dataDir);
  const db = createDb(dbPath(options.dataDir));
  try {
    runMigrations(db);
    const existing = rulesetAnImportWouldReplace(db, options.name, imported);
    if (existing && !options.replace) {
      throw new SeedRefusedError(
        `A ruleset called "${existing.name}" already exists at version ${existing.version}, and this ` +
          "document differs from it. Re-run with --replace to replace its rules.",
      );
    }
    const saved = saveImportedRuleset(db, {
      name: options.name,
      tier: options.tier,
      imported,
      sourceDoc: options.sourceDoc,
    });
    return { changed: saved.changed, version: saved.version, ruleCount: imported.rules.length };
  } finally {
    db.$client.close();
    release();
  }
}
