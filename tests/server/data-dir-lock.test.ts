/**
 * One server per data directory (4.18). A second server on the same directory
 * marked the first one's running reviews interrupted as it started, and the
 * two could migrate one database at once.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lockPath } from "@/lib/paths";
import { DataDirInUseError, acquireDataDirLock } from "@/server/data-dir-lock";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-lock-"));
});

afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

/** A process that is still running while the test looks at it. */
function liveProcess(): { pid: number; stop: () => void } {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  return { pid: child.pid!, stop: () => child.kill() };
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", "0"]).pid!;
}

describe("the data directory lock", () => {
  it("is taken by writing this process's id, and released by removing it", () => {
    const release = acquireDataDirLock(dataDir);
    expect(JSON.parse(readFileSync(lockPath(dataDir), "utf8")).pid).toBe(process.pid);
    release();
    expect(existsSync(lockPath(dataDir))).toBe(false);
  });

  it("is taken again by the process that holds it", () => {
    // The runtime is opened afresh in one process after closeRuntime, as the
    // route tests do.
    acquireDataDirLock(dataDir);
    expect(() => acquireDataDirLock(dataDir)).not.toThrow();
  });

  it("refuses a second server while the first one is running, naming it", () => {
    const other = liveProcess();
    try {
      writeFileSync(lockPath(dataDir), JSON.stringify({ pid: other.pid }));
      expect(() => acquireDataDirLock(dataDir)).toThrow(DataDirInUseError);
      expect(() => acquireDataDirLock(dataDir)).toThrow(new RegExp(`process ${other.pid}`));
    } finally {
      other.stop();
    }
  });

  it("takes over a lock left by a server that is no longer running", () => {
    // What a crash or a killed terminal leaves behind.
    writeFileSync(lockPath(dataDir), JSON.stringify({ pid: deadPid() }));
    acquireDataDirLock(dataDir);
    expect(JSON.parse(readFileSync(lockPath(dataDir), "utf8")).pid).toBe(process.pid);
  });

  it("takes over a lock file it cannot read", () => {
    writeFileSync(lockPath(dataDir), '{"pi');
    expect(() => acquireDataDirLock(dataDir)).not.toThrow();
  });

  it("does not remove a lock another process has since taken", () => {
    const release = acquireDataDirLock(dataDir);
    const other = liveProcess();
    try {
      writeFileSync(lockPath(dataDir), JSON.stringify({ pid: other.pid }));
      release();
      expect(JSON.parse(readFileSync(lockPath(dataDir), "utf8")).pid).toBe(other.pid);
    } finally {
      other.stop();
    }
  });
});

describe("opening the runtime on a data directory another server holds", () => {
  it("refuses before touching the database", async () => {
    const other = liveProcess();
    const previous = process.env.TRYSQUARE_DATA;
    process.env.TRYSQUARE_DATA = dataDir;
    try {
      writeFileSync(lockPath(dataDir), JSON.stringify({ pid: other.pid }));
      const { runtime } = await import("@/server/runtime");
      expect(() => runtime()).toThrow(DataDirInUseError);
      // Refused before the database was opened, let alone migrated.
      expect(existsSync(join(dataDir, "db.sqlite"))).toBe(false);
    } finally {
      other.stop();
      if (previous === undefined) delete process.env.TRYSQUARE_DATA;
      else process.env.TRYSQUARE_DATA = previous;
    }
  });
});
