/**
 * Every screen, in both themes, photographed and checked for the things a
 * screenshot cannot tell you.
 *
 * Runs after the journey, so the pages have real content in them: an empty
 * projects list photographs nothing worth looking at. The assertions are about
 * behaviour a picture would hide, and the pictures are for a person to judge.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { COLLEAGUE_BRANCH, GIT_CONFIG, MY_EMAIL } from "./setup";

const EVIDENCE = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "review",
  `${new Date().toISOString().slice(0, 10)}-e2e`,
);

/**
 * Photographs the page by capturing the body rather than the whole page.
 *
 * A full-page capture failed intermittently here, and the reason is structural
 * rather than incidental: the top bar polls for a running review every few
 * seconds, so the page is never idle and a capture can land mid-repaint. An
 * element capture does not take that path, and animations are frozen so two
 * photographs of the same screen are the same photograph.
 *
 * From the top of the page: the capture draws the sticky top bar where the
 * page is scrolled to, so a page left scrolled by a field filled further down
 * was photographed with the bar across its middle, which nobody sees.
 */
async function photograph(page: import("@playwright/test").Page, file: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("body").screenshot({ path: file, animations: "disabled", caret: "hide" });
}

const SCREENS = [
  // The dashboard is a screen now, so it is photographed and checked like
  // one, including that it marks itself current without lighting every
  // other link.
  { path: "/", name: "dashboard", title: "Review scoreboard" },
  { path: "/projects", name: "projects", title: "Projects" },
  { path: "/reviews", name: "reviews", title: "Reviews" },
  { path: "/rulesets", name: "rulesets", title: "Rulesets" },
  { path: "/settings", name: "settings", title: "Settings" },
];

test.beforeAll(() => {
  mkdirSync(EVIDENCE, { recursive: true });
});

/**
 * Waits for every animation and transition on the page to end, so axe reads
 * colours as they stay. A control enabled a moment ago is still fading in
 * from its disabled opacity: on Settings, as Check the CLI turned enabled,
 * the probe buttons read 0.45 to 0.70, and axe on macOS CI flagged their
 * contrast mid-fade (run 39733821489, 2026-10-22).
 */
async function settled(page: import("@playwright/test").Page): Promise<void> {
  // Only those that end: the top bar's pulse runs for good while a review
  // is active, and waited for, held the page until the test timed out; one
  // a re-render interrupts rejects, and counts as ended (review of the 7.1
  // changes).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

for (const screen of SCREENS) {
  test(`${screen.name} renders and photographs`, async ({ page }, testInfo) => {
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.title, level: 1 })).toBeVisible();

    // The bar marks where you are, for anyone not going by colour, and
    // marks exactly one place: every path begins with "/", so a prefix test
    // would light the dashboard on every screen.
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
  // The branches as fetched: photographed while "Fetching the latest refs...",
  // and New review pressed during that fetch waited behind it, the server
  // fetching one clone at a time (review round 15).
  await expect(page.getByRole("main").getByRole("table")).toBeVisible({ timeout: 60_000 });
  await photograph(page, shot("project-detail"));

  await page.getByRole("link", { name: "New review" }).click();
  await expect(page.getByRole("heading", { name: "New review", level: 1 })).toBeVisible();
  // Drawn once its own fetch from the remote lands, as the branches above are.
  await expect(page.getByTestId("model-picker")).toBeVisible({ timeout: 60_000 });
  await photograph(page, shot("new-review"));

  await page.goto("/rulesets");
  await page.getByRole("main").getByRole("link").first().click();
  await expect(page.getByRole("table")).toBeVisible();
  await photograph(page, shot("ruleset-detail"));
});

