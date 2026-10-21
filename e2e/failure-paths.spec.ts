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

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test, type Locator, type Route } from "@playwright/test";
import { answerOnce, routeUntilStopped } from "./answer-once";
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
  await expect(page.getByText("What this review will examine", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

async function startAReview(page: import("@playwright/test").Page): Promise<void> {
  await fillANewReview(page);
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page).toHaveURL(/\/reviews\/[A-Z0-9]+$/i, { timeout: 60_000 });
}

test("a dependency ticked with no branch keeps Start off and says why", async ({
  page,
  request,
}) => {
  // Ticked, with no branch of the same name to suggest, the dependency's
  // branch stayed at "Choose a branch", Start stayed on, and the review was
  // created without the dependency, saying nothing (5.14, audit U11).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: [
          {
            id: "LINK123",
            dependencyProjectId: "DEP123",
            dependencyName: "shared-core",
            packageName: "@acme/core",
          },
        ],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  const branch = (name: string) => ({
    name,
    commit: "a".repeat(40),
    subject: name,
    committedAt: "2026-10-01T00:00:00Z",
    ahead: 0,
    behind: 0,
  });
  const stopBranches = await answerOnce(page, "**/api/projects/DEP123/branches", (route) =>
    route.fulfill({
      status: 200,
      json: { branches: [branch("main"), branch("release")], defaultBranch: "main" },
    }),
  );

  await fillANewReview(page);
  const start = page.getByRole("button", { name: "Start review" });
  await expect(start).toBeEnabled();
  await page.getByLabel(/Include shared-core/).check();
  await expect(page.getByLabel("Its branch")).toHaveValue("");
  await expect(start).toBeDisabled();
  await expect(page.getByText("Choose the dependency's branch, or untick it.")).toBeVisible();

  // Its branch set to the one it would be compared against, it was a
  // dependency compared with itself, an empty half that reads as clean;
  // compare-against moves off it, as the primary's does (D-144).
  await page.getByLabel("Its branch").selectOption("main");
  const itsInto = page.getByLabel("Compare against").nth(1);
  await expect(itsInto).toHaveValue("release");
  await expect(itsInto.locator("option", { hasText: /^main$/ })).toHaveCount(0);

  // Then the line goes, and the review asked about has the dependency in
  // it: the gate alone proved neither (D-144).
  const line = page.getByText("Choose the dependency's branch, or untick it.");
  const asked = page.waitForRequest(
    (sent) =>
      sent.url().endsWith("/api/reviews/preflight") &&
      (sent.postDataJSON() as { linked?: { fromBranch: string } }).linked?.fromBranch === "release",
  );
  await page.getByLabel("Its branch").selectOption("release");
  await expect(start).toBeEnabled();
  await expect(line).toHaveCount(0);
  expect((await asked).postDataJSON()).toMatchObject({
    linked: { projectId: "DEP123", fromBranch: "release", intoBranch: "main" },
  });
  await page.getByLabel(/Include shared-core/).uncheck();
  await expect(start).toBeEnabled();
  await expect(line).toHaveCount(0);
  await stopBranches();
  await stopWithLink();
});

test("a dependency's suggested branch follows the branch under review until chosen", async ({
  page,
  request,
}) => {
  // Suggested once and kept, it stayed on the first branch's name after the
  // branch under review moved, with "Suggested: it has a branch of the same
  // name" still beside it, and the review paired the new branch with the old
  // one's half (D-145).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const names = (
    (await (await request.get(`/api/projects/${app.id}/branches`)).json()) as {
      branches: { name: string }[];
    }
  ).branches.map((branch) => branch.name);
  const third = names.find((name) => name !== "main" && name !== "feature/rename-prefs");
  expect(third, "a third branch to move to").toBeDefined();
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: [
          {
            id: "LINK123",
            dependencyProjectId: "DEP123",
            dependencyName: "shared-core",
            packageName: "@acme/core",
          },
        ],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  const dependencyBranches = (route: Route) =>
    route.fulfill({
      status: 200,
      json: {
        branches: names.map((name) => ({
          name,
          commit: "a".repeat(40),
          subject: name,
          committedAt: "2026-10-01T00:00:00Z",
          ahead: 0,
          behind: 0,
        })),
        defaultBranch: "main",
      },
    });
  const stopDependencyBranches = await routeUntilStopped(
    page,
    "**/api/projects/DEP123/branches",
    dependencyBranches,
  );

  await fillANewReview(page);
  await page.getByLabel(/Include shared-core/).check();
  const its = page.getByLabel("Its branch");
  const hint = page.getByText("Suggested: it has a branch of the same name.");
  await expect(its).toHaveValue("feature/rename-prefs");
  await expect(hint).toBeVisible();

  await page.getByRole("main").locator("label").filter({ hasText: third! }).first().click();
  await expect(its).toHaveValue(third!);
  await expect(hint).toBeVisible();

  // Chosen by hand, it stays, and nothing calls it suggested.
  await its.selectOption("feature/rename-prefs");
  await page.getByRole("main").locator("label").filter({ hasText: "main" }).first().click();
  await expect(its).toHaveValue("feature/rename-prefs");
  await expect(hint).toHaveCount(0);

  await stopDependencyBranches();
  await stopWithLink();
});

