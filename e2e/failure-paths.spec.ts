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
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { answerOnce } from "./answer-once";
import { APP_REPO, E2E_ROOT, LIMIT_TRIGGER, STALL_TRIGGER } from "./setup";

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

/** The new-review form filled for the journey's pair, up to its Start button. */
async function fillANewReview(page: import("@playwright/test").Page): Promise<void> {
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
}

async function startAReview(page: import("@playwright/test").Page): Promise<void> {
  await fillANewReview(page);
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

  // A resume the server refuses, as it does when another tab has already
  // cancelled the review, says why rather than watching a run that never
  // comes (4.19 review). Answered once by the route, the way the server does.
  await page.route(
    "**/api/reviews/*/start",
    (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Review is cancelled, which cannot be started or resumed.",
          code: "ReviewNotStartableError",
        }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(
    page.getByText("Review is cancelled, which cannot be started or resumed."),
  ).toBeVisible();

  // The toolbar's Cancel asks too, and an answer that cancelled nothing is
  // said rather than read as done (5.1; driven here since the review of 5.1
  // to 5.4: only the theater's had been).
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  const yesCancel = page.getByRole("button", { name: "Yes, cancel", exact: true });
  await cancel.click();
  await page.getByRole("button", { name: "No, keep it", exact: true }).click();
  await expect(cancel).toBeVisible();
  const stopAnswering = await answerOnce(page, "**/api/reviews/*/cancel", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cancelled: false, snapshot: null }),
    }),
  );
  await cancel.click();
  await yesCancel.click();
  await expect(
    page.getByText("Nothing was cancelled: the review had already ended."),
  ).toBeVisible();
  await expect(page.getByText("paused limit")).toBeVisible();
  await stopAnswering();

  // Armed and left armed, the confirmation used to outlive the status it was
  // asked under: once the run below finished, one click on a still-showing
  // "Yes, cancel" would have cancelled the paid-for review (review of 5.1 to
  // 5.4). It belongs to the status it was armed for.
  await cancel.click();
  await expect(yesCancel).toBeVisible();

  // The trigger armed one call and disarmed itself, so the resume runs to the
  // end, paying only for the stages the first attempt never reached.
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("awaiting your decision")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible();
  await expect(yesCancel).toBeHidden();
  await expect(cancel).toBeVisible();

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
  // test exists to check. The event feed says when the stage is truly open,
  // in the label a person reads rather than the stage's internal id.
  await expect(page.getByText("Risk started")).toBeVisible({ timeout: 60_000 });

  // Cancelled is terminal, so one click no longer ends a review: it asks,
  // and nothing is sent until the answer (5.1).
  let cancels = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/cancel")) cancels += 1;
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yes, cancel", exact: true })).toBeVisible();
  expect(cancels).toBe(0);

  // A cancel that does not get through says so, and the review runs on;
  // the response used to be ignored, and the screen claimed nothing (5.1).
  const stopRefusing = await answerOnce(page, "**/api/reviews/*/cancel", (route) =>
    route.fulfill({ status: 500, contentType: "text/html", body: "<html>Server error</html>" }),
  );
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("The review could not be cancelled.")).toBeVisible();
  await expect(page.getByText("running", { exact: true })).toBeVisible();
  await stopRefusing();

  // A server that has gone away drops the cancel and the reading after it.
  // The reading threw past the theater, so it said nothing at all, the most
  // likely way for a local app's cancel to fail (review of 5.1 to 5.4).
  const reviewPath = `**/api${new URL(page.url()).pathname}`;
  const stopDroppingCancel = await answerOnce(page, "**/api/reviews/*/cancel", (route) =>
    route.abort(),
  );
  const stopDroppingRead = await answerOnce(page, reviewPath, (route) => route.abort());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText(/The review could not be cancelled: /)).toBeVisible();
  await stopDroppingCancel();
  await stopDroppingRead();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();

  await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });
  // The stage it was on is shown as a decision, not a red fault.
  await expect(page.getByText("Cancelled mid-stage.")).toBeVisible();
  // And it is genuinely over: nothing is left running to come back later.
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
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

  // A delete whose request never arrives says so; reading no answer used to
  // throw past the message (review of 5.1 to 5.4).
  // Its own route rather than answerOnce: the pattern also matches the reads
  // this page makes, and only the first DELETE is to be dropped.
  let dropped = false;
  const dropDelete = (route: import("@playwright/test").Route) => {
    if (dropped || route.request().method() !== "DELETE") return route.fallback();
    dropped = true;
    return route.abort();
  };
  await page.route("**/api/reviews/*", dropDelete);
  await rows.first().getByRole("button", { name: "Delete" }).click();
  await rows.first().getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText(/The review could not be deleted: /)).toBeVisible();
  await expect(rows).toHaveCount(before);
  await page.unroute("**/api/reviews/*", dropDelete);

  await rows.first().getByRole("button", { name: "Yes, delete" }).click();
  await expect(rows).toHaveCount(before - 1);
});

