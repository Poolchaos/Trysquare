/**
 * The environment is checked against a real git, with a global config the
 * test writes itself, so the result does not depend on how the machine
 * running the suite is configured.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitEnv, standInConfigText, systemGitConfig } from "@/server/gitops/run";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trysquare-gitenv-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** git as the app runs it, but with this test's global config. */
function gitWith(system: string, global: string, args: string[]): string {
  const env = gitEnv(
    { kind: "standIn", path: system },
    { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: global, HOME: dir, USERPROFILE: dir },
  );
  try {
    return execFileSync("git", args, { env: env as NodeJS.ProcessEnv, encoding: "utf8" });
  } catch {
    return "";
  }
}

describe("the system config git is given", () => {
  it("declares the helpers in order, keeping an empty one, quoted as git reads them", () => {
    const text = standInConfigText(["", 'C:/Program Files/Git/git-credential-manager.exe "x"']);
    const file = join(dir, "system.gitconfig");
    writeFileSync(file, text);
    const read = execFileSync("git", ["config", "--file", file, "--get-all", "credential.helper"], {
      encoding: "utf8",
    });
    expect(read.split(/\r?\n/).slice(0, 2)).toEqual([
      "",
      'C:/Program Files/Git/git-credential-manager.exe "x"',
    ]);
  });

  it("puts the system helper before global config, so a global reset still clears it", () => {
    // The order native git uses. Forwarding the helper at command scope put
    // it after global config, so a user's `helper =` reset no longer applied.
    const system = join(dir, "system.gitconfig");
    const global = join(dir, "global.gitconfig");
    writeFileSync(system, standInConfigText(["manager"]));
    writeFileSync(global, "[credential]\n\thelper =\n\thelper = store\n");

    const scoped = gitWith(system, global, [
      "config",
      "--show-scope",
      "--get-all",
      "credential.helper",
    ]);
    expect(scoped.split(/\r?\n/).filter(Boolean)).toEqual([
      "system\tmanager",
      "global\t",
      "global\tstore",
    ]);
  });

  it("reads nothing else from the real system config, line endings included", () => {
    const system = join(dir, "system.gitconfig");
    const global = join(dir, "global.gitconfig");
    writeFileSync(system, standInConfigText(["manager"]));
    writeFileSync(global, "");
    expect(gitWith(system, global, ["config", "--get", "core.autocrlf"])).toBe("");
    expect(gitWith(system, global, ["config", "--system", "--list"]).trim()).toBe(
      "credential.helper=manager",
    );
  });

  it("switches system config off entirely when there is no stand-in", () => {
    const env = gitEnv({ kind: "none" }, { GIT_CONFIG_SYSTEM: "/somewhere" });
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_CONFIG_SYSTEM).toBeUndefined();
  });

  it("keeps prompts off whichever way system config goes", () => {
    for (const system of [{ kind: "none" } as const, { kind: "standIn", path: "x" } as const]) {
      const env = gitEnv(system, {});
      expect(env.GIT_TERMINAL_PROMPT).toBe("0");
      expect(env.LC_ALL).toBe("C");
    }
  });

  it("builds a stand-in this machine's git actually reads", async () => {
    // Whatever this machine's system config holds, the app either uses a
    // stand-in git was seen reading, or switches system config off.
    const system = await systemGitConfig();
    if (system.kind === "standIn") {
      const origins = execFileSync("git", ["config", "--system", "--list", "--show-origin"], {
        env: gitEnv(system) as NodeJS.ProcessEnv,
        encoding: "utf8",
      });
      for (const line of origins.split(/\r?\n/).filter(Boolean)) {
        expect(line.replace(/\\/g, "/").toLowerCase()).toContain(
          system.path.replace(/\\/g, "/").toLowerCase(),
        );
      }
    } else {
      expect(gitEnv(system).GIT_CONFIG_NOSYSTEM).toBe("1");
    }
  });
});
