/**
 * The only place in the application that spawns git.
 *
 * Every invocation is timeout-guarded, has its exit status checked separately
 * from its output, and passes arguments as an array so nothing reaches a
 * shell. Credential prompts are disabled: a repository the user cannot reach
 * must fail with a clear error rather than hang forever waiting for a password
 * nobody will type into a background process.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly timedOut: boolean,
  ) {
    super(
      timedOut
        ? `git ${args.join(" ")} timed out. A hang is a failure, not something to wait out.`
        : `git ${args.join(" ")} failed with exit code ${exitCode}: ${stderr.trim() || "(no stderr)"}`,
    );
    this.name = "GitCommandError";
  }
}

export interface GitRunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Bytes of output to accept before treating the command as runaway. */
  maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 256 * 1024 * 1024;

/**
 * What git reads as its system config: this machine's own system file, or a
 * stand-in holding only its credential helpers.
 *
 * The real system file is where Git for Windows sets `core.autocrlf=true`,
 * which would rewrite the line endings of every worktree the model reads, so
 * it is never read. It is also where Git for Windows registers its credential
 * manager, so with no system config at all a private HTTPS repository could
 * not authenticate (D-91). The stand-in carries the helpers and nothing else,
 * and sits where they came from, at system scope, so a user's global config
 * still overrides them as it would natively: an empty `helper =` there still
 * resets the list. Appending them at command scope instead put them after
 * global config and undid that reset (review of MVP phases 2 and 3).
 */
export type SystemConfig = { kind: "standIn"; path: string } | { kind: "none" };

export function gitEnv(
  system: SystemConfig,
  base: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...base,
    // Prompts are off so a missing credential fails instead of hanging, and
    // the locale is pinned so parsing never depends on the user's language.
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    SSH_ASKPASS: "echo",
    LC_ALL: "C",
    LANG: "C",
  };
  if (system.kind === "standIn") {
    env.GIT_CONFIG_SYSTEM = system.path;
    delete env.GIT_CONFIG_NOSYSTEM;
  } else {
    env.GIT_CONFIG_NOSYSTEM = "1";
    delete env.GIT_CONFIG_SYSTEM;
  }
  return env;
}

/** A gitconfig file declaring these helpers, empty values included, in order. */
export function standInConfigText(helpers: readonly string[]): string {
  const quoted = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return [
    "# Written by Trysquare: the credential helpers from this machine's system",
    "# git config, and nothing else from it.",
    "[credential]",
    ...helpers.map((helper) => (helper === "" ? "\thelper =" : `\thelper = ${quoted(helper)}`)),
    "",
  ].join("\n");
}

function runGit(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ ok: boolean; code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { timeout: 10_000, encoding: "utf8", windowsHide: true, env: env as NodeJS.ProcessEnv },
      (error, stdout) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
        resolve({ ok: error === null, code, stdout });
      },
    );
  });
}

let systemConfig: Promise<SystemConfig> | undefined;

/**
 * Built once per process. A stand-in is used only once git has been seen to
 * read it: a git too old to know GIT_CONFIG_SYSTEM would silently read the
 * real file instead, autocrlf and all, so then system config is switched off
 * and private HTTPS repositories go without their helper rather than worktrees
 * going without their line endings.
 */
export function systemGitConfig(): Promise<SystemConfig> {
  systemConfig ??= (async () => {
    const plain = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" };
    const read = await runGit(["config", "--system", "--get-all", "credential.helper"], plain);
    // Exit 1 is "no such key"; no system file says the same.
    if (!read.ok && read.code !== 1) {
      systemConfig = undefined;
      return { kind: "none" };
    }
    const helpers =
      read.ok && read.stdout !== "" ? read.stdout.replace(/\r?\n$/, "").split(/\r?\n/) : [];
    const text = standInConfigText(helpers);
    const path = join(
      tmpdir(),
      `trysquare-system-${createHash("sha256").update(text).digest("hex").slice(0, 12)}.gitconfig`,
    );
    await writeFile(path, text, "utf8");

    const standIn: SystemConfig = { kind: "standIn", path };
    const seen = await runGit(["config", "--system", "--list", "--show-origin"], gitEnv(standIn));
    const normalise = (value: string) => value.replace(/\\/g, "/").toLowerCase();
    const honoured = seen.stdout
      .split(/\r?\n/)
      .filter((line) => line !== "")
      .every((line) => normalise(line).startsWith(`file:${normalise(path)}`));
    return seen.code !== null && honoured ? standIn : { kind: "none" };
  })();
  return systemConfig;
}

export async function git(args: readonly string[], options: GitRunOptions = {}): Promise<string> {
  const { stdout } = await gitWithStderr(args, options);
  return stdout;
}

export async function gitWithStderr(
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const system = await systemGitConfig();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env: gitEnv(system) as NodeJS.ProcessEnv,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        const timedOut =
          (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true &&
          (error as NodeJS.ErrnoException & { signal?: string }).signal !== null;
        const exitCode = typeof error.code === "number" ? error.code : null;
        reject(new GitCommandError(args, exitCode, stderr || error.message, timedOut));
      },
    );
    child.on("error", (error) => {
      reject(new GitCommandError(args, null, String(error), false));
    });
  });
}

/**
 * Runs git and returns its output as bytes, for content that is compared
 * exactly: decoding as text first can make two different byte strings equal.
 */
export async function gitBytes(
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<Buffer> {
  const system = await systemGitConfig();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env: gitEnv(system) as NodeJS.ProcessEnv,
        encoding: "buffer",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const timedOut =
          (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true &&
          (error as NodeJS.ErrnoException & { signal?: string }).signal !== null;
        const exitCode = typeof error.code === "number" ? error.code : null;
        reject(
          new GitCommandError(args, exitCode, stderr.toString("utf8") || error.message, timedOut),
        );
      },
    );
    child.on("error", (error) => {
      reject(new GitCommandError(args, null, String(error), false));
    });
  });
}

/** Runs git and returns whether it succeeded, for genuinely optional checks. */
export async function gitSucceeds(
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<boolean> {
  try {
    await git(args, options);
    return true;
  } catch {
    return false;
  }
}

/** Splits git output that is one record per line, discarding the trailing blank. */
export function toLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
}