test("a half of the review with no change is said, and Start stays off", async ({
  page,
  request,
}) => {
  // The pre-flight showed both halves' files summed and no word of either
  // half alone, so a half with no change, a branch never committed to or one
  // already merged, ran and read as clean (D-145). The answers are the
  // route's own, with one half's files set to none.
  const start = page.getByRole("button", { name: "Start review" });
  const primaryEmpty = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { pins: { primary: object } };
    await route.fulfill({
      response,
      json: { ...body, pins: { ...body.pins, primary: { ...body.pins.primary, files: 0 } } },
    });
  };
  const stopPrimaryEmpty = await routeUntilStopped(page, "**/api/reviews/preflight", primaryEmpty);
  await fillANewReview(page);
  await expect(page.getByText(/feature\/rename-prefs changes nothing against main/)).toBeVisible();
  await expect(start).toBeDisabled();
  await stopPrimaryEmpty();

  // The dependency's half, asked about as the route would answer it.
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: [
          {
            id: "LINK123",
            dependencyProjectId: "DEP123",
            dependencyName: "shared-core",
            packageName: "@acme/core",
          },
        ],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  const branch = (name: string) => ({
    name,
    commit: "a".repeat(40),
    subject: name,
    committedAt: "2026-10-01T00:00:00Z",
    ahead: 0,
    behind: 0,
  });
  const stopBranches = await answerOnce(page, "**/api/projects/DEP123/branches", (route) =>
    route.fulfill({
      status: 200,
      json: { branches: [branch("main"), branch("release")], defaultBranch: "main" },
    }),
  );
  const dependencyEmpty = async (route: Route) => {
    const sent = route.request().postDataJSON() as { linked?: object };
    const response = await route.fetch({
      postData: JSON.stringify({ ...sent, linked: undefined }),
    });
    const body = (await response.json()) as { pins: object };
    await route.fulfill({
      response,
      json: {
        ...body,
        pins: sent.linked
          ? { ...body.pins, linked: { fromCommit: "b".repeat(40), subject: "release", files: 0 } }
          : body.pins,
      },
    });
  };
  const stopDependencyEmpty = await routeUntilStopped(
    page,
    "**/api/reviews/preflight",
    dependencyEmpty,
  );
  await fillANewReview(page);
  await expect(start).toBeEnabled();
  await page.getByLabel(/Include shared-core/).check();
  await page.getByLabel("Its branch").selectOption("release");
  await expect(page.getByText(/The dependency's release changes nothing against main/)).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(start).toBeDisabled();
  await stopBranches();
  await stopDependencyEmpty();
  await stopWithLink();
});

test("a Refresh reads a ticked dependency's branches again", async ({ page, request }) => {
  // Read once when ticked, they were never read again: a branch pushed to
  // the dependency since, named like the one under review, was not offered
  // or suggested until the box was unticked and ticked again (D-146).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: [
          {
            id: "LINK123",
            dependencyProjectId: "DEP123",
            dependencyName: "shared-core",
            packageName: "@acme/core",
          },
        ],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  const branch = (name: string) => ({
    name,
    commit: "a".repeat(40),
    subject: name,
    committedAt: "2026-10-01T00:00:00Z",
    ahead: 0,
    behind: 0,
  });
  let names = ["main", "release"];
  const dependencyBranches = (route: Route) =>
    route.fulfill({
      status: 200,
      json: { branches: names.map(branch), defaultBranch: "main" },
    });
  const stopDependencyBranches = await routeUntilStopped(
    page,
    "**/api/projects/DEP123/branches",
    dependencyBranches,
  );

  await fillANewReview(page);
  await page.getByLabel(/Include shared-core/).check();
  const its = page.getByLabel("Its branch");
  await expect(its).toHaveValue("");
  names = ["main", "release", "feature/rename-prefs"];
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(its).toHaveValue("feature/rename-prefs", { timeout: 60_000 });
  await stopDependencyBranches();
  await stopWithLink();
});

test("every reason Start is off is said beside it", async ({ page, request }) => {
  // An empty half and a dependency with no branch chosen, and the line
  // beside Start named the empty half alone (D-146). The pre-flight is the
  // route's own with the primary half emptied.
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: [
          {
            id: "LINK123",
            dependencyProjectId: "DEP123",
            dependencyName: "shared-core",
            packageName: "@acme/core",
          },
        ],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  const branch = (name: string) => ({
    name,
    commit: "a".repeat(40),
    subject: name,
    committedAt: "2026-10-01T00:00:00Z",
    ahead: 0,
    behind: 0,
  });
  const stopBranches = await answerOnce(page, "**/api/projects/DEP123/branches", (route) =>
    route.fulfill({
      status: 200,
      json: { branches: [branch("main"), branch("release")], defaultBranch: "main" },
    }),
  );
  const primaryEmpty = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { pins: { primary: object } };
    await route.fulfill({
      response,
      json: { ...body, pins: { ...body.pins, primary: { ...body.pins.primary, files: 0 } } },
    });
  };
  const stopPrimaryEmpty = await routeUntilStopped(page, "**/api/reviews/preflight", primaryEmpty);
  await fillANewReview(page);
  await page.getByLabel(/Include shared-core/).check();
  await expect(
    page.getByText(
      "The pre-flight found a half of this review with no change: see above. Choose the dependency's branch, or untick it.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30_000 });
  await stopBranches();
  await stopPrimaryEmpty();
  await stopWithLink();
});

test("a ticked dependency says what its branches are doing, and lets go with its link", async ({
  page,
  request,
}) => {
  // Its branch read in flight, refused, or answered with no branches, the
  // screen said only "Choose the dependency's branch" over no picker; and a
  // link removed in another tab, seen at a Refresh, left it ticked out of
  // sight with Start off for good (D-144).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  let linked = true;
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: linked
          ? [
              {
                id: "LINK123",
                dependencyProjectId: "DEP123",
                dependencyName: "shared-core",
                packageName: "@acme/core",
              },
            ]
          : [],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const dependencyBranches = async (route: Route) => {
    reads += 1;
    if (reads === 1) {
      await held;
      await route.fulfill({
        status: 500,
        json: { error: "Refused for this test: the dependency's branches.", code: "Test" },
      });
    } else {
      await route.fulfill({ status: 200, json: { branches: [], defaultBranch: "main" } });
    }
  };
  const stopDependencyBranches = await routeUntilStopped(
    page,
    "**/api/projects/DEP123/branches",
    dependencyBranches,
  );

  await fillANewReview(page);
  const start = page.getByRole("button", { name: "Start review" });
  const beside = (text: string) => page.getByText(text, { exact: true });
  await page.getByLabel(/Include shared-core/).check();
  await expect(page.getByText("Reading shared-core's branches...")).toBeVisible();
  await expect(beside("Reading the dependency's branches...")).toBeVisible();
  await expect(start).toBeDisabled();

  release();
  await expect(page.getByText("Refused for this test: the dependency's branches.")).toBeVisible();
  await expect(
    beside("The dependency's branches could not be read: try again above, or untick it."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByText("shared-core has no branches to review, so it cannot be included: untick it."),
  ).toBeVisible();
  await expect(beside("The dependency has nothing to compare: untick it.")).toBeVisible();
  await expect(start).toBeDisabled();

  linked = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel(/Include shared-core/)).toHaveCount(0);
  await expect(start).toBeEnabled({ timeout: 60_000 });
  // Restored, it comes back unticked: it came back ticked, its old branches
  // shown as read while they were read again (D-145, D-146).
  linked = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel(/Include shared-core/)).not.toBeChecked({ timeout: 60_000 });
  await expect(page.getByText(/has no branches to review/)).toHaveCount(0);
  await stopDependencyBranches();
  await stopWithLink();
});

