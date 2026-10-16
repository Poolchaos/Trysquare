/**
 * The resolver is tested on real files in a temporary directory, with the
 * platform passed in, so both the Windows and the POSIX rules run on every
 * machine. The shim texts are what npm's own cmd-shim wrote on 2026-10-16
 * (npm 10.9.2), line endings included.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliNotFoundError,
  CliUnusableError,
  bundledCliPaths,
  describeCli,
  isAtLeast,
  parseCliVersion,
  realCliEnvironment,
  resolveCli,
  type CliEnvironment,
} from "@/server/engine/cli";

const EXE_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
  "",
].join("\r\n");

const SCRIPT_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*',
  "",
].join("\r\n");

const NODE = "/opt/node/bin/node";
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trysquare-cli-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function file(path: string, contents = "") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function environment(
  platform: NodeJS.Platform,
  path: string[],
  runnable: (path: string) => boolean = () => true,
  bundled: string[] = [],
): CliEnvironment {
  const real = realCliEnvironment();
  return {
    ...real,
    platform,
    nodePath: NODE,
    env: { PATH: path.join(delimiter), PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    isRunnable: (candidate) => real.isFile(candidate) && runnable(candidate),
    bundled,
  };
}

describe("on Windows", () => {
  it("runs the program an npm shim launches, not the shim", () => {
    const bin = join(root, "npm");
    const exe = file(
      join(bin, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    );
    const shim = file(join(bin, "claude.cmd"), EXE_SHIM);

    expect(resolveCli(undefined, environment("win32", [bin]))).toEqual({
      command: exe,
      prefixArgs: [],
      display: shim,
    });
  });

  it("runs a script shim's script with Node, even with node.exe beside the shim", () => {
    const bin = join(root, "nvm");
    file(join(bin, "node.exe"));
    const script = file(join(bin, "node_modules", "pkg", "cli.js"));
    file(join(bin, "claude.cmd"), SCRIPT_SHIM);

    const resolved = resolveCli(undefined, environment("win32", [bin]));
    expect(resolved.command).toBe(NODE);
    expect(resolved.prefixArgs).toEqual([script]);
  });

  it("prefers claude.exe to claude.cmd in one directory, as PATHEXT orders them", () => {
    const bin = join(root, "bin");
    const exe = file(join(bin, "claude.exe"));
    file(join(bin, "claude.cmd"), EXE_SHIM);

    expect(resolveCli(undefined, environment("win32", [bin])).command).toBe(exe);
  });

  it("looks past a batch file it cannot use to a later directory that has the program", () => {
    const first = join(root, "first");
    const second = join(root, "second");
    file(join(first, "claude.cmd"), "@echo off\r\necho not a shim\r\n");
    const exe = file(join(second, "claude.exe"));

    expect(resolveCli(undefined, environment("win32", [first, second])).command).toBe(exe);
  });

  it("refuses a batch file that names no program, and says what to do instead", () => {
    const bin = join(root, "bin");
    file(join(bin, "claude.cmd"), "@echo off\r\necho not a shim\r\n");

    expect(() => resolveCli(undefined, environment("win32", [bin]))).toThrow(CliUnusableError);
    expect(() => resolveCli(undefined, environment("win32", [bin]))).toThrow(/claude\.exe/);
  });

  it("refuses a shim whose program is missing", () => {
    const bin = join(root, "bin");
    file(join(bin, "claude.cmd"), EXE_SHIM);

    expect(() => resolveCli(join(bin, "claude.cmd"), environment("win32", []))).toThrow(
      CliUnusableError,
    );
  });
});

describe("on any platform", () => {
  it.each(["win32", "linux", "darwin"] as const)(
    "runs a configured .mjs with Node on %s, since a shebang is not portable",
    (platform) => {
      const script = file(join(root, "fake-claude.mjs"));
      expect(resolveCli(script, environment(platform, []))).toEqual({
        command: NODE,
        prefixArgs: [script],
        display: script,
      });
    },
  );

  it("refuses a configured path that does not exist", () => {
    expect(() => resolveCli(join(root, "nope", "claude"), environment("linux", []))).toThrow(
      /no such file/,
    );
  });

  it("looks a configured bare name up on PATH rather than in the working directory", () => {
    const bin = join(root, "bin");
    const found = file(join(bin, "claude-nightly"));
    expect(resolveCli("claude-nightly", environment("linux", [bin])).command).toBe(found);
  });

  it("names what it searched when nothing is found", () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    const attempt = () => resolveCli(undefined, environment("linux", [empty]));
    expect(attempt).toThrow(CliNotFoundError);
    expect(attempt).toThrow(empty);
  });

  it("says so when PATH is empty", () => {
    expect(() => resolveCli(undefined, environment("linux", []))).toThrow(/PATH is empty/);
  });
});

describe("on POSIX", () => {
  it("skips a claude that is not executable and finds a later one", () => {
    const first = join(root, "first");
    const second = join(root, "second");
    const blocked = file(join(first, "claude"));
    const good = file(join(second, "claude"));

    const resolved = resolveCli(
      undefined,
      environment("linux", [first, second], (path) => path !== blocked),
    );
    expect(resolved.command).toBe(good);
  });

  it("reports a claude that exists but is not executable", () => {
    const bin = join(root, "bin");
    file(join(bin, "claude"));
    expect(() =>
      resolveCli(
        undefined,
        environment("linux", [bin], () => false),
      ),
    ).toThrow(/not executable/);
  });

  it("does not treat a .cmd as a shim off Windows", () => {
    const bin = join(root, "bin");
    const cmd = file(join(bin, "claude.cmd"), EXE_SHIM);
    expect(resolveCli(cmd, environment("linux", [])).command).toBe(cmd);
  });
});

describe("the version a review needs", () => {
  it("reads the version the real CLI prints", () => {
    // `claude --version`, CLI 2.1.301, 2026-10-16.
    expect(parseCliVersion("2.1.301 (Claude Code)\n")).toEqual([2, 1, 301]);
    expect(parseCliVersion("Claude Code")).toBeNull();
  });

  it.each([
    [[2, 1, 301], true],
    [[2, 1, 302], true],
    [[2, 2, 0], true],
    [[3, 0, 0], true],
    [[2, 1, 71], false],
    [[2, 0, 999], false],
    [[1, 9, 999], false],
  ])("judges %j against 2.1.301 as %s", (version, expected) => {
    expect(isAtLeast(version, [2, 1, 301])).toBe(expected);
  });
});

describe("the CLI installed with the app", () => {
  it("is used ahead of PATH when nothing is configured", () => {
    const bundled = file(join(root, "node_modules", "cli", "claude.exe"));
    const onPath = join(root, "bin");
    file(join(onPath, "claude.exe"));
    expect(
      resolveCli(undefined, environment("win32", [onPath], undefined, [bundled])).command,
    ).toBe(bundled);
  });

  it("gives way to a configured path, which is the user saying which one", () => {
    const bundled = file(join(root, "node_modules", "cli", "claude"));
    const chosen = file(join(root, "mine", "claude"));
    expect(resolveCli(chosen, environment("linux", [], undefined, [bundled])).command).toBe(chosen);
  });

  it("falls back to PATH when the bundled copy is missing", () => {
    const onPath = join(root, "bin");
    const found = file(join(onPath, "claude"));
    const missing = join(root, "node_modules", "cli", "claude");
    expect(
      resolveCli(undefined, environment("linux", [onPath], undefined, [missing])).command,
    ).toBe(found);
  });

  it.each([
    ["win32", "x64", false, "claude-code-win32-x64", "claude.exe"],
    ["darwin", "arm64", false, "claude-code-darwin-arm64", "claude"],
    ["linux", "x64", false, "claude-code-linux-x64", "claude"],
    ["linux", "arm64", true, "claude-code-linux-arm64-musl", "claude"],
  ] as const)("looks for %s-%s (musl %s) in %s", (platform, cpu, musl, pkg, binary) => {
    const [first, second] = bundledCliPaths("/app", platform, cpu, musl);
    expect(first).toBe(join("/app", "node_modules", "@anthropic-ai", pkg, binary));
    expect(second).toBe(
      join("/app", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    );
  });
});

describe("what a run records about its CLI", () => {
  const fake = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

  it("names the program and the version it reported", async () => {
    await expect(describeCli(fake)).resolves.toBe(`${fake} (2.1.301 (Claude Code))`);
  });

  it("says plainly when there is no usable CLI, rather than naming a default", async () => {
    await expect(describeCli(join(root, "missing", "claude"))).resolves.toMatch(
      /^none usable \(.*no such file/,
    );
  });
});
