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
 * Environment for every git child process.
 *
 * Prompts are disabled so a missing credential fails instead of hanging, and
 * the locale is pinned so parsing never depends on the user's language.
 */
export function gitEnv(
  credentialHelpers: readonly string[],
  base: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    SSH_ASKPASS: "echo",
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
    LANG: "C",
  };
  // Appended after any the user set, which GIT_CONFIG_COUNT numbers from 0.
  const existing = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10) || 0;
  credentialHelpers.forEach((helper, offset) => {
    env[`GIT_CONFIG_KEY_${existing + offset}`] = "credential.helper";
    env[`GIT_CONFIG_VALUE_${existing + offset}`] = helper;
  });
  if (credentialHelpers.length > 0) {
    env.GIT_CONFIG_COUNT = String(existing + credentialHelpers.length);
  }
  return env;
}

/**
 * The credential helpers the system git config names, read once.
 *
 * GIT_CONFIG_NOSYSTEM stays, because system config is where Git for Windows
 * sets `core.autocrlf=true`, and that would rewrite the line endings of every
 * worktree the model reads. But it is also where Git for Windows registers
 * its credential manager, so a private HTTPS repository had no way to
 * authenticate at all (D-91, MVP-PLAN 3.5). Only the helpers come back, in
 * their order, empty values included, since an empty one resets the list.
 */
let systemHelpers: Promise<string[]> | undefined;

export function systemCredentialHelpers(): Promise<string[]> {
  systemHelpers ??= new Promise((resolve) => {
    execFile(
      "git",
      ["config", "--system", "--get-all", "credential.helper"],
      {
        timeout: 10_000,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" },
      },
      // Exit 1 is "no such key", and no system file says the same; either way
      // there is nothing to forward.
      (error, stdout) => {
        if (error || stdout === "") resolve([]);
        else resolve(stdout.replace(/\r?\n$/, "").split(/\r?\n/));
      },
    );
  });
  return systemHelpers;
}

export async function git(args: readonly string[], options: GitRunOptions = {}): Promise<string> {
  const { stdout } = await gitWithStderr(args, options);
  return stdout;
}

export async function gitWithStderr(
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const helpers = await systemCredentialHelpers();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env: gitEnv(helpers) as NodeJS.ProcessEnv,
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
