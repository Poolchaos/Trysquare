import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * What axe finds on the page as it stands, against the WCAG A and AA rules
 * themes.spec holds every screen to, each named with the elements it is on.
 * Waits first for the transitions that end, as themes.spec does: a control
 * caught mid-fade measures as low contrast.
 *
 * Each is asked whether it has ended, not awaited by its `finished` promise:
 * after a theme switch on the new-review screen, Chromium reported a
 * select's colour transitions as finished and never settled that promise,
 * and the wait held the test until it timed out (measured 2026-11-21: 54
 * waited on, the select's left unsettled after four seconds, each with
 * playState "finished").
 */
export async function accessibilityViolations(page: Page): Promise<string[]> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      .every((animation) => animation.playState === "finished" || animation.playState === "idle"),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help}\n` +
      violation.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n"),
  );
}
