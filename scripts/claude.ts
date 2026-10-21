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

import { delimiter } from "node:path";
import { CliNotFoundError, runCliAttached } from "@/server/engine/cli";

const configured = process.env.TRYSQUARE_CLAUDE_PATH?.trim() || undefined;

try {
  process.exit(runCliAttached(process.argv.slice(2), configured));
} catch (error) {
  if (error instanceof CliNotFoundError) {
    // In this script's own words: the error's advice names the CLI path on
    // Settings, which this script never reads, and npm install does not help
    // while the variable names something else (reviews of the D-153 and
    // D-154 fixes).
    const searched =
      error.searched.length === 0 ? "(PATH is empty)" : error.searched.join(delimiter);
    console.error(
      configured === undefined
        ? 'Could not find the Claude Code CLI: npm install puts it in node_modules, and "claude" ' +
            `is not on PATH either. Run npm install. Searched: ${searched}`
        : `TRYSQUARE_CLAUDE_PATH names "${error.command}", which is not on PATH. Give its ` +
            `full path, or unset it to use the CLI installed with the app. Searched: ${searched}`,
    );
  } else {
    console.error((error as Error).message);
  }
  process.exit(1);
}
