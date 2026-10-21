/**
 * Which programs the real-CLI guard takes for fakes. A rule only, so nothing
 * is resolved or started.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isFakeCli } from "../../helpers/fake-cli-rule";

const TESTS = join("C:", "repo", "tests");
const TEMP = join("C:", "Temp");

describe("the real-CLI guard's rule", () => {
  it("takes the suite's fake and a test's own script in the temp directory", () => {
    expect(isFakeCli(join(TESTS, "fixtures", "fake-claude.mjs"), TESTS, TEMP)).toBe(true);
    expect(isFakeCli(join(TEMP, "work", "old-claude.mjs"), TESTS, TEMP)).toBe(true);
  });

  it("refuses the real CLI in a copy of the repository made in the temp directory", () => {
    // Let through before (review of the D-152 fixes): the copy sat under the
    // temp directory, and so did its node_modules.
    const copied = join(TEMP, "copy", "node_modules", "@anthropic-ai", "claude-code-win32-x64");
    expect(isFakeCli(join(copied, "claude.exe"), TESTS, TEMP)).toBe(false);
    expect(isFakeCli(join(TEMP, "copy", "node_modules", "x", "cli.mjs"), TESTS, TEMP)).toBe(false);
  });

  it("refuses a program in the temp directory that is not a script", () => {
    expect(isFakeCli(join(TEMP, "claude.exe"), TESTS, TEMP)).toBe(false);
    expect(isFakeCli(join(TEMP, "bin", "claude"), TESTS, TEMP)).toBe(false);
  });

  it("refuses anything outside both", () => {
    expect(isFakeCli(join("C:", "Program Files", "claude", "claude.exe"), TESTS, TEMP)).toBe(false);
  });
});
