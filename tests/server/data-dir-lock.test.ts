/**
 * One server per data directory (4.18). A second server on the same directory
 * marked the first one's running reviews interrupted as it started, and the
 * two could migrate one database at once.
 *
 * The lock is SQLite's, released by the operating system when its process
 * ends (D-118), so every other server here is a real process.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lockHolderPath, lockPath } from "@/lib/paths";
import { DataDirInUseError, DataDirLockError, acquireDataDirLock } from "@/server/data-dir-lock";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOLDER = join(REPO_ROOT, "tests", "fixtures", "hold-data-dir-lock.mts");

let dataDir: string;
let releases: (() => void)[];
let others: ChildProcess[];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-lock-"));
  releases = [];
  others = [];
});

afterEach(async () => {
  for (const release of releases) release();
  for (const other of others) {
    // A process killed by a signal has a signal code and no exit code.
    if (other.exitCode === null && other.signalCode === null) {
      other.kill("SIGKILL");
      await new Promise((resolve) => other.once("exit", resolve));
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function take(dir = dataDir): () => void {
  const release = acquireDataDirLock(dir);
  releases.push(release);
  return release;
}

/** Another server holding the lock, alive until the test ends or kills it. */
async function anotherServerHolding(
  dir = dataDir,
): Promise<{ pid: number; process: ChildProcess }> {
  const other = spawn(process.execPath, ["--import", "tsx", HOLDER, dir, "hold"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });
  others.push(other);
  const line = await new Promise<string>((resolve) =>
    other.stdout!.once("data", (chunk) => resolve(String(chunk).trim())),
  );
  expect(line).toMatch(/^held \d+$/);
  return { pid: Number(line.split(" ")[1]), process: other };
}

/** What another server starting now would get: "held" or the error's name. */
function anotherServerTrying(dir = dataDir): string {
  const result = spawnSync(process.execPath, ["--import", "tsx", HOLDER, dir, "try"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  return result.stdout.trim().split(" ")[0]!;
}

describe("the data directory lock", () => {
  it("keeps another server out while held, and lets it in once given back", () => {
    const release = take();
    expect(anotherServerTrying()).toBe("DataDirInUseError");
    release();
    expect(anotherServerTrying()).toBe("held");
  }, 60_000);

  it("is taken again by the process that holds it", () => {
    // The runtime is opened afresh in one process after closeRuntime, as the
    // route tests do.
    take();
    expect(() => take()).not.toThrow();
  });

  it("refuses while another server holds it, naming that server's process", async () => {
    const other = await anotherServerHolding();
    expect(() => take()).toThrow(DataDirInUseError);
    expect(() => take()).toThrow(new RegExp(`process ${other.pid},`));
  }, 60_000);

  it("is released by the operating system when its holder dies, however it dies", async () => {
    // What a crash or a killed terminal leaves behind is no lock at all.
    const other = await anotherServerHolding();
    other.process.kill("SIGKILL");
    await new Promise((resolve) => other.process.once("exit", resolve));
    expect(() => take()).not.toThrow();
  }, 60_000);

  it("leaves alone a file at its path that it did not write", () => {
    writeFileSync(lockPath(dataDir), "not a database at all, and not ours to delete\n");
    expect(() => take()).toThrow(DataDirLockError);
    expect(() => take()).toThrow(/is not a lock Trysquare wrote, so it is left alone/);
    expect(readFileSync(lockPath(dataDir), "utf8")).toContain("not ours to delete");
  });

  it("gives the lock back when it cannot record its holder (D-119 review)", () => {
    // Taken, then kept by a handle nothing held, so the next attempt in the
    // same process was refused as another server.
    mkdirSync(lockHolderPath(dataDir));
    expect(() => take()).toThrow(DataDirLockError);
    expect(() => take()).toThrow(/server-lock\.pid/);
    rmSync(lockHolderPath(dataDir), { recursive: true });
    expect(() => take()).not.toThrow();
  });
});

describe("two servers starting together (D-118)", () => {
  it("lets exactly one take each lock, new or left by a server that stopped", async () => {
    // A lock file managed by hand let both take it, one start in ten on
    // Windows before D-116 and still now and then on macOS after it.
    // Thirty: the faults this has caught, both holding one start in ten and
    // both refusing every time, show in the first few.
    const trials = 30;
    for (let trial = 0; trial < trials; trial += 1) {
      const dir = join(dataDir, `dir-${trial}`);
      mkdirSync(dir);
      // Half begin with a lock a server took and gave back.
      if (trial % 2 === 0) acquireDataDirLock(dir)();
    }
    const worker = join(REPO_ROOT, "tests", "fixtures", "lock-race-worker.mts");
    const workers = ["a", "b"].map((id) =>
      spawn(process.execPath, ["--import", "tsx", worker, dataDir, id, String(trials)], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      }),
    );
    others.push(...workers);
    const waitFor = async (paths: string[]) => {
      while (!paths.every((path) => existsSync(path))) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    };
    for (let trial = 0; trial < trials; trial += 1) {
      await waitFor(["a", "b"].map((id) => join(dataDir, `ready-${trial}-${id}`)));
      writeFileSync(join(dataDir, `go-${trial}`), "");
      const results = ["a", "b"].map((id) => join(dataDir, `result-${trial}-${id}`));
      await waitFor(results);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const outcomes = results.map((path) => readFileSync(path, "utf8")).sort();
      expect(outcomes, `trial ${trial}`).toEqual(["DataDirInUseError", "held"]);
    }
  }, 120_000);
});

describe("the lock and the runtime", () => {
  it("is refused by the runtime before it touches the database", async () => {
    await anotherServerHolding();
    const previous = process.env.TRYSQUARE_DATA;
    process.env.TRYSQUARE_DATA = dataDir;
    try {
      const { runtime } = await import("@/server/runtime");
      expect(() => runtime()).toThrow(DataDirInUseError);
      expect(existsSync(join(dataDir, "db.sqlite"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TRYSQUARE_DATA;
      else process.env.TRYSQUARE_DATA = previous;
    }
  }, 60_000);

  it("is given back by closing the runtime", async () => {
    const previous = process.env.TRYSQUARE_DATA;
    process.env.TRYSQUARE_DATA = dataDir;
    try {
      const { closeRuntime, runtime } = await import("@/server/runtime");
      runtime();
      expect(anotherServerTrying()).toBe("DataDirInUseError");
      closeRuntime();
      expect(anotherServerTrying()).toBe("held");
    } finally {
      if (previous === undefined) delete process.env.TRYSQUARE_DATA;
      else process.env.TRYSQUARE_DATA = previous;
    }
  }, 60_000);

  it("is refused at startup with the reason, and the server exits", () => {
    // Left running, a refused server answered every request with a 500.
    take();
    const started = spawnSync(
      process.execPath,
      ["--import", "tsx", join(REPO_ROOT, "tests", "fixtures", "start-node-hook.mts")],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, TRYSQUARE_DATA: dataDir },
        timeout: 60_000,
      },
    );
    expect(started.status).toBe(1);
    expect(started.stderr).toContain(`Another Trysquare server, process ${process.pid},`);
    expect(existsSync(join(dataDir, "db.sqlite"))).toBe(false);
  }, 60_000);
});
