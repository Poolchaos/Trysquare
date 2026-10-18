/**
 * Migration 0011: findings killed before the kind of kill was recorded are
 * classified by the note the pipeline wrote (4.24).
 *
 * Run as an upgrade really runs: a database migrated to the release before,
 * holding rows that release wrote, then the new migration on top of it.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { seedProject, seedReview } from "./helpers";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

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

describe("findings killed before the kind of kill was recorded (migration 0011)", () => {
  it("are told apart by the note the pipeline wrote", () => {
    runMigrations(db, migrationsBefore("0011_"));
    const reviewId = seedReview(db, seedProject(db).id).id;
    const insert = db.$client.prepare(
      `INSERT INTO findings (id, review_id, repo, file_path, line_start, line_end, severity,
         issue, comment, mechanism, status, verification_note, created_at)
       VALUES (?, ?, 'primary', 'app/a.ts', 1, 1, 'WARNING', 'x', 'x', 'x', ?, ?, '2026-10-01')`,
    );
    const rows: [string, string, string | null][] = [
      ["quote", "killed", "The quotation did not match the file: line 2 differs."],
      ["unreadable", "killed", "The cited file could not be read: app/gone.ts"],
      ["moved", "killed", "Verification quoted line 1, which does not overlap the cited line 2."],
      ["refuted", "killed", "The caller already checks this."],
      ["default-refuted", "killed", "Refuted during verification."],
      ["kept", "verified", "checked"],
    ];
    for (const [id, status, note] of rows) insert.run(id, reviewId, status, note);

    runMigrations(db);

    const kinds = Object.fromEntries(
      (
        db.$client.prepare("SELECT id, killed_by FROM findings").all() as {
          id: string;
          killed_by: string | null;
        }[]
      ).map((row) => [row.id, row.killed_by]),
    );
    expect(kinds).toEqual({
      quote: "quote_check",
      unreadable: "quote_check",
      moved: "quote_check",
      refuted: "verification",
      "default-refuted": "verification",
      kept: null,
    });
  });
});
