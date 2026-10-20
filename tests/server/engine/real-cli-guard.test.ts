/**
 * The suite refuses the real Claude Code CLI (tests/helpers/no-real-cli.ts).
 *
 * Only resolution is asked here, which starts nothing, so a guard that did not
 * hold would fail these tests without reaching any model.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCli } from "@/server/engine/cli";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

describe("the real-CLI guard", () => {
  it("refuses the CLI npm install put in node_modules", () => {
    expect(() => resolveCli(undefined)).toThrow(/not a fake/);
    expect(() => resolveCli("  ")).toThrow(/not a fake/);
  });

  it("lets the fake through", () => {
    expect(resolveCli(FAKE_CLI).prefixArgs).toEqual([FAKE_CLI]);
  });

  it("leaves a test's own CLI environment alone", () => {
    const found = resolveCli(undefined, {
      platform: "linux",
      env: {},
      nodePath: "/usr/bin/node",
      bundled: ["/opt/app/node_modules/@anthropic-ai/claude-code-linux-x64/claude"],
      isFile: () => true,
      isRunnable: () => true,
      readText: () => "",
    });
    expect(found.command).toBe("/opt/app/node_modules/@anthropic-ai/claude-code-linux-x64/claude");
  });
});
