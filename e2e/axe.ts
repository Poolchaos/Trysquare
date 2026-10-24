import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * What axe finds on the page as it stands, against the WCAG A and AA rules
 * themes.spec holds every screen to, each named with the elements it is on.
 * Waits first for the transitions that end, as themes.spec does: a control
 * caught mid-fade measures as low contrast.
 */
export async function accessibilityViolations(page: Page): Promise<string[]> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
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
