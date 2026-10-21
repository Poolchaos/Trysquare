/**
 * `npm run claude -- <args>` runs the Claude Code CLI this app reviews with:
 * TRYSQUARE_CLAUDE_PATH's, or else the one `npm install` put in node_modules,
 * so `npm run claude -- auth login` signs that program in. Spelling out a
 * path instead would differ per platform, and on npm 11 the wrapper's own
 * `bin` entry is a placeholder until its install script is approved.
 *
 * Not a CLI path kept on Settings (D-152): that lives in the database, which
 * a running server holds locked. A CLI kept there is signed in with its own
 * command, which Settings names (MVP 6.3).
 */

import { runCliAttached } from "@/server/engine/cli";

try {
  process.exit(runCliAttached(process.argv.slice(2), process.env.TRYSQUARE_CLAUDE_PATH));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
