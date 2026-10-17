/**
 * One server per data directory (4.18).
 *
 * A server starting marks every review it finds running as interrupted,
 * which is right after a crash and wrong while another server is running
 * them; and two servers starting together could migrate one database at once.
 * So the first holds a lock file naming its process, and a second refuses to
 * start while that process is alive.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { lockPath } from "@/lib/paths";

export class DataDirInUseError extends Error {
  constructor(
    readonly dataDir: string,
    readonly pid: number,
  ) {
    super(
      `Another Trysquare server, process ${pid}, is using ${dataDir}. Stop it first, or point ` +
        `TRYSQUARE_DATA at another directory. If no such process is running, delete ` +
        `${lockPath(dataDir)} and start again.`,
    );
    this.name = "DataDirInUseError";
  }
}

/** Takes the lock, and returns the function that gives it back. */
export function acquireDataDirLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const path = lockPath(dataDir);
  const release = () => {
    // Only ever this process's own lock: one a later server has taken over
    // is not ours to remove.
    if (holderOf(path) === process.pid) rmSync(path, { force: true });
  };

  // Twice at most: a stale lock is removed once and the write tried again. A
  // second server racing for the same stale lock then finds the winner's.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(
        path,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        {
          flag: "wx",
        },
      );
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = holderOf(path);
      if (holder === process.pid) return release;
      if (holder !== null && isRunning(holder)) throw new DataDirInUseError(dataDir, holder);
      // Left by a process that is gone, or cut short as it was written.
      rmSync(path, { force: true });
    }
  }
  const holder = holderOf(path);
  if (holder !== null) throw new DataDirInUseError(dataDir, holder);
  throw new Error(
    `Could not take the lock at ${path}: another server may be starting on ${dataDir} at the ` +
      "same moment. Start again.",
  );
}

function holderOf(path: string): number | null {
  try {
    const pid = (JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown }).pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
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
