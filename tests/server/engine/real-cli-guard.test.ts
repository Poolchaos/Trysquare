/**
 * The suite refuses the real Claude Code CLI (tests/helpers/no-real-cli.ts).
 *
 * Only resolution is asked here, which starts nothing, so a guard that did not
 * hold would fail these tests without reaching any model.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeCli, resolveCli, runCliAttached } from "@/server/engine/cli";
import { realCliPresent } from "../../helpers/real-cli-present";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

/** The refusals below need a real CLI to refuse. */
const noRealCli = !realCliPresent();

describe("the real-CLI guard", () => {
  it.skipIf(noRealCli)("refuses the CLI npm install put in node_modules", () => {
    expect(() => resolveCli(undefined)).toThrow(/not a fake/);
    expect(() => resolveCli("  ")).toThrow(/not a fake/);
  });

  it.skipIf(noRealCli)(
    "refuses it in any test but the real-CLI one, whatever the shell says",
    () => {
      // The variable exported in a shell let every test of a run reach the real
      // CLI, not only the one that asks for it (review of the D-152 fixes).
      const before = process.env.TRYSQUARE_REAL_CLI;
      process.env.TRYSQUARE_REAL_CLI = "1";
      try {
        expect(() => resolveCli(undefined)).toThrow(/not a fake/);
      } finally {
        if (before === undefined) delete process.env.TRYSQUARE_REAL_CLI;
        else process.env.TRYSQUARE_REAL_CLI = before;
      }
    },
  );

  it.skipIf(noRealCli)(
    "names no real CLI in a run's engine note, and starts none to ask its version",
    async () => {
      // describeCli resolved inside its own module, past the guard, and started
      // the real CLI for its version: free, but started (review of the D-152
      // fixes).
      expect(await describeCli(undefined)).toMatch(/^none usable \(.*not a fake/);
    },
  );

  it.skipIf(noRealCli)("refuses the real CLI to npm run claude's runner too", () => {
    // It resolved inside its own module, past the guard, and then runs the CLI
    // attached, with whatever it is given (review of the D-153 fixes). Asked
    // for --version only, so a guard that did not hold starts nothing that
    // spends.
    expect(() => runCliAttached(["--version"], undefined)).toThrow(/not a fake/);
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
