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
import { createDb, type Db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { jobManager, type JobManager } from "./jobs/manager";

const RUNTIME_KEY = Symbol.for("trysquare.runtime");

interface RuntimeHolder {
  [RUNTIME_KEY]?: { db: Db; dataDir: string };
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
    const db = createDb(dbPath(dataDir));
    runMigrations(db);
    jobManager().init({ db, dataDir });
    holder[RUNTIME_KEY] = { db, dataDir };
  }

  const { db, dataDir } = holder[RUNTIME_KEY];
  return { db, dataDir, manager: jobManager() };
}