test("a screen whose data cannot be read says so instead of loading forever", async ({ page }) => {
  // Three detail screens used to set their state only when the fetch came
  // back ok, so a review, project or ruleset that could not be read left
  // "Loading..." on the screen permanently. A failure indistinguishable from
  // slowness is the one a person waits out rather than acts on.
  for (const [path, back] of [
    ["/reviews/NOPE123", "All reviews"],
    ["/projects/NOPE123", "All projects"],
    ["/rulesets/NOPE123", "All rulesets"],
  ] as const) {
    await page.goto(path);
    // The server's own words, and the way back: Try again for something that
    // does not exist could never work, and the review screen replaced the
    // server's words with a fixed sentence (D-138).
    await expect(page.getByRole("link", { name: back })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/not found|No \w+ with id/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.getByText("Loading...")).toBeHidden();
    // And the page keeps its shape while it fails, rather than collapsing to
    // a bare line of text with no header.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("a list whose data cannot be read says so, and reads again on Try again", async ({ page }) => {
  // The projects, reviews and rulesets lists, and the settings screen, read
  // with a bare fetch. A server error left "Loading..." for good, or an empty
  // column or section, and a failure that looks like slowness is waited out
  // (5.13, audit U9).
  // Each with what its read brings, so Try again is proved by the content it
  // reads rather than by the old message going (D-137).
  const screens: [string, string, (on: import("@playwright/test").Page) => Locator][] = [
    ["/projects", "**/api/projects", (on) => on.getByRole("link", { name: "app", exact: true })],
    ["/reviews", "**/api/reviews", (on) => on.getByRole("main").locator("ul > li").first()],
    [
      "/rulesets",
      "**/api/rulesets",
      (on) => on.getByRole("main").getByText("Example protocol").first(),
    ],
    ["/settings", "**/api/settings", (on) => on.getByLabel("Stage timeout (minutes)")],
    ["/", "**/api/scoreboard", (on) => on.getByText("Precision").first()],
  ];
  for (const [screen, api, content] of screens) {
    const refusal = `Refused for this test: ${screen}.`;
    const stopRefusing = await answerOnce(page, api, (route) =>
      route.fulfill({ status: 500, json: { error: refusal, code: "Test" } }),
    );
    await page.goto(screen);
    await expect(page.getByText(refusal)).toBeVisible({ timeout: 30_000 });
    await stopRefusing();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(content(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(refusal)).toHaveCount(0);
    await expect(page.getByText("Loading...")).toHaveCount(0);
  }
});

test("the new review screen says why a read failed, not that a repository is empty", async ({
  page,
  request,
}) => {
  // A refused branch list showed "Nothing has been pushed to it yet" beside
  // "Fetched from the remote at", both untrue then, and a ruleset read that
  // failed broke the form without a word (5.13, audit U9; D-134).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app");
  expect(app).toBeDefined();
  const stopBranches = await answerOnce(page, "**/api/projects/*/branches", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Refused for this test: the branches.", code: "CloneNotReadyError" },
    }),
  );
  const stopRulesets = await answerOnce(page, "**/api/rulesets", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Refused for this test: the rulesets.", code: "Test" },
    }),
  );
  const stopModels = await answerOnce(page, "**/api/models", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Refused for this test: the models.", code: "Test" },
    }),
  );
  await page.goto(`/reviews/new?projectId=${app!.id}`);
  await expect(page.getByText("Refused for this test: the branches.")).toBeVisible({
    timeout: 30_000,
  });
  // Each said on its own, not run together into one sentence, and an unread
  // list is not an empty one: "No rulesets imported yet" and "Import a
  // ruleset first" were untrue then (D-137).
  // Each named by its read, and keyed by it (D-138).
  await expect(page.getByText("Rulesets: Refused for this test: the rulesets.")).toBeVisible();
  await expect(page.getByText("Models: Refused for this test: the models.")).toBeVisible();
  await expect(page.getByText(/No rulesets imported yet|Import a ruleset first/)).toHaveCount(0);
  await expect(page.getByText(/Nothing has been pushed/)).toHaveCount(0);
  await expect(page.getByText(/Fetched from the remote at/)).toHaveCount(0);
  await stopBranches();
  await stopRulesets();
  await stopModels();

  // One Try again on the screen, the branch card's (D-138).
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("main").locator("label").filter({ hasText: "feature/rename-prefs" }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Refused for this test: the rulesets.")).toHaveCount(0);
});

