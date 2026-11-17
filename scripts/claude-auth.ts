/**
 * `npm run claude:auth` checks that the Claude Code CLI reviews run through is
 * new enough and signed in, and starts the sign-in only when it is not. It
 * resolves the CLI as the app does bar one step: a path kept on Settings
 * lives in the database, which a running server holds, so it is not read
 * here. Exits 0 when reviews can run, 1 otherwise.
 */

import { runCliAttached } from "@/server/engine/cli";
import { runClaudeAuth } from "./lib/claude-auth";

const claudePath = process.env.TRYSQUARE_CLAUDE_PATH?.trim() || undefined;

try {
  process.exit(
    await runClaudeAuth({
      claudePath,
      login: () => runCliAttached(["auth", "login"], claudePath),
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    }),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
