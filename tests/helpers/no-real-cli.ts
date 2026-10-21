/**
 * No unit test reaches the real Claude Code CLI unless it asks to.
 *
 * A manager test started a run with no CLI path of its own, and on the code
 * before its fix the run resolved the CLI `npm install` put in node_modules:
 * one real stage ran on the maintainer's sign-in, 33,893 output tokens on
 * claude-fable-5, before it failed (2026-10-20, D-152). Every engine call
 * that can reach a model finds its CLI through `resolveCli` as imported by
 * the engine modules, so that import is wrapped here: outside the opt-in
 * real-CLI test (TRYSQUARE_REAL_CLI=1), a CLI that is not a fake is refused
 * before anything is started (tests/helpers/fake-cli-rule.ts). A test that hands in its own CLI
 * environment resolves nothing real and is left alone.
 */

import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { isFakeCli } from "./fake-cli-rule";

const TESTS_DIR = fileURLToPath(new URL("..", import.meta.url));

vi.mock("@/server/engine/cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/engine/cli")>();
  return {
    ...actual,
    resolveCli: (...args: Parameters<typeof actual.resolveCli>) => {
      const found = actual.resolveCli(...args);
      if (args[1] !== undefined || process.env.TRYSQUARE_REAL_CLI === "1") return found;
      const program =
        found.command === process.execPath && found.prefixArgs[0] !== undefined
          ? found.prefixArgs[0]
          : found.command;
      if (isFakeCli(program, TESTS_DIR, tmpdir())) return found;
      throw new Error(
        `A unit test reached ${found.display}, which is not a fake. Point the test at ` +
          "tests/fixtures/fake-claude.mjs, or run it with TRYSQUARE_REAL_CLI=1 to spend " +
          "real usage on purpose.",
      );
    },
  };
});
