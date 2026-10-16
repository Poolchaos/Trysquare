/**
 * Which program "claude" is, as something this process can actually start.
 *
 * Spawning the bare name worked on Linux, where PATH lookup finds an
 * executable file, and nowhere else it was tried. On Windows, measured
 * 2026-10-16 with Node 22.17: a bare name is ENOENT unless an `.exe` of that
 * name is on PATH; a `.cmd` throws EINVAL synchronously, because Node will not
 * run a batch file without a shell; a `.mjs` throws EFTYPE, because a shebang
 * means nothing there. A shell is not the answer: the arguments carry a
 * system prompt and would need quoting rules that differ per shell.
 *
 * So the command is resolved here, once, to a real executable or to Node plus
 * a script, and every caller spawns the result directly.
 */

import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { buildChildEnv } from "@/lib/engine/command";

/**
 * The oldest Claude Code a review stage runs on. Stages pass their system
 * prompt with `--system-prompt-file`, and 2.1.301 is the only version this
 * project has measured accepting it (D-91, 2026-10-16). Probes and the
 * sign-in check do not need it and run on anything.
 */
export const MINIMUM_CLI_VERSION = "2.1.301";

export interface CliCommand {
  /** What to spawn. */
  command: string;
  /** Arguments that go before the CLI's own, such as the script Node runs. */
  prefixArgs: readonly string[];
  /** The path a person would recognise, for messages and run notes. */
  display: string;
}

export class CliNotFoundError extends Error {
  constructor(
    readonly command: string,
    readonly searched: readonly string[],
  ) {
    super(
      `Could not find "${command}", the Claude Code CLI, on PATH. Install it, or set ` +
        "TRYSQUARE_CLAUDE_PATH to its full path. Searched: " +
        (searched.length === 0 ? "(PATH is empty)" : searched.join(delimiter)),
    );
    this.name = "CliNotFoundError";
  }
}

export class CliUnusableError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`The Claude Code CLI at ${path} cannot be started: ${reason}`);
    this.name = "CliUnusableError";
  }
}

export class CliTooOldError extends Error {
  constructor(
    readonly path: string,
    readonly version: string,
  ) {
    super(
      `The Claude Code CLI at ${path} is version ${version}; reviews need ${MINIMUM_CLI_VERSION} ` +
        "or newer. Update Claude Code (current versions update with `claude update`).",
    );
    this.name = "CliTooOldError";
  }
}

