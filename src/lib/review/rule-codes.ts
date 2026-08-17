/**
 * Reading a rule code back to the spelling the ruleset uses.
 *
 * A protocol numbers its rules `1`, `2a`, `11`. A model asked which rule was
 * violated answers in prose about as often as not: `Rule 11`, `rule 2a`,
 * `#11`. Both live runs of the seeded fixture came back with `Rule 1` where
 * the ruleset says `1`.
 *
 * That mismatch is not cosmetic. The confirmation screen looks the code up to
 * show the rule's own words beside the finding, which is how a person decides
 * whether the rule says what the engine claims; an unmatched code shows the
 * rule as missing from the very ruleset it came from. Worse, the adversarial
 * stage's sweep dispositions are reconciled against hits whose codes come from
 * the ruleset itself, so one prose code there fails reconciliation and stops
 * the whole run.
 *
 * Nothing is invented and nothing is dropped: a code that cannot be resolved
 * is returned exactly as the model wrote it, and the screen says plainly that
 * it is not in the ruleset the review was frozen with.
 */

/** `Rule 11`, `rule: 11`, `#11`, `Rule #2a` all reduce to what follows. */
const PROSE_PREFIX = /^(?:rule|rules)?[\s:.#-]*/i;

export function ruleCodeReader(codes: Iterable<string>): (raw: string | null) => string | null {
  const bySpelling = new Map<string, string>();
  for (const code of codes) {
    // Last writer would win on a collision, but the importer refuses a
    // ruleset with duplicate codes, so there is nothing to collide.
    bySpelling.set(code.trim().toLowerCase(), code);
  }

  return (raw) => {
    if (raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed === "") return raw;

    const exact = bySpelling.get(trimmed.toLowerCase());
    if (exact !== undefined) return exact;

    const stripped = trimmed.replace(PROSE_PREFIX, "").trim();
    const resolved = bySpelling.get(stripped.toLowerCase());
    if (resolved !== undefined) return resolved;

    // Unresolvable. Kept verbatim: what the model claimed is evidence, and
    // replacing it with null would hide that it cited a rule at all.
    return raw;
  };
}
