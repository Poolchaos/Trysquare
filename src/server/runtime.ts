/**
 * What a request handler needs to do anything: the database and the scheduler.
 *
 * Route handlers must not open their own database. Two handles on one SQLite
 * file is how a local app starts losing writes, and the manager holds state
 * about what is running that only means anything if there is one of it.
 *
 * Startup normally builds both in `instrumentation.ts`. This falls back to
 * building them on first use, because Next does not guarantee instrumentation
 * has run before a route in every mode, and a handler failing with "the job
 * manager was used before init" would be a worse answer than simply having
 * done it.
 */

import { homedir } from "node:os";
import { dbPath, resolveDataDir } from "@/lib/paths";
import { acquireDataDirLock } from "./data-dir-lock";
import { createDb, type Db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { jobManager, type JobManager } from "./jobs/manager";

const RUNTIME_KEY = Symbol.for("trysquare.runtime");
const EXIT_HOOK_KEY = Symbol.for("trysquare.runtime.exit-hook");

interface RuntimeHolder {
  [RUNTIME_KEY]?: { db: Db; dataDir: string; release: () => void };
  [EXIT_HOOK_KEY]?: true;
}

export interface Runtime {
  db: Db;
  dataDir: string;
  manager: JobManager;
}

export function runtime(): Runtime {
  const holder = globalThis as RuntimeHolder;

  if (!holder[RUNTIME_KEY]) {
    const dataDir = resolveDataDir(process.env, homedir());
    // Before the database is opened: a second server on this directory would
    // mark the first one's running reviews interrupted, and could migrate the
    // database alongside it (4.18).
    const release = acquireDataDirLock(dataDir);
    let db: Db | undefined;
    try {
      db = createDb(dbPath(dataDir));
      runMigrations(db);
      jobManager().init({ db, dataDir });
      holder[RUNTIME_KEY] = { db, dataDir, release };
    } catch (error) {
      // Left open and held, the next call opened a second handle on the same
      // file beside this one, under a lock no runtime owned (D-181 item 6).
      db?.$client.close();
      release();
      throw error;
    }
    if (!holder[EXIT_HOOK_KEY]) {
      process.once("exit", () => holder[RUNTIME_KEY]?.release());
      holder[EXIT_HOOK_KEY] = true;
    }
  }

  const { db, dataDir } = holder[RUNTIME_KEY];
  return { db, dataDir, manager: jobManager() };
}

/**
 * Closes the database and forgets the runtime, so the next `runtime()` opens
 * afresh. Windows will not delete a data directory while the database in it
 * is open, which is what a test tearing down its data directory does.
 */
export function closeRuntime(): void {
  const holder = globalThis as RuntimeHolder;
  holder[RUNTIME_KEY]?.db.$client.close();
  holder[RUNTIME_KEY]?.release();
  delete holder[RUNTIME_KEY];
}
