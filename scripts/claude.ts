/**
 * `npm run claude -- <args>` runs the Claude Code CLI this app reviews with,
 * resolved the way a review resolves it, so `npm run claude -- auth login`
 * signs in the exact program the reviews will use. Spelling out a path
 * instead would differ per platform, and on npm 11 the wrapper's own `bin`
 * entry is a placeholder until its install script is approved.
 */

import { runCliAttached } from "@/server/engine/cli";

try {
  process.exit(runCliAttached(process.argv.slice(2), process.env.TRYSQUARE_CLAUDE_PATH));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
