/**
 * A runtime() whose database or migrations failed (D-181 item 6).
 *
 * It took the data directory's lock, then failed, and kept both the lock and
 * the database handle it had opened; tried again, as each route does, it
 * opened a second handle on the same file under a lock no runtime owned. In
 * a file of its own: the mocks below apply to the whole file.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOLDER = join(REPO_ROOT, "tests", "fixtures", "hold-data-dir-lock.mts");

const state = vi.hoisted(() => ({
  handles: [] as { $client: { open: boolean } }[],
  failMigration: true,
}));

vi.mock("@/server/db/client", async (original) => {
  const actual = await original<typeof import("@/server/db/client")>();
  return {
    ...actual,
    createDb: (path: string) => {
      const db = actual.createDb(path);
      state.handles.push(db);
      return db;
    },
  };
});

vi.mock("@/server/db/migrate", async (original) => {
  const actual = await original<typeof import("@/server/db/migrate")>();
  return {
    ...actual,
    runMigrations: (...args: Parameters<typeof actual.runMigrations>) => {
      if (state.failMigration) {
        state.failMigration = false;
        throw new Error("the migration failed");
      }
      actual.runMigrations(...args);
    },
  };
});

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-failed-start-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

/** What another server starting now would get: "held" or the error's name. */
function anotherServerTrying(): string {
  const result = spawnSync(process.execPath, ["--import", "tsx", HOLDER, dataDir, "try"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  return result.stdout.trim().split(" ")[0]!;
}

it("gives back the lock and the database when it fails, and opens one on the next call", async () => {
  const { runtime } = await import("@/server/runtime");

  expect(() => runtime()).toThrow("the migration failed");
  expect(state.handles).toHaveLength(1);
  expect(state.handles[0]!.$client.open).toBe(false);
  expect(anotherServerTrying()).toBe("held");

  const { db } = runtime();
  expect(db).toBe(state.handles[1]);
  expect(state.handles.filter((handle) => handle.$client.open)).toHaveLength(1);
  // Taken for real, not the failed start's leftover entry in the held map.
  expect(anotherServerTrying()).toBe("DataDirInUseError");
  expect(runtime().db).toBe(db);
  expect(state.handles).toHaveLength(2);
}, 60_000);
