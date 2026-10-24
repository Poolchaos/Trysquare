/**
 * A project's own commands, run in its throwaway copy (WP-I, step 2):
 * their exit, their output kept, their time limit and a cancel each taking
 * the whole process tree down, and the screenshots an e2e saved copied out.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_CHECKS } from "@/lib/projects/checks";
import { runProjectChecks, runProjectCommand } from "@/server/projectrun/run";

let root: string;
const node = `"${process.execPath}"`;
/** A script file, so no command depends on how a shell quotes. */
const script = (name: string, body: string) => {
  const path = join(root, `${name}.cjs`);
  writeFileSync(path, body);
  return `${node} "${path}"`;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "trysquare-projectrun-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("one of a project's commands", () => {
  it("reports its exit and keeps its output", async () => {
    const passed = await runProjectCommand({
      step: "tests",
      command: script("passes", 'console.log("all good"); console.error("a warning");'),
      cwd: root,
      logPath: join(root, "logs", "passes.log"),
    });
    expect(passed).toMatchObject({ exitCode: 0, timedOut: false, cancelled: false });
    expect(readFileSync(passed.logPath, "utf8")).toContain("all good");
    expect(passed.tail).toContain("a warning");

    const failed = await runProjectCommand({
      step: "tests",
      command: script("fails", 'console.log("1 failing"); process.exit(3);'),
      cwd: root,
      logPath: join(root, "logs", "fails.log"),
    });
    expect(failed.exitCode).toBe(3);
    expect(failed.tail).toContain("1 failing");
  });

  it("runs in the copy, without the app's or Claude's environment", async () => {
    process.env.TRYSQUARE_DATA_PROBE = "the app's";
    process.env.ANTHROPIC_API_KEY_PROBE = "a key";
    try {
      const result = await runProjectCommand({
        step: "tests",
        command: script(
          "env",
          "console.log(process.cwd());" +
            'console.log("app=" + (process.env.TRYSQUARE_DATA_PROBE ?? "none"));' +
            'console.log("key=" + (process.env.ANTHROPIC_API_KEY_PROBE ?? "none"));' +
            'console.log("path=" + (process.env.PATH || process.env.Path ? "kept" : "none"));',
        ),
        cwd: root,
        logPath: join(root, "logs", "env.log"),
      });
      expect(result.tail).toContain("app=none");
      expect(result.tail).toContain("key=none");
      expect(result.tail).toContain("path=kept");
    } finally {
      delete process.env.TRYSQUARE_DATA_PROBE;
      delete process.env.ANTHROPIC_API_KEY_PROBE;
    }
  });

  // A grandchild that writes a marker a moment later, under a parent that
  // waits long after: a kill of the shell alone left the grandchild to write.
  const lingering = (name: string) => {
    const marker = join(root, `${name}.marker`);
    const command = script(
      name,
      `const { spawn } = require("node:child_process");
       spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(" + JSON.stringify(${JSON.stringify(marker)}) + ", 'x'), 1500)"], { stdio: "ignore" });
       setTimeout(() => {}, 20000);`,
    );
    return { marker, command };
  };

  it("is stopped at its time limit, with everything it started", async () => {
    const { marker, command } = lingering("slow");
    const result = await runProjectCommand({
      step: "e2e",
      command,
      cwd: root,
      logPath: join(root, "logs", "slow.log"),
      timeoutMs: 500,
    });
    expect(result).toMatchObject({ exitCode: null, timedOut: true, cancelled: false });
    expect(result.durationMs).toBeLessThan(10_000);
    await sleep(2500);
    expect(existsSync(marker)).toBe(false);
  });

  it("is stopped by a cancel, with everything it started", async () => {
    const { marker, command } = lingering("cancelled");
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 500);
    const result = await runProjectCommand({
      step: "e2e",
      command,
      cwd: root,
      logPath: join(root, "logs", "cancelled.log"),
      signal: abort.signal,
    });
    expect(result).toMatchObject({ exitCode: null, timedOut: false, cancelled: true });
    await sleep(2500);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("a project's checks in turn", () => {
  const copyWith = (name: string) => {
    const copyDir = join(root, name);
    mkdirSync(copyDir, { recursive: true });
    return copyDir;
  };

  it("stop after a failed install, which the rest would only fail for", async () => {
    const copyDir = copyWith("install-fails");
    const run = await runProjectChecks({
      checks: {
        ...NO_CHECKS,
        enabled: true,
        installCommand: script("install-fails", "process.exit(1);"),
        testCommand: script("never-run", 'console.log("ran");'),
      },
      copyDir,
      logDir: join(copyDir, "..", "install-fails-logs"),
      screenshotsDir: join(copyDir, "..", "install-fails-shots"),
    });
    expect(run.commands.map((command) => [command.step, command.exitCode])).toEqual([
      ["install", 1],
    ]);
  });

  it("run install, tests, then e2e, and copy out the screenshots the e2e saved", async () => {
    const copyDir = copyWith("all-three");
    const shots = join(root, "all-three-shots");
    const run = await runProjectChecks({
      checks: {
        enabled: true,
        installCommand: script("install", 'console.log("installed");'),
        testCommand: script("tests", "process.exit(1);"),
        e2eCommand: script(
          "e2e",
          `const fs = require("node:fs"), path = require("node:path");
           const dir = path.join(process.cwd(), "e2e", "screens", "phone");
           fs.mkdirSync(dir, { recursive: true });
           fs.writeFileSync(path.join(dir, "home.png"), "png");
           fs.writeFileSync(path.join(process.cwd(), "e2e", "screens", "home.png"), "png");
           fs.writeFileSync(path.join(process.cwd(), "e2e", "screens", "notes.txt"), "not an image");`,
        ),
        screenshotDir: "e2e/screens",
        designStandardPath: null,
      },
      copyDir,
      logDir: join(root, "all-three-logs"),
      screenshotsDir: shots,
    });
    // A failing test does not stop the e2e: each is its own finding.
    expect(run.commands.map((command) => [command.step, command.exitCode])).toEqual([
      ["install", 0],
      ["tests", 1],
      ["e2e", 0],
    ]);
    expect(run.screenshots).toEqual([join(shots, "home.png"), join(shots, "phone", "home.png")]);
    expect(readFileSync(join(shots, "phone", "home.png"), "utf8")).toBe("png");
  });

  it("copy no screenshot when no e2e ran", async () => {
    const copyDir = copyWith("no-e2e");
    mkdirSync(join(copyDir, "e2e", "screens"), { recursive: true });
    writeFileSync(join(copyDir, "e2e", "screens", "old.png"), "left by someone");
    const run = await runProjectChecks({
      checks: {
        ...NO_CHECKS,
        enabled: true,
        testCommand: script("tests-only", "process.exit(0);"),
        screenshotDir: "e2e/screens",
      },
      copyDir,
      logDir: join(root, "no-e2e-logs"),
      screenshotsDir: join(root, "no-e2e-shots"),
    });
    expect(run.screenshots).toEqual([]);
  });
});
