"use client";

/**
 * The rulesets a review is judged against, ticked one or more (D-288, D-294).
 *
 * Used where a review is set up and where a draft is started from its own
 * page, so both say a set that cannot run in the same words.
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { RULESET_TIERS } from "@/lib/domain/enums";
import { ruleCountWords } from "@/lib/rulesets/rule-count";
import { sharedCodes, sharedCodesRefusal } from "@/lib/rulesets/shared-codes";
import { Problem } from "@/components/ui";

export interface PickableRuleset {
  id: string;
  name: string;
  tier: string;
  version: number;
  /** Its rules that are switched on. */
  ruleCount: number;
  /** Every rule it holds, switched on or off. */
  ruleTotal: number;
  /** The codes of its rules that are switched on, which a review would freeze. */
  codes: string[];
}

export interface RulesetChoice {
  /** The ticked rulesets, in the list's order whatever order they were ticked in. */
  ids: string[];
  /** Why the ticked set cannot judge one review, in the server's words; empty when it can. */
  refusal: string;
  noneTicked: boolean;
}

/**
 * What a list of ticks comes to: only rulesets still listed, and the
 * refusal for two that hold a rule under one number, known from the list's
 * own codes before anything is asked of the server.
 */
export function rulesetChoice(
  rulesets: readonly PickableRuleset[],
  ticked: readonly string[] | null,
): RulesetChoice {
  const chosen = rulesets.filter((ruleset) => ticked?.includes(ruleset.id));
  const shared = sharedCodes(chosen);
  return {
    ids: chosen.map((ruleset) => ruleset.id),
    refusal: shared.length > 0 ? sharedCodesRefusal(shared) : "",
    noneTicked: rulesets.length > 0 && chosen.length === 0,
  };
}

/**
 * Runs `read` each time the window is come back to, from another tab or
 * another window.
 *
 * A screen reads the list of rulesets once, and a ruleset is changed
 * somewhere else: renumbered in another tab, as the refusal for a shared
 * number says to, it kept its old numbers here, and the refusal stood until
 * the page was loaded again (review round 25).
 */
export function useReadOnReturn(read: () => void): void {
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  useEffect(() => {
    // A tab come back to is both shown and focused: one read, not two.
    let away = false;
    const left = () => {
      away = true;
    };
    const back = () => {
      if (!away || document.visibilityState !== "visible") return;
      away = false;
      latest.current();
    };
    const shownOrHidden = () => (document.visibilityState === "visible" ? back() : left());
    window.addEventListener("blur", left);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", shownOrHidden);
    return () => {
      window.removeEventListener("blur", left);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", shownOrHidden);
    };
  }, []);
}

export function RulesetPicker({
  rulesets,
  choice,
  onChange,
}: {
  rulesets: readonly PickableRuleset[];
  choice: RulesetChoice;
  onChange: (ids: string[]) => void;
}) {
  return (
    <>
      <div className="grid gap-3" data-testid="ruleset-picker">
        {/* The tiers in the order the Rulesets screen lists them, then any
            other a ruleset carries: left out, its ruleset could not be
            ticked. */}
        {[...new Set([...RULESET_TIERS, ...rulesets.map((ruleset) => ruleset.tier)])]
          .filter((tier) => rulesets.some((ruleset) => ruleset.tier === tier))
          .map((tier) => (
            <div key={tier}>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                {tier}
              </h3>
              <ul className="grid gap-1">
                {rulesets
                  .filter((ruleset) => ruleset.tier === tier)
                  .map((ruleset) => {
                    const ticked = choice.ids.includes(ruleset.id);
                    return (
                      <li
                        key={ruleset.id}
                        className={`flex items-center gap-3 rounded-md border px-3 ${
                          ticked
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                            : "border-transparent hover:bg-[var(--color-surface-sunken)]"
                        }`}
                      >
                        {/* The label is the row's height, so a thumb has the
                            40px the other controls keep. */}
                        <label className="flex min-h-[var(--hit-target)] min-w-0 flex-1 cursor-pointer items-center gap-3 py-1 text-sm">
                          <input
                            type="checkbox"
                            className="shrink-0 scheme-light-dark accent-[var(--color-accent)]"
                            checked={ticked}
                            onChange={(event) =>
                              onChange(
                                event.target.checked
                                  ? [...choice.ids, ruleset.id]
                                  : choice.ids.filter((id) => id !== ruleset.id),
                              )
                            }
                          />
                          <span className="min-w-0 break-words">{ruleset.name}</span>
                          <span className="shrink-0 text-xs text-[var(--color-ink-muted)] tabular-nums">
                            v{ruleset.version}
                          </span>
                        </label>
                        <Link
                          href={`/rulesets/${ruleset.id}`}
                          aria-label={`${ruleset.name}, ${ruleCountWords(
                            ruleset.ruleCount,
                            ruleset.ruleTotal,
                          )}`}
                          className="shrink-0 text-xs text-[var(--color-accent)] tabular-nums hover:underline"
                        >
                          {ruleCountWords(ruleset.ruleCount, ruleset.ruleTotal)}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
      </div>
      {/* Said as a tick changes it, so a screen reader hears it too. */}
      <div aria-live="polite" className="mt-3 grid gap-2 empty:mt-0">
        {choice.refusal ? <Problem>{choice.refusal}</Problem> : null}
        {choice.noneTicked ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            No ruleset is ticked, and a review needs at least one to judge the change against.
          </p>
        ) : null}
      </div>
    </>
  );
}
