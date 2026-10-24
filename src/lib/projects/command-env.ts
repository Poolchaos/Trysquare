/**
 * The environment a project's own commands run in (WP-I): the person's, as
 * their own terminal would give it, so PATH and the package managers' own
 * settings reach them, without the app's and Claude's. Without the app's, a
 * project's e2e could read this data directory as its own; without
 * Claude's, a test could run as a child of the session or spend on an API
 * key the person set for something else.
 */

// NODE_ENV and Next's own: the server sets NODE_ENV=production for itself,
// and a project's npm ci given it skips the devDependencies its tests need,
// a failure the app would call proven (review round 7).
const WITHHELD = ["TRYSQUARE_", "FAKE_CLAUDE_", "CLAUDE", "ANTHROPIC_", "NEXT_", "__NEXT"];
const WITHHELD_NAMES = ["NODE_ENV"];

export function projectCommandEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    const name = key.toUpperCase();
    if (WITHHELD.some((prefix) => name.startsWith(prefix)) || WITHHELD_NAMES.includes(name)) {
      continue;
    }
    child[key] = value;
  }
  return child;
}
