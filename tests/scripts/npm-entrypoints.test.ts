/**
 * The npm commands a new machine runs, exercised as a person runs them: the
 * exit codes and the output, not the functions under them. `npm run dev` must
 * stop at the doctor when the doctor fails, before Next starts.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXAMPLE = join(REPO_ROOT, "tests", "fixtures", "example-protocol.md");
const LIMIT_MS = 90_000;

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-npm-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

interface NpmRun {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Next printed its ready line, so the doctor let it start. */
  serverStarted: boolean;
}

/**
 * Stops npm and everything under it. Killing npm alone leaves `next dev`
 * running and holding its port (the same reason src/server/projectrun/run.ts
 * kills the tree).
 */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/**
 * Runs an npm script the way a person does, with the given environment added.
 * A dev server that comes up is killed with its tree straight away and
 * reported, so a broken predev fails this suite instead of leaving a server.
 */
function npm(args: string[], env: Record<string, string>): Promise<NpmRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: REPO_ROOT,
      env: { ...process.env, TRYSQUARE_DATA: dataDir, ...env },
      // Its own process group, so killTree reaches what npm started.
      detached: process.platform !== "win32",
      // npm is a .cmd on Windows, which Node will not start without a shell.
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let serverStarted = false;
    const timer = setTimeout(() => {
      killTree(child.pid!);
      reject(
        new Error(`npm ${args.join(" ")} did not finish in ${LIMIT_MS}ms:\n${stdout}${stderr}`),
      );
    }, LIMIT_MS);
    const watch = () => {
      if (!serverStarted && /Ready in/.test(stdout + stderr)) {
        serverStarted = true;
        killTree(child.pid!);
      }
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      watch();
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      watch();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, serverStarted });
    });
  });
}

describe("npm run dev", () => {
  it("stops at the doctor, before Next starts, when a required check fails", async () => {
    const result = await npm(["run", "dev"], {
      TRYSQUARE_CLAUDE_PATH: join(dataDir, "no-such-claude.mjs"),
    });

    expect(result.serverStarted).toBe(false);
    // The doctor's own line, which only predev prints. Not npm's "> predev"
    // banner: verify.sh runs the suite under `npm run --silent`, and the
    // nested npm inherits npm_config_loglevel=silent, so no banner is shown.
    expect(result.stdout).toMatch(/FAIL Claude Code CLI/);
    expect(result.stderr).toMatch(/required check\(s\) failed/);
    expect(result.status).toBe(1);
  });
});

describe("npm run rules:seed", () => {
  it("stores a protocol file and says what it stored", async () => {
    // One word: on Windows npm runs through a shell, which would split a quoted
    // name into three. A person's own shell keeps the quotes, as the README shows.
    const result = await npm(["run", "rules:seed", "--", EXAMPLE, "--name", "Base"], {});

    expect(result.stdout).toMatch(/Stored: "Base" \(global\), version 1, \d+ rules/);
    expect(result.status).toBe(0);
  });

  it("says the tier the ruleset keeps when an unchanged file asks for another", async () => {
    const seed = ["run", "rules:seed", "--", EXAMPLE, "--name", "Base"];
    await npm([...seed, "--tier", "tech"], {});

    const again = await npm([...seed, "--tier", "project"], {});

    expect(again.stdout).toMatch(/Unchanged: "Base" \(tech\), version 1, \d+ rules/);
    expect(again.stdout).toContain(
      "Tier project was not set: an unchanged document leaves the ruleset as it is.",
    );
    expect(again.status).toBe(0);
  });

  it("exits 2 with the usage when the name is missing", async () => {
    const result = await npm(["run", "rules:seed", "--", EXAMPLE], {});

    expect(result.stderr).toMatch(/Usage: npm run rules:seed/);
    expect(result.status).toBe(2);
  });
});