test("a report that could not be read says so, and is read again on Try again", async ({
  page,
}) => {
  // A dropped connection or an error page that was not JSON threw past the
  // report's read, and "Building the report..." stayed for good (D-137).
  const stopFailing = await answerOnce(page, "**/api/reviews/*/report", (route) =>
    route.fulfill({ status: 500, contentType: "text/html", body: "<html>Server error</html>" }),
  );
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("link").click();
  await expect(page.getByText("The report could not be built.")).toBeVisible({ timeout: 30_000 });
  await stopFailing();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "What was examined" })).toBeVisible({
    timeout: 30_000,
  });
});

test("a page the server let go of opens a new stream rather than polling", async ({ page }) => {
  // The server lets a stream go when its page falls 256 frames behind, and
  // says so last. The page used to read any end as a dropped connection and
  // poll instead. Answered once by the route as the server answers then; not
  // `times: 1`, see answerOnce.
  let streams = 0;
  page.on("request", (request) => {
    if (/\/api\/reviews\/[^/]+\/events$/.test(new URL(request.url()).pathname)) streams += 1;
  });
  const stopAnswering = await answerOnce(page, "**/api/reviews/*/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "event: reconnect\ndata: {}\n\n",
    }),
  );
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("link").click();
  await expect.poll(() => streams, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await stopAnswering();
});

test("an emptied budget field keeps its ceiling rather than removing it", async ({ page }) => {
  // Number("") is 0, and zero removes the ceiling: clearing the field and
  // leaving it lifted the cap on every model call without a word (5.3).
  // Removing the ceiling now takes a typed 0.
  await page.goto("/settings");
  const budget = page.getByLabel("Budget per call (USD)");
  await expect(budget).toHaveValue(/^\d/, { timeout: 30_000 });
  const before = await budget.inputValue();

  // Not yet a number reads "" as well, and was told it was left empty.
  // Emptied, then typed: Control+A selects all only off macOS, and there it
  // put the caret first, so "1e" before the stored 15 made 1e15, a number
  // (macOS CI, run 39109455025).
  await budget.fill("");
  await budget.pressSequentially("1e");
  await budget.blur();
  await expect(
    page.getByText("Budget per call (USD) needs a number, so it was not changed."),
  ).toBeVisible();
  await expect(budget).toHaveValue(before);

  await budget.fill("");
  await budget.blur();
  await expect(page.getByText(/was left empty, so it was not changed/)).toBeVisible();
  await expect(page.getByText(/To remove the ceiling, enter 0/)).toBeVisible();
  // The field shows what is stored, and what is stored did not move.
  await expect(budget).toHaveValue(before);
  const stored = (await (await page.request.get("/api/settings")).json()) as {
    settings: Record<string, number>;
  };
  expect(stored.settings.stageMaxBudgetUsd).toBe(Number(before));
});