test("Enter on the Advanced fold or a link in the new review form does what it says", async ({
  page,
}) => {
  // The form's guard against Enter starting a paid review took every Enter
  // but a button's and a text area's, so Enter on the Advanced fold did not
  // open it, and Enter on a link went nowhere (D-144).
  await fillANewReview(page);
  const engine = page.getByLabel("Engine");
  await expect(engine).toBeHidden();
  await page.getByText("Advanced", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(engine).toBeVisible();

  await page.getByRole("link", { name: "See which rules apply" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/rulesets\/[A-Z0-9]+$/i, { timeout: 30_000 });
});

test("a pre-flight for choices since changed is not left on screen", async ({ page }) => {
  // The card kept the last answer while the next was read, so the counts on
  // screen were for a branch no longer chosen, beside a Start that would
  // review the new one (5.14, audit U11).
  await fillANewReview(page);
  const card = page.getByText("What this review will examine", { exact: true });
  await expect(card).toBeVisible();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopHolding = await answerOnce(page, "**/api/reviews/preflight", async (route) => {
    await held;
    await route.continue();
  });
  const into = page.getByLabel("Compare against");
  const choices = await into.locator("option").allTextContents();
  const other = choices.find((name) => name !== "main" && name !== "feature/rename-prefs");
  expect(other, "a third branch to compare against").toBeDefined();
  await into.selectOption(other!);
  await expect(page.getByText("Working out what this review will examine...")).toBeVisible();
  await expect(card).toBeHidden();
  release();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await stopHolding();
});

test("a Refresh asks the pre-flight again, so an empty half pushed to since is not still blocked", async ({
  page,
}) => {
  // A branch just pushed with nothing on it was said to change nothing, with
  // Start off; pushed to and refreshed, its name unchanged, the pre-flight
  // was not asked again, and Start stayed off on an answer no longer true
  // (D-146). The first answer is the route's own with the primary half
  // emptied; the one after a Refresh is the route's own.
  const emptied = await answerOnce(page, "**/api/reviews/preflight", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { pins: { primary: object } };
    await route.fulfill({
      response,
      json: { ...body, pins: { ...body.pins, primary: { ...body.pins.primary, files: 0 } } },
    });
  });
  await fillANewReview(page);
  const start = page.getByRole("button", { name: "Start review" });
  await expect(page.getByText(/feature\/rename-prefs changes nothing against main/)).toBeVisible();
  await expect(start).toBeDisabled();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/changes nothing against/)).toHaveCount(0, { timeout: 60_000 });
  await expect(start).toBeEnabled();
  await emptied();
});

test("ticking a dependency with no branch chosen asks the pre-flight nothing new", async ({
  page,
  request,
}) => {
  // The request does not change until the dependency has both branches, but
  // the tick sent it again, and the dependency's branches arriving sent it a
  // third time: each a fetch and a diff on the server, overlapping (D-147).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: [
          {
            id: "LINK123",
            dependencyProjectId: "DEP123",
            dependencyName: "shared-core",
            packageName: "@acme/core",
          },
        ],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  const branch = (name: string) => ({
    name,
    commit: "a".repeat(40),
    subject: name,
    committedAt: "2026-10-01T00:00:00Z",
    ahead: 0,
    behind: 0,
  });
  const stopBranches = await answerOnce(page, "**/api/projects/DEP123/branches", (route) =>
    route.fulfill({
      status: 200,
      json: { branches: [branch("main"), branch("release")], defaultBranch: "main" },
    }),
  );
  await fillANewReview(page);
  let asked = 0;
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname === "/api/reviews/preflight") asked += 1;
  });
  await page.getByLabel(/Include shared-core/).check();
  await expect(page.getByLabel("Its branch")).toHaveValue("");
  await expect(page.getByLabel("Compare against").nth(1)).toHaveValue("main");
  // Long enough for a request the tick or the branches' arrival would send.
  await page.waitForTimeout(1_500);
  expect(asked).toBe(0);
  await stopBranches();
  await stopWithLink();
});

