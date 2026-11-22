/**
 * How many rules a ruleset holds, said where rulesets are listed or ticked.
 *
 * The rules switched on are what a review is judged against, so they are
 * the count; with any switched off the total is said too, as the ruleset's
 * own page says it ("12 rules, 3 switched off"). A list that said "9 rules"
 * of that ruleset disagreed with its page (the eighteenth grade, AF4).
 */
export function ruleCountWords(on: number, total: number): string {
  const rules = `rule${total === 1 ? "" : "s"}`;
  return on === total ? `${total} ${rules}` : `${on} of ${total} ${rules} on`;
}
