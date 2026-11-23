/**
 * The nothing-hidden gate (D-213, review round 11): a file git cannot see is
 * reported wherever it is, the root's own files and dotfiles included, and
 * only what is named as meant to be ignored is excused, whatever the
 * environment says about reading pathspecs.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const GATE = resolve("scripts", "check-nothing-hidden.mjs");
let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "trysquare-nothing-hidden-"));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(
    join(repo, ".gitignore"),
    [
      "newtool.config.ts",
      ".tool.rc",
      "next-env.d.ts",
      ".DS_Store",
      ".env",
      ".env.*",
      "docs/private/",
      "docs/notes.md",
      "",
    ].join("\n"),
  );
  for (const file of [
    "newtool.config.ts",
    ".tool.rc",
    "next-env.d.ts",
    ".DS_Store",
    ".env.local",
    ".env.example",
    "docs/private/secret.md",
    "docs/notes.md",
  ]) {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), "x");
  }
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

function gate(extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [GATE], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

describe("the nothing-hidden gate", () => {
  it("reports an ignored file at the root, a root dotfile and a doc", () => {
    const run = gate();
    expect(run.status).toBe(1);
    for (const file of ["newtool.config.ts", ".tool.rc", "docs/notes.md", ".env.example"]) {
      expect(run.stderr, file).toContain(`  ${file}\n`);
    }
  });

  it("excuses only what is named as meant to be ignored", () => {
    const run = gate();
    for (const file of ["next-env.d.ts", ".DS_Store", ".env.local", "docs/private/secret.md"]) {
      expect(run.stderr, file).not.toContain(`  ${file}\n`);
    }
  });

  it("passes over files ignored on purpose without saying nothing is ignored", () => {
    const clean = mkdtempSync(join(tmpdir(), "trysquare-nothing-hidden-clean-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: clean });
      writeFileSync(join(clean, ".gitignore"), "next-env.d.ts\ndocs/private/\n");
      mkdirSync(join(clean, "docs", "private"), { recursive: true });
      writeFileSync(join(clean, "next-env.d.ts"), "x");
      writeFileSync(join(clean, "docs", "private", "secret.md"), "x");

      const run = spawnSync(process.execPath, [GATE], { cwd: clean, encoding: "utf8" });

      expect(run.stdout).toBe(
        "check-nothing-hidden: clean (git ignores nothing among the root's own files or under " +
          "src, tests, e2e, scripts, drizzle, docs, .github beyond what is meant to be ignored).\n",
      );
      expect(run.status).toBe(0);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  it("still sees the root when git is told to read pathspecs literally", () => {
    // With GIT_LITERAL_PATHSPECS set, the root's glob matched nothing and
    // the gate passed having looked at nothing (review round 11).
    const run = gate({ GIT_LITERAL_PATHSPECS: "1" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("  newtool.config.ts\n");
  });
});