test("a failed clone can be opened, tried again and deleted; a known address is named", async ({
  page,
}) => {
  // A failed clone was a dead end: the list would not open it, nothing could
  // try it again, and adding its address again was a 500 in SQLite's words
  // (5.7, audits A2 and U6).
  await page.goto("/projects");
  const address = page.getByPlaceholder("git@github.com:you/your-app.git");

  await address.fill(`file://${APP_REPO}`);
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByText('This repository is already the project "app".')).toBeVisible();
  await expect(page.getByRole("link", { name: "Open it" })).toHaveAttribute(
    "href",
    /\/projects\/[A-Z0-9]+$/i,
  );

  await address.fill(`file://${join(E2E_ROOT, "nowhere.git")}`);
  await page.getByRole("button", { name: "Add project" }).click();
  const row = page.getByRole("main").locator("li").filter({ hasText: "nowhere" });
  await expect(row.getByText("clone failed")).toBeVisible({ timeout: 60_000 });
  await row.getByRole("link", { name: "nowhere" }).click();

  // Its page says why and offers another try, which fails the same way while
  // the address still answers nothing, and the page follows it there.
  const retry = page.getByRole("button", { name: "Retry clone" });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  // The error block itself: the header shows the address too, so a match on
  // the address alone proved nothing (review of 5.5 to 5.7).
  await expect(page.locator("pre", { hasText: "nowhere.git" })).toBeVisible();
  // Where the branches would be, the reason there are none, not a
  // "Fetching the latest refs..." that never ends.
  await expect(page.getByText("This project's clone failed, so it has no branches")).toBeVisible();

  // While the clone runs only the project is asked after: the whole page,
  // branches and all, once a second ran git fetch inside the clone still
  // being written (review of 5.5 to 5.7). A clone of nothing fails too fast
  // to watch, so each read of the project answers the next of `script`:
  // "cloning", a dropped connection, or the project gone. Then the real one.
  const projectApi = new URL(page.url()).pathname.replace(/^\/projects\//, "/api/projects/");
  const script: ("cloning" | "drop" | "gone")[] = [];
  await page.route(`**${projectApi}`, async (route) => {
    const next = route.request().method() === "GET" ? script.shift() : undefined;
    if (next === undefined) return route.fallback();
    if (next === "drop") return route.abort();
    if (next === "gone") {
      return route.fulfill({
        status: 404,
        json: { error: 'No project with id "gone".', code: "ProjectNotFoundError" },
      });
    }
    const response = await route.fetch();
    const body = (await response.json()) as { project: { cloneStatus: string } };
    body.project.cloneStatus = "cloning";
    return route.fulfill({ response, json: body });
  });
  const reads = { branches: 0, project: 0 };
  const countReads = (request: import("@playwright/test").Request) => {
    const path = new URL(request.url()).pathname;
    if (path === `${projectApi}/branches`) reads.branches += 1;
    if (path === projectApi && request.method() === "GET") reads.project += 1;
  };
  page.on("request", countReads);
  script.push("cloning", "cloning", "drop", "drop", "cloning");

  // Waited on by its answer, not by the button going: the clone itself can
  // fail again before anything is drawn.
  const retried = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/clone") && response.request().method() === "POST",
  );
  await retry.click();
  expect((await retried).status()).toBe(200);
  await expect(page.getByText("cloning", { exact: true })).toBeVisible();
  // A read that fails is said, and the page goes on following: it used to go
  // on in silence (review of the D-133 fixes).
  await expect(page.getByText(/This project could not be read/)).toBeVisible();
  await expect(retry).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/This project could not be read/)).toHaveCount(0);
  // Once when the retry was accepted and once when it settled; the polls
  // between read the project alone. Counted after more than a poll's
  // interval, or a poll that kept going would add its read too late to see.
  await page.waitForTimeout(1_500);
  expect(reads.branches).toBe(2);

  // A project deleted from another tab while its clone ran was followed for
  // as long as the page stayed open; now the page says it is gone, and stops.
  script.push("cloning", "gone");
  await retry.click();
  await expect(page.getByText('No project with id "gone".')).toBeVisible({ timeout: 30_000 });
  const readsWhenGone = reads.project;
  await page.waitForTimeout(2_500);
  expect(reads.project).toBe(readsWhenGone);
  page.off("request", countReads);
  await page.unroute(`**${projectApi}`);
  await page.reload();
  await expect(retry).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: /^Yes, delete nowhere/ }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("main").locator("li").filter({ hasText: "nowhere" })).toHaveCount(0);
});

