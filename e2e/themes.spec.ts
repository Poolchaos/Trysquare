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

test("a completed review photographs with its report", async ({ page }, testInfo) => {
  await page.goto("/reviews");
  // The only review the journey left, whatever the project ended up called.
  await page.getByRole("main").getByRole("link").first().click();

  await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });
  await photograph(page, join(EVIDENCE, `${testInfo.project.name}-review.png`));
});

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