test("the profile picker names the model's profile while a pre-flight is pending", async ({
  page,
}) => {
  // Read from the pre-flight, it went whenever an answer was pending, and
  // the downgrade list widened to profiles the server refuses (D-147).
  await fillANewReview(page);
  await page.getByText("Advanced", { exact: true }).click();
  const own = page.getByTestId("profile-override").locator("option").first();
  await expect(own).toHaveText(/The model's own \([a-z-]+\)/);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopHolding = await answerOnce(page, "**/api/reviews/preflight", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByTestId("profile-override").selectOption("decomposed");
  await expect(page.getByText("Working out what this review will examine...")).toBeVisible();
  await expect(own).toHaveText(/The model's own \([a-z-]+\)/);
  // Answered before the route goes: removed first, it let the held request
  // through under the answer still being made.
  const answered = page.waitForResponse((response) =>
    response.url().endsWith("/api/reviews/preflight"),
  );
  release();
  await answered;
  await stopHolding();
});

test("a review the pre-flight says would refuse cannot be started", async ({ page }) => {
  // The pre-flight said a sweep pattern could not run, so the run would stop
  // at its sweep, and Start stayed on beside it (5.14, audit U11). The answer
  // is the route's own, with one sweep problem added.
  const refusing = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: { ...body, sweepProblems: ["(unclosed: the pattern is not valid"] },
    });
  };
  const stopRefusing = await routeUntilStopped(page, "**/api/reviews/preflight", refusing);
  await fillANewReview(page);
  await expect(page.getByText(/would refuse to start: \(unclosed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start review" })).toBeDisabled();
  await expect(
    page.getByText("The pre-flight says this review would refuse to start: see above."),
  ).toBeVisible();
  await stopRefusing();
});

test("a pre-flight that says it would refuse leaves the other reasons beside Start", async ({
  page,
  request,
}) => {
  // Its line stood alone beside a dependency with no branch chosen, the
  // class of D-146's one reason of two (review of the D-147 fixes).
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const withLink = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        links: [
          {
            id: "LINK123",
            dependencyProjectId: "DEP123",
            dependencyName: "shared-core",
            packageName: "@acme/core",
          },
        ],
      },
    });
  };
  const stopWithLink = await routeUntilStopped(page, `**/api/projects/${app.id}`, withLink);
  const branch = (name: string) => ({
    name,
    commit: "a".repeat(40),
    subject: name,
    committedAt: "2026-10-01T00:00:00Z",
    ahead: 0,
    behind: 0,
  });
  const stopBranches = await answerOnce(page, "**/api/projects/DEP123/branches", (route) =>
    route.fulfill({
      status: 200,
      json: { branches: [branch("main"), branch("release")], defaultBranch: "main" },
    }),
  );
  const refusing = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: { ...body, sweepProblems: ["(unclosed: the pattern is not valid"] },
    });
  };
  const stopRefusing = await routeUntilStopped(page, "**/api/reviews/preflight", refusing);
  await fillANewReview(page);
  await page.getByLabel(/Include shared-core/).check();
  await expect(
    page.getByText(
      "The pre-flight says this review would refuse to start: see above. Choose the dependency's branch, or untick it.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30_000 });
  await stopBranches();
  await stopRefusing();
  await stopWithLink();
});

test("Start waits for the pre-flight of the choices on screen", async ({ page }) => {
  // On beside "Working out what this review will examine...", Start offered
  // a review whose pre-flight had not said what it would examine, nor
  // whether it would refuse (D-147).
  await fillANewReview(page);
  const start = page.getByRole("button", { name: "Start review" });
  await expect(start).toBeEnabled();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopHolding = await answerOnce(page, "**/api/reviews/preflight", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Working out what this review will examine...")).toBeVisible({
    timeout: 60_000,
  });
  await expect(start).toBeDisabled();
  await expect(
    page.getByText("The pre-flight is still working out what this review will examine.", {
      exact: true,
    }),
  ).toBeVisible();
  const answered = page.waitForResponse((response) =>
    response.url().endsWith("/api/reviews/preflight"),
  );
  release();
  await answered;
  await stopHolding();
  await expect(start).toBeEnabled({ timeout: 30_000 });
});

test("a branch reached by the keyboard shows that it has the focus", async ({ page }) => {
  // The radios are hidden from sight and the label stands for them, so the
  // focus ring drawn on the radio was clipped away with it: Tab moved into
  // the list and nothing on screen said where (5.14, audit U12).
  await fillANewReview(page);
  await page.getByPlaceholder("Filter branches").focus();
  // Past the Refresh link, into the list.
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Tab");
    const onRadio = await page.evaluate(
      () => (document.activeElement as HTMLInputElement | null)?.type === "radio",
    );
    if (onRadio) break;
  }
  const focused = await page.evaluate(() => {
    const active = document.activeElement as HTMLInputElement | null;
    const label = active?.closest("label");
    // The ring's outer edge, against the scrolling list that clips it: drawn
    // outside the label, the list cut it down to two lines, which the
    // computed style alone still called solid (review of the D-147 fixes).
    const style = label ? getComputedStyle(label) : null;
    const reach = style ? parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth) : 0;
    const box = label?.getBoundingClientRect();
    const list = label?.closest("ul")?.getBoundingClientRect();
    return {
      type: active?.type,
      outline: style ? style.outlineStyle : "no label",
      inside:
        box !== undefined &&
        list !== undefined &&
        box.left - reach >= list.left &&
        box.right + reach <= list.right &&
        box.top - reach >= list.top &&
        box.bottom + reach <= list.bottom,
      // And beyond the label's border: the focused row is the chosen one,
      // whose border is the ring's colour, and a ring drawn over it only
      // thickened it by a pixel (review of the D-148 fixes).
      clearsBorder: style !== null && parseFloat(style.outlineOffset) >= 0,
      // The room made for the ring is not taken from the rows: padded alone,
      // the list set them 4px in from the model list's, at the card's edge
      // (review of the D-149 fixes).
      rowsAlignedWithModels:
        box !== undefined &&
        Math.abs(
          box.left -
            (document.querySelector('[data-testid="model-picker"] label')?.getBoundingClientRect()
              .left ?? NaN),
        ) < 0.5,
    };
  });
  expect(focused.type).toBe("radio");
  expect(focused.outline).toBe("solid");
  expect(focused.inside).toBe(true);
  expect(focused.clearsBorder).toBe(true);
  expect(focused.rowsAlignedWithModels).toBe(true);
});