/** The first `x.y.z` in what `--version` printed, as numbers. */
export function parseCliVersion(output: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isAtLeast(version: readonly number[], minimum: readonly number[]): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    const have = version[index] ?? 0;
    const need = minimum[index] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

/**
 * Asked once per CLI per process: the answer only changes when someone updates
 * the CLI, which makes it newer. A failure is not remembered, so the run after
 * an update sees the new version without a restart.
 */
const supportedVersions = new Map<string, Promise<string>>();

/** Forgets every answer, for when the configured CLI changes under a running server. */
export function forgetCliVersions(): void {
  supportedVersions.clear();
}

/** Resolves to the version text, or rejects when the CLI is too old or will not say. */
export function checkCliVersion(cli: CliCommand, timeoutMs = 30_000): Promise<string> {
  const key = [cli.command, ...cli.prefixArgs].join("\0");
  const known = supportedVersions.get(key);
  if (known) return known;

  const asked = new Promise<string>((resolveVersion, reject) => {
    const unreadable = (detail: string) =>
      new CliUnusableError(cli.display, `\`--version\` did not report a version (${detail}).`);
    try {
      const child = execFile(
        cli.command,
        [...cli.prefixArgs, "--version"],
        {
          timeout: timeoutMs,
          env: buildChildEnv(process.env) as NodeJS.ProcessEnv,
          encoding: "utf8",
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(unreadable((stderr || error.message).trim().slice(0, 300)));
            return;
          }
          const version = parseCliVersion(stdout);
          if (version === null) {
            reject(unreadable(`it printed "${stdout.trim().slice(0, 120)}"`));
            return;
          }
          const minimum = parseCliVersion(MINIMUM_CLI_VERSION) ?? [];
          if (!isAtLeast(version, minimum)) {
            reject(new CliTooOldError(cli.display, version.join(".")));
            return;
          }
          resolveVersion(stdout.trim());
        },
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end();
    } catch (error) {
      reject(unreadable((error as Error).message));
    }
  });
  supportedVersions.set(key, asked);
  asked.catch(() => supportedVersions.delete(key));
  return asked;
}

export interface CliEnvironment {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** The Node binary that runs a script target. */
  nodePath: string;
  /** A regular file this process may execute. */
  isRunnable: (path: string) => boolean;
  /** A regular file that exists, whatever its mode. */
  isFile: (path: string) => boolean;
  readText: (path: string) => string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function realCliEnvironment(): CliEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    nodePath: process.execPath,
    isFile,
    isRunnable: (path) => {
      if (!isFile(path)) return false;
      // Windows has no execute bit; whether a file runs is its extension.
      if (process.platform === "win32") return true;
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    readText: (path) => readFileSync(path, "utf8"),
  };
}

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const BATCH_EXTENSIONS = new Set([".cmd", ".bat"]);

function forScript(path: string, nodePath: string): CliCommand {
  return { command: nodePath, prefixArgs: [path], display: path };
}

/**
 * The program an npm `.cmd` shim launches. npm's cmd-shim writes the target
 * as a quoted path under `%dp0%`, the shim's own directory, for example
 * `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*`, and
 * for a script target precedes it with the Node it found. Reading that line
 * gives the real program, which can be spawned without a shell.
 *
 * The launch line is the last quoted `%dp0%` path. A script shim also tests
 * `IF EXIST "%dp0%\node.exe"` first, and in an nvm directory that file is
 * real, so taking the first match would have launched Node in place of the CLI.
 */
function shimTarget(shimPath: string, cli: CliEnvironment): CliCommand | null {
  let text: string;
  try {
    text = cli.readText(shimPath);
  } catch {
    return null;
  }
  const relative = [...text.matchAll(/"%~?dp0%?\\([^"%]+)"/gi)].at(-1)?.[1];
  if (relative === undefined) return null;
  const target = resolve(dirname(shimPath), ...relative.split("\\"));
  if (!cli.isFile(target)) return null;
  const extension = extname(target).toLowerCase();
  if (extension === ".exe") return { command: target, prefixArgs: [], display: shimPath };
  if (SCRIPT_EXTENSIONS.has(extension)) {
    return { command: cli.nodePath, prefixArgs: [target], display: shimPath };
  }
  return null;
}

function fromPath(path: string, cli: CliEnvironment): CliCommand {
  const extension = extname(path).toLowerCase();
  if (SCRIPT_EXTENSIONS.has(extension)) {
    if (!cli.isFile(path)) throw new CliUnusableError(path, "no such file.");
    return forScript(path, cli.nodePath);
  }
  if (cli.platform === "win32" && BATCH_EXTENSIONS.has(extension)) {
    const target = shimTarget(path, cli);
    if (target !== null) return target;
    throw new CliUnusableError(
      path,
      "it is a batch file, which Windows runs only through a shell, and it does not name a " +
        "program this app can start instead. Point TRYSQUARE_CLAUDE_PATH at claude.exe.",
    );
  }
  if (!cli.isRunnable(path)) {
    throw new CliUnusableError(
      path,
      cli.isFile(path) ? "the file is not executable." : "no such file.",
    );
  }
  return { command: path, prefixArgs: [], display: path };
}

/** PATHEXT order decides which of `claude.exe` and `claude.cmd` Windows would run. */
function candidateNames(name: string, cli: CliEnvironment): string[] {
  if (cli.platform !== "win32" || extname(name) !== "") return [name];
  const extensions = (cli.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension !== "");
  return extensions.map((extension) => `${name}${extension}`);
}

function searchPath(name: string, cli: CliEnvironment): CliCommand {
  const raw = cli.env.PATH ?? cli.env.Path ?? "";
  const directories = raw.split(delimiter).filter((directory) => directory.trim() !== "");
  let unusable: CliUnusableError | null = null;
  for (const directory of directories) {
    for (const file of candidateNames(name, cli)) {
      const candidate = join(directory, file);
      if (!cli.isFile(candidate)) continue;
      try {
        return fromPath(candidate, cli);
      } catch (error) {
        // Keep looking: a later PATH entry may hold a usable copy, and only
        // when none does is the first refusal the one worth reporting.
        if (error instanceof CliUnusableError) unusable ??= error;
        else throw error;
      }
    }
  }
  if (unusable !== null) throw unusable;
  throw new CliNotFoundError(name, directories);
}

/**
 * Resolves the CLI from an explicit path when one is configured, otherwise
 * from PATH the way the platform's own shell would. A configured value with
 * no directory in it is a name to look up on PATH, as a shell reads it.
 */
export function resolveCli(
  configured: string | undefined,
  cli: CliEnvironment = realCliEnvironment(),
): CliCommand {
  const explicit = configured?.trim() ?? "";
  if (explicit === "") return searchPath("claude", cli);
  if (!/[\\/]/.test(explicit)) return searchPath(explicit, cli);
  return fromPath(isAbsolute(explicit) ? explicit : resolve(explicit), cli);
}
