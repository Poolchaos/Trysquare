/**
 * A list of branches narrowed to the person's own (WP-L, D-243): the toggle,
 * and what a list it empties says.
 *
 * Used on a project's page and in a new review's branch picker, so both say
 * it in the same words.
 */

import Link from "next/link";
import { Button, Empty, Mono } from "@/components/ui";

export function MineToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    // A toggle, so it says whether it is on rather than leaving that to
    // colour. Never a submit: a new review's picker sits in the form that
    // starts the review.
    <Button
      type="button"
      variant={on ? "primary" : "secondary"}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      Mine
    </Button>
  );
}

/**
 * Why Mine came back empty, and where that is changed: an empty list alone
 * reads as a project with no branches.
 *
 * @param identities The emails the branches were matched against.
 */
export function NoBranchOfYours({ identities }: { identities: readonly string[] }) {
  // Underlined, not coloured alone: inside a sentence a link has to be
  // told from the words around it without its colour (axe,
  // link-in-text-block, which a card's plain background lets it measure).
  const settings = (
    <Link href="/settings" className="text-[var(--color-accent)] underline underline-offset-2">
      Settings
    </Link>
  );
  if (identities.length === 0) {
    return (
      <Empty title="No email counts as yours yet">
        A branch is yours when its newest commit was authored with one of your git emails. Enter
        yours in {settings}.
      </Empty>
    );
  }
  return (
    <Empty title="No branch here is yours">
      None ends on a commit authored as{" "}
      {/* Each email in a box with the mark that follows it: the box moves to
          the next line whole. One wider than the line, as in a new review's
          picker on a phone, is broken after its @ before anywhere else, and
          its full stop stays with it: it was cut mid-word, the stop alone
          at the start of the next line. */}
      {identities.map((email, index) => {
        const at = email.lastIndexOf("@");
        return (
          <span key={email}>
            {index === 0 ? null : " "}
            <span className="inline-block max-w-full">
              <Mono className="[overflow-wrap:anywhere]">
                {email.slice(0, at + 1)}
                <wbr />
                {email.slice(at + 1)}
              </Mono>
              {index === identities.length - 1 ? "." : ","}
            </span>
          </span>
        );
      })}{" "}
      The emails that count as yours are set in {settings}.
    </Empty>
  );
}

/** What a filter that matches no branch is hiding, counted in the list it narrows. */
export function hiddenByFilter(count: number, mineOnly: boolean): string {
  const branches = mineOnly
    ? count === 1
      ? "1 of your branches is"
      : `${count} of your branches are`
    : count === 1
      ? "1 branch is"
      : `${count} branches are`;
  return `${branches} here; the filter is hiding ${count === 1 ? "it" : "them"}.`;
}