test("a branch reached by the keyboard below the list's fold is scrolled into view", async ({
  page,
  request,
}) => {
  // The radio is positioned outside the label, so focusing it did not scroll
  // the list: arrow keys chose branches out of sight, ring and all (review
  // of the D-149 fixes). The route's own branches, with twenty more after.
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const stopMore = await routeUntilStopped(
    page,
    `**/api/projects/${app.id}/branches`,
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { branches: object[] };
      const more = Array.from({ length: 20 }, (_, index) => ({
        name: `zz/extra-${String(index + 1).padStart(2, "0")}`,
        commit: "a".repeat(40),
        subject: "extra",
        committedAt: "2026-10-01T00:00:00Z",
        ahead: 1,
        behind: 0,
      }));
      await route.fulfill({ response, json: { ...body, branches: [...body.branches, ...more] } });
    },
  );
  await fillANewReview(page);
  await page.getByPlaceholder("Filter branches").focus();
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Tab");
    const onRadio = await page.evaluate(
      () => (document.activeElement as HTMLInputElement | null)?.type === "radio",
    );
    if (onRadio) break;
  }
  for (let step = 0; step < 12; step += 1) await page.keyboard.press("ArrowDown");
  const seen = await page.evaluate(() => {
    const label = document.activeElement?.closest("label");
    const box = label?.getBoundingClientRect();
    const list = label?.closest("ul")?.getBoundingClientRect();
    return {
      name: label?.textContent ?? "",
      inView:
        box !== undefined && list !== undefined && box.top >= list.top && box.bottom <= list.bottom,
    };
  });
  expect(seen.name).toContain("zz/extra-");
  expect(seen.inView).toBe(true);
  await stopMore();
});

test("the scan theater is a dialog the keyboard stays in", async ({ page }) => {
  // It covered the whole page, top bar too, but was a plain div: focus
  // stayed wherever it had been, Tab walked out into the page beneath, and
  // a screen reader read what was hidden (5.14, audit U12).
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 30_000 }), "utf8");
  await startAReview(page);
  const theater = page.getByRole("dialog", {
    name: "Watching the review of feature/rename-prefs into main",
  });
  await expect(theater).toBeVisible({ timeout: 60_000 });
  await expect(theater.getByRole("button", { name: "Hide" })).toBeFocused();
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press("Tab");
    const outside = await page.evaluate(() => {
      const active = document.activeElement;
      return active !== null && active !== document.body && active.closest("dialog") === null;
    });
    expect(outside, `Tab ${step + 1} left the theater`).toBe(false);
  }
  await page.keyboard.press("Escape");
  await expect(theater).toHaveCount(0);
  // Hidden, it left the focus on the page, and Tab began again from the top
  // (review of the D-147 fixes). Scan view brings the theater back.
  await expect(page.getByRole("button", { name: "Scan view" })).toBeFocused();

  // Cancelled, so it does not run on into the suites after.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });
  // And the stall goes with it: left armed, the usage-limit test after this
  // stalled in its first stage and never reached its limit.
  rmSync(STALL_TRIGGER, { force: true });
});

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

test("refs from last time go while the branches are read again", async ({ page, request }) => {
  // Try again and Refresh cleared the branches but left "these are the refs
  // from last time" and "Cached refs" up, with no refs under them, for as
  // long as git fetch ran (D-139). Cached refs and a refused ruleset read
  // put both lines and the head's Try again on screen; each read again is
  // held while the screen is checked.
  const listed = (await (await request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app");
  expect(app).toBeDefined();
  const cachedBranches = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({ response, json: { ...body, stale: "Stale for this test." } });
  };
  const holdBranches = async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = await answerOnce(page, "**/api/projects/*/branches", async (route) => {
      await held;
      await cachedBranches(route);
    });
    return { release, stop };
  };

  const stopCached = await answerOnce(page, "**/api/projects/*/branches", cachedBranches);
  const stopRulesets = await answerOnce(page, "**/api/rulesets", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Refused for this test: the rulesets.", code: "Test" },
    }),
  );
  await page.goto(`/reviews/new?projectId=${app!.id}`);
  const lastTime = page.getByText(/these are the refs from last time/);
  const cachedLine = page.getByText("Cached refs, shown because the remote could not be reached.");
  const fetching = page.getByText("Fetching the latest branches...");
  await expect(lastTime).toBeVisible({ timeout: 30_000 });
  await expect(cachedLine).toBeVisible();
  await stopCached();
  await stopRulesets();

  const retried = await holdBranches();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(fetching).toBeVisible();
  await expect(lastTime).toHaveCount(0);
  await expect(cachedLine).toHaveCount(0);
  retried.release();
  await expect(cachedLine).toBeVisible({ timeout: 30_000 });
  await retried.stop();

  const refreshed = await holdBranches();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(fetching).toBeVisible();
  await expect(lastTime).toHaveCount(0);
  await expect(cachedLine).toHaveCount(0);
  refreshed.release();
  await expect(cachedLine).toBeVisible({ timeout: 30_000 });
  await refreshed.stop();
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

