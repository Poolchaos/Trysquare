/**
 * Migration 0019: a review's frozen ruleset no longer holds the ruleset it
 * was copied from in place, so one ruleset can be deleted (RA-1).
 *
 * Run as an upgrade really runs: a database migrated to the release before,
 * holding a snapshot that release wrote, then the new migration on top of it.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  deleteRuleset,
  readReviewSnapshotMeta,
  saveImportedRuleset,
  writeReviewSnapshot,
} from "@/server/db/repositories/rulesets";
import { importProtocol } from "@/lib/rulesets/import";
import { seedProject } from "./helpers";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
).ruleset;

let dir: string;
let db: Db;

/** The migrations as the release before this one shipped them. */
function migrationsBefore(tag: string): string {
  const folder = join(dir, "migrations-before");
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const index = journal.entries.findIndex((entry) => entry.tag.startsWith(tag));
  expect(index, `migration ${tag}`).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trysquare-migration-"));
  db = createDb(join(dir, "db.sqlite"));
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a snapshot written before a ruleset could be deleted (migration 0019)", () => {
  it("is carried over whole, and no longer keeps its ruleset from being deleted", () => {
    runMigrations(db, migrationsBefore("0019_"));
    // The review written as the release before wrote it; the ruleset and the
    // snapshot through the repository, whose tables 0019 does not reshape
    // but for the key.
    const reviewId = "R1";
    db.$client
      .prepare(
        `INSERT INTO reviews (id, project_id, from_branch, from_commit, into_branch, into_commit,
           merge_base_commit, model, profile_id, engine_mode, status, created_at)
         VALUES (?, ?, 'feature/x', ?, 'main', ?, ?, 'claude-fable-5[1m]', 'full-context',
           'headless', 'complete', '2026-11-01')`,
      )
      .run(reviewId, seedProject(db).id, "a".repeat(40), "b".repeat(40), "c".repeat(40));
    const { rulesetId } = saveImportedRuleset(db, {
      name: "Example protocol",
      tier: "global",
      imported: PROTOCOL,
    });
    writeReviewSnapshot(db, reviewId, rulesetId);
    const before = db.$client.prepare("SELECT * FROM review_rulesets").all();
    expect(before).toHaveLength(1);
    // The release before refuses it.
    expect(() => deleteRuleset(db, rulesetId)).toThrow(/FOREIGN KEY/);

    runMigrations(db);

    expect(db.$client.prepare("SELECT * FROM review_rulesets").all()).toEqual(before);
    deleteRuleset(db, rulesetId);
    expect(db.$client.prepare("SELECT count(*) AS n FROM rulesets").get()).toEqual({ n: 0 });
    expect(readReviewSnapshotMeta(db, reviewId)).toEqual([
      { name: "Example protocol", version: 1 },
    ]);
    // A review deleted still takes its snapshot with it.
    db.$client.prepare("DELETE FROM reviews WHERE id = ?").run(reviewId);
    expect(db.$client.prepare("SELECT count(*) AS n FROM review_rulesets").get()).toEqual({ n: 0 });
  });
});
