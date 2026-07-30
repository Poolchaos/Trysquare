import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createProject } from "@/server/db/repositories/projects";
import { createReview } from "@/server/db/repositories/reviews";

export interface TestDb {
  db: Db;
  cleanup: () => void;
}

/**
 * A real SQLite file rather than :memory:, so migrations, foreign keys, and
 * cascades behave exactly as they will in the app.
 */
export function makeTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "trysquare-test-"));
  const db = createDb(join(dir, "test.sqlite"));
  runMigrations(db);
  return {
    db,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function seedProject(db: Db, name = "example") {
  return createProject(db, {
    name,
    gitUrl: `git@example.com:acme/${name}.git`,
    defaultBranch: "main",
    clonePath: `/data/projects/${name}/repo.git`,
  });
}

export function seedReview(db: Db, projectId: string) {
  return createReview(db, {
    projectId,
    fromBranch: "feature/x",
    fromCommit: "a".repeat(40),
    intoBranch: "main",
    intoCommit: "b".repeat(40),
    mergeBaseCommit: "c".repeat(40),
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
  });
}