test("a new review of a project that does not exist offers the way back", async ({ page }) => {
  // From a stale bookmark, or a project deleted in another tab: the screen
  // said why with a Try again that could never succeed (D-139).
  await page.goto("/reviews/new?projectId=NOPE123");
  await expect(page.getByRole("link", { name: "All projects" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
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
  // The read again is held, so the screen is seen to say it is reading
  // rather than keep the old message (D-138, D-139).
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopHolding = await answerOnce(page, "**/api/rulesets", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Reading the rulesets...")).toBeVisible();
  release();
  const start = page.getByRole("button", { name: "Start review" });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await stopHolding();
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

  // And the API refuses what the screen no longer offers: a ruleset sent to a
  // review waiting in line was answered 200 and dropped (D-138), and then,
  // in the built app, 500 (D-139).
  const queuedId = new URL(page.url()).pathname.split("/").pop();
  const listed = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string }[];
  };
  const startWithRuleset = () =>
    page.request.post(`/api/reviews/${queuedId}/start`, {
      data: { rulesetId: listed.rulesets[0]!.id },
    });
  const alreadyStarted = await startWithRuleset();
  expect(alreadyStarted.status()).toBe(409);
  expect(((await alreadyStarted.json()) as { code: string }).code).toBe(
    "ReviewAlreadyStartedError",
  );

  // Both cancelled, the waiting one first, so neither runs on into the suites after.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 30_000 });
  // The manager's other refusal, from the same route: a cancelled review
  // cannot be started.
  const notStartable = await startWithRuleset();
  expect(notStartable.status()).toBe(409);
  expect(((await notStartable.json()) as { code: string }).code).toBe("ReviewNotStartableError");
  await page.goto(running);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });
});

test("every route answers an id that names nothing with a 404 naming it", async ({ page }) => {
  // Asked of the built app, where the job manager is the instrumentation
  // bundle's copy of the server modules. Two answered 500: the rules route,
  // which never looked the review up, and a cancel, whose lookup was the
  // manager's (D-139). Each route is sent what passes its validation, so the
  // lookup is what answers: {} was refused first by five of them, which
  // proved nothing about the id (D-140). The answer must name the thing
  // the asked id was for: any not-found code passed, and a guard before the
  // lookup answering a generic one would have passed too (D-141).
  const projects = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const rulesets = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string }[];
  };
  const parents: Record<string, string> = {
    projects: projects.projects.find((project) => project.name === "app")!.id,
    rulesets: rulesets.rulesets[0]!.id,
  };
  // The class whose 404 each segment's id must get.
  const notFound: Record<string, string> = {
    findings: "FindingNotFoundError",
    models: "ModelNotFoundError",
    projects: "ProjectNotFoundError",
    links: "LinkNotFoundError",
    reviews: "ReviewNotFoundError",
    rulesets: "RulesetNotFoundError",
    rules: "RuleNotFoundError",
  };

  const asked: Record<string, { data?: object; query?: string }> = {
    "POST findings/[id]/confirm": { data: {} },
    "POST findings/[id]/dismiss": { data: { reason: "Asked by the sweep." } },
    "POST models/[id]/probe": { data: {} },
    "GET projects/[id]": {},
    "DELETE projects/[id]": {},
    "GET projects/[id]/branches": {},
    "POST projects/[id]/clone": { data: {} },
    "POST projects/[id]/fetch": { data: {} },
    "GET projects/[id]/links": {},
    // A dependency that exists, so only the path's id can be the one not
    // found; the path's own id would be refused as a self-link unlooked.
    "POST projects/[id]/links": {
      data: { dependencyProjectId: parents.projects, packageName: "swept" },
    },
    "DELETE projects/[id]/links/[linkId]": {},
    "DELETE projects/[id]/reviews": {},
    "GET reviews/[id]": {},
    "DELETE reviews/[id]": {},
    "POST reviews/[id]/cancel": { data: {} },
    "POST reviews/[id]/complete": { data: {} },
    "GET reviews/[id]/context": { query: "?path=app/README.md&line=1" },
    "GET reviews/[id]/events": {},
    "POST reviews/[id]/export": { data: {} },
    "GET reviews/[id]/report": {},
    "GET reviews/[id]/rules": {},
    "POST reviews/[id]/start": { data: {} },
    "GET rulesets/[id]": {},
    "GET rulesets/[id]/export": {},
    "POST rulesets/[id]/duplicate": { data: { tier: "global", name: "Swept" } },
    "PATCH rulesets/[id]/rules/[code]": { data: { enabled: true } },
  };

  // Read from the routes on disk, so a new one with no entry above fails
  // here rather than going unasked.
  const apiRoot = join(process.cwd(), "src", "app", "api");
  const walked: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        const route = relative(apiRoot, dir).split("\\").join("/");
        if (!route.includes("[")) continue;
        const methods = [
          ...readFileSync(full, "utf8").matchAll(
            /export (?:async function|const|function) (GET|POST|PUT|PATCH|DELETE)\b/g,
          ),
        ].map((match) => match[1]!);
        expect(methods, `${route} exports no method the sweep can see`).not.toHaveLength(0);
        walked.push(...methods.map((method) => `${method} ${route}`));
      }
    }
  };
  walk(apiRoot);
  expect(walked.sort()).toEqual(Object.keys(asked).sort());

  const ask = async (key: string, url: string, code: string) => {
    const { data, query } = asked[key]!;
    const answer = await page.request.fetch(url + (query ?? ""), {
      method: key.split(" ")[0]!,
      ...(data === undefined ? {} : { data }),
    });
    const body = await answer.text();
    expect.soft(answer.status(), `${key} at ${url}: ${body}`).toBe(404);
    expect.soft(body, `${key} at ${url}`).toContain(`"code":"${code}"`);
  };
  for (const key of Object.keys(asked)) {
    const route = key.split(" ")[1]!;
    const segments = route.split("/");
    const ids = route.match(/\[[^\]]+\]/g)!;
    await ask(key, `/api/${route.replace(/\[[^\]]+\]/g, "NOPE123")}`, notFound[segments[0]!]!);
    // An inner id is asked under a parent that exists too, or only the
    // parent's lookup would ever answer.
    if (ids.length > 1) {
      const inner = segments[segments.indexOf(ids[1]!) - 1]!;
      await ask(
        key,
        `/api/${route.replace(ids[0]!, parents[segments[0]!]!).replace(ids[1]!, "NOPE123")}`,
        notFound[inner]!,
      );
    }
  }
});

