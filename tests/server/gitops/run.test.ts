/**
 * The environment is checked against a real git, with a global config the
 * test writes itself, so the result does not depend on how the machine
 * running the suite is configured.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("the stand-in's file", () => {
    // In this test's own directory: the machine's temp directory holds the
    // stand-in a running server and every other test worker read, and these
    // tests remove and rewrite it (review of the D-149 fixes).
    async function ownCopy() {
      vi.resetModules();
      vi.doMock("node:os", async (importOriginal) => ({
        ...(await importOriginal<typeof import("node:os")>()),
        tmpdir: () => dir,
      }));
      return import("@/server/gitops/run");
    }
    afterEach(() => {
      vi.doUnmock("node:os");
      vi.doUnmock("node:fs/promises");
    });

    it("is never empty while another copy writes it", async () => {
      // Every copy of this module writes the same path, named for its text:
      // the instrumentation bundle's and the routes', and other servers'.
      // Rewritten in place it was empty for a moment, and a git reading it
      // then ran with no system config, a private HTTPS fetch with no
      // credential helper (review of the D-148 fixes).
      const system = await (await ownCopy()).systemGitConfig();
      // Nothing is written on a machine whose git ignores the stand-in.
      if (system.kind !== "standIn") return;
      expect(dirname(system.path)).toBe(dir);
      const text = await readFile(system.path, "utf8");
      const reads: string[] = [];
      let writing = true;
      const reader = (async () => {
        while (writing) reads.push(await readFile(system.path, "utf8"));
      })();
      for (let copy = 0; copy < 20; copy += 1) await (await ownCopy()).systemGitConfig();
      writing = false;
      await reader;
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.filter((read) => read !== text)).toEqual([]);
    }, 60_000);

    it("is never empty while a copy replaces other text there", async () => {
      // Other text there each time, so every copy replaces it rather than
      // leaving it alone, and the rename is what is under test: the test
      // above it only ever met a file that already held its text (review of
      // the D-149 fixes). Put there by a rename too, retried as Windows
      // refuses one while the reader has the file open.
      const system = await (await ownCopy()).systemGitConfig();
      if (system.kind !== "standIn") return;
      const text = await readFile(system.path, "utf8");
      const stale = "# stale\n";
      const putStale = async () => {
        writeFileSync(`${system.path}.stale`, stale, "utf8");
        for (;;) {
          try {
            renameSync(`${system.path}.stale`, system.path);
            return;
          } catch (error) {
            if (!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? ""))
              throw error;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        }
      };
      const reads: string[] = [];
      let writing = true;
      const reader = (async () => {
        while (writing) reads.push(await readFile(system.path, "utf8"));
      })();
      try {
        for (let copy = 0; copy < 10; copy += 1) {
          await putStale();
          await (await ownCopy()).systemGitConfig();
        }
      } finally {
        // Left reading after a failure, it read on into the next test, which
        // removes the file, and failed there instead.
        writing = false;
        await reader;
      }
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.filter((read) => read !== text && read !== stale)).toEqual([]);
      expect(await readFile(system.path, "utf8")).toBe(text);
    }, 60_000);

    it("is written when missing, and nothing is left beside it", async () => {
      const system = await (await ownCopy()).systemGitConfig();
      if (system.kind !== "standIn") return;
      const text = await readFile(system.path, "utf8");
      rmSync(system.path);
      await (await ownCopy()).systemGitConfig();
      expect(await readFile(system.path, "utf8")).toBe(text);
      expect(
        readdirSync(dir).filter((entry) => entry.startsWith(`${basename(system.path)}.`)),
      ).toEqual([]);
    });

    it("takes a rename Windows refuses for done when the file holds the text", async () => {
      // Windows refuses to replace a file another process has open: another
      // writer, in another copy or another server, put the same text there.
      const system = await (await ownCopy()).systemGitConfig();
      if (system.kind !== "standIn") return;
      const text = await readFile(system.path, "utf8");
      rmSync(system.path);
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...actual,
          rename: async (from: string, to: string) => {
            // The partial is left where it was, for writeStandIn to clear.
            await actual.writeFile(to, text, "utf8");
            throw Object.assign(new Error(`EPERM: operation not permitted, rename`), {
              code: "EPERM",
            });
          },
        };
      });
      expect(await (await ownCopy()).systemGitConfig()).toEqual(system);
      expect(
        readdirSync(dir).filter((entry) => entry.startsWith(`${basename(system.path)}.`)),
      ).toEqual([]);
    });

    it("tries again after a refusal that clears, as Windows' do", async () => {
      // Windows refuses a rename for a moment while antivirus or the indexer
      // has a file open; the first refusal failed the stand-in, and the
      // stand-in's failure is every git call's (review of the D-149 fixes).
      const system = await (await ownCopy()).systemGitConfig();
      if (system.kind !== "standIn") return;
      const text = await readFile(system.path, "utf8");
      rmSync(system.path);
      let refusals = 0;
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...actual,
          rename: async (from: string, to: string) => {
            if ((refusals += 1) <= 2) {
              throw Object.assign(new Error("EPERM: operation not permitted, rename"), {
                code: "EPERM",
              });
            }
            return actual.rename(from, to);
          },
        };
      });
      expect(await (await ownCopy()).systemGitConfig()).toEqual(system);
      expect(refusals).toBe(3);
      expect(await readFile(system.path, "utf8")).toBe(text);
    });

    // POSIX only: Windows gives each user a temp folder of their own and no
    // mode bits to read. The owner check shares this branch; a test cannot
    // make a file another user owns without root.
    it.skipIf(process.platform === "win32")(
      "is not taken from a file others could write, nor through a link",
      async () => {
        // The path is the machine's temp folder and a hash of text anyone
        // can work out, and a file there holding that text was taken as is.
        // In a shared /tmp another user could make it first and keep it,
        // then add a core.fsmonitor that git runs as this user (security
        // review of the MVP, D-180).
        const first = await (await ownCopy()).systemGitConfig();
        if (first.kind !== "standIn") return;
        const text = await readFile(first.path, "utf8");
        const own = (system: { kind: string; path?: string }) => {
          expect(system.kind).toBe("standIn");
          const path = (system as { path: string }).path;
          expect(path).not.toBe(first.path);
          const stat = lstatSync(path);
          expect(stat.isFile()).toBe(true);
          expect(stat.mode & 0o022).toBe(0);
          return path;
        };

        rmSync(first.path);
        writeFileSync(first.path, text);
        chmodSync(first.path, 0o666);
        expect(await readFile(own(await (await ownCopy()).systemGitConfig()), "utf8")).toBe(text);

        rmSync(first.path);
        const elsewhere = join(dir, "elsewhere.gitconfig");
        writeFileSync(elsewhere, text);
        symlinkSync(elsewhere, first.path);
        expect(await readFile(own(await (await ownCopy()).systemGitConfig()), "utf8")).toBe(text);
      },
    );

    it("is built again on the next call after one that failed", async () => {
      // The failure was kept for the life of the process, and every git call
      // after it failed with it (review of the D-149 fixes).
      const system = await (await ownCopy()).systemGitConfig();
      if (system.kind !== "standIn") return;
      rmSync(system.path);
      let calls = 0;
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...actual,
          rename: async (from: string, to: string) => {
            if ((calls += 1) === 1) {
              throw Object.assign(new Error("ENOSPC: no space left on device, rename"), {
                code: "ENOSPC",
              });
            }
            return actual.rename(from, to);
          },
        };
      });
      const copy = await ownCopy();
      await expect(copy.systemGitConfig()).rejects.toThrow("ENOSPC");
      expect(await copy.systemGitConfig()).toEqual(system);
    });
  });
});
