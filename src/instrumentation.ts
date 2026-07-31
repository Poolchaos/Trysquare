/**
 * What runs once, when the server starts.
 *
 * Next calls `register()` a single time per server process, which is the only
 * hook that fits work that must not run per request: opening the database,
 * migrating it, and recovering reviews that a previous process left marked as
 * running. A review in that state cannot be running, because nothing survived
 * the restart that could be running it, and until it is recovered it can
 * neither be started nor cancelled.
 *
 * Every import is inside the function and behind the runtime check. Next builds
 * this file for its edge runtime as well, where none of it can load, and a
 * top-level import of anything touching node:path fails that build.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { homedir } = await import("node:os");
  const { dbPath, resolveDataDir } = await import("@/lib/paths");
  const { createDb } = await import("@/server/db/client");
  const { runMigrations } = await import("@/server/db/migrate");
  const { jobManager } = await import("@/server/jobs/manager");

  const dataDir = resolveDataDir(process.env, homedir());
  const db = createDb(dbPath(dataDir));
  runMigrations(db);
  jobManager().init({ db, dataDir });
}