test("a project's page draws before its branches, which wait on git fetch", async ({ page }) => {
  // The branch list runs git fetch first, which takes seconds on a large or
  // distant remote, and the page drew nothing until it came back (5.13,
  // audit U10). Held here until the page has been checked.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopHolding = await answerOnce(page, "**/api/projects/*/branches", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/projects");
  await page.getByRole("main").getByRole("link", { name: "app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "app", level: 1 })).toBeVisible();
  await expect(page.getByText("Fetching the latest refs...")).toBeVisible();
  release();
  await expect(page.getByRole("link", { name: "Review", exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await stopHolding();
});

test("a project read just as its clone finished still lists its branches", async ({ page }) => {
  // The project and its branches are read side by side, so the two can
  // straddle the clone finishing: the project ready, its branches refused as
  // not ready, and no poll left to correct the card (review of the D-133
  // fixes). The journey's project is ready; its first branch read is refused.
  const stopRefusing = await answerOnce(page, "**/api/projects/*/branches", (route) =>
    route.fulfill({
      status: 409,
      json: {
        error:
          "This project is still being cloned. Its branches can be listed once the clone is ready.",
        code: "CloneNotReadyError",
      },
    }),
  );
  await page.goto("/projects");
  await page.getByRole("main").getByRole("link", { name: "app", exact: true }).click();
  // A branch row's own link, exact: the header's "New review" matches "Review" too,
  // and is there before the branches are.
  await expect(page.getByRole("link", { name: "Review", exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/still being cloned/)).toHaveCount(0);
  await stopRefusing();
});

test("removing a link that is already gone says so and shows the links as they are", async ({
  page,
  request,
}) => {
  // Removed in another tab, or with the project it named, a link answered
  // its removal with a 404 in ids, and its row stayed until a reload (review
  // of 5.8 to 5.10, D-136).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app");
  expect(app).toBeDefined();
  const created = await request.post("/api/projects", {
    data: { gitUrl: `file://${join(E2E_ROOT, "linked-elsewhere.git")}`, name: "linked-elsewhere" },
  });
  expect(created.status()).toBe(201);
  const { project: other } = (await created.json()) as { project: { id: string } };
  const linked = await request.post(`/api/projects/${app!.id}/links`, {
    data: { dependencyProjectId: other.id, packageName: "@acme/elsewhere" },
  });
  expect(linked.status()).toBe(201);
  const { link } = (await linked.json()) as { link: { id: string } };

  await page.goto(`/projects/${app!.id}`);
  const row = page.getByRole("listitem").filter({ hasText: "@acme/elsewhere" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // Another tab removes it first.
  expect((await request.delete(`/api/projects/${app!.id}/links/${link.id}`)).status()).toBe(200);
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/no such dependency link/)).toBeVisible();
  await expect(row).toHaveCount(0);

  expect((await request.delete(`/api/projects/${other.id}`)).status()).toBe(200);
});

test("a dropped stream is said in the theater and opened again, and the feed goes on", async ({
  page,
}) => {
  // After a dropped connection the page polled for the status, but the feed
  // and the "request n of m" line are fed by the stream alone, so they
  // stopped; and the theater, where a run is watched, never said why (5.12,
  // audit U8). The first stream is dropped; the stalled stage's end can only
  // reach the feed through a stream opened again.
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 8_000 }), "utf8");
  let streams = 0;
  const countStreams = (request: import("@playwright/test").Request) => {
    if (/\/api\/reviews\/[^/]+\/events$/.test(new URL(request.url()).pathname)) streams += 1;
  };
  page.on("request", countStreams);
  const stopDropping = await answerOnce(page, "**/api/reviews/*/events", (route) => route.abort());
  await startAReview(page);

  await expect(page.getByText(/being opened again/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => streams, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await stopDropping();
  await expect(page.getByText(/being opened again/)).toHaveCount(0, { timeout: 15_000 });
  // The stalled stage ends with a note on the stream. The Activity log is
  // the feed itself, not the notes the poll reads back, so only a stream
  // opened again can put it there.
  await expect(
    page.getByRole("group", { name: "Activity log" }).getByText(/stalled call was never cancelled/),
  ).toBeVisible({ timeout: 30_000 });
  page.off("request", countStreams);
});

test("a review left as a draft can be started from its own screen", async ({ page }) => {
  // A review is created and then started, two requests. When the start
  // failed, the review was left a draft whose screen offered no way to start
  // it: its only control was Resume, which a draft is not (5.11, audit U7).
  await fillANewReview(page);
  const stopRefusing = await answerOnce(page, "**/api/reviews/*/start", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Refused for this test.", code: "Test" }),
    }),
  );
  const creation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reviews" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start review" }).click();
  const { review } = (await (await creation).json()) as { review: { id: string } };
  await expect(page.getByText("Refused for this test.")).toBeVisible();
  await stopRefusing();

  // A ruleset read that fails says so, with Try again, rather than leaving a
  // disabled picker and no word why (D-137).
  const stopRulesets = await answerOnce(page, "**/api/rulesets", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Refused for this test: the rulesets.", code: "Test" },
    }),
  );
  await page.goto(`/reviews/${review.id}`);
  await expect(page.getByText("Refused for this test: the rulesets.")).toBeVisible({
    timeout: 30_000,
  });
  await stopRulesets();
  await page.getByRole("button", { name: "Try again" }).click();
  const start = page.getByRole("button", { name: "Start review" });
  await expect(start).toBeVisible({ timeout: 30_000 });
  const chosen = await page.getByLabel("Ruleset to start with").inputValue();
  expect(chosen).not.toBe("");
  const started = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/reviews/${review.id}/start` &&
      response.request().method() === "POST",
  );
  // Watched for the whole run: the server closes the stream when a run ends,
  // and the theater read that as a drop, "being opened again", until the last
  // reading landed (D-137).
  await page.evaluate(() => {
    const seen = { notice: false };
    (window as unknown as { streamNotice: typeof seen }).streamNotice = seen;
    new MutationObserver(() => {
      if (document.body.innerText.includes("being opened again")) seen.notice = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await start.click();
  const answer = await started;
  expect(answer.status()).toBe(200);
  expect(answer.request().postDataJSON()).toEqual({ rulesetId: chosen });
  await expect(start).toHaveCount(0);
  // Let the run end, so the screenshots after this suite are of a settled app
  // rather than one mid-run (D-137).
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/reviews/${review.id}`)).json()) as {
            review: { status: string };
          }
        ).review.status,
      { timeout: 60_000 },
    )
    .not.toMatch(/^(draft|running|verifying)$/);
  expect(
    await page.evaluate(
      () => (window as unknown as { streamNotice: { notice: boolean } }).streamNotice.notice,
    ),
  ).toBe(false);
});

