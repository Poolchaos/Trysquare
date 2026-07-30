/**
 * Database connection.
 *
 * One connection per process. SQLite is opened with foreign keys on, because
 * the deletion rules in docs/02-DATA-MODEL.md rely on cascades, and SQLite
 * disables foreign key enforcement by default.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function openSqlite(dbFilePath: string): Database.Database {
  if (dbFilePath !== ":memory:") {
    mkdirSync(dirname(dbFilePath), { recursive: true });
  }
  const sqlite = new Database(dbFilePath);
  // Without this, ON DELETE CASCADE silently does nothing and deleting a
  // review would leave its findings and ledger behind.
  sqlite.pragma("foreign_keys = ON");
  // WAL keeps reads working while a long review writes progress.
  if (dbFilePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

export function createDb(dbFilePath: string) {
  return drizzle(openSqlite(dbFilePath), { schema });
}

export { schema };
