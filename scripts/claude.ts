/**
 * `npm run claude -- <args>` runs the Claude Code CLI this app reviews with,
 * resolved the way a review resolves it, so `npm run claude -- auth login`
 * signs in the exact program the reviews will use. Spelling out a path
 * instead would differ per platform, and on npm 11 the wrapper's own `bin`
 * entry is a placeholder until its install script is approved.
 */

import { spawnSync } from "node:child_process";
import { resolveCli } from "@/server/engine/cli";
import { buildChildEnv } from "@/lib/engine/command";

const cli = resolveCli(process.env.TRYSQUARE_CLAUDE_PATH);
const result = spawnSync(cli.command, [...cli.prefixArgs, ...process.argv.slice(2)], {
  stdio: "inherit",
  // Without this the CLI refuses to run when started from inside a Claude
  // Code session, the same reason every review scrubs it.
  env: buildChildEnv(process.env) as NodeJS.ProcessEnv,
});
if (result.error) {
  console.error(`Could not start ${cli.display}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
