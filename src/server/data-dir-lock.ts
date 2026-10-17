/**
 * One server per data directory (4.18).
 *
 * A server starting marks every review it finds running as interrupted,
 * which is right after a crash and wrong while another server is running
 * them; and two servers starting together could migrate one database at once.
 * So the first holds a lock file naming its process, and a second refuses to
 * start while that process is alive.
 */

import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { lockPath } from "@/lib/paths";

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
    readonly pid: number,
  ) {
    super(
      `Another Trysquare server, process ${pid}, is using ${dataDir}. Stop it first, or point ` +
        `TRYSQUARE_DATA at another directory. If process ${pid} is not a Trysquare server, the ` +
        `system has reused the id of one that stopped: delete ${lockPath(dataDir)} and start ` +
        "again.",
    );
    this.name = "DataDirInUseError";
  }
}

/** How long a starting server waits on another one taking over a stale lock. */
const TAKEOVER_WAIT_MS = 3_000;
const RETRY_MS = 10;

/** Takes the lock, and returns the function that gives it back. */
export function acquireDataDirLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const path = lockPath(dataDir);
  const token = `${path}.takeover`;
  const release = () => {
    // Only ever this process's own lock: one a later server has taken over
    // is not ours to remove.
    if (holderOf(path) === process.pid) rmSync(path, { force: true });
  };

  const deadline = Date.now() + TAKEOVER_WAIT_MS;
  while (Date.now() < deadline) {
    if (createWhole(path)) return release;

    const seen = readText(path);
    const holder = holderIn(seen);
    if (holder === process.pid) return release;
    if (holder !== null && isRunning(holder)) throw new DataDirInUseError(dataDir, holder);

    // The lock is stale: its process is gone, or it cannot be read. Only the
    // process holding the takeover token may remove it, and only if it is
    // still the stale lock that was seen. Removing it unguarded let two
    // servers starting together each remove the other's fresh lock and both
    // go on as its holder (D-116).
    if (createWhole(token)) {
      try {
        if (readText(path) === seen) rmSync(path, { force: true });
      } finally {
        rmSync(token, { force: true });
      }
      continue;
    }
    const takingOver = holderOf(token);
    if (takingOver !== null && takingOver !== process.pid && !isRunning(takingOver)) {
      // A server that crashed part way through a takeover.
      rmSync(token, { force: true });
      continue;
    }
    pause(RETRY_MS);
  }
  throw new DataDirLockError(
    `Could not take the lock at ${path}: another server kept it in the middle of starting for ` +
      `${TAKEOVER_WAIT_MS / 1000} seconds. Start again.`,
  );
}

/**
 * Creates the file holding this process's id, whole or not at all. Written
 * aside first and linked into place, so no reader ever sees it half written,
 * and linking fails if the file already exists.
 */
function createWhole(path: string): boolean {
  const aside = `${path}.${process.pid}.writing`;
  writeFileSync(aside, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    linkSync(aside, path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM is Windows refusing a name whose file is being deleted.
    if (code === "EEXIST" || code === "EPERM") return false;
    throw error;
  } finally {
    rmSync(aside, { force: true });
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function holderIn(text: string | null): number | null {
  if (text === null) return null;
  try {
    const pid = (JSON.parse(text) as { pid?: unknown }).pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function holderOf(path: string): number | null {
  return holderIn(readText(path));
}

/** Signal 0 tests for a process without touching it; EPERM means it exists. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A synchronous wait: the runtime is opened synchronously, so it cannot await. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
