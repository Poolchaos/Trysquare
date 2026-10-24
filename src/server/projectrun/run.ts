/**
 * A project's own commands, run in its throwaway copy (WP-I, D-191). The
 * only module that spawns them, as only gitops spawns git and only the
 * engine spawns claude: they are the branch's own code, run as the person,
 * so where they run and for how long is decided in one place.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { isScreenshotName } from "@/lib/review/design";
import { projectCommandEnv } from "@/lib/projects/command-env";
import type { ProjectChecks } from "@/lib/projects/checks";

export interface CommandResult {
  /** install, tests or e2e. */
  step: "install" | "tests" | "e2e";
  command: string;
  /** Null when it was stopped, by its time limit or a cancel. */
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  logPath: string;
  /** The output's last lines, enough to say why it failed. */
  tail: string;
}

/** A project's test or e2e suite may be slow, but a hang is a failure. */
export const COMMAND_TIME_LIMIT_MS = 20 * 60_000;
const TAIL_CHARS = 4000;

/**
 * Stops the command and everything it started. A shell's children outlive
 * the shell when only it is killed: an e2e server left serving the copy
 * held it open on Windows and kept its port.
 */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on(
      "error",
      () => {},
    );
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Gone already.
  }
}

/**
 * How long a command's output may go on arriving after it exits: a process
 * it left in the background can hold the pipes open, and waiting for them
 * to close hung the review for as long as it lived (review round 7).
 */
const CLOSE_GRACE_MS = 2000;

