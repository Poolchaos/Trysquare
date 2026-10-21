import { fileURLToPath } from "node:url";

/** The suite's fake CLI. */
export const FAKE_CLI = fileURLToPath(new URL("../fixtures/fake-claude.mjs", import.meta.url));

/**
 * Points the app at the fake CLI, signed in through a subscription, for a
 * test that creates a review: creating one now asks the CLI whether it can
 * run a review, and refuses one it cannot (MVP 6.2). Returns the undo.
 */
export function useSignedInFake(): () => void {
  const before = {
    path: process.env.TRYSQUARE_CLAUDE_PATH,
    status: process.env.FAKE_CLAUDE_AUTH_STATUS,
  };
  process.env.TRYSQUARE_CLAUDE_PATH = FAKE_CLI;
  process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "max",
  });
  return () => {
    if (before.path === undefined) delete process.env.TRYSQUARE_CLAUDE_PATH;
    else process.env.TRYSQUARE_CLAUDE_PATH = before.path;
    if (before.status === undefined) delete process.env.FAKE_CLAUDE_AUTH_STATUS;
    else process.env.FAKE_CLAUDE_AUTH_STATUS = before.status;
  };
}