test("a run whose last reading fails still shows how it ended", async ({ page }) => {
  // The server closes the stream when a run ends, and the page read the
  // review once more. When that reading failed, nothing was left to correct
  // it: no notice, no stream and no poll, so the page sat on the run as
  // though it were still going (D-138). Every reading of the review is
  // dropped across the end of a run held in a stage, then let through.
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 6_000 }), "utf8");
  await startAReview(page);
  const reviewApi = `**/api${new URL(page.url()).pathname}`;
  await expect(page.getByText("Risk started")).toBeVisible({ timeout: 60_000 });
  const dropReads = (route: import("@playwright/test").Route) =>
    route.request().method() === "GET" ? route.abort() : route.fallback();
  // The stream ending is the run ending: the server closes it then. Waited
  // on, not timed, so the end is known to fall while readings are dropped,
  // or the reading after it would succeed and prove nothing (D-139).
  const runEnded = page.waitForEvent("requestfinished", {
    predicate: (request) => new URL(request.url()).pathname.endsWith("/events"),
    timeout: 60_000,
  });
  await page.route(reviewApi, dropReads);
  await runEnded;
  // Past one poll, which the dropped readings answer with nothing.
  await page.waitForTimeout(2_500);
  await page.unroute(reviewApi, dropReads);
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 15_000 });
});

