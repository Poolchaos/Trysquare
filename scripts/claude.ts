/**
 * `npm run claude -- <args>` runs the Claude Code CLI this app reviews with:
 * TRYSQUARE_CLAUDE_PATH's, or else the one `npm install` put in node_modules,
 * or else `claude` on PATH, so `npm run claude -- auth login` signs that
 * program in. Spelling out a path instead would differ per platform, and on
 * npm 11 the wrapper's own `bin` entry is a placeholder until its install
 * script is approved.
 *
 * Not a CLI path kept on Settings (D-152): that lives in the database, which
 * a running server holds locked. A CLI kept there is signed in with its own
 * command, which Settings will name (MVP 6.3).
 */

import { CliNotFoundError, runCliAttached } from "@/server/engine/cli";

try {
  process.exit(runCliAttached(process.argv.slice(2), process.env.TRYSQUARE_CLAUDE_PATH));
} catch (error) {
  // The error's own advice names the CLI path on Settings, which this script
  // never reads (review of the D-153 fixes).
  console.error(
    error instanceof CliNotFoundError
      ? `Could not find "${error.command}", the Claude Code CLI. Run npm install, which ` +
          "installs it, or set TRYSQUARE_CLAUDE_PATH to its full path for this command."
      : (error as Error).message,
  );
  process.exit(1);
}