test("a file the change deleted is said to be deleted, not the checkout gone", async ({ page }) => {
  // The context route answers a file the change deleted with no lines, and
  // the pane read that as "The checkout is no longer available for this
  // review": the checkout is there, without that file (D-139). With no hunk,
  // a deleted binary say, it pointed at a change above that was not there
  // (D-141). Each answer is the route's own shape for a deleted file.
  const answers = [
    {
      hunk: { header: "@@ -1,2 +0,0 @@", lines: ["-gone", "-also gone"] },
      said: "the change deleted it, and the change above is all there is of it.",
    },
    { hunk: null, said: "This file is not in the review's checkout: the change deleted it." },
  ];
  for (const { hunk, said } of answers) {
    const stopAnswering = await answerOnce(page, "**/api/reviews/*/context*", (route) =>
      route.fulfill({ status: 200, json: { lines: [], hunk, deleted: true } }),
    );
    await page.goto("/reviews?status=awaiting");
    await page.getByRole("main").locator("ul > li").first().getByRole("link").click();
    await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible({ timeout: 30_000 });
    await page.locator("body").press("Enter");
    const file = page.getByRole("group", { name: "The file around this finding" });
    await expect(file).toHaveText(new RegExp(`${said.replace(/[.]/g, "\\.")}$`));
    await expect(page.getByText(/no longer available for this review/)).toHaveCount(0);
    await stopAnswering();
  }
});

test("a link the change made out of the checkout shows its hunk, not where it leads", async ({
  page,
}) => {
  // Answered 404, not found, the link's hunk went with it, though the hunk is
  // what says where it points (D-143). The answer is the route's own shape.
  const stopAnswering = await answerOnce(page, "**/api/reviews/*/context*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        lines: [],
        hunk: { header: "@@ -0,0 +1 @@", lines: ["+/somewhere/outside/secret.txt"] },
        outside: true,
      },
    }),
  );
  await page.goto("/reviews?status=awaiting");
  await page.getByRole("main").locator("ul > li").first().getByRole("link").click();
  await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible({ timeout: 30_000 });
  await page.locator("body").press("Enter");
  await expect(page.getByRole("group", { name: "The file around this finding" })).toHaveText(
    /a link that leads out of the review's checkout/,
  );
  await expect(page.getByText("+/somewhere/outside/secret.txt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await stopAnswering();
});

test("a link the change made to nothing is said as that, with no Try again", async ({ page }) => {
  // Its target not on this machine, it was a read error with a Try again
  // that could never work (D-144). The answer is the route's own shape.
  const stopAnswering = await answerOnce(page, "**/api/reviews/*/context*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        lines: [],
        hunk: { header: "@@ -0,0 +1 @@", lines: ["+../nowhere"] },
        brokenLink: true,
      },
    }),
  );
  await page.goto("/reviews?status=awaiting");
  await page.getByRole("main").locator("ul > li").first().getByRole("link").click();
  await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible({ timeout: 30_000 });
  await page.locator("body").press("Enter");
  await expect(page.getByRole("group", { name: "The file around this finding" })).toHaveText(
    /a link to something that is not there/,
  );
  await expect(page.getByText("+../nowhere")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await stopAnswering();
});

test("a file the checkout could not give up is said as that, not as deleted", async ({ page }) => {
  // Every failed read with a hunk was answered as a deletion, so a modified
  // file the checkout held but could not give up, busy on Windows say, was
  // said to be deleted (D-140). The answer is the route's own shape for it.
  const stopAnswering = await answerOnce(page, "**/api/reviews/*/context*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        lines: [],
        hunk: { header: "@@ -1,2 +1,2 @@", lines: ["-before", "+after"] },
        readError: "EBUSY: resource busy or locked, open 'guard.ts'",
      },
    }),
  );
  await page.goto("/reviews?status=awaiting");
  await page.getByRole("main").locator("ul > li").first().getByRole("link").click();
  await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible({ timeout: 30_000 });
  await page.locator("body").press("Enter");
  await expect(
    page.getByText(/could not be read from the review's checkout: EBUSY: resource busy/),
  ).toBeVisible();
  await expect(page.getByText("+after")).toBeVisible();
  await expect(page.getByText(/the change deleted it/)).toHaveCount(0);
  await stopAnswering();
  // Read again, not only cleared: the message went the moment it was
  // pressed, so its going proved nothing about a second read (D-141).
  const readAgain = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith("/context") && response.ok(),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await readAgain;
  await expect(page.getByRole("group", { name: "The file around this finding" })).not.toHaveText(
    /Reading the file|Not read/,
  );
  await expect(page.getByText(/could not be read from the review's checkout/)).toHaveCount(0);
});

test("a file the change renamed is said to be renamed, and shown from its new name", async ({
  page,
}) => {
  // Cited by its old name, the file was read where the checkout no longer
  // has it, and the pane offered a Try again that could never work (D-141).
  // The answer is the route's own shape for a renamed file.
  const stopAnswering = await answerOnce(page, "**/api/reviews/*/context*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        path: "app/src/old-name.ts",
        start: 1,
        end: 1,
        total: 1,
        lines: [{ number: 1, text: "export const renamed = true;" }],
        hunk: {
          header: "@@ -1,1 +1,1 @@",
          lines: ["-export const renamed = false;", "+export const renamed = true;"],
        },
        renamedTo: "app/src/new-name.ts",
      },
    }),
  );
  await page.goto("/reviews?status=awaiting");
  await page.getByRole("main").locator("ul > li").first().getByRole("link").click();
  await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible({ timeout: 30_000 });
  await page.locator("body").press("Enter");
  await expect(page.getByText("The change renamed this file to app/src/new-name.ts")).toBeVisible();
  await expect(page.getByRole("group", { name: "The file around this finding" })).toContainText(
    "export const renamed = true;",
  );
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