test("a rule opens to what its document says, on a desk and on a phone", async ({
  page,
}, testInfo) => {
  const shot = (name: string) => join(EVIDENCE, `${testInfo.project.name}-${name}.png`);
  await page.goto("/rulesets");
  await page.getByRole("main").getByRole("link", { name: "Example protocol", exact: true }).click();
  const title = page.getByRole("button", { name: "Unawaited Promise", exact: true });
  await expect(title).toHaveAttribute("aria-expanded", "false");
  const written = page.getByTestId("rule-text");
  await expect(written).toHaveCount(0);

  await title.click();
  await expect(title).toHaveAttribute("aria-expanded", "true");
  await expect(written).toBeVisible();
  await expect(written).toContainText("Flag a call that returns a promise");
  // The example and the reason, not only the rule's first line, formatted:
  // labels in bold, the examples as code, and no markdown markers left over.
  await expect(written.locator("strong", { hasText: "Why This Matters:" })).toBeVisible();
  await expect(written.locator("pre", { hasText: "await persist(order);" })).toBeVisible();
  await expect(written).not.toContainText("**");
  await expect(written).not.toContainText("```");

  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  await photograph(page, shot("ruleset-rule-open"));

  // At phone width a rule is a stack, so the card has nothing to scroll
  // sideways to: the tags, the sweeps and the on/off switch sat past its
  // edge (PROJECT-STATE, Known issues, 2026-11-03). The rule's text must
  // still be read whole, inside the screen.
  // Not scrolled into view first: that could scroll a card sideways to the
  // text, and hide the very thing measured here.
  await page.setViewportSize({ width: 360, height: 780 });
  const box = await written.boundingBox();
  expect(box, "the rule's text has a box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  const table = page.getByRole("table");
  const cardScroll = await table.evaluate((element) => {
    const card = element.parentElement;
    return card === null ? Number.NaN : card.scrollWidth - card.clientWidth;
  });
  expect(cardScroll, "pixels of the rules past the card's edge").toBeLessThanOrEqual(0);
  for (const control of [page.getByRole("checkbox").first(), page.getByRole("combobox").first()]) {
    const place = await control.boundingBox();
    expect(place, "a rule's control has a box").not.toBeNull();
    expect(place!.x).toBeGreaterThanOrEqual(0);
    expect(place!.x + place!.width).toBeLessThanOrEqual(360);
  }
  await expect(table.getByText("Tags:").first()).toBeVisible();
  await expect(table.getByText("Sweeps:").first()).toBeVisible();
  const phone = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(phone.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  await photograph(page, shot("ruleset-rule-open-phone"));

  await title.click();
  await expect(title).toHaveAttribute("aria-expanded", "false");
  await expect(written).toHaveCount(0);
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
    // Settled before it is measured: Settings asks the CLI as it opens, its
    // controls disabled until the answer, and axe flags a disabled button's
    // faded text for contrast, though WCAG 1.4.3 exempts an inactive control
    // (measured with the answer held; review of the D-163 fixes).
    if (screen.path === "/settings") {
      await expect(page.getByRole("button", { name: "Check the CLI" })).toBeEnabled({
        timeout: 30_000,
      });
    }

    await settled(page);

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

test("a primary button keeps its contrast under the pointer", async ({ page }) => {
  // Faded to nine-tenths on hover, the light theme's primary button read
  // 4.41:1, under AA's 4.5:1; no screen above is measured with the pointer
  // on one, so it was found only when a test left it there.
  await page.goto("/projects");
  await page.getByRole("main").getByRole("link", { name: "app", exact: true }).click();
  const primary = page.getByRole("button", { name: "New review" });
  await expect(primary).toBeVisible({ timeout: 30_000 });
  const background = () => primary.evaluate((button) => getComputedStyle(button).backgroundColor);
  const resting = await background();
  await primary.hover();
  await settled(page);
  // The pointer took: what is measured below is the hovered button.
  expect(await background()).not.toBe(resting);
  mkdirSync(EVIDENCE, { recursive: true });
  await page
    .locator("header")
    .filter({ has: page.getByRole("heading", { level: 1 }) })
    .screenshot({
      path: join(EVIDENCE, `primary-hover-${test.info().project.name}.png`),
      caret: "hide",
    });

  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(
    results.violations.flatMap((violation) =>
      violation.nodes.map((node) => `${node.target.join(" ")}: ${node.any[0]?.message ?? ""}`),
    ),
    `a hovered primary button in ${test.info().project.name}`,
  ).toEqual([]);
});

test("a disabled primary button does not answer the pointer", async ({ page }) => {
  // Review round 14: the hover moved a disabled button's colour too, as if it
  // could be pressed; the fading it replaced lost to the disabled fade.
  await page.goto("/projects");
  const add = page.getByRole("button", { name: "Add project" });
  await expect(add).toBeDisabled({ timeout: 30_000 });
  const background = () => add.evaluate((button) => getComputedStyle(button).backgroundColor);
  const resting = await background();
  await add.hover({ force: true });
  await settled(page);
  expect(await background()).toBe(resting);
});

test("the billing notice has no accessibility violations", async ({ page }) => {
  // On its warning colours, in each theme: no page showed it while axe ran,
  // since the suite's fake draws on a subscription (review of D-161).
  await page.route("**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        cli: { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "api_key" },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    }),
  );
  await page.goto("/settings");
  await expect(page.getByTestId("per-token-notice")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("cli-status")).toContainText("Signed in (api_key)");

  await settled(page);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help}\n` +
        violation.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n"),
    ),
    `the billing notice in ${test.info().project.name}`,
  ).toEqual([]);
});

test("the confirmation queue has no accessibility violations", async ({ page }) => {
  // The densest screen in the app and the one a person spends longest in, so
  // it is checked on its own rather than only as part of the list above.
  await page.goto("/reviews");
  await openTheCompletedReview(page);
  await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });

  await settled(page);

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

test("a review waiting on decisions photographs on a desk and on a phone", async ({
  page,
}, testInfo) => {
  // Deciding findings is what a phone is for here (D-69), so the queue is
  // looked at there too, not only where it was designed.
  const shot = (name: string) => join(EVIDENCE, `${testInfo.project.name}-${name}.png`);
  await page.goto("/reviews?status=awaiting");
  const row = page.getByRole("main").locator("ul > li").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("link").click();
  await expect(page.getByRole("button", { name: "Complete review" })).toBeVisible({
    timeout: 30_000,
  });
  await settled(page);
  await photograph(page, shot("queue"));

  await page.setViewportSize({ width: 360, height: 780 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);

  // The two decisions are a thumb high and the width of the card (WP-K).
  // Measured once settled: a button's size is a transition, and one caught
  // midway read 40.1px on its way to 44.
  await settled(page);
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  for (const [name, button] of [
    ["Confirm", confirm],
    ["Dismiss", dismiss],
  ] as const) {
    const box = await button.boundingBox();
    expect(box, `${name} has a box`).not.toBeNull();
    expect(box!.height, `${name}'s height`).toBeGreaterThanOrEqual(44);
    expect(box!.width, `${name}'s width`).toBeGreaterThanOrEqual(240);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
  // The finding to decide comes before the account of the run.
  const proven = page.getByRole("heading", { name: "How the findings were proven" });
  const confirmAt = (await confirm.boundingBox())!.y;
  const provenAt = (await proven.boundingBox())!.y;
  expect(confirmAt, "Confirm sits above the run's summary").toBeLessThan(provenAt);
  // Keys are for a keyboard.
  await expect(page.getByText("next / previous")).toBeHidden();

  await settled(page);
  const phone = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(phone.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  await photograph(page, shot("queue-phone"));
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

test("no screen makes the page scroll sideways", async ({ page }) => {
  // 04 section 1. A run note naming sixty-one changed paths, or an engine
  // line carrying a whole JSON answer, used to widen the layout until the
  // document itself scrolled: the review screen was unreadable at the right
  // edge and every panel was pushed off centre.
  for (const path of ["/", "/projects", "/reviews", "/rulesets", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test("the shell works at phone width", async ({ page }) => {
  // WP-K: monitoring a run and deciding findings are first-class on a phone.
  // The bar is the part every screen depends on, so it is the part measured:
  // navigation still reachable, nothing pushed off the side, and the page
  // still not scrolling horizontally at the width where it is likeliest to.
  await page.setViewportSize({ width: 360, height: 780 });

  for (const path of ["/", "/reviews", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Every destination is still there and still says what it is: a label
    // without an icon navigates, an icon without a label guesses.
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const label of ["Dashboard", "Projects", "Reviews", "Rulesets", "Settings"]) {
      await expect(nav.getByRole("link", { name: label })).toBeAttached();
    }
    await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls horizontally by ${overflow}px at 360`).toBeLessThanOrEqual(0);
  }
});

/**
 * Three lines that said more than the code does, until a sweep of the screens
 * on 2026-11-19 (D-244): git writes in a clone, the picker and not the server
 * keeps a review to a probed model, and the sign-in check asks Anthropic's
 * API. Read here so each stays what was measured, and photographed at the
 * width where a longer line is likeliest to break.
 */
test("Projects, the model picker and the CLI card say what the code does, on a phone too", async ({
  page,
}, testInfo) => {
  const shot = (name: string) => join(EVIDENCE, `${testInfo.project.name}-${name}.png`);
  await page.setViewportSize({ width: 360, height: 780 });

  await page.goto("/projects");
  await expect(
    page.getByText("Cloned read-only. Trysquare never writes to a project's code."),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "app", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await photograph(page, shot("projects-phone"));

  await page.getByRole("main").getByRole("link", { name: "app", exact: true }).click();
  await page.getByRole("link", { name: "New review" }).click();
  await expect(page.getByTestId("model-picker")).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("Only a model a fresh probe vouches for can be chosen here."),
  ).toBeVisible();
  await photograph(page, shot("new-review-phone"));

  await page.goto("/settings");
  await expect(
    page.getByText(
      "The sign-in check contacts Anthropic's API; neither check sends a model a prompt.",
    ),
  ).toBeVisible();
  await photograph(page, shot("settings-phone"));
});

test("Mine leaves the branches I last committed to, and an empty one says whose it looked for", async ({
  page,
}, testInfo) => {
  // WP-L, D-243. The suite's server commits as the fixture's author
  // (playwright.config.ts), so the fixture's three branches are mine and the
  // colleague's one is not.
  const shot = (name: string) => join(EVIDENCE, `${testInfo.project.name}-${name}.png`);
  const emails = page.getByLabel("Emails, one per line");
  const inEffect = page.getByTestId("git-email");
  const mine = page.getByRole("button", { name: "Mine", exact: true });
  const rows = page.getByRole("main").getByRole("table").locator("tbody tr");
  const colleagues = rows.filter({ hasText: COLLEAGUE_BRANCH });
  const violations = async () => {
    await settled(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    return results.violations.map((violation) => `${violation.id}: ${violation.help}`);
  };
  const sideways = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  const keep = async (text: string) => {
    await page.goto("/settings");
    await emails.fill(text);
    await emails.blur();
  };
  const openBranches = async () => {
    await page.goto("/projects");
    await page.getByRole("main").getByRole("link", { name: "app", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Branches" })).toBeVisible({ timeout: 60_000 });
    await expect(mine).toBeVisible({ timeout: 60_000 });
  };
  const desk = page.viewportSize() ?? { width: 1280, height: 720 };
  const phone = { width: 360, height: 780 };

  try {
    // Nothing kept: git's own email is the one in effect, and Settings says so.
    await page.goto("/settings");
    await expect(emails).toHaveValue("");
    await expect(inEffect).toHaveText(`Going by ${MY_EMAIL}, from your git config.`);

    await openBranches();
    await expect(mine).toHaveAttribute("aria-pressed", "false");
    await expect(rows).toHaveCount(4);
    await expect(colleagues).toHaveCount(1);
    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(3);
    await expect(colleagues).toHaveCount(0);
    await expect(rows.filter({ hasText: "feature/rename-prefs" })).toHaveCount(1);
    expect(await violations()).toEqual([]);
    await photograph(page, shot("project-mine"));

    // Both narrowings at once say which of them is hiding the branches.
    await page.getByPlaceholder("Filter").fill("no branch is called this");
    await expect(page.getByText("No branch matches that filter")).toBeVisible();
    await expect(
      page.getByText("3 of your branches are here; the filter is hiding them."),
    ).toBeVisible();
    await page.getByPlaceholder("Filter").fill("");
    await expect(rows).toHaveCount(3);

    await page.setViewportSize(phone);
    expect(await sideways(), "the project page scrolls sideways at 360").toBeLessThanOrEqual(0);
    const toggle = await mine.boundingBox();
    expect(toggle, "Mine has a box").not.toBeNull();
    expect(toggle!.x).toBeGreaterThanOrEqual(0);
    expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(phone.width);
    expect(toggle!.height).toBeGreaterThanOrEqual(40);
    await photograph(page, shot("project-mine-phone"));
    await page.setViewportSize(desk);

    // Somebody else's email kept: it replaces git's, and no branch here is
    // theirs, which the empty list says with the email it went by.
    await keep("someone-else@example.invalid");
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await expect(inEffect).toHaveCount(0);
    expect(await violations()).toEqual([]);
    await photograph(page, shot("settings-emails-kept"));
    await page.setViewportSize(phone);
    expect(await sideways(), "Settings scrolls sideways at 360").toBeLessThanOrEqual(0);
    await photograph(page, shot("settings-emails-kept-phone"));
    await page.setViewportSize(desk);

    await openBranches();
    await mine.click();
    const none = page.getByText("No branch here is yours");
    await expect(none).toBeVisible();
    await expect(
      page.getByText(
        "None ends on a commit authored as someone-else@example.invalid. The emails that count as yours are kept in Settings.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("table")).toHaveCount(0);
    // The email is read whole: broken wherever the line ran out, it was
    // "someo" on one line and the rest on the next, at both widths.
    const linesOfEmail = () =>
      page
        .getByRole("main")
        .getByText("someone-else@example.invalid", { exact: true })
        .evaluate(
          (email) =>
            email.getBoundingClientRect().height / parseFloat(getComputedStyle(email).lineHeight),
        );
    expect(await linesOfEmail(), "the email sits on one line at desk width").toBeLessThan(1.5);
    expect(await violations()).toEqual([]);
    await photograph(page, shot("project-mine-none"));
    await page.setViewportSize(phone);
    expect(await sideways(), "the empty Mine list scrolls sideways at 360").toBeLessThanOrEqual(0);
    expect(await linesOfEmail(), "the email sits on one line at 360").toBeLessThan(1.5);
    await photograph(page, shot("project-mine-none-phone"));
    await page.setViewportSize(desk);
    // The way out it names is a link, and it goes there.
    await page.getByRole("main").getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    // A name with its email is refused in the server's words, beside the
    // field, and what was typed is still there to correct.
    await emails.fill("Fixture <fixture@example.invalid>");
    await emails.blur();
    await expect(
      page.getByText("The list of emails holds < or >: enter the email alone, without a name"),
    ).toBeVisible();
    await expect(emails).toHaveValue("Fixture <fixture@example.invalid>");
    await photograph(page, shot("settings-emails-refused"));

    // Emptied again, with a git config that sets no email: nobody's, said on
    // Settings and by the empty list, each naming what to do.
    writeFileSync(GIT_CONFIG, "[user]\n\tname = Fixture\n");
    await emails.fill("");
    await emails.blur();
    await expect(inEffect).toHaveText(
      "Your git config sets no user.email, so no branch counts as yours until you enter an email here.",
    );
    expect(await violations()).toEqual([]);
    await photograph(page, shot("settings-no-git-email"));
    await openBranches();
    await mine.click();
    await expect(page.getByText("No email counts as yours yet")).toBeVisible();
    expect(await violations()).toEqual([]);
    await photograph(page, shot("project-mine-no-email"));
  } finally {
    // As the next theme's run, and every test after this one, expects it.
    writeFileSync(GIT_CONFIG, `[user]\n\tname = Fixture\n\temail = ${MY_EMAIL}\n`);
    await keep("");
  }
  await expect(inEffect).toHaveText(`Going by ${MY_EMAIL}, from your git config.`);
});

// Last in this file: the ruleset it imports stays, and no test before it
// should meet a list one row longer in one theme than in the other.
test("a document's image is shown as words, and its host is never asked", async ({
  page,
}, testInfo) => {
  const shot = (name: string) => join(EVIDENCE, `${testInfo.project.name}-${name}.png`);
  const markdown = [
    "# Protocol with an image",
    "",
    // Long enough to pass any height a box might cap it at: the test after
    // this one opens it.
    "## The Prime Directive",
    "",
    "Understand the change before judging it.",
    "",
    ...Array.from(
      { length: 30 },
      (_, index) => `- Step ${index + 1}: read the next file in the chain before judging.`,
    ),
    "",
    "## Correctness Anti-Patterns",
    "",
    "### 1. Diagram Left Behind",
    "",
    "**Rule:** Flag a change to the order flow that leaves its diagram showing the old one.",
    "",
    "![The order flow before the change](https://images.invalid/order-flow.png)",
    "",
    "**Severity:** WARNING",
    "",
  ].join("\n");
  // Through the route, not the screen: the journey owns the import flow. The
  // second theme sends the same document, which the route stores unchanged.
  const imported = await page.request.post("/api/rulesets/import", {
    data: { name: "Protocol with an image", tier: "global", markdown },
  });
  expect(imported.status(), await imported.text()).toBe(201);

  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1") asked.push(request.url());
  });

  await page.goto("/rulesets");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Protocol with an image", exact: true })
    .click();
  await page.getByRole("button", { name: "Diagram Left Behind", exact: true }).click();
  const written = page.getByTestId("rule-text");
  await expect(written).toBeVisible();
  await expect(page.getByTestId("document-image")).toHaveText(
    "Image, not loaded: The order flow before the change https://images.invalid/order-flow.png",
  );
  await expect(written.locator("img")).toHaveCount(0);

  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  await photograph(page, shot("ruleset-image-as-words"));

  await page.setViewportSize({ width: 360, height: 780 });
  const box = await written.boundingBox();
  expect(box, "the rule's text has a box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  await photograph(page, shot("ruleset-image-as-words-phone"));

  // Asked last, after every paint above had its chance to fetch.
  expect(asked, "requests to another host").toEqual([]);
});

// After the test above, whose ruleset it opens.
test("a long process directive opens whole, with no scroll box a keyboard cannot reach", async ({
  page,
}, testInfo) => {
  const shot = (name: string) => join(EVIDENCE, `${testInfo.project.name}-${name}.png`);
  await page.goto("/rulesets");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Protocol with an image", exact: true })
    .click();
  await page.getByRole("button", { name: /^Show the \d+ process directive/ }).click();
  const title = page.getByRole("button", { name: /The Prime Directive/ });
  // Its section in words, not as the key it is stored under.
  await expect(title).toHaveText("Prime directive: The Prime Directive");
  await expect(page.getByRole("button", { name: /^Philosophy: / }).first()).toBeVisible();
  await expect(page.getByText(/prime_directive|domain_knowledge|output_format/)).toHaveCount(0);
  await expect(title).toHaveAttribute("aria-expanded", "false");
  await title.click();
  await expect(title).toHaveAttribute("aria-expanded", "true");

  const body = page.locator("pre", { hasText: "Step 30: read the next file" });
  await expect(body).toBeVisible();
  // All thirty steps are on the page, none behind a scroll of the box's own.
  const hidden = await body.evaluate((box) => box.scrollHeight - box.clientHeight);
  // Soft, so that a box with a scroll of its own is also put to axe below.
  expect.soft(hidden, "pixels of the directive behind its own scroll").toBeLessThanOrEqual(0);

  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  await photograph(page, shot("ruleset-directive-open"));

  await page.setViewportSize({ width: 360, height: 780 });
  const box = await body.boundingBox();
  expect(box, "the directive has a box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  await photograph(page, shot("ruleset-directive-open-phone"));
});
