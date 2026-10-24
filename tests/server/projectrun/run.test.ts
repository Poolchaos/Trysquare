/**
 * A project's own commands, run in its throwaway copy (WP-I, step 2):
 * their exit, their output kept, their time limit and a cancel each taking
 * the whole process tree down, and the screenshots an e2e saved copied out.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_CHECKS } from "@/lib/projects/checks";
import {
  SCREENSHOT_BYTES,
  SCREENSHOT_LIMIT,
  runProjectChecks,
  runProjectCommand,
} from "@/server/projectrun/run";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

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

  // A grandchild that writes a marker well after the kill, under a parent
  // that says once it exists and then waits long after: a kill of the shell
  // alone left the grandchild to write. The parent's line proves the
  // grandchild was there to be killed, so a kill that came first proves
  // nothing and fails (review round 7).
  const lingering = (name: string) => {
    const marker = join(root, `${name}.marker`);
    const command = script(
      name,
      `const { spawn } = require("node:child_process");
       spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(" + JSON.stringify(${JSON.stringify(marker)}) + ", 'x'), 4500)"], { stdio: "ignore" });
       console.log("grandchild spawned");
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
      timeoutMs: 2500,
    });
    expect(result).toMatchObject({ exitCode: null, timedOut: true, cancelled: false });
    expect(result.tail).toContain("grandchild spawned");
    expect(result.durationMs).toBeLessThan(15_000);
    await sleep(5000);
    expect(existsSync(marker)).toBe(false);
  }, 30_000);

  it("is stopped by a cancel, with everything it started", async () => {
    const { marker, command } = lingering("cancelled");
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 2500);
    const result = await runProjectCommand({
      step: "e2e",
      command,
      cwd: root,
      logPath: join(root, "logs", "cancelled.log"),
      signal: abort.signal,
    });
    expect(result).toMatchObject({ exitCode: null, timedOut: false, cancelled: true });
    expect(result.tail).toContain("grandchild spawned");
    expect(result.durationMs).toBeLessThan(15_000);
    await sleep(5000);
    expect(existsSync(marker)).toBe(false);
  }, 30_000);

  it("never starts once cancelled, though the cancel came first", async () => {
    // An abort event fires once; a listener added after it never heard it,
    // and the command ran to its limit (review round 7).
    const marker = join(root, "never.marker");
    const abort = new AbortController();
    abort.abort();
    const result = await runProjectCommand({
      step: "tests",
      command: script(
        "never",
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`,
      ),
      cwd: root,
      logPath: join(root, "logs", "never.log"),
      signal: abort.signal,
    });
    expect(result).toMatchObject({ exitCode: null, cancelled: true });
    await sleep(1000);
    expect(existsSync(marker)).toBe(false);
  });

  it("ends when it exits, though something it started still holds its output", async () => {
    // A background process sharing the pipes kept them open, and waiting for
    // them to close hung the review for its whole life (review round 7).
    const result = await runProjectCommand({
      step: "tests",
      command: script(
        "leaves-a-child",
        `const { spawn } = require("node:child_process");
         spawn(process.execPath, ["-e", "setTimeout(() => {}, 8000)"], { stdio: "inherit", cwd: require("node:os").tmpdir() });
         console.log("passed, leaving a helper running");
         process.exit(0);`,
      ),
      cwd: root,
      logPath: join(root, "logs", "leaves-a-child.log"),
    });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, cancelled: false });
    expect(result.tail).toContain("passed, leaving a helper running");
    expect(result.durationMs).toBeLessThan(6000);
  }, 30_000);
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
    // By the name the e2e gave each, and the hash of what it saved.
    expect(run.screenshots).toEqual([
      { name: "home.png", sha256: sha256("png") },
      { name: "phone/home.png", sha256: sha256("png") },
    ]);
    expect(run.screenshotsLeft).toEqual([]);
    expect(readFileSync(join(shots, "phone", "home.png"), "utf8")).toBe("png");
  });

  /** An e2e command whose body saves screenshots under e2e/screens. */
  const saving = (name: string, body: string) => ({
    ...NO_CHECKS,
    enabled: true,
    e2eCommand: script(
      name,
      `const fs = require("node:fs"), path = require("node:path");
       const dir = path.join(process.cwd(), "e2e", "screens");
       fs.mkdirSync(dir, { recursive: true });
       ${body}`,
    ),
    screenshotDir: "e2e/screens",
  });

  it("leave out a screenshot over the size limit, and say so", async () => {
    const run = await runProjectChecks({
      checks: saving(
        "huge",
        `fs.writeFileSync(path.join(dir, "huge.png"), Buffer.alloc(${SCREENSHOT_BYTES + 1}));
         fs.writeFileSync(path.join(dir, "home.png"), "png");`,
      ),
      copyDir: copyWith("huge"),
      logDir: join(root, "huge-logs"),
      screenshotsDir: join(root, "huge-shots"),
    });
    expect(run.screenshots.map((shot) => shot.name)).toEqual(["home.png"]);
    expect(run.screenshotsLeft).toEqual([
      `huge.png was not graded: at ${SCREENSHOT_BYTES + 1} bytes it is over the ${SCREENSHOT_BYTES}-byte limit.`,
    ]);
    expect(existsSync(join(root, "huge-shots", "huge.png"))).toBe(false);
  });

  it("grade only the first screenshots up to the limit, and say where it stopped", async () => {
    const run = await runProjectChecks({
      checks: saving(
        "many",
        `for (let i = 0; i <= ${SCREENSHOT_LIMIT}; i++) {
           fs.writeFileSync(path.join(dir, \`s\${String(i).padStart(3, "0")}.png\`), "png");
         }`,
      ),
      copyDir: copyWith("many"),
      logDir: join(root, "many-logs"),
      screenshotsDir: join(root, "many-shots"),
    });
    expect(run.screenshots).toHaveLength(SCREENSHOT_LIMIT);
    expect(run.screenshotsLeft).toEqual([
      `Only the first ${SCREENSHOT_LIMIT} screenshots, by name, were graded; s${SCREENSHOT_LIMIT}.png and the rest after it were not.`,
    ]);
  });

  // Windows allows neither a colon nor a line break in a file name, so a
  // project there cannot save one; Linux and macOS can (CI runs both).
  it.skipIf(process.platform === "win32")(
    "leave out a name a grading request cannot list on one line",
    async () => {
      const run = await runProjectChecks({
        checks: saving(
          "unsayable",
          `fs.writeFileSync(path.join(dir, "a: b.png"), "png");
           fs.writeFileSync(path.join(dir, "two\\nlines.png"), "png");
           fs.writeFileSync(path.join(dir, "home.png"), "png");`,
        ),
        copyDir: copyWith("unsayable"),
        logDir: join(root, "unsayable-logs"),
        screenshotsDir: join(root, "unsayable-shots"),
      });
      expect(run.screenshots.map((shot) => shot.name)).toEqual(["home.png"]);
      expect(run.screenshotsLeft).toEqual([
        '"a: b.png" was not graded: a name with a line break or ": " in it cannot be listed in a grading request.',
        '"two\\nlines.png" was not graded: a name with a line break or ": " in it cannot be listed in a grading request.',
      ]);
    },
  );

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
