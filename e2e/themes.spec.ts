/**
 * Every screen, in both themes, photographed and checked for the things a
 * screenshot cannot tell you.
 *
 * Runs after the journey, so the pages have real content in them: an empty
 * projects list photographs nothing worth looking at. The assertions are about
 * behaviour a picture would hide, and the pictures are for a person to judge.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const EVIDENCE = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "review",
  `${new Date().toISOString().slice(0, 10)}-e2e`,
);

/**
 * Photographs the page by capturing the body rather than the whole page.
 *
 * A full-page capture failed intermittently here, and the reason is structural
 * rather than incidental: the rail polls for a running review every few
 * seconds, so the page is never idle and a capture can land mid-repaint. An
 * element capture does not take that path, and animations are frozen so two
 * photographs of the same screen are the same photograph.
 */
async function photograph(page: import("@playwright/test").Page, file: string): Promise<void> {
  await page.locator("body").screenshot({ path: file, animations: "disabled", caret: "hide" });
}

const SCREENS = [
  { path: "/projects", name: "projects", title: "Projects" },
  { path: "/reviews", name: "reviews", title: "Reviews" },
  { path: "/rulesets", name: "rulesets", title: "Rulesets" },
  { path: "/settings", name: "settings", title: "Settings" },
];

test.beforeAll(() => {
  mkdirSync(EVIDENCE, { recursive: true });
});

for (const screen of SCREENS) {
  test(`${screen.name} renders and photographs`, async ({ page }, testInfo) => {
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.title, level: 1 })).toBeVisible();

    // The rail marks where you are, for anyone not going by colour.
    const current = page.locator('nav a[aria-current="page"]');
    await expect(current).toHaveCount(1);

    // Wide content scrolls inside its own container; the page never does.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, `${screen.path} scrolls horizontally`).toBe(false);

    await photograph(page, join(EVIDENCE, `${testInfo.project.name}-${screen.name}.png`));
  });
}

/**
 * The screens that need a thing to exist before they can be seen at all.
 *
 * Walked rather than deep-linked, because the ids belong to whatever the
 * journey created, and walking is also the path a person takes.
 */
test("the detail screens photograph on real content", async ({ page }, testInfo) => {
  const shot = (name: string) => join(EVIDENCE, `${testInfo.project.name}-${name}.png`);

  await page.goto("/projects");
  await page.getByRole("main").getByRole("link", { name: "app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Branches" })).toBeVisible({ timeout: 60_000 });
  await photograph(page, shot("project-detail"));

  await page.getByRole("link", { name: "New review" }).click();
  await expect(page.getByRole("heading", { name: "New review", level: 1 })).toBeVisible();
  await expect(page.getByTestId("model-picker")).toBeVisible();
  await photograph(page, shot("new-review"));

  await page.goto("/rulesets");
  await page.getByRole("main").getByRole("link").first().click();
  await expect(page.getByRole("table")).toBeVisible();
  await photograph(page, shot("ruleset-detail"));
});

test("a completed review photographs with its report", async ({ page }, testInfo) => {
  await page.goto("/reviews");
  await openTheCompletedReview(page);

  await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });
  await photograph(page, join(EVIDENCE, `${testInfo.project.name}-review.png`));
});

/**
 * Opens the one review that reached a report.
 *
 * Named rather than taken as "the first row": the failure-path pass leaves a
 * resumed review and a cancelled one behind, and picking whichever sorted
 * newest quietly landed on a review with no report at all.
 */
async function openTheCompletedReview(page: import("@playwright/test").Page): Promise<void> {
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("link").click();
}

test("the theme actually follows the browser's preference", async ({ page }, testInfo) => {
  // Asserted rather than left to the screenshots, because a picture nobody
  // opens proves nothing. This caught a real bug: Tailwind's @theme does not
  // honour being nested in a media query, so the dark values were overwriting
  // the light ones unconditionally and the app only ever rendered dark.
  await page.goto("/projects");
  const background = await page
    .locator("body")
    .evaluate((element) => getComputedStyle(element).backgroundColor);

  // Chromium reports these as lab(), where the first channel is lightness on
  // a 0 to 100 scale, and an rgb() answer would need averaging instead. The
  // first version of this test summed the lab channels and read 99.8 as
  // "dark", which was the test being wrong rather than the page.
  const lightness = lightnessOf(background);
  if (testInfo.project.name === "dark") expect(lightness).toBeLessThan(30);
  else expect(lightness).toBeGreaterThan(80);
});

/** Lightness on a 0 to 100 scale, whichever colour syntax the browser used. */
function lightnessOf(colour: string): number {
  const numbers = colour.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (colour.startsWith("lab(")) return numbers[0] ?? 0;
  if (colour.startsWith("oklch(")) return (numbers[0] ?? 0) * 100;
  const [red = 0, green = 0, blue = 0] = numbers;
  return ((red + green + blue) / 3 / 255) * 100;
}

/**
 * The contrast and semantics claim 04 section 4 makes, actually checked.
 *
 * It was stated as fact for days while nothing checked it, which is the exact
 * failure the "not built yet" blocks exist to prevent. Both themes, because a
 * palette that passes light can fail dark on the same tokens.
 *
 * Scoped to WCAG 2 A and AA, which is what 04 claims. Best-practice rules are
 * deliberately not included: they are opinions, and failing the suite on an
 * opinion trains people to ignore it.
 */
for (const screen of SCREENS) {
  test(`${screen.name} has no accessibility violations`, async ({ page }) => {
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.title, level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Named in the failure rather than counted: "3 violations" sends someone
    // to a report file, and the rule id and the element are what actually
    // get it fixed.
    const summary = results.violations.map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n"),
    );
    expect(summary, `${screen.path} in ${test.info().project.name}`).toEqual([]);
  });
}

test("the confirmation queue has no accessibility violations", async ({ page }) => {
  // The densest screen in the app and the one a person spends longest in, so
  // it is checked on its own rather than only as part of the list above.
  await page.goto("/reviews");
  await openTheCompletedReview(page);
  await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help}\n` +
        violation.nodes
          .map((node) => `    ${node.target.join(" ")}\n    ${node.failureSummary ?? ""}`)
          .join("\n"),
    ),
    "the completed review screen",
  ).toEqual([]);
});

test("the first thing tabbed to is reachable and visibly focused", async ({ page }) => {
  // Focus has to be visible, not merely present: a keyboard user who cannot
  // see where they are is not being served by an outline that was removed.
  await page.goto("/projects");
  await page.keyboard.press("Tab");

  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  const outline = await focused.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});
