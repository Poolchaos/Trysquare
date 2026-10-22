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
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  /** Written to git's stdin, which is then closed. */
  input?: string;
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

/**
 * Puts the stand-in at its path without it ever being seen empty.
 *
 * Every copy of this module writes the same path, named for its text: the
 * instrumentation bundle's and the routes', and other servers'. Rewritten in
 * place, it was empty for a moment, and a git reading it then ran with no
 * system config, a private HTTPS fetch with no credential helper (review of
 * the D-148 fixes). A file already holding the text is left alone; otherwise
 * it is written beside it and renamed into place.
 *
 * Windows refuses a rename while another process has either file open: no
 * failure when the file there holds the same text, as another writer's does,
 * and otherwise tried again for a while, since antivirus and the indexer let
 * go within moments; graceful-fs retries renames for the same reason. Tried
 * often rather than backing off: each reader holds the file for moments, and
 * waits growing to 200ms gave about 15 tries in the window, which a reader
 * opening it again and again outlasted in 3 of 8 runs under full CPU load
 * (2026-10-21).
 */
async function writeStandIn(path: string, text: string): Promise<void> {
  if (await holds(path, text)) return;
  const partial = `${path}.${process.pid}.${randomUUID()}.partial`;
  // Never writable by others, whatever the umask: trusted() refuses it then.
  await writeFile(partial, text, { encoding: "utf8", mode: 0o644 });
  const deadline = Date.now() + RENAME_RETRY_MS;
  for (;;) {
    try {
      await rename(partial, path);
      return;
    } catch (error) {
      const refused = RENAME_REFUSALS.has((error as NodeJS.ErrnoException).code ?? "");
      const done = await holds(path, text);
      if (done || !refused || Date.now() + RENAME_RETRY_WAIT_MS > deadline) {
        // Its own refusal is no reason to fail the stand-in.
        await rm(partial, { force: true }).catch(() => undefined);
        if (done) return;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_WAIT_MS));
    }
  }
}

/**
 * Whether the file at the stand-in's path may be read as this machine's
 * system config. Its path is the shared temp folder and a hash of text
 * anyone can work out, so on a shared /tmp another user could put the right
 * text there first, keep the file, and later add a core.fsmonitor or a
 * credential helper that git runs as this user (security review of the
 * MVP, D-180). Only a plain file this user owns, which no one else can
 * write, is taken as it is; a link or a writable file is replaced. Windows
 * gives each user a temp folder of their own and no mode bits to read.
 */
async function trusted(path: string): Promise<boolean> {
  const stat = await lstat(path).catch(() => null);
  if (stat === null || !stat.isFile()) return false;
  if (process.platform === "win32") return true;
  return stat.uid === process.getuid?.() && (stat.mode & 0o022) === 0;
}

/** Whether the file at the path may be read as system config and holds this text. */
async function holds(path: string, text: string): Promise<boolean> {
  return (await trusted(path)) && (await readFile(path, "utf8").catch(() => null)) === text;
}

/** Whether another user holds the path, where this one can neither trust nor replace it. */
async function othersHold(path: string): Promise<boolean> {
  if (process.platform === "win32") return false;
  const stat = await lstat(path).catch(() => null);
  return stat !== null && stat.uid !== process.getuid?.();
}

const RENAME_REFUSALS = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_MS = 2_000;
const RENAME_RETRY_WAIT_MS = 5;

let systemConfig: Promise<{ config: SystemConfig; text: string }> | undefined;

/**
 * Built once per process, and checked again on every call: a stand-in no
 * longer trusted or no longer holding its text is built again, since a temp
 * cleaner can remove it under a running server and another user make it
 * again (D-181 item 4). A stand-in is used only once git has been seen to
 * read it: a git too old to know GIT_CONFIG_SYSTEM would silently read the
 * real file instead, autocrlf and all, so then system config is switched off
 * and private HTTPS repositories go without their helper rather than worktrees
 * going without their line endings. One that fails is not kept: kept, its
 * failure was every git call's until the server restarted (review of the
 * D-149 fixes).
 */
export async function systemGitConfig(): Promise<SystemConfig> {
  const cached = systemConfig;
  if (cached !== undefined) {
    const { config, text } = await cached;
    if (config.kind === "none" || (await holds(config.path, text))) return config;
    // A full build, not a rewrite: another user may hold the shared path now.
    // Only the first caller to find it stale drops it; the rest share the build.
    if (systemConfig === cached) systemConfig = undefined;
  }
  return (await (systemConfig ??= buildSystemConfig())).config;
}

function buildSystemConfig(): Promise<{ config: SystemConfig; text: string }> {
  return (async (): Promise<{ config: SystemConfig; text: string }> => {
    const plain = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" };
    const read = await runGit(["config", "--system", "--get-all", "credential.helper"], plain);
    // Exit 1 is "no such key"; no system file says the same.
    if (!read.ok && read.code !== 1) {
      systemConfig = undefined;
      return { config: { kind: "none" }, text: "" };
    }
    const helpers =
      read.ok && read.stdout !== "" ? read.stdout.replace(/\r?\n$/, "").split(/\r?\n/) : [];
    const text = standInConfigText(helpers);
    const shared = join(
      tmpdir(),
      `trysquare-system-${createHash("sha256").update(text).digest("hex").slice(0, 12)}.gitconfig`,
    );
    // Shared by every copy and server when it can be; one of this process's
    // own, in a folder only this user can open, when another user holds it.
    const path = (await othersHold(shared))
      ? join(await mkdtemp(join(tmpdir(), "trysquare-system-")), "system.gitconfig")
      : shared;
    await writeStandIn(path, text);

    const standIn: SystemConfig = { kind: "standIn", path };
    const seen = await runGit(["config", "--system", "--list", "--show-origin"], gitEnv(standIn));
    const normalise = (value: string) => value.replace(/\\/g, "/").toLowerCase();
    const honoured = seen.stdout
      .split(/\r?\n/)
      .filter((line) => line !== "")
      .every((line) => normalise(line).startsWith(`file:${normalise(path)}`));
    return { config: seen.code !== null && honoured ? standIn : { kind: "none" }, text };
  })().catch((error: unknown) => {
    systemConfig = undefined;
    throw error;
  });
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
    if (options.input !== undefined) {
      // An EPIPE here is git ending before it read, which its exit reports.
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.input);
    }
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