test("the CLI's check names the CLI, its version and how it is signed in", async ({ page }) => {
  // Every way it could not answer read "Not signed in.", and it never said
  // which CLI it asked (MVP 6.1, audit E2). The suite's fake is signed in
  // through a subscription.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Check the CLI" }).click();
  const status = page.getByTestId("cli-status");
  await expect(status).toContainText("fake-claude.mjs, 2.1.301 (Claude Code)");
  await expect(status).toContainText(
    "Reviews draw on your Max plan's usage limits rather than billing per token.",
  );
});

test("the CLI's check says each way it cannot run a review, and a check that failed", async ({
  page,
}) => {
  await page.goto("/settings");
  const status = page.getByTestId("cli-status");
  const check = page.getByRole("button", { name: "Check the CLI" });
  const answers: [object, string][] = [
    [
      { state: "notFound", message: 'Could not find "claude", the Claude Code CLI, on PATH.' },
      "No Claude Code CLI was found.",
    ],
    [
      { state: "cannotRun", path: "/opt/claude", message: "the file is not executable." },
      "The CLI cannot run reviews.",
    ],
    [{ state: "signedOut", path: "/opt/claude", version: "2.1.301" }, "Not signed in."],
    [
      { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "api_key" },
      "bills per token rather than drawing on a subscription. Reviews still run.",
    ],
    [
      // No method named: how it bills is not claimed (review of the D-153 fixes).
      { state: "perToken", path: "/opt/claude", version: "2.1.301" },
      "the CLI did not say how, so whether reviews draw on a subscription or bill per token is not known.",
    ],
  ];
  for (const [cli, said] of answers) {
    const stop = await answerOnce(page, "**/api/auth", (route) =>
      route.fulfill({ status: 200, json: { cli } }),
    );
    await check.click();
    await expect(status).toContainText(said);
    await stop();
  }
  await expect(status).toContainText("/opt/claude, 2.1.301");
  await expect(page.getByTestId("cli-path")).toHaveCount(1);
  // Finding the CLI failed before it named a path, so no path line is drawn:
  // without the check, an empty one was, which no text could tell apart
  // (review of the D-154 fixes).
  const stopNoPath = await answerOnce(page, "**/api/auth", (route) =>
    route.fulfill({
      status: 200,
      json: { cli: { state: "cannotRun", message: "the guard refused it." } },
    }),
  );
  await check.click();
  await expect(status).toContainText("the guard refused it.");
  await expect(page.getByTestId("cli-path")).toHaveCount(0);
  await stopNoPath();
  const stop = await answerOnce(page, "**/api/auth", (route) =>
    route.fulfill({ status: 500, json: { error: "The server could not run the check." } }),
  );
  await check.click();
  await expect(page.getByText("The server could not run the check.")).toBeVisible();
  await expect(status).toHaveCount(0);
  await stop();
});

test("a CLI path kept in Settings is saved, and the environment's is said to win", async ({
  page,
}) => {
  // The path came only from TRYSQUARE_CLAUDE_PATH, which the suite's server
  // is started with, pointing at the fake (MVP 6.1, D-152).
  await page.goto("/settings");
  const path = page.getByLabel("CLI path");
  await expect(path).toHaveValue("");
  await expect(page.getByText(/TRYSQUARE_CLAUDE_PATH is set to .*fake-claude\.mjs/)).toBeVisible();
  await path.fill("  /opt/claude/bin/claude  ");
  await path.blur();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(path).toHaveValue("/opt/claude/bin/claude");
  await page.reload();
  await expect(page.getByLabel("CLI path")).toHaveValue("/opt/claude/bin/claude");
  // The variable wins, so the check still asks the fake.
  await page.getByRole("button", { name: "Check the CLI" }).click();
  await expect(page.getByTestId("cli-status")).toContainText("fake-claude.mjs, 2.1.301");
  // Left as it was found, for the tests after.
  await page.getByLabel("CLI path").fill("");
  await page.getByLabel("CLI path").blur();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
});

test("Start refused for a CLI that cannot run says why, and stays on the form", async ({
  page,
}) => {
  // Creating a review asks the CLI first and refuses one that cannot run a
  // review (MVP 6.2); the suite's own fake can, so the refusal is the route's
  // shape, answered here.
  await fillANewReview(page);
  const stop = await routeUntilStopped(page, "**/api/reviews", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 409,
      json: {
        error:
          "The Claude Code CLI at /opt/claude is not signed in, so the review cannot run. Sign it in, then start the review again.",
        code: "CliNotReady",
      },
    });
  });
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText(/is not signed in, so the review cannot run/)).toBeVisible();
  await expect(page).toHaveURL(/\/reviews\/new/);
  await stop();
});
