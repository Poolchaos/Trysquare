/**
 * One server per data directory (4.18).
 *
 * A server starting marks every review it finds running as interrupted,
 * which is right after a crash and wrong while another server is running
 * them; and two servers starting together could migrate one database at once.
 *
 * The lock is SQLite's own: a small database beside the app's, held in
 * exclusive locking mode for as long as the server runs. The operating system
 * releases it when the process ends, however it ends, so there is no stale
 * lock to judge and no process id to trust. A lock file managed by hand
 * needed both, and on macOS two servers starting together each took it
 * (D-118). The holder's process id is written beside it, only so a refused
 * server can name it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { lockHolderPath, lockPath } from "@/lib/paths";

/** Any reason the lock could not be taken; the server cannot start. */
export class DataDirLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDirLockError";
  }
}

export class DataDirInUseError extends DataDirLockError {
  constructor(
    readonly dataDir: string,
    readonly pid: number | null,
  ) {
    super(
      `Another Trysquare server${pid === null ? "" : `, process ${pid},`} is using ${dataDir}. ` +
        "Stop it first, or point TRYSQUARE_DATA at another directory.",
    );
    this.name = "DataDirInUseError";
  }
}

/** Locks this process holds, so taking one it already holds is not refused. */
const held = new Map<string, Database.Database>();

/**
 * Takes the lock, and returns the function that gives it back.
 *
 * @param waitMs How long to wait on another server's lock before refusing.
 *   A second, no more: a server holding the lock keeps it for as long as it
 *   runs, so waiting longer is waiting for nothing. Without any wait, two
 *   servers taking the lock at the same instant could each find the other
 *   part way and both refuse. A test racing many starts shortens it.
 */
export function acquireDataDirLock(dataDir: string, waitMs = 1_000): () => void {
  mkdirSync(dataDir, { recursive: true });
  const path = lockPath(dataDir);
  const release = () => {
    held.get(path)?.close();
    held.delete(path);
  };
  if (held.has(path)) return release;

  const handle = new Database(path, { timeout: waitMs });
  try {
    // An exclusive transaction opened and never committed: it holds the lock
    // for as long as the connection is open, and a failed attempt lets go of
    // what it took. SQLite's exclusive locking mode was tried first and keeps
    // even a failed attempt's shared lock, so two servers starting together
    // each blocked the other and both refused.
    handle.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    handle.close();
    const code = (error as { code?: unknown }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
      throw new DataDirInUseError(dataDir, holderOf(dataDir));
    }
    if (code === "SQLITE_NOTADB") {
      throw new DataDirLockError(
        `${path} is not a lock Trysquare wrote, so it is left alone. If nothing else uses it, ` +
          "delete it and start again.",
      );
    }
    throw error;
  }
  writeFileSync(lockHolderPath(dataDir), String(process.pid));
  held.set(path, handle);
  return release;
}

function holderOf(dataDir: string): number | null {
  try {
    const pid = Number(readFileSync(lockHolderPath(dataDir), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
