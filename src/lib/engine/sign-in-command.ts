/**
 * The command a person runs to sign in the CLI reviews use (MVP 6.3, D-159).
 *
 * Shown, never run: this app starts the CLI with read-only tools alone, and
 * whether its login flow runs without a terminal is unknown (MG-7). With no
 * path configured, `npm run claude` from the project directory resolves the
 * CLI as a review does. A configured path, from TRYSQUARE_CLAUDE_PATH or kept
 * on Settings, gets its own command: the script never reads Settings, and the
 * variable the server was started with may not be set in the person's
 * terminal (D-152).
 */

const NODE_SCRIPT = /\.(mjs|cjs|js)$/i;

export function signInCommand(claudePath: string | undefined, platform: string): string {
  if (claudePath === undefined) return "npm run claude -- auth login";
  const quoted = `"${claudePath}"`;
  if (NODE_SCRIPT.test(claudePath)) return `node ${quoted} auth login`;
  // PowerShell, Windows' own terminal, runs a quoted path only after &.
  return platform === "win32" ? `& ${quoted} auth login` : `${quoted} auth login`;
}
