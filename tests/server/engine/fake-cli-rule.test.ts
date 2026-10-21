/**
 * Which programs the real-CLI guard takes for fakes. The rule only, so
 * nothing is resolved or started.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isFakeCli } from "../../helpers/fake-cli-rule";

const TESTS = join("C:", "repo", "tests");
const TEMP = join("C:", "Temp");

describe("the real-CLI guard's rule", () => {
  it("takes the suite's fake and a test's own Node script in the temp directory", () => {
    expect(isFakeCli(join(TESTS, "fixtures", "fake-claude.mjs"), true, TESTS, TEMP)).toBe(true);
    expect(isFakeCli(join(TEMP, "work", "old-claude.mjs"), true, TESTS, TEMP)).toBe(true);
  });

  it("refuses the real CLI in a copy of the repository made in the temp directory", () => {
    // Let through before (review of the D-152 fixes): the copy sat under the
    // temp directory, and so did its node_modules.
    const copied = join(TEMP, "copy", "node_modules", "@anthropic-ai", "claude-code-win32-x64");
    expect(isFakeCli(join(copied, "claude.exe"), false, TESTS, TEMP)).toBe(false);
    expect(isFakeCli(join(TEMP, "copy", "node_modules", "x", "cli.mjs"), true, TESTS, TEMP)).toBe(
      false,
    );
  });

  it("refuses anything in the temp directory but a Node script Node runs", () => {
    // A shell script or batch file can start any program, and no test writes
    // one (review of the D-153 fixes).
    expect(isFakeCli(join(TEMP, "claude.exe"), false, TESTS, TEMP)).toBe(false);
    expect(isFakeCli(join(TEMP, "bin", "claude"), false, TESTS, TEMP)).toBe(false);
    expect(isFakeCli(join(TEMP, "claude.sh"), false, TESTS, TEMP)).toBe(false);
    expect(isFakeCli(join(TEMP, "claude.cmd"), false, TESTS, TEMP)).toBe(false);
    expect(isFakeCli(join(TEMP, "fake.mjs"), false, TESTS, TEMP)).toBe(false);
  });

  it("refuses anything outside both", () => {
    expect(isFakeCli(join("C:", "Program Files", "claude", "claude.exe"), false, TESTS, TEMP)).toBe(
      false,
    );
  });

  it("judges a link by where it leads", (context) => {
    // A script in the temp directory linked to one in node_modules passed for
    // a fake by its name alone (review of the D-153 fixes).
    const root = mkdtempSync(join(tmpdir(), "trysquare-fake-rule-"));
    try {
      const target = join(root, "node_modules", "pkg", "cli-wrapper.cjs");
      mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
      writeFileSync(target, "");
      const link = join(root, "cli-wrapper.cjs");
      try {
        symlinkSync(target, link, "file");
      } catch {
        // Windows makes a file link only with Developer Mode or as an
        // administrator; Linux and macOS CI run this.
        context.skip();
      }
      expect(isFakeCli(link, true, join(root, "tests"), tmpdir())).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