test("a review that does not exist is not asked after again and again", async ({ page }) => {
  // Its stream answers 404, which the page took for a dropped connection: it
  // reopened the stream with backoff and polled every two seconds, for as
  // long as the tab stayed open (D-137).
  const asked = { streams: 0, reads: 0 };
  const count = (request: import("@playwright/test").Request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/reviews/NOPE123/events") asked.streams += 1;
    if (path === "/api/reviews/NOPE123" && request.method() === "GET") asked.reads += 1;
  };
  page.on("request", count);
  await page.goto("/reviews/NOPE123");
  await expect(page.getByRole("link", { name: "All reviews" })).toBeVisible({ timeout: 30_000 });
  // Past the first reopen (one second) and the first poll (two).
  await page.waitForTimeout(5_000);
  page.off("request", count);
  expect(asked.streams).toBe(1);
  expect(asked.reads).toBeLessThanOrEqual(2);
});

test("a review waiting its turn offers no Start of its own", async ({ page }) => {
  // A review queued behind a running one is still a draft in the database,
  // and its screen offered Start review with a ruleset it would not use;
  // starting it answered 200 and dropped the choice (D-137). One runs at a
  // time, so the second of two is queued while the first is held in a stage.
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 30_000 }), "utf8");
  await startAReview(page);
  const running = page.url();
  await expect(page.getByText("Risk started")).toBeVisible({ timeout: 60_000 });

  await startAReview(page);
  await expect(page.getByText(/Waiting for the running review to finish/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
  await expect(page.getByLabel("Ruleset to start with")).toHaveCount(0);

  // Both cancelled, the waiting one first, so neither runs on into the suites after.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto(running);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });
});

test("a file the change deleted is said to be deleted, not the checkout gone", async ({ page }) => {
  // The context route answers a file the change deleted with its hunk and no
  // lines, and the pane read that as "The checkout is no longer available
  // for this review": the checkout is there, without that file (D-139). The
  // answer is the route's own shape for a deleted file.
  const stopAnswering = await answerOnce(page, "**/api/reviews/*/context*", (route) =>
    route.fulfill({
      status: 200,
      json: { lines: [], hunk: { header: "@@ -1,2 +0,0 @@", lines: ["-gone", "-also gone"] } },
    }),
  );
  await page.goto("/reviews?status=awaiting");
  await page.getByRole("main").locator("ul > li").first().getByRole("link").click();
  await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible({ timeout: 30_000 });
  await page.locator("body").press("Enter");
  await expect(page.getByText(/the change deleted it/)).toBeVisible();
  await expect(page.getByText(/no longer available for this review/)).toHaveCount(0);
  await stopAnswering();
});

test("the top bar says how many reviews are waiting on a person", async ({ page }) => {
  // The one state that wants something from someone used to be visible only
  // by opening the reviews list and reading the chips, so a review that
  // finished while the tab sat on another screen waited silently.
  await page.goto("/projects");
  const badge = page.getByLabel(/awaiting your decision/);
  await expect(badge).toBeVisible({ timeout: 30_000 });
  // A link, not an ornament: the count is also the way to the queue. It
  // asserted a bare "/reviews" until 2026-08-18, which landed on every review
  // ever run: the list someone pressing a count of three wants least.
  await expect(badge).toHaveAttribute("href", "/reviews?status=awaiting");
  await expect(badge).toContainText(/\d+/);

  // And the filter is actually applied on arrival, rather than the parameter
  // being decoration on the href. Asserted through the toggle's own pressed
  // state rather than by counting rows: how many reviews are waiting depends
  // on what the tests before this one left behind, and the question here is
  // whether the link arrives filtered.
  await badge.click();
  await expect(page).toHaveURL(/status=awaiting/);
  await expect(page.getByRole("button", { name: /awaiting your decision/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
