/**
 * Stopping the production server while a review runs (4.5).
 *
 * On POSIX a child outlives its parent, so a server stopped mid-stage left its
 * claude process running, and spending, after it was gone. The server's own
 * SIGTERM handler now stops every run first. Driven against `next start`
 * itself, because what is under test is Next's handler and this app's running
 * in the right order, and no unit test can hold Next's half.
 *
 * Each server gets a data directory of its own, seeded before it boots, so
 * stopping it touches nothing the other projects use. Skipped on Windows,
 * where there is nothing to prevent: a SIGTERM there is TerminateProcess and
 * runs no handler, and a server killed that way took its stage's CLI with it
 * within two seconds when this ran unskipped on Windows 11 (2026-10-17).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { APP_REPO, E2E_ROOT, FAKE_CLI, PROTOCOL_PATH } from "./setup";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const NEXT_BIN = join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next");

test.skip(process.platform === "win32", "a killed server takes its children with it on Windows");

/**
 * Everything a test started, registered the moment it exists. A setup that
 * failed part way used to leave its server holding the port, so the next run
 * met it instead of its own (review of 4.5 to 4.7).
 */
const launched: { servers: ChildProcess[]; clis: number[] } = { servers: [], clis: [] };

test.afterEach(async () => {
  for (const pid of launched.clis.splice(0)) if (isAlive(pid)) process.kill(pid, "SIGKILL");
  for (const server of launched.servers.splice(0)) {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      await exited(server);
    }
  }
});

/** How long after the server exits the CLI's fate is read. */
const AFTER_EXIT_MS = 2_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A data directory holding one review, ready to start, and the ruleset to start it with. */
async function seed(dataDir: string): Promise<{ reviewId: string; rulesetId: string }> {
  const { dbPath } = await import("@/lib/paths");
  const { importProtocol } = await import("@/lib/rulesets/import");
  const { createDb } = await import("@/server/db/client");
  const { runMigrations } = await import("@/server/db/migrate");
  const { createProject } = await import("@/server/db/repositories/projects");
  const { createReview } = await import("@/server/db/repositories/reviews");
  const { saveImportedRuleset } = await import("@/server/db/repositories/rulesets");
  const { cloneBare, mergeBase, resolveBranch } = await import("@/server/gitops/repo");

  const clonePath = join(dataDir, "app.git");
  await cloneBare(APP_REPO, clonePath);
  const base = await mergeBase(clonePath, "main", "feature/rename-prefs");

  const db = createDb(dbPath(dataDir));
  try {
    runMigrations(db);
    const project = createProject(db, {
      name: "app",
      gitUrl: APP_REPO,
      defaultBranch: "main",
      clonePath,
    });
    const { rulesetId } = saveImportedRuleset(db, {
      name: "Example protocol",
      tier: "global",
      imported: importProtocol(readFileSync(PROTOCOL_PATH, "utf8")).ruleset,
    });
    const review = createReview(db, {
      projectId: project.id,
      fromBranch: "feature/rename-prefs",
      fromCommit: await resolveBranch(clonePath, "feature/rename-prefs"),
      intoBranch: "main",
      intoCommit: await resolveBranch(clonePath, "main"),
      mergeBaseCommit: base,
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
    });
    return { reviewId: review.id, rulesetId };
  } finally {
    db.$client.close();
  }
}

/**
 * A production server running a review whose first stage's CLI hangs, and
 * that CLI's process id. Waits until the CLI has started, so the signal finds
 * a stage in flight rather than the preparation before it.
 */
async function serverMidStage(port: number): Promise<{ server: ChildProcess; cliPid: number }> {
  const dataDir = mkdtempSync(join(E2E_ROOT, "shutdown-"));
  const { reviewId, rulesetId } = await seed(dataDir);
  const pidFile = join(dataDir, "cli.pid");
  const base = `http://127.0.0.1:${port}`;

  // Something already answering here would pass for this server.
  const occupied = await fetch(`${base}/api/settings`).then(
    () => true,
    () => false,
  );
  expect(occupied, `port ${port} is already in use`).toBe(false);

  // `next start` itself, not through npm, so the signal reaches the server
  // and not a shell or npm's own process in front of it.
  const server = spawn(process.execPath, [NEXT_BIN, "start", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TRYSQUARE_DATA: dataDir,
      TRYSQUARE_CLAUDE_PATH: FAKE_CLI,
      FAKE_CLAUDE_SCENARIO: "hang",
      FAKE_CLAUDE_PID_FILE: pidFile,
    },
    stdio: "ignore",
  });
  launched.servers.push(server);

  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${base}/api/settings`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(200);

  const started = await fetch(`${base}/api/reviews/${reviewId}/start`, {
    method: "POST",
    body: JSON.stringify({ rulesetId }),
  });
  expect(started.status).toBe(200);

  await expect.poll(() => existsSync(pidFile), { timeout: 60_000 }).toBe(true);
  // Refused unless it is a real pid: the cleanup above sends SIGKILL to it,
  // and to process.kill a pid of 0 is the test runner's own process group
  // (review of the D-133 fixes).
  const pidText = readFileSync(pidFile, "utf8");
  const cliPid = Number(pidText);
  if (!Number.isInteger(cliPid) || cliPid <= 0) throw new Error(`The pid file held "${pidText}".`);
  launched.clis.push(cliPid);
  expect(isAlive(cliPid)).toBe(true);
  return { server, cliPid };
}

function exited(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => server.once("exit", () => resolve()));
}

test("a server killed outright leaves its stage's CLI running, which is what SIGTERM must prevent", async () => {
  // The control: nothing in the server runs on SIGKILL, so if the CLI outlives
  // this server, the test can see an orphan, and the SIGTERM test below
  // passing means the handler stopped it rather than the platform.
  const { server, cliPid } = await serverMidStage(3101);
  server.kill("SIGKILL");
  await exited(server);
  await new Promise((resolve) => setTimeout(resolve, AFTER_EXIT_MS));
  expect(isAlive(cliPid)).toBe(true);
});

test("a server told to stop takes its stage's CLI down with it", async () => {
  // The same window as the control, so the two differ only in the signal: it
  // used to allow fifteen seconds here against the control's two.
  const { server, cliPid } = await serverMidStage(3102);
  server.kill("SIGTERM");
  await exited(server);
  await expect.poll(() => isAlive(cliPid), { timeout: AFTER_EXIT_MS }).toBe(false);
});
