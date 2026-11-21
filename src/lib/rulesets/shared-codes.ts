/**
 * The rule codes more than one of a review's rulesets holds (RS-2b, D-288).
 *
 * A finding, a sweep hit and the coverage of a rule against a file each name
 * a rule by its code alone, so two rules under one code in one review cannot
 * be told apart. A set of rulesets that shares a code is refused, in words
 * that say which codes and which rulesets.
 */

export interface SharedCodes {
  /** The codes these rulesets all hold, in the order the first holds them. */
  codes: string[];
  /** The names of the rulesets that hold them, in the order given. */
  rulesets: string[];
}

/** One entry for each group of rulesets that shares codes; none when no code is shared. */
export function sharedCodes(
  rulesets: readonly { name: string; codes: readonly string[] }[],
): SharedCodes[] {
  const holders = new Map<string, string[]>();
  for (const ruleset of rulesets) {
    for (const code of new Set(ruleset.codes)) {
      holders.set(code, [...(holders.get(code) ?? []), ruleset.name]);
    }
  }
  const groups = new Map<string, SharedCodes>();
  for (const [code, names] of holders) {
    if (names.length < 2) continue;
    const key = JSON.stringify(names);
    const group = groups.get(key) ?? { codes: [], rulesets: names };
    group.codes.push(code);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const listed = (items: readonly string[]): string =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The refusal a person reads, for a set that `sharedCodes` found entries in. */
export function sharedCodesRefusal(shared: readonly SharedCodes[]): string {
  const groups = shared.map(
    ({ codes, rulesets }) =>
      `${codes.length === 1 ? "rule" : "rules"} ${listed(codes)} ${codes.length === 1 ? "is" : "are"} in ` +
      listed(rulesets.map((name) => `"${name}"`)),
  );
  return (
    `These rulesets cannot judge one review together: ${groups.join("; ")}. ` +
    "A finding names its rule by number alone, so a number may be in only one of a " +
    "review's rulesets. Leave one of them out, or change the numbers in one."
  );
}
