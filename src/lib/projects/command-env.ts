/**
 * The environment a project's own commands run in (WP-I): the person's, as
 * their own terminal would give it, so PATH and the package managers' own
 * settings reach them, without the app's and Claude's. Without the app's, a
 * project's e2e could read this data directory as its own; without
 * Claude's, a test could run as a child of the session or spend on an API
 * key the person set for something else.
 */

const WITHHELD = ["TRYSQUARE_", "FAKE_CLAUDE_", "CLAUDE", "ANTHROPIC_"];

export function projectCommandEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    if (WITHHELD.some((prefix) => key.toUpperCase().startsWith(prefix))) continue;
    child[key] = value;
  }
  return child;
}
