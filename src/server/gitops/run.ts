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
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    SSH_ASKPASS: "echo",
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
    LANG: "C",
  };
}

export async function git(args: readonly string[], options: GitRunOptions = {}): Promise<string> {
  const { stdout } = await gitWithStderr(args, options);
  return stdout;
}

export function gitWithStderr(
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env: gitEnv(),
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
