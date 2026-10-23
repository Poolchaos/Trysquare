import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createProject } from "@/server/db/repositories/projects";
import { createReview } from "@/server/db/repositories/reviews";
import { recordProbeSuccess, registerCandidate } from "@/server/db/repositories/models";
import { DEFAULT_MODEL_CANDIDATES } from "@/server/engine/probe";

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
    // Closed first: Windows refuses to delete a file a process holds open, so
    // removing the directory under a live connection failed every test there.
    cleanup: () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
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

/**
 * Probes the models that prove a review's findings again, Opus 5.5 for a
 * Fable review and Fable 5.1 for an Opus one, so a create or Start is not
 * refused for them (WP-E). Registered first: a test database has no
 * candidates until a manager starts.
 */
export function probeSecondVerifier(db: Db): void {
  for (const id of ["claude-opus-5-5", "claude-fable-5-1"]) {
    const candidate = DEFAULT_MODEL_CANDIDATES.find((entry) => entry.id === id)!;
    registerCandidate(db, candidate);
    recordProbeSuccess(db, id, { resolvedId: id, contextWindow: 1_000_000 });
  }
}
