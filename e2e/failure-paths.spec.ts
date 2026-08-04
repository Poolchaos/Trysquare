/**
 * The endings that are not success, walked through a browser.
 *
 * A usage limit is not a bug and neither is a cancel: both are ordinary
 * outcomes of running expensive work against someone else's rate limit, and
 * the product's claim is that it survives them legibly. The integration layer
 * proves the state machine and the persistence. What only a browser can show
 * is that a person is told what happened and handed the way forward.
 *
 * Runs after the journey, which leaves a project and a ruleset behind, so
 * these can start a review without repeating the setup.
 */

import { rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { LIMIT_TRIGGER, STALL_TRIGGER } from "./setup";

/** Unix seconds, and deliberately a fixed moment so the banner is checkable. */
const RESETS_AT = 1785408600;

/** Arms the next CLI call to fail the way a usage limit does. */
function armLimit(): void {
  writeFileSync(LIMIT_TRIGGER, JSON.stringify({ resetsAt: RESETS_AT }), "utf8");
}

test.afterAll(() => {
  rmSync(LIMIT_TRIGGER, { force: true });
  rmSync(STALL_TRIGGER, { force: true });
});

async function startAReview(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/projects");
  await page.getByRole("link", { name: "app", exact: true }).click();
  await page.getByRole("link", { name: "New review" }).click();
  await expect(page.getByRole("heading", { name: "New review", level: 1 })).toBeVisible();

  // The journey already probed this model, and the probe is fresh, so the
  // picker offers it without another paid call.
  await page
    .getByRole("main")
    .locator("label")
    .filter({ hasText: "feature/rename-prefs" })
    .first()
    .click();
  // Pinned rather than left to the detected-default fallback: the fixture has
  // three branches, and a wrong into-branch here would surface as the fake
  // CLI exiting over an unknown candidate, reading as an engine fault.
  await page.getByLabel("Compare against").selectOption("main");
  await expect(page.getByText("What this review will examine")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page).toHaveURL(/\/reviews\/[A-Z0-9]+$/i, { timeout: 60_000 });
}

test("a usage limit pauses the review, says when it clears, and resumes to the end", async ({
  page,
}) => {
  armLimit();
  await startAReview(page);

  // Paused rather than failed: nothing is wrong with the review, the account
  // simply has no capacity right now.
  await expect(page.getByText("paused limit")).toBeVisible({ timeout: 120_000 });
  // The CLI's own words, not a summary of them. Twice over, in fact: once as
  // the review's banner and once on the stage that hit it, which is the
  // difference between "this run is paused" and "this is where it stopped".
  await expect(page.getByText(/Claude usage limit reached/).first()).toBeVisible();
  expect(await page.getByText(/Claude usage limit reached/).count()).toBeGreaterThan(1);
  // And the half that makes a pause a wait rather than a hang: when to return.
  await expect(page.getByText(/The limit clears at/)).toBeVisible();
  await expect(page.getByText(/resuming before then will pause again/i)).toBeVisible();

  // The trigger armed one call and disarmed itself, so the resume runs to the
  // end, paying only for the stages the first attempt never reached.
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("awaiting confirmation")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible();

  // The pause is over, so the banner is gone rather than lingering as a
  // warning about something that has already been dealt with.
  await expect(page.getByText(/The limit clears at/)).toBeHidden();
});

test("cancelling a running review stops it and says so", async ({ page }) => {
  // A cancel is an ordinary ending, not a fault: the person changed their
  // mind, or saw the wrong branch pair. What has to hold is that the run
  // actually stops rather than being abandoned to finish unwatched, and that
  // the stage it was on reads as cancelled rather than as a failure.
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 30_000 }), "utf8");
  await startAReview(page);

  await expect(page.getByText("running", { exact: true })).toBeVisible({ timeout: 60_000 });
  // Cancel during the stalled stage, not merely while "running": the prepare
  // step precedes any stage, takes real time on a three-branch fixture, and a
  // cancel landing there leaves no stage to carry the mid-stage note this
  // test exists to check. The event feed says when the stage is truly open.
  await expect(page.getByText("s1_risk started")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });
  // The stage it was on is shown as a decision, not a red fault.
  await expect(page.getByText("Cancelled mid-stage.")).toBeVisible();
  // And it is genuinely over: nothing is left running to come back later.
  await expect(page.getByRole("button", { name: "Cancel" })).toBeHidden();
});

test("a review deleted from the list takes its evidence with it", async ({ page }) => {
  // The other ordinary ending: a review nobody needs any more. Its worktrees,
  // bundle and logs go with it, which is why the list says so out loud.
  await page.goto("/reviews");
  // Waited for rather than counted immediately: the list is fetched on the
  // client, and counting a list that has not arrived counts zero.
  await expect(page.getByText(/Deleting a review removes its worktrees/)).toBeVisible();
  const rows = page.getByRole("main").locator("ul > li");
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  await rows.first().getByRole("button", { name: "Delete" }).click();
  await rows.first().getByRole("button", { name: "Yes, delete" }).click();

  await expect(rows).toHaveCount(before - 1);
});
