/**
 * The rulesets a request names, said one of two ways: `rulesetIds`, one or
 * more, or the single `rulesetId` every caller sent before a review could be
 * judged against several (RS-2b). Both sent, one would be dropped without a
 * word; an id named twice would share every rule code with itself.
 */

import { z } from "zod";

export const rulesetIdFields = {
  rulesetId: z.string().min(1).optional(),
  rulesetIds: z.array(z.string().min(1)).min(1).optional(),
};

/** The ids named, or undefined when the request names none. Throws the 400. */
export function namedRulesetIds(input: {
  rulesetId?: string | undefined;
  rulesetIds?: string[] | undefined;
}): string[] | undefined {
  if (input.rulesetId !== undefined && input.rulesetIds !== undefined) {
    throw Response.json(
      { error: "Send rulesetId or rulesetIds, not both.", code: "RulesetsNamedTwoWays" },
      { status: 400 },
    );
  }
  const named = input.rulesetIds ?? (input.rulesetId === undefined ? undefined : [input.rulesetId]);
  if (named !== undefined && new Set(named).size !== named.length) {
    throw Response.json(
      { error: "rulesetIds names a ruleset more than once.", code: "RulesetNamedTwice" },
      { status: 400 },
    );
  }
  return named;
}
