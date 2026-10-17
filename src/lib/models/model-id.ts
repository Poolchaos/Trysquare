/**
 * Whether a model id names one model rather than a family.
 *
 * The CLI accepts an alias ("fable", "opus", "sonnet", per its own `--help`)
 * as "the latest model" of a family, and an alias has been observed to
 * resolve to a previous generation. So only an id that carries a version is
 * stored or passed on: `claude-` followed somewhere by a number, which fits
 * every id in the registry (`claude-fable-5[1m]`) and the older naming that
 * puts the version first (`claude-3-5-sonnet-<date>`). A rule that says what
 * an id must be, rather than a list of aliases, also refuses aliases nobody
 * has listed yet, such as `sonnet[1m]` or `claude-fable`.
 */
const FULL_ID = /claude-[^\d]*\d/i;

export function isFullModelId(id: string): boolean {
  return FULL_ID.test(id.trim());
}

export function aliasRefusal(id: string): string {
  return (
    `"${id}" does not name a single model. Aliases resolve to whatever the CLI considers ` +
    `current for a family, which can be a previous generation. Use a full id such as ` +
    `"claude-fable-5[1m]".`
  );
}