export function runProjectCommand(options: {
  step: CommandResult["step"];
  command: string;
  cwd: string;
  logPath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<CommandResult> {
  const started = Date.now();
  const result = (
    outcome: Pick<CommandResult, "exitCode" | "timedOut" | "cancelled" | "tail">,
  ): CommandResult => ({
    step: options.step,
    command: options.command,
    ...outcome,
    durationMs: Date.now() - started,
    logPath: options.logPath,
  });
  // A cancel that came before the command is one it never hears: an abort
  // event fires once, and a listener added after it waits for ever.
  const cancelledBefore = () =>
    result({ exitCode: null, timedOut: false, cancelled: true, tail: "" });
  if (options.signal?.aborted === true) return Promise.resolve(cancelledBefore());

  return mkdir(dirname(options.logPath), { recursive: true }).then(
    () =>
      new Promise<CommandResult>((resolve) => {
        if (options.signal?.aborted === true) {
          resolve(cancelledBefore());
          return;
        }
        const log = createWriteStream(options.logPath);
        let logFailed = false;
        let tail = "";
        let timedOut = false;
        let cancelled = false;
        let exited = false;
        let settled = false;
        // A log that cannot be written, a full disk say, is said in the tail;
        // unheard, its error event would end the server.
        log.on("error", (error) => {
          logFailed = true;
          tail = (tail + `\n${error.message}\n`).slice(-TAIL_CHARS);
        });
        // Through the platform's shell, as the person would type it: a
        // command such as "npm ci && npm test" is one line of shell.
        const child = spawn(options.command, {
          cwd: options.cwd,
          shell: true,
          env: projectCommandEnv(process.env) as NodeJS.ProcessEnv,
          windowsHide: true,
          // Its own process group off Windows, so the whole tree can be killed.
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
        const take = (chunk: Buffer) => {
          if (!logFailed) log.write(chunk);
          tail = (tail + chunk.toString("utf8")).slice(-TAIL_CHARS);
        };
        child.stdout?.on("data", take);
        child.stderr?.on("data", take);

        // Not once the shell has exited on Windows: its id is free to belong
        // to another process by then, whose tree taskkill would end.
        const stop = () => {
          if (child.pid === undefined) return;
          if (exited && process.platform === "win32") return;
          killTree(child.pid);
        };
        const timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, options.timeoutMs ?? COMMAND_TIME_LIMIT_MS);
        const onAbort = () => {
          if (exited) return;
          cancelled = true;
          stop();
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        let grace: NodeJS.Timeout | undefined;

        const settle = (exitCode: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(grace);
          options.signal?.removeEventListener("abort", onAbort);
          child.stdout?.destroy();
          child.stderr?.destroy();
          const outcome = result({
            exitCode: timedOut || cancelled ? null : exitCode,
            timedOut,
            cancelled,
            tail,
          });
          if (logFailed) resolve(outcome);
          else log.end(() => resolve(outcome));
        };
        child.on("error", (error) => {
          take(Buffer.from(`\n${error.message}\n`));
          settle(null);
        });
        child.on("exit", (code) => {
          exited = true;
          clearTimeout(timer);
          // What it left in its group off Windows: the copy is removed next,
          // and a server still serving it would hold it and its port.
          if (process.platform !== "win32" && child.pid !== undefined && !timedOut && !cancelled) {
            killTree(child.pid);
          }
          grace = setTimeout(() => settle(code), CLOSE_GRACE_MS);
        });
        child.on("close", (code) => settle(code));
      }),
  );
}

/** A screenshot copied out of the copy, which is removed after. */
export interface Screenshot {
  /** Relative to screenshotsDir, with forward slashes, as the e2e named it. */
  name: string;
  /** Of its bytes: a grade replayed on resume must be of this same image. */
  sha256: string;
}

/**
 * The most screenshots graded, and the largest: each eight is a request,
 * and each one graded C or D is carried whole in the report (review round 8).
 */
export const SCREENSHOT_LIMIT = 200;
export const SCREENSHOT_BYTES = 8 * 1024 * 1024;

/**
 * The longest side the CLI's Read shows a model, larger images scaled to
 * fit: measured 2026-10-24 with 2.1.301, a 1280x12000 PNG shown as
 * 213x2000, and a 1900x1900 one whole (D-201).
 */
export const READ_MAX_SIDE = 2000;

export interface ChecksRun {
  commands: CommandResult[];
  screenshots: Screenshot[];
  /** What was not copied, and why, each said to the person. */
  screenshotsLeft: string[];
  /** Copied, but shown to the graders smaller than saved, each said. */
  screenshotsScaled: string[];
}

/** A PNG's width and height, from its header, or null for one without it. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function pngsUnder(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) found.push(full);
    }
  };
  await walk(root);
  return found;
}

/**
 * The screenshot folder, resolved, when it is inside the copy; false when a
 * link committed at that path leads elsewhere on this machine, as the
 * design standard is refused (review round 9); null when it is not there.
 */
async function insideCopy(copyDir: string, folder: string): Promise<string | false | null> {
  try {
    const root = await realpath(copyDir);
    const resolved = await realpath(join(copyDir, folder));
    const inside = relative(root, resolved);
    return isAbsolute(inside) || inside.split(sep)[0] === ".." ? false : resolved;
  } catch {
    return null;
  }
}

/**
 * Install, then tests, then e2e, each that is set. A failed install stops
 * the rest, which would only fail for its sake. The screenshots the e2e saved
 * are copied out, since the copy goes when the review is done with it.
 */
export async function runProjectChecks(options: {
  checks: ProjectChecks;
  copyDir: string;
  logDir: string;
  screenshotsDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ChecksRun> {
  const { checks } = options;
  const steps = (
    [
      ["install", checks.installCommand],
      ["tests", checks.testCommand],
      ["e2e", checks.e2eCommand],
    ] as const
  ).filter((step): step is readonly [CommandResult["step"], string] => step[1] !== null);

  const commands: CommandResult[] = [];
  for (const [step, command] of steps) {
    const result = await runProjectCommand({
      step,
      command,
      cwd: options.copyDir,
      logPath: join(options.logDir, `${step}.log`),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    commands.push(result);
    if (result.cancelled) break;
    if (step === "install" && result.exitCode !== 0) break;
  }

  const ranE2e = commands.some((result) => result.step === "e2e" && !result.cancelled);
  const screenshots: Screenshot[] = [];
  const screenshotsLeft: string[] = [];
  const screenshotsScaled: string[] = [];
  const from =
    ranE2e && checks.screenshotDir !== null
      ? await insideCopy(options.copyDir, checks.screenshotDir)
      : null;
  if (from === false) {
    screenshotsLeft.push(
      `The screenshot folder ${checks.screenshotDir} leads outside the branch, so nothing in it was graded.`,
    );
  } else if (from !== null) {
    // By name, as said, not by this machine's path order: Windows sorts
    // its backslashes apart from the slashes a name has (review round 9).
    const found = (await pngsUnder(from))
      .map((png) => ({ png, name: relative(from, png).split(sep).join("/") }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const { png, name } of found) {
      if (!isScreenshotName(name)) {
        screenshotsLeft.push(
          `${JSON.stringify(name)} was not graded: a name with a line break, ": ", a backslash, a drive or a space at either end cannot be listed in a grading request.`,
        );
        continue;
      }
      const bytes = (await stat(png)).size;
      if (bytes > SCREENSHOT_BYTES) {
        screenshotsLeft.push(
          `${name} was not graded: at ${bytes} bytes it is over the ${SCREENSHOT_BYTES}-byte limit.`,
        );
        continue;
      }
      if (screenshots.length === SCREENSHOT_LIMIT) {
        screenshotsLeft.push(
          `Only the first ${SCREENSHOT_LIMIT} screenshots, by name, were graded; ${name} and the rest after it were not.`,
        );
        break;
      }
      const to = join(options.screenshotsDir, ...name.split("/"));
      await mkdir(dirname(to), { recursive: true });
      await copyFile(png, to);
      const copied = await readFile(to);
      const sha256 = createHash("sha256").update(copied).digest("hex");
      screenshots.push({ name, sha256 });
      const size = pngSize(copied);
      if (size !== null && Math.max(size.width, size.height) > READ_MAX_SIDE) {
        const scale = READ_MAX_SIDE / Math.max(size.width, size.height);
        screenshotsScaled.push(
          `${name} is ${size.width}x${size.height}; the graders see it scaled to about ${Math.round(size.width * scale)}x${Math.round(size.height * scale)}, so its detail may be lost.`,
        );
      }
    }
  }
  return { commands, screenshots, screenshotsLeft, screenshotsScaled };
}
