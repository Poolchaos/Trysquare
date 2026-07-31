/**
 * One review, from an empty app to an exported report, through a browser.
 *
 * The unit and route tests prove each part in isolation; this proves the parts
 * are connected, which is the one thing they cannot. It runs against a
 * production build with the fake engine, so it spends nothing and its answers
 * are the same ones the engine quality gate uses.
 *
 * Written as one test with named steps rather than several tests, because it
 * is one flow: each step depends on what the last one left on the screen, and
 * Playwright gives every separate test a fresh page.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { APP_REPO, PROTOCOL_PATH } from "./setup";

test("a review, from an empty app to an exported report", async ({ page }) => {
  await test.step("an app with nothing in it says what to do first", async () => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    // An empty state that teaches the next step, rather than an apology.
    await expect(page.getByText("No projects yet")).toBeVisible();
    await expect(page.getByText(/pick two branches and the rules/i)).toBeVisible();
  });

  await test.step("a repository is added and clones in the background", async () => {
    await page.getByPlaceholder("git@github.com:you/your-app.git").fill(`file://${APP_REPO}`);
    await page.getByRole("button", { name: "Add project" }).click();
    // The clone runs in the background and the row appears at once, so the
    // name is what to wait for rather than a spinner finishing.
    await expect(page.getByRole("link", { name: "app", exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("a protocol document becomes a ruleset", async () => {
    await page.goto("/rulesets");
    await page.getByLabel("Name").fill("Example protocol");
    await page
      .getByPlaceholder("Paste the markdown protocol here")
      .fill(readFileSync(PROTOCOL_PATH, "utf8"));
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText(/Imported \d+ rule\(s\)/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the project page lists its branches with how far they have moved", async () => {
    await page.goto("/projects");
    await page.getByRole("link", { name: "app", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Branches" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Dependencies" })).toBeVisible();
  });

  await test.step("setting up a review shows what it will examine first", async () => {
    await page.getByRole("link", { name: "New review" }).click();
    await expect(page.getByRole("heading", { name: "New review" })).toBeVisible();

    // Both branches are chosen deliberately rather than left to the defaults.
    // This fixture's HEAD is the feature branch, so its detected default is
    // the branch under review, and taking the default would review main into
    // the feature branch: backwards, and a review of nothing anyone asked for.
    // Clicked the way a person clicks it: the radio itself is visually
    // hidden and the whole row is its label.
    await page
      .getByRole("main")
      .locator("label")
      .filter({ hasText: "feature/rename-prefs" })
      .first()
      .click();
    await page.getByLabel("Compare against").selectOption("main");
    await page
      .getByLabel(/What was this change meant to do/)
      .fill("Rename the prefs field and migrate every consumer.");

    // The pre-flight is free and read-only, so it appears on its own once the
    // four decisions are made.
    await expect(page.getByText("What this review will examine")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Files changed")).toBeVisible();
    await expect(page.getByText(/pinned again when the review starts/)).toBeVisible();
  });

  await test.step("starting it walks the stages and then stops for a person", async () => {
    await page.getByRole("button", { name: "Start review" }).click();
    await expect(page).toHaveURL(/\/reviews\/[A-Z0-9]+$/i, { timeout: 60_000 });
    await expect(page.getByText("awaiting confirmation")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible();
  });

  await test.step("one finding is dismissed with a reason", async () => {
    // Nothing is reported until a person says so, so completing is refused
    // while anything is still undecided.
    await expect(page.getByRole("button", { name: "Complete review" })).toBeDisabled();

    await page
      .getByPlaceholder("Why is this not a problem?")
      .first()
      .fill("Deliberate: the caller already guards this.");
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await expect(page.getByText("Deliberate: the caller already guards this.")).toBeVisible();
  });

  await test.step("the rest are confirmed from the keyboard", async () => {
    for (let guard = 0; guard < 30; guard += 1) {
      if ((await page.getByRole("button", { name: "Confirm" }).count()) === 0) break;
      await page.locator("body").press("c");
      await page.waitForTimeout(200);
    }
    await expect(page.getByRole("button", { name: "Complete review" })).toBeEnabled({
      timeout: 30_000,
    });
  });

  await test.step("completing it produces a report that can be exported", async () => {
    await page.getByRole("button", { name: "Complete review" }).click();
    await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });

    // The report says what was examined, not only what was found, and renders
    // findings in the structure the protocol defines.
    await expect(page.getByText("## What was examined")).toBeVisible();
    await expect(page.getByText(/^File: app\//m).first()).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByText(/Written to .*exports/)).toBeVisible({ timeout: 30_000 });
  });
});
