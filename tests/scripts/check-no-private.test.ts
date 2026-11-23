/**
 * The private-material gate's path rule (D-317): a file in a private
 * directory is refused whatever its extension. The rule ran after the skip
 * of files whose contents are not read, so a force-added image passed.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const GATE = resolve("scripts", "check-no-private.mjs");
let repo: string;

function git(...args: string[]) {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  expect(run.status, `git ${args.join(" ")}: ${run.stderr}`).toBe(0);
}

function gate() {
  return spawnSync(process.execPath, [GATE], { cwd: repo, encoding: "utf8" });
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "trysquare-no-private-"));
  git("init", "-q");
  writeFileSync(join(repo, ".gitignore"), "docs/private/\n");
  writeFileSync(join(repo, "README.md"), "Nothing private.\n");
  mkdirSync(join(repo, "docs", "private"), { recursive: true });
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("the private-material gate", () => {
  it("passes a repository with nothing private in what git would publish", () => {
    // An ignored file in the private directory is not publishable, so it
    // is not a violation: the directory is where such files are kept.
    writeFileSync(join(repo, "docs", "private", "kept.md"), "x");
    const run = gate();
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it.each(["shot.png", "store.sqlite", "notes.md"])(
    "refuses %s force-added from a private directory",
    (name) => {
      const file = `docs/private/${name}`;
      writeFileSync(join(repo, file), "x");
      git("add", "-f", file);
      try {
        const run = gate();
        expect(run.stderr).toContain(
          `${file}: must never be committed (file inside a private directory)`,
        );
        expect(run.status).toBe(1);
      } finally {
        git("rm", "-q", "--cached", file);
      }
    },
  );
});
