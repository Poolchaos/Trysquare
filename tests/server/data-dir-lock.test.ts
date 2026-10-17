/**
 * One server per data directory (4.18). A second server on the same directory
 * marked the first one's running reviews interrupted as it started, and the
 * two could migrate one database at once.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * A pid no process can have: odd, so never a Windows pid, and above the pid
 * limit on Linux and macOS. The pid of a process that had exited was handed
 * to another while the whole suite ran, and one trial of the race then found
 * the stale lock's holder alive and both racers rightly refused (D-117).
 */
function deadPid(): number {
  return 2_147_483_647;
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

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

describe("two servers starting together (D-116)", () => {
  it("lets exactly one take each lock, stale or not", async () => {
    // Taking over a stale lock by reading then removing it let both go on as
    // its holder in about one start in ten, released together like this.
    const trials = 100;
    for (let trial = 0; trial < trials; trial += 1) {
      const dir = join(dataDir, `dir-${trial}`);
      mkdirSync(dir);
      if (trial % 2 === 0) writeFileSync(lockPath(dir), JSON.stringify({ pid: deadPid() }));
    }
    const worker = join(REPO_ROOT, "tests", "fixtures", "lock-race-worker.mts");
    const workers = ["a", "b"].map((id) =>
      spawn(process.execPath, [TSX, worker, dataDir, id, String(trials)], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      }),
    );
    const waitFor = async (paths: string[]) => {
      while (!paths.every((path) => existsSync(path))) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    };
    try {
      for (let trial = 0; trial < trials; trial += 1) {
        await waitFor(["a", "b"].map((id) => join(dataDir, `ready-${trial}-${id}`)));
        writeFileSync(join(dataDir, `go-${trial}`), "");
        const results = ["a", "b"].map((id) => join(dataDir, `result-${trial}-${id}`));
        await waitFor(results);
        await new Promise((resolve) => setTimeout(resolve, 2));
        const outcomes = results.map((path) => readFileSync(path, "utf8")).sort();
        expect(outcomes, `trial ${trial}`).toEqual(["DataDirInUseError", "held"]);
      }
    } finally {
      for (const child of workers) child.kill();
    }
  }, 120_000);
});

describe("giving the lock back", () => {
  it("is done by closing the runtime, so it can be opened again", async () => {
    const previous = process.env.TRYSQUARE_DATA;
    process.env.TRYSQUARE_DATA = dataDir;
    try {
      const { closeRuntime, runtime } = await import("@/server/runtime");
      runtime();
      expect(JSON.parse(readFileSync(lockPath(dataDir), "utf8")).pid).toBe(process.pid);
      closeRuntime();
      expect(existsSync(lockPath(dataDir))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TRYSQUARE_DATA;
      else process.env.TRYSQUARE_DATA = previous;
    }
  });

  it("is refused at startup with the reason, and the server exits", () => {
    // Left running, a refused server answered every request with a 500.
    writeFileSync(lockPath(dataDir), JSON.stringify({ pid: process.pid }));
    const started = spawnSync(
      process.execPath,
      [TSX, join(REPO_ROOT, "tests", "fixtures", "start-node-hook.mts")],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, TRYSQUARE_DATA: dataDir },
        timeout: 60_000,
      },
    );
    expect(started.status).toBe(1);
    expect(started.stderr).toContain(`Another Trysquare server, process ${process.pid}`);
    expect(existsSync(join(dataDir, "db.sqlite"))).toBe(false);
  }, 60_000);
});
