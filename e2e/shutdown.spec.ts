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

  const base = `http://127.0.0.1:${port}`;
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
  const cliPid = Number(readFileSync(pidFile, "utf8"));
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
  try {
    server.kill("SIGKILL");
    await exited(server);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(isAlive(cliPid)).toBe(true);
  } finally {
    if (isAlive(cliPid)) process.kill(cliPid, "SIGKILL");
  }
});

test("a server told to stop stops its stage's CLI before it exits", async () => {
  const { server, cliPid } = await serverMidStage(3102);
  try {
    server.kill("SIGTERM");
    await exited(server);
    await expect.poll(() => isAlive(cliPid), { timeout: 15_000 }).toBe(false);
  } finally {
    if (isAlive(cliPid)) process.kill(cliPid, "SIGKILL");
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
  }
});
