/**
 * Whether the machine has a managed Claude Code policy, looked for read-only
 * where the CLI reads one (D-174 item 3).
 *
 * A policy outranks every flag the app passes: the bundled 2.1.301 binary
 * adds the policy tier to whatever `--setting-sources` allows, as 2.1.306
 * does, so a review reading no settings still runs under it. It can set the model, the tools, an
 * apiKeyHelper or another provider, so it is said rather than overridden.
 *
 * The places are the binary's own: a managed-settings.json in a folder fixed
 * per platform, the .json files of a managed-settings.d beside it, and on
 * Windows a registry value under HKLM and HKCU. Not looked for, since nothing
 * on this machine shows them: a macOS MDM profile, whose reader the Windows
 * binary does not carry, and a policy an organisation's account delivers.
 */

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ManagedPolicy {
  /** Each file or registry value holding a policy. */
  found: string[];
  /** Each place that could not be looked at, with why. */
  unchecked: string[];
}

interface Options {
  platform?: NodeJS.Platform;
  /** The folder the CLI reads, fixed per platform; the binary ignores any override. */
  dir?: string;
  registry?: { keys: string[]; value: string };
}

const POLICY_DIRS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "/Library/Application Support/ClaudeCode",
  // Literal in the binary, not %ProgramFiles%.
  win32: "C:\\Program Files\\ClaudeCode",
};

const REGISTRY = {
  keys: ["HKLM\\SOFTWARE\\Policies\\ClaudeCode", "HKCU\\SOFTWARE\\Policies\\ClaudeCode"],
  value: "Settings",
};

// The binary's own wait for reg.exe.
const REGISTRY_TIMEOUT_MS = 5_000;

export async function findManagedPolicy(options: Options = {}): Promise<ManagedPolicy> {
  const platform = options.platform ?? process.platform;
  const dir = options.dir ?? POLICY_DIRS[platform] ?? "/etc/claude-code";
  const policy: ManagedPolicy = { found: [], unchecked: [] };

  const file = join(dir, "managed-settings.json");
  try {
    if ((await stat(file)).isFile()) policy.found.push(file);
  } catch (error) {
    if (!isAbsence(error)) policy.unchecked.push(`${file}: ${messageOf(error)}`);
  }

  const dropIns = join(dir, "managed-settings.d");
  try {
    const names = (await readdir(dropIns, { withFileTypes: true }))
      .filter(
        (entry) =>
          (entry.isFile() || entry.isSymbolicLink()) &&
          entry.name.endsWith(".json") &&
          !entry.name.startsWith("."),
      )
      .map((entry) => entry.name)
      .sort();
    policy.found.push(...names.map((name) => join(dropIns, name)));
  } catch (error) {
    if (!isAbsence(error)) policy.unchecked.push(`${dropIns}: ${messageOf(error)}`);
  }

  if (platform === "win32") {
    const { keys, value } = options.registry ?? REGISTRY;
    const answers = await Promise.all(keys.map((key) => registryHolds(key, value)));
    keys.forEach((key, i) => {
      const answer = answers[i];
      if (answer === true) policy.found.push(`${key}\\${value}`);
      else if (typeof answer === "string") policy.unchecked.push(`${key}\\${value}: ${answer}`);
    });
  }
  return policy;
}

function isAbsence(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True when reg.exe finds the value, false when it does not, or why it could
 * not be asked. Exit 1 is reg.exe's answer for a key or value not there, and
 * for any other refusal too: its words for which are translated, so they are
 * not read.
 */
function registryHolds(key: string, value: string): Promise<boolean | string> {
  const reg = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  return new Promise((resolve) => {
    execFile(
      reg,
      ["query", key, "/v", value],
      { timeout: REGISTRY_TIMEOUT_MS, windowsHide: true },
      (error) => {
        if (error === null) resolve(true);
        else if (error.code === 1) resolve(false);
        else resolve(error.killed ? "reg.exe did not answer in time" : error.message);
      },
    );
  });
}
