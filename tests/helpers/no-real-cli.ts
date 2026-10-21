/**
 * No unit test reaches the real Claude Code CLI unless it asks to.
 *
 * A manager test started a run with no CLI path of its own, and on the code
 * before its fix the run resolved the CLI `npm install` put in node_modules:
 * one real stage ran on the maintainer's sign-in, 33,893 output tokens on
 * claude-fable-5, before it failed (2026-10-20, D-152). The engine modules
 * find their CLI through `resolveCli` as they import it, and cli.ts's own
 * describeCli and runCliAttached through the one inside it, so all three are
 * wrapped here: a CLI that is not a fake (tests/helpers/fake-cli-rule.ts) is
 * refused before anything is started. A call that hands in a CLI
 * environment is left alone. Most tests hand in a made-up one, which
 * resolves nothing real; two hand in the real one on purpose:
 * stand-in-api.test.ts, whose CLI talks only to a local stand-in API with a
 * stand-in sign-in, and real-cli-present.ts, which resolves only (review of
 * the D-155 fixes). TRYSQUARE_REAL_CLI=1
 * opens the guard to the real-CLI test alone: exported in a shell, it opened
 * it to every test of the run (review of the D-152 fixes).
 */

import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";
import { isFakeCli } from "./fake-cli-rule";

const TESTS_DIR = fileURLToPath(new URL("..", import.meta.url));

// Every test file starts with no CLI path from the shell: exported there, as
// the RUNBOOK allows, it won over the path the Settings tests keep, and they
// failed for whoever had it set (review of the D-152 fixes). A test that
// wants it sets its own.
delete process.env.TRYSQUARE_CLAUDE_PATH;

function inRealCliTest(): boolean {
  const testPath = (expect.getState().testPath ?? "").replace(/\\/g, "/");
  return testPath.endsWith("/tests/server/engine/real-cli.test.ts");
}

vi.mock("@/server/engine/cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/engine/cli")>();
  const resolveCli = (...args: Parameters<typeof actual.resolveCli>) => {
    const found = actual.resolveCli(...args);
    if (args[1] !== undefined) return found;
    if (process.env.TRYSQUARE_REAL_CLI === "1" && inRealCliTest()) return found;
    const program =
      found.command === process.execPath && found.prefixArgs[0] !== undefined
        ? found.prefixArgs[0]
        : found.command;
    if (isFakeCli(program, found.command === process.execPath, TESTS_DIR, tmpdir())) return found;
    throw new Error(
      `A unit test reached ${found.display}, which is not a fake. Point the test at ` +
        "tests/fixtures/fake-claude.mjs, or run it with TRYSQUARE_REAL_CLI=1 to spend " +
        "real usage on purpose.",
    );
  };
  return {
    ...actual,
    resolveCli,
    // It resolves inside its own module, past the wrap above, and then starts
    // the CLI for its version: free, but started (review of the D-152 fixes).
    // Its CLI is put to the same test first.
    describeCli: async (configured: string | undefined) => {
      try {
        resolveCli(configured);
      } catch (error) {
        return `none usable (${(error as Error).message})`;
      }
      return actual.describeCli(configured);
    },
    // The same for npm run claude's runner, which then runs the CLI attached
    // with whatever it was given (review of the D-153 fixes).
    runCliAttached: (args: readonly string[], configured: string | undefined) => {
      resolveCli(configured);
      return actual.runCliAttached(args, configured);
    },
  };
});
