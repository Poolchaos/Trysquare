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

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Route } from "@playwright/test";
import { answerOnce, routeUntilStopped } from "./answer-once";
import { sidewaysOverflow } from "./overflow";
import { accessibilityViolations } from "./axe";
import {
  ANSWERS_DIR,
  APP_REPO,
  COUNTER_FILE,
  E2E_ROOT,
  LIMIT_TRIGGER,
  STALL_TRIGGER,
} from "./setup";

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

test("the scan theater follows the review from stage to stage", async ({ page }) => {
  // It re-read the review only when its status changed, which a running
  // review's does not between Risk and Verification, so it named Risk while
  // the later stages ran (proof-and-steps plan, WP-A). Held in its third
  // model call, the adversarial stage.
  // The two calls let through use up scripted answers, which every later
  // review reads by count, so the count is put back once this one is
  // cancelled; the held call un-counts itself. Put back even when an
  // assertion fails, or every later review reads shifted answers and one
  // failure becomes many.
  const callsBefore = readFileSync(COUNTER_FILE, "utf8");
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 30_000, skip: 2 }), "utf8");
  try {
    await startAReview(page);
    const theater = page.getByRole("dialog", {
      name: "Watching the review of feature/rename-prefs into main",
    });
    await expect(theater).toBeVisible({ timeout: 60_000 });
    await expect(theater.getByText("Adversarial", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(theater.getByText(/stage 4 of up to 10/)).toBeVisible();

    // The five steps a person reads (WP-G): the first two done with what
    // they measured, finding issues the one now.
    const steps = theater.getByRole("list", { name: "Review steps" });
    await expect(steps.locator('[aria-current="step"]')).toContainText("Find issues");
    await expect(steps.getByRole("listitem").nth(0)).toContainText(/Done.*rules frozen/);
    await expect(steps.getByRole("listitem").nth(1)).toContainText(/Done.*files read/);
    await expect(steps.getByRole("listitem").nth(4)).toContainText(/Next.*Waiting/);
    const evidence = join(
      fileURLToPath(new URL("..", import.meta.url)),
      "review",
      `${new Date().toISOString().slice(0, 10)}-e2e`,
    );
    mkdirSync(evidence, { recursive: true });
    const desktop = page.viewportSize();
    for (const [scheme, name] of [
      ["light", "steps-live-light"],
      ["dark", "steps-live-dark"],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: join(evidence, `${name}.png`), animations: "disabled" });
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(evidence, "steps-live-phone.png"), animations: "disabled" });
    if (desktop) await page.setViewportSize(desktop);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });
  } finally {
    rmSync(STALL_TRIGGER, { force: true });
    writeFileSync(COUNTER_FILE, callsBefore, "utf8");
  }
});

for (const held of [
  {
    // Held in its fifth call, the first verifier: every candidate raised,
    // none ruled on yet.
    what: "the first",
    skip: 4,
    card: "10 to prove",
    tiles: [
      ["proven by the first verifier", "0"],
      ["refuted", "0"],
      ["discarded: the cited code was not there", "0"],
      ["open question", "0"],
      ["still to prove", "10"],
    ],
    shots: "steps-proving",
  },
  {
    // Held in its sixth, the second verifier: the first has proven nine and
    // refuted one, which this view read as none proven (review round 5).
    what: "the second",
    skip: 5,
    card: "9 with the second verifier",
    tiles: [
      ["proven by the first verifier", "9"],
      ["refuted", "1"],
      ["discarded: the cited code was not there", "0"],
      ["open question", "0"],
      ["still to prove", "0"],
    ],
    shots: "steps-second",
  },
] as const) {
  test(`the scan theater counts the findings while ${held.what} verifier works`, async ({
    page,
  }) => {
    // WP-G. The count is put back as in the test above, even if an
    // assertion fails.
    const callsBefore = readFileSync(COUNTER_FILE, "utf8");
    writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 30_000, skip: held.skip }), "utf8");
    try {
      await startAReview(page);
      const theater = page.getByRole("dialog", {
        name: "Watching the review of feature/rename-prefs into main",
      });
      await expect(theater).toBeVisible({ timeout: 60_000 });
      const steps = theater.getByRole("list", { name: "Review steps" });
      const current = steps.locator('[aria-current="step"]');
      await expect(current).toContainText("Prove each finding", { timeout: 30_000 });
      await expect(current).toContainText(held.card, { timeout: 30_000 });
      await expect(steps.getByRole("listitem").nth(2)).toContainText("10 candidates raised");
      const found = theater.getByRole("group", { name: "Findings so far" });
      for (const [label, count] of held.tiles) {
        await expect(
          found
            .locator("div")
            .filter({ has: page.getByText(label, { exact: true }) })
            .getByRole("definition"),
        ).toHaveText(count);
      }

      const evidence = join(
        fileURLToPath(new URL("..", import.meta.url)),
        "review",
        `${new Date().toISOString().slice(0, 10)}-e2e`,
      );
      mkdirSync(evidence, { recursive: true });
      const desktop = page.viewportSize();
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.screenshot({
          path: join(evidence, `${held.shots}-${scheme}.png`),
          animations: "disabled",
        });
      }
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 390, height: 844 });
      await found.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(evidence, `${held.shots}-phone.png`),
        animations: "disabled",
      });
      if (desktop) await page.setViewportSize(desktop);

      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
      await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });

      if (held.what === "the second") {
        // Cancelled with its findings raised: the read-only list and the run
        // detail, unfolded, read on a phone without the page scrolling
        // sideways; their bare grids took the width of a quoted line (round 6).
        await expect(page.getByRole("heading", { name: /^Findings \(/ })).toBeVisible();
        // With the text this page shows at its longest: a quotation, a stage's
        // error and a refutation's note as one unbroken token each, which
        // engine output can be. The run itself writes none so long.
        const token = "0123456789".repeat(14);
        const stopLong = await routeUntilStopped(page, "**/api/reviews/*", async (route) => {
          if (route.request().url().endsWith("/attention")) return route.fallback();
          const response = await route.fetch();
          const body = (await response.json()) as {
            stages: { errorClass: string | null; errorText: string | null }[];
            findings: Record<string, unknown>[];
          };
          const [first, second, ...rest] = body.findings;
          await route.fulfill({
            response,
            json: {
              ...body,
              // The last stage failed rather than cancelled, so its error shows.
              stages: body.stages.map((stage, index, all) =>
                index === all.length - 1
                  ? { ...stage, errorClass: "invalid_output", errorText: token }
                  : stage,
              ),
              findings: [
                { ...first, quotedCode: token },
                {
                  ...second,
                  status: "killed",
                  killedBy: "verification",
                  filePath: `app/${token}.ts`,
                  verificationNote: token,
                },
                ...rest,
              ],
            },
          });
        });
        await page.reload();
        await expect(page.getByRole("heading", { name: "Refuted in verification" })).toBeVisible({
          timeout: 30_000,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        const sideways = await sidewaysOverflow(page);
        expect(sideways.by, sideways.culprits.join("\n")).toBeLessThanOrEqual(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator("body").screenshot({
          path: join(evidence, "cancelled-findings-phone.png"),
          animations: "disabled",
        });
        if (desktop) await page.setViewportSize(desktop);
        await stopLong();
      }
    } finally {
      rmSync(STALL_TRIGGER, { force: true });
      writeFileSync(COUNTER_FILE, callsBefore, "utf8");
    }
  });
}

/**
 * A region in light, dark and at a phone's width, clipped from the whole
 * page so the fixed top bar is not drawn across it, the phone measured for
 * anything past its edge while it is there.
 */
async function shootAll(
  page: import("@playwright/test").Page,
  region: Locator,
  name: string,
): Promise<void> {
  const evidence = join(
    fileURLToPath(new URL("..", import.meta.url)),
    "review",
    `${new Date().toISOString().slice(0, 10)}-e2e`,
  );
  mkdirSync(evidence, { recursive: true });
  const shoot = async (file: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await region.boundingBox();
    if (!box) throw new Error(`${name} has no box to photograph.`);
    await page.screenshot({
      path: join(evidence, `${file}.png`),
      fullPage: true,
      clip: box,
      animations: "disabled",
    });
  };
  const desktop = page.viewportSize();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shoot(`${name}-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  const sideways = await sidewaysOverflow(page);
  expect(sideways.by, sideways.culprits.join("\n")).toBeLessThanOrEqual(0);
  await shoot(`${name}-phone`);
  if (desktop) await page.setViewportSize(desktop);
}

test("a project's failing test is decided above the queue, and counted (WP-I)", async ({
  page,
}) => {
  // D-197: what a project's own checks find is decided as a code finding
  // is, above the queue, and a review completes only once it is. The count
  // is put back after, as the theater tests do, so the answers serve again.
  const callsBefore = readFileSync(COUNTER_FILE, "utf8");
  const projects = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = projects.projects.find((project) => project.name === "app")!;
  const failing = join(E2E_ROOT, "scripts", "failing-tests.cjs");
  mkdirSync(join(E2E_ROOT, "scripts"), { recursive: true });
  writeFileSync(failing, 'console.log("2 failing: totals, refunds"); process.exit(1);\n');
  const checks = (testCommand: string | null) => ({
    enabled: testCommand !== null,
    installCommand: null,
    testCommand,
    e2eCommand: null,
    screenshotDir: null,
    designStandardPath: null,
  });
  let reviewId = "";
  let completed = false;
  try {
    const on = await page.request.put(`/api/projects/${app.id}/checks`, {
      data: checks(`"${process.execPath}" "${failing}"`),
    });
    expect(on.status()).toBe(200);
    await startAReview(page);
    reviewId = page.url().split("/").pop()!;
    await expect(page.getByText("awaiting your decision")).toBeVisible({ timeout: 120_000 });

    const section = page.getByRole("region", { name: "Tests and design" });
    await expect(section).toContainText("The tests fail on this branch.");
    await expect(section).toContainText("Exited with code 1, as the app ran it.");
    await expect(section.getByRole("group", { name: "Where it failed" })).toContainText(
      "2 failing: totals, refunds",
    );
    // Counted with the code findings: nine of those, and this.
    await expect(page.getByText("0 of 10 decided")).toBeVisible();
    await expect(page.getByText(/1 from the project's checks left to decide/)).toBeVisible();
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, section, "checks-queue");

    // A review whose only findings are its checks: the queue says it has
    // none, not an empty list with keys that do nothing (review round 7).
    const stopNoCode = await routeUntilStopped(
      page,
      `**/api/reviews/${reviewId}`,
      async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as object;
        await route.fulfill({ response, json: { ...body, findings: [] } });
      },
    );
    await page.reload();
    await expect(
      page.getByText("No code findings: the review raised none that verification kept."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("navigation", { name: "Findings" })).toHaveCount(0);
    await expect(page.getByText("0 of 1 decided")).toBeVisible();
    await shootAll(page, page.getByRole("main"), "checks-only");
    await stopNoCode();
    await page.reload();
    await expect(page.getByText("0 of 10 decided")).toBeVisible({ timeout: 30_000 });

    // Every code finding decided, the check still not: Complete stays off
    // for the check alone (review round 7: it was off for the code findings).
    const read = (await (await page.request.get(`/api/reviews/${reviewId}`)).json()) as {
      findings: { id: string; status: string; issue: string }[];
    };
    // All but one through the API, the last from the keyboard: with no code
    // finding left and the check still open, the title keeps the focus
    // rather than the page (review round 14).
    const verified = read.findings.filter((row) => row.status === "verified");
    for (const finding of verified.slice(0, -1)) {
      const confirmed = await page.request.post(`/api/findings/${finding.id}/confirm`, {
        data: {},
      });
      expect(confirmed.status()).toBe(200);
    }
    await page.reload();
    await expect(page.getByText("8 of 10 decided")).toBeVisible({ timeout: 30_000 });
    // The queue opens on its first row, decided; the one left is chosen.
    await page
      .getByRole("navigation", { name: "Findings" })
      .getByRole("button")
      .filter({ hasText: verified.at(-1)!.issue })
      .click();
    const lastConfirm = page.getByRole("button", { name: "Confirm", exact: true });
    await lastConfirm.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("9 of 10 decided")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("heading", { level: 3, name: verified.at(-1)!.issue }),
    ).toBeFocused();
    await expect(page.getByText("1 from the project's checks left to decide")).toBeVisible();
    const complete = page.getByRole("button", { name: "Complete review" });
    await expect(complete).toBeDisabled();

    // Dismissed only with a reason, which is kept and shown; then Complete.
    const dismiss = section.getByRole("button", { name: /^Dismiss/ });
    await expect(dismiss).toBeDisabled();
    await section.getByLabel("Why is this not a problem?").fill("Flaky on this machine.");
    await section.getByLabel("Why is this not a problem?").press("Enter");
    await expect(section).toContainText("Dismissed: Flaky on this machine.");
    await expect(page.getByText("10 of 10 decided")).toBeVisible();
    await shootAll(page, section, "checks-dismissed");
    await expect(complete).toBeEnabled();
    await complete.click();
    await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    completed = true;
    // Read only, once complete.
    await expect(section.getByRole("button")).toHaveCount(0);
    await expect(section.getByText("dismissed", { exact: true })).toBeVisible();
    await shootAll(page, section, "checks-complete");

    // No screenshots, so the grading stages were not asked: said, not
    // shown passed (review round 8).
    await page.getByText("Run detail").click();
    const stages = page.getByRole("heading", { name: "Stages" }).locator("..");
    await expect(stages).toContainText("Not asked: there were no screenshots to grade.");
    await expect(stages).toContainText("Not asked: no screen was graded C or D.");
    await shootAll(page, stages, "stages-not-asked");

    // And the report says so, in a section of its own, with how the
    // project's commands ended (step 3b-2): it said nothing of them before.
    // And that the design was not checked, never a grade (WP-I step 4).
    const examined = page.getByText(
      "The project's own checks ran on a copy of the branch: the tests failed. The design was not checked: the project has no e2e command.",
    );
    await expect(examined).toBeVisible({ timeout: 30_000 });
    await shootAll(page, examined, "report-design-not-checked");
    const inReport = page.getByRole("heading", { name: "Tests and design (1)" }).locator("..");
    await expect(inReport).toContainText("Dismissed: Flaky on this machine.");
    await expect(inReport).toContainText("2 failing: totals, refunds");
    await shootAll(page, inReport, "report-checks");
  } finally {
    const off = await page.request.put(`/api/projects/${app.id}/checks`, { data: checks(null) });
    expect.soft(off.status(), "the checks turned off again").toBe(200);
    if (reviewId !== "" && !completed) {
      const cancelled = await page.request.post(`/api/reviews/${reviewId}/cancel`, { data: {} });
      expect.soft(cancelled.status(), "the review cancelled").toBe(200);
    }
    writeFileSync(COUNTER_FILE, callsBefore, "utf8");
  }
});

test("a project's screens are graded: one proven D confirmed, one open question left out (WP-I)", async ({
  page,
}) => {
  // Step 4: the screenshots a project's own e2e saved, graded A to D by one
  // model and, for a C or D, again by the paired model. Two real screens of
  // this app stand in for the project's; the fake grades one D twice, which
  // proves it, and the other C then B, which leaves it an open question.
  // The answers are written past those setup wrote, then taken away, the
  // count put back, as the theater tests do.
  const callsBefore = readFileSync(COUNTER_FILE, "utf8");
  // Numbered from what is there, not from what setup wrote when this was
  // written (review round 8).
  const written = readdirSync(ANSWERS_DIR).filter((file) => /^\d{3}\.json$/.test(file)).length;
  const numbered = (n: number) => join(ANSWERS_DIR, `${String(n).padStart(3, "0")}.json`);
  const extra = Array.from({ length: 8 }, (_, index) => numbered(written + 1 + index));
  // Setup writes one run's answers twice over, S1 to S4, then S5 and S5b.
  const perRun = written / 2;
  expect(perRun, "a run's answers as setup writes them").toBe(6);
  const [s1, s2, s3, s4, s5, s5b] = Array.from({ length: perRun }, (_, index) =>
    readFileSync(numbered(index + 1), "utf8"),
  );
  const projects = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = projects.projects.find((project) => project.name === "app")!;
  const source = join(E2E_ROOT, "screens-source");
  mkdirSync(source, { recursive: true });
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await page.screenshot({ path: join(source, "home.png") });
  await page.goto("/rulesets");
  await expect(page.getByRole("heading", { name: "Rulesets", level: 1 })).toBeVisible();
  await page.screenshot({ path: join(source, "rulesets.png") });
  const e2e = join(E2E_ROOT, "scripts", "save-screens.cjs");
  mkdirSync(join(E2E_ROOT, "scripts"), { recursive: true });
  writeFileSync(
    e2e,
    `const fs = require("node:fs"), path = require("node:path");
fs.mkdirSync("e2e/screens", { recursive: true });
for (const name of ["home.png", "rulesets.png"]) {
  fs.copyFileSync(path.join(${JSON.stringify(source)}, name), path.join("e2e/screens", name));
}
`,
  );
  const graded = (...grades: [string, string, string][]) =>
    JSON.stringify({
      grades: grades.map(([screenshot, grade, whatIsOff]) => ({
        screenshot,
        opened: true,
        grade,
        whatIsOff,
      })),
    });
  // S1 to S4, S4b grading both screens, S5 and S5b, then S5c asked about
  // both, graded C or D by the first.
  const answers = [
    s1,
    s2,
    s3,
    s4,
    graded(
      ["home.png", "D", "The page title is cut off at the top of the card."],
      ["rulesets.png", "C", "The empty state sits too close to the heading."],
    ),
    s5,
    s5b,
    graded(["home.png", "D", "The heading is clipped."], ["rulesets.png", "B", ""]),
  ];
  answers.forEach((answer, index) => writeFileSync(extra[index]!, answer!));
  writeFileSync(COUNTER_FILE, String(written), "utf8");
  const checks = (on: boolean) => ({
    enabled: on,
    installCommand: null,
    testCommand: null,
    e2eCommand: on ? `"${process.execPath}" "${e2e}"` : null,
    screenshotDir: on ? "e2e/screens" : null,
    designStandardPath: null,
  });
  const decided = (action: "confirm" | "dismiss") =>
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/check-findings/") && response.url().endsWith(`/${action}`),
    );
  let reviewId = "";
  let completed = false;
  try {
    const on = await page.request.put(`/api/projects/${app.id}/checks`, { data: checks(true) });
    expect(on.status()).toBe(200);
    // Said before Start: what runs, and that grading adds requests counted
    // only once the e2e has saved its screenshots (WP-I step 5).
    await fillANewReview(page);
    const said = page.getByTestId("project-checks");
    await expect(said).toContainText("The project's own checks run first", { timeout: 30_000 });
    await expect(said).toContainText("On a throwaway copy of the branch, as you:");
    await expect(said).toContainText("save-screens.cjs");
    await expect(said).toContainText(
      "The screenshots its e2e saves are then graded, a request for each eight or fewer",
    );
    await shootAll(page, said, "preflight-checks");
    await page.getByRole("button", { name: "Start review" }).click();
    await expect(page).toHaveURL(/\/reviews\/[A-Z0-9]+$/i, { timeout: 60_000 });
    reviewId = page.url().split("/").pop()!;
    await expect(page.getByText("awaiting your decision")).toBeVisible({ timeout: 120_000 });

    const section = page.getByRole("region", { name: "Tests and design" });
    const home = section
      .getByRole("listitem")
      .filter({ hasText: "The screen home.png is graded D." });
    const rulesets = section
      .getByRole("listitem")
      .filter({ hasText: "The screen rulesets.png is graded C." });
    await expect(home).toContainText("The page title is cut off at the top of the card.");
    await expect(home).toContainText("Graded D again by the second grader");
    await expect(rulesets).toContainText("The second grader, claude-opus-5-5, graded it B.");
    // Open, as the code queue has it: said so, and no Confirm that does
    // nothing (review round 8).
    await expect(rulesets.getByText("open question", { exact: true })).toBeVisible();
    await expect(rulesets.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
    await expect(rulesets).toContainText("The two graders did not agree");
    // The five steps, and the funnel, say what grading came to.
    const went = page.getByRole("region", { name: "How the review went" });
    const steps = went.getByRole("listitem");
    await expect(steps.nth(2)).toContainText("2 screens graded C or D.");
    await expect(steps.nth(3)).toContainText(
      "The second grader agreed on 1 of 2 screens graded C or D, leaving 1 open.",
    );
    await expect(went).toContainText(
      "Apart from these, 2 screens graded C or D: 1 graded C or D again by the second grader, 1 left open.",
    );
    const image = home.getByRole("img", {
      name: /^The screen home\.png, graded D\. What is off: /,
    });
    await expect(image).toBeVisible();
    // Loaded, not merely there: naturalWidth is 0 until it has.
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await expect(home.getByRole("link", { name: "Open the screenshot full size" })).toHaveAttribute(
      "href",
      /\/api\/check-findings\/.+\/screenshot$/,
    );
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, section, "design-queue");

    // A screenshot that will not load says so, by name, rather than show a
    // broken image (review round 9: the state was never driven).
    const stopImages = await routeUntilStopped(
      page,
      "**/api/check-findings/*/screenshot",
      (route) => route.fulfill({ status: 404, json: { error: "gone" } }),
    );
    await page.reload();
    await expect(home).toContainText(
      "The screenshot, home.png, could not be loaded: its review's files may have been removed.",
      { timeout: 30_000 },
    );
    await expect(home.getByRole("img")).toHaveCount(0);
    await shootAll(page, home, "design-image-gone");
    await stopImages();
    await page.reload();
    await expect(image).toBeVisible({ timeout: 30_000 });

    const confirming = decided("confirm");
    await home.getByRole("button", { name: /^Confirm/ }).click();
    expect((await confirming).status()).toBe(200);
    await expect(home.getByText("confirmed", { exact: true })).toBeVisible();

    await rulesets.getByLabel("Why leave it out?").fill("Agreed with design.");
    const leaving = decided("dismiss");
    await rulesets.getByRole("button", { name: /^Leave out/ }).click();
    expect((await leaving).status()).toBe(200);
    await expect(rulesets.getByText("left out", { exact: true })).toBeVisible();
    await expect(rulesets).toContainText("Left out: Agreed with design.");
    await shootAll(page, section, "design-decided");

    const reviewed = (await (await page.request.get(`/api/reviews/${reviewId}`)).json()) as {
      findings: { id: string; status: string }[];
    };
    for (const finding of reviewed.findings.filter((row) => row.status === "verified")) {
      const confirmed = await page.request.post(`/api/findings/${finding.id}/confirm`, {
        data: {},
      });
      expect(confirmed.status()).toBe(200);
    }
    await page.reload();
    await page.getByRole("button", { name: "Complete review" }).click();
    await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    completed = true;
    await expect(
      page.getByText(
        "The project's own checks ran on a copy of the branch: the e2e tests passed. The screenshots its e2e saved were graded A to D.",
      ),
    ).toBeVisible();
    const inReport = page.getByRole("heading", { name: "Tests and design (2)" }).locator("..");
    await expect(inReport).toContainText(
      "The screens the project's own e2e saved, on a copy of this branch, that were graded C or D.",
    );
    await expect(inReport.getByRole("heading", { name: "Confirmed (1)" })).toBeVisible();
    await expect(inReport.getByRole("heading", { name: "Left out unproven (1)" })).toBeVisible();
    await expect(inReport).toContainText("Left out: Agreed with design.");
    const reportImage = inReport.getByRole("img", {
      name: "The screen home.png. What is off: The page title is cut off at the top of the card.",
    });
    await expect
      .poll(() =>
        reportImage.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await shootAll(page, inReport, "design-report");

    // A screen the report does not carry is named, in its own layout, not
    // set as a failing command's output (review round 9: never driven).
    const stopReport = await routeUntilStopped(
      page,
      `**/api/reviews/${reviewId}/report`,
      async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as {
          report?: { checks?: { confirmed: { screenshotDataUri?: string | null }[] } };
        };
        for (const check of body.report?.checks?.confirmed ?? []) check.screenshotDataUri = null;
        await route.fulfill({ response, json: body });
      },
    );
    await page.reload();
    const notCarried = page.getByRole("heading", { name: "Tests and design (2)" }).locator("..");
    await expect(notCarried).toContainText(
      "The screenshot, home.png, is not carried in this report: it is gone, or over what one report carries.",
      { timeout: 30_000 },
    );
    await expect(notCarried).toContainText(
      "What is off: The page title is cut off at the top of the card.",
    );
    await shootAll(page, notCarried, "design-report-not-carried");
    await stopReport();
  } finally {
    const off = await page.request.put(`/api/projects/${app.id}/checks`, { data: checks(false) });
    expect.soft(off.status(), "the checks turned off again").toBe(200);
    if (reviewId !== "" && !completed) {
      const cancelled = await page.request.post(`/api/reviews/${reviewId}/cancel`, { data: {} });
      expect.soft(cancelled.status(), "the review cancelled").toBe(200);
    }
    for (const file of extra) rmSync(file, { force: true });
    writeFileSync(COUNTER_FILE, callsBefore, "utf8");
  }
});

test("the theater says when a step is grading the project's screens (WP-I)", async ({ page }) => {
  // Held in S4b, the fifth call: the Find issues step is grading screens,
  // not walking the rules, and said so (review round 9: never driven).
  const callsBefore = readFileSync(COUNTER_FILE, "utf8");
  const written = readdirSync(ANSWERS_DIR).filter((file) => /^\d{3}\.json$/.test(file)).length;
  const numbered = (n: number) => join(ANSWERS_DIR, `${String(n).padStart(3, "0")}.json`);
  const extra = [1, 2, 3, 4].map((n) => {
    const to = numbered(written + n);
    writeFileSync(to, readFileSync(numbered(n), "utf8"));
    return to;
  });
  writeFileSync(COUNTER_FILE, String(written), "utf8");
  const projects = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = projects.projects.find((project) => project.name === "app")!;
  const e2e = join(E2E_ROOT, "scripts", "save-one-screen.cjs");
  mkdirSync(join(E2E_ROOT, "scripts"), { recursive: true });
  writeFileSync(
    e2e,
    `const fs = require("node:fs");
fs.mkdirSync("e2e/screens", { recursive: true });
fs.writeFileSync("e2e/screens/home.png", "png");
`,
  );
  const checks = (on: boolean) => ({
    enabled: on,
    installCommand: null,
    testCommand: null,
    e2eCommand: on ? `"${process.execPath}" "${e2e}"` : null,
    screenshotDir: on ? "e2e/screens" : null,
    designStandardPath: null,
  });
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 60_000, skip: 4 }), "utf8");
  try {
    const on = await page.request.put(`/api/projects/${app.id}/checks`, { data: checks(true) });
    expect(on.status()).toBe(200);
    await startAReview(page);
    const theater = page.getByRole("dialog", {
      name: "Watching the review of feature/rename-prefs into main",
    });
    await expect(theater.getByText("Design grading", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const steps = theater.getByRole("list", { name: "Review steps" });
    await expect(steps.locator('[aria-current="step"]')).toContainText("Find issues");
    await expect(steps.getByRole("listitem").nth(2)).toContainText("Grading the screens");
    await shootAll(page, theater, "steps-grading");

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 60_000 });
  } finally {
    rmSync(STALL_TRIGGER, { force: true });
    const off = await page.request.put(`/api/projects/${app.id}/checks`, { data: checks(false) });
    expect.soft(off.status(), "the checks turned off again").toBe(200);
    for (const file of extra) rmSync(file, { force: true });
    writeFileSync(COUNTER_FILE, callsBefore, "utf8");
  }
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

test("a decision that moves onto an open question leaves the focus on its title", async ({
  page,
}) => {
  // Audit finding U6: confirming a finding moves to the next one to decide,
  // and when that is an open question its Confirm goes, with the focus in
  // it; Tab began again from the top. The review the next test reads is
  // staged as that test stages it, its criticals proven and the rest open
  // questions, and Confirm is answered here, so nothing is decided on it.
  const listed = (await (await page.request.get("/api/reviews")).json()) as {
    reviews: { id: string; status: string; findings: { confirmed: number; dismissed: number } }[];
  };
  const waiting = listed.reviews.find(
    (review) =>
      review.status === "awaiting_confirmation" &&
      review.findings.confirmed === 0 &&
      review.findings.dismissed === 0,
  );
  expect(waiting, "a review awaiting decisions, none made yet").toBeDefined();
  let criticals = 0;
  const stop = await routeUntilStopped(page, `**/api/reviews/${waiting!.id}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      findings: { id: string; status: string; severity: string; verificationNote: string | null }[];
    };
    criticals = body.findings.filter(
      (finding) => finding.status === "verified" && finding.severity === "CRITICAL",
    ).length;
    await route.fulfill({
      response,
      json: {
        ...body,
        findings: body.findings.map((finding) =>
          finding.status !== "verified" || finding.severity === "CRITICAL"
            ? finding
            : { ...finding, status: "open_question", verificationNote: "Could not be settled." },
        ),
      },
    });
  });
  const stopConfirming = await routeUntilStopped(page, "**/api/findings/*/confirm", (route) =>
    route.fulfill({ status: 200, json: {} }),
  );
  try {
    await page.goto(`/reviews/${waiting!.id}`);
    const confirm = page.getByRole("button", { name: "Confirm", exact: true });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    expect(criticals, "proven criticals to confirm").toBeGreaterThan(0);
    // The last proven critical, so the next to decide is an open question.
    for (let step = 1; step < criticals; step += 1) await page.locator("body").press("j");
    // From the keyboard, which keeps the focus on the button; a mouse click
    // leaves none on it by design, so it has none to lose.
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("not-proven")).toBeVisible();
    const title = page.getByRole("heading", { level: 3 }).filter({ hasNotText: /\(\d+\)$/ });
    await expect(title).toBeFocused();
    await shootAll(page, page.getByRole("main"), "decided-onto-question");
  } finally {
    await stopConfirming();
    await stop();
  }
});

test("a decision with findings left only above it moves up to them", async ({ page }) => {
  // Review round 14: the next finding to decide was looked for only below,
  // so with those left above, the queue stayed put and the focus fell to the
  // page. Staged the other way round from the test above: its criticals
  // open questions, its warnings proven; Confirm answered here.
  const listed = (await (await page.request.get("/api/reviews")).json()) as {
    reviews: { id: string; status: string; findings: { confirmed: number; dismissed: number } }[];
  };
  const waiting = listed.reviews.find(
    (review) =>
      review.status === "awaiting_confirmation" &&
      review.findings.confirmed === 0 &&
      review.findings.dismissed === 0,
  );
  expect(waiting, "a review awaiting decisions, none made yet").toBeDefined();
  const stop = await routeUntilStopped(page, `**/api/reviews/${waiting!.id}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      findings: { id: string; status: string; severity: string; verificationNote: string | null }[];
    };
    await route.fulfill({
      response,
      json: {
        ...body,
        findings: body.findings.map((finding) =>
          finding.status === "verified" && finding.severity === "CRITICAL"
            ? { ...finding, status: "open_question", verificationNote: "Could not be settled." }
            : finding,
        ),
      },
    });
  });
  const stopConfirming = await routeUntilStopped(page, "**/api/findings/*/confirm", (route) =>
    route.fulfill({ status: 200, json: {} }),
  );
  try {
    await page.goto(`/reviews/${waiting!.id}`);
    await expect(page.getByTestId("not-proven")).toBeVisible({ timeout: 30_000 });
    // The last row, a proven warning, every finding still to decide above it.
    await page.locator("body").press("G");
    const confirm = page.getByRole("button", { name: "Confirm", exact: true });
    await expect(confirm).toBeVisible();
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("not-proven")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3 }).filter({ hasNotText: /\(\d+\)$/ }),
    ).toBeFocused();
  } finally {
    await stopConfirming();
    await stop();
  }
});

test("a watched run that ends while hidden says so, and the focus stays on the page", async ({
  page,
}) => {
  // Audit finding U7: hidden, the theater leaves the focus on Scan view, and
  // a run that ended took Scan view with it; the focus fell to the page and
  // nothing said the run was over. Held in a stage, hidden, then cancelled
  // from outside, as another tab would. The count is put back as in the
  // theater tests.
  const callsBefore = readFileSync(COUNTER_FILE, "utf8");
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 30_000 }), "utf8");
  try {
    await startAReview(page);
    const theater = page.getByRole("dialog", { name: /^Watching the review of/ });
    await expect(theater).toBeVisible({ timeout: 60_000 });
    await expect(theater.getByText("Risk started")).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Scan view" })).toBeFocused();

    const reviewId = new URL(page.url()).pathname.split("/").pop();
    const cancelled = await page.request.post(`/api/reviews/${reviewId}/cancel`, { data: {} });
    expect(cancelled.status()).toBe(200);
    await expect(page.getByTestId("run-ending")).toHaveText("The run is over: it was cancelled.", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("review-heading")).toBeFocused();
    await shootAll(
      page,
      page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) }),
      "run-ended-hidden",
    );
  } finally {
    rmSync(STALL_TRIGGER, { force: true });
    writeFileSync(COUNTER_FILE, callsBefore, "utf8");
  }
});

test("a watched run that ends with its theater open says so", async ({ page }) => {
  // Review round 15: the page that took the theater's place mounted with the
  // status badge already showing the ending, and what a live region is
  // mounted with is not read out. The region that says it is marked while
  // the theater is open, and found marked after: the same node. Its words
  // must come after the theater has gone, whose modal dialog keeps the page
  // from a screen reader: each change to the page is recorded as whether
  // the theater is open and whether the words are there. No screen reader
  // is driven; this is the order one depends on. Held, then cancelled from
  // outside, as above.
  const callsBefore = readFileSync(COUNTER_FILE, "utf8");
  writeFileSync(STALL_TRIGGER, JSON.stringify({ ms: 30_000 }), "utf8");
  try {
    await startAReview(page);
    const theater = page.getByRole("dialog", { name: /^Watching the review of/ });
    await expect(theater).toBeVisible({ timeout: 60_000 });
    await expect(theater.getByText("Risk started")).toBeVisible({ timeout: 60_000 });
    const said = page.getByTestId("run-ending");
    await expect(said).toHaveText("");
    await said.evaluate((node) => node.setAttribute("data-marked", "with the theater"));
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { endingOrder: string[] }).endingOrder = seen;
      new MutationObserver(() => {
        const open = document.querySelector("dialog[open]") ? "theater" : "page";
        const words = document.querySelector('[data-testid="run-ending"]')?.textContent;
        const now = `${open} ${words ? "said" : "quiet"}`;
        if (seen.at(-1) !== now) seen.push(now);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });

    const reviewId = new URL(page.url()).pathname.split("/").pop();
    const cancelled = await page.request.post(`/api/reviews/${reviewId}/cancel`, { data: {} });
    expect(cancelled.status()).toBe(200);
    await expect(theater).toHaveCount(0, { timeout: 60_000 });
    await expect(said).toHaveText("The run is over: it was cancelled.");
    await expect(said).toHaveAttribute("data-marked", "with the theater");
    const order = await page.evaluate(
      () => (window as unknown as { endingOrder: string[] }).endingOrder,
    );
    expect(order).not.toContain("theater said");
    expect(order.slice(-2)).toEqual(["page quiet", "page said"]);
    await expect(page.getByTestId("review-heading")).toBeFocused();
    await shootAll(
      page,
      page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) }),
      "run-ended-watched",
    );
  } finally {
    rmSync(STALL_TRIGGER, { force: true });
    writeFileSync(COUNTER_FILE, callsBefore, "utf8");
  }
});

test("a quiet dashboard keeps its times and its waiting list current", async ({ page }) => {
  // Audit finding U3: the clock behind "waiting 4m ago" ticked only while a
  // run was live, so a quiet dashboard froze; and the scoreboard was read
  // once, so its Needs you list drifted from the top bar. The clock is the
  // test's own, and what the bar polls is answered as quiet, then as one
  // more review waiting on a person.
  await page.clock.install();
  let boards = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/scoreboard") boards += 1;
  });
  let awaiting: number | null = null;
  const stop = await routeUntilStopped(page, "**/api/reviews/attention", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { awaiting: number };
    awaiting ??= body.awaiting;
    await route.fulfill({ response, json: { ...body, active: null, awaiting } });
  });
  // One re-read of the scoreboard is answered as a failure when asked to.
  let failNext = false;
  const failOnce = async (route: import("@playwright/test").Route) => {
    if (!failNext) return route.fallback();
    failNext = false;
    await route.fulfill({ status: 500, json: { error: "The scoreboard could not be read." } });
  };
  await page.route("**/api/scoreboard", failOnce);
  try {
    await page.goto("/");
    const waiting = page.getByText(/^waiting (just now|\d+[mhd] ago)$/).first();
    await expect(waiting).toBeVisible({ timeout: 30_000 });
    const before = await waiting.textContent();
    // Hours, so the words change however long the review has waited.
    await page.clock.fastForward("02:00:00");
    await expect(waiting).not.toHaveText(before!);

    const read = boards;
    awaiting = (awaiting ?? 0) + 1;
    await page.clock.fastForward("00:05");
    await expect.poll(() => boards).toBeGreaterThan(read);

    // A re-read that fails is asked again at the next poll (review round
    // 15), though what the bar polls has not changed since.
    const again = boards;
    failNext = true;
    awaiting += 1;
    await page.clock.fastForward("00:05");
    await expect.poll(() => boards).toBeGreaterThan(again);
    // Said while the old figures stand (review round 16), and gone once a
    // read lands.
    const stale = page.getByText(/The figures below are the last ones read/);
    await expect(stale).toBeVisible();
    await shootAll(page, stale, "scoreboard-reread-failed");
    await page.clock.fastForward("00:05");
    await expect.poll(() => boards).toBeGreaterThan(again + 1);
    await expect(stale).toHaveCount(0);
  } finally {
    await page.unroute("**/api/scoreboard", failOnce);
    await stop();
  }
});

test("an older reading of what is running does not put back what it said", async ({ page }) => {
  // Audit finding U4: the dashboard's and the top bar's polls applied each
  // reading as it landed, so a slow one overtaken by a later one put back a
  // run that had ended, or a count since changed, until the next poll. The
  // first round is held and answered stale, a run that is not there and
  // seven more waiting; the next is answered as the server is; then the
  // first lands.
  const real = (await (await page.request.get("/api/reviews/attention")).json()) as {
    awaiting: number;
  };
  // The first two readings are the two pollers' first, on load: held.
  let held = 0;
  let releaseStale = () => {};
  const stale = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  let current = 0;
  const stop = await routeUntilStopped(page, "**/api/reviews/attention", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { awaiting: number };
    if (held < 2) {
      held += 1;
      await stale;
      await route.fulfill({
        response,
        json: {
          ...body,
          awaiting: body.awaiting + 7,
          active: {
            id: "STALE",
            status: "running",
            projectName: "app",
            fromBranch: "a-run-that-has-ended",
            intoBranch: "main",
            currentStage: null,
            startedAt: new Date().toISOString(),
            costEquivalentUsd: 0,
          },
        },
      });
      return;
    }
    await route.fulfill({ response, json: body });
    current += 1;
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Review scoreboard", level: 1 })).toBeVisible();
    // The scoreboard drawn, so a phantom run would have somewhere to show.
    await expect(page.getByText("Total spend")).toBeVisible({ timeout: 30_000 });
    // Both pollers' first readings are out, held; their next are answered.
    await expect.poll(() => held, { timeout: 15_000, intervals: [100] }).toBe(2);
    await expect
      .poll(() => current, { timeout: 15_000, intervals: [100] })
      .toBeGreaterThanOrEqual(2);
    releaseStale();
    // Well before the next poll could put things right, four seconds on.
    await page.waitForTimeout(400);
    // Read once, not waited on: a check that retries for its five seconds
    // reaches the next poll, which puts things right, and passed on the old
    // pages while the stale reading showed.
    const said = (count: number) => page.locator(`[aria-label="${count} awaiting your decision"]`);
    expect(await said(real.awaiting + 7).count()).toBe(0);
    if (real.awaiting > 0) expect(await said(real.awaiting).count()).toBe(1);
    expect(await page.getByText("a-run-that-has-ended").count()).toBe(0);
  } finally {
    releaseStale();
    await stop();
  }
});

test("closing Verify again stops the reads of what it would cost", async ({ page }) => {
  // Audit finding U8: opening the dialog reads the settings and the sign-in
  // to say what a request costs, and closing it left those reads running.
  // The sign-in read is held; Not now must stop it, and so must dismissing
  // the finding while its dialog is open (review round 15).
  const listed = (await (await page.request.get("/api/reviews")).json()) as {
    reviews: { id: string; status: string; findings: { confirmed: number; dismissed: number } }[];
  };
  const waiting = listed.reviews.find(
    (review) =>
      review.status === "awaiting_confirmation" &&
      review.findings.confirmed === 0 &&
      review.findings.dismissed === 0,
  );
  expect(waiting, "a review awaiting decisions, none made yet").toBeDefined();
  const stop = await routeUntilStopped(page, `**/api/reviews/${waiting!.id}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      findings: { id: string; status: string; severity: string; verificationNote: string | null }[];
    };
    await route.fulfill({
      response,
      json: {
        ...body,
        findings: body.findings.map((finding) =>
          finding.status === "verified"
            ? { ...finding, status: "open_question", verificationNote: "Could not be settled." }
            : finding,
        ),
      },
    });
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = false;
  const holdAuth = async (route: import("@playwright/test").Route) => {
    asked = true;
    await held;
    await route.fulfill({ status: 200, json: {} }).catch(() => undefined);
  };
  const stopped: string[] = [];
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/auth")
      stopped.push(request.failure()?.errorText ?? "");
  });
  try {
    await page.goto(`/reviews/${waiting!.id}`);
    await expect(page.getByTestId("not-proven")).toBeVisible({ timeout: 30_000 });
    await page.route("**/api/auth", holdAuth);
    await page.getByRole("button", { name: "Verify again" }).click();
    await expect.poll(() => asked).toBe(true);
    await page.getByRole("button", { name: "Not now" }).click();
    await expect.poll(() => stopped.length).toBe(1);
    // Stopped, not failed: nothing is said for a dialog the person closed.
    await page.waitForTimeout(300);
    expect(await page.getByText(/could not be read/).count()).toBe(0);

    // The dismissal is answered here, so the finding stays for the tests
    // after; routed once and never unrouted, as the journey's is.
    await page.route(
      "**/api/findings/*/dismiss",
      (route) => route.fulfill({ status: 200, json: { status: "dismissed" } }),
      { times: 1 },
    );
    asked = false;
    await page.getByRole("button", { name: "Verify again" }).click();
    await expect.poll(() => asked).toBe(true);
    const reason = page.locator('input[id^="dismiss-reason-"]');
    await reason.fill("Left out by the test.");
    await reason.press("Enter");
    await expect.poll(() => stopped.length).toBe(2);
  } finally {
    release();
    await page.unroute("**/api/auth", holdAuth);
    await stop();
  }
});

test("a reading slower than the poll still lands", async ({ page }) => {
  // Review round 15: the polls dropped a reading once a later poll had been
  // sent, so a server slower than the four-second poll showed nothing at all.
  // Every reading here takes five seconds.
  const real = (await (await page.request.get("/api/reviews/attention")).json()) as {
    awaiting: number;
  };
  expect(real.awaiting, "a review waiting on a person, left by the tests before").toBeGreaterThan(
    0,
  );
  const slow = async (route: import("@playwright/test").Route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.fulfill({ response }).catch(() => undefined);
  };
  await page.route("**/api/reviews/attention", slow);
  try {
    await page.goto("/projects");
    await expect(
      page.locator(`[aria-label="${real.awaiting} awaiting your decision"]`),
    ).toHaveCount(1, { timeout: 20_000 });
  } finally {
    await page.unroute("**/api/reviews/attention", slow);
  }
});

test("a good reading is kept when the one asked after it fails", async ({ page }) => {
  // Review round 15: a review's reading was dropped once a later one had
  // been asked, so when that later one failed the page had nothing. The
  // first reading is held a moment and answered as the server answers; every
  // one after it fails.
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const reading = `**${await row.getByRole("link").getAttribute("href")}`.replace(
    "/reviews/",
    "/api/reviews/",
  );
  let readings = 0;
  const firstLate = async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    readings += 1;
    if (readings > 1) {
      await route.fulfill({ status: 500, json: { error: "The review could not be read." } });
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ response }).catch(() => undefined);
  };
  await page.route(reading, firstLate);
  try {
    await row.getByRole("link").click();
    await page.waitForURL(/\/reviews\/[A-Z0-9]+$/);
    await expect.poll(() => readings, { timeout: 10_000 }).toBeGreaterThan(1);
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    await expect(header.getByText("complete", { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await page.unroute(reading, firstLate);
  }
});

test("a sliding feed keeps each row with its own entry", async ({ page }) => {
  // Audit finding U9: the feed was keyed by place, so once its window slid
  // every row was redrawn with its neighbour's words. A finished review is
  // read as running, its stream sends 125 lines and asks to be opened again,
  // and the next stream, once a row is marked, sends one more.
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const reading = `**${await row.getByRole("link").getAttribute("href")}`.replace(
    "/reviews/",
    "/api/reviews/",
  );
  const stopReading = await routeUntilStopped(page, reading, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { review: { status: string } };
    await route.fulfill({
      response,
      json: { ...body, running: true, review: { ...body.review, status: "running" } },
    });
  });
  const line = (n: number) =>
    `event: update\ndata: ${JSON.stringify({ kind: "engine", detail: `row ${String(n).padStart(3, "0")}` })}\n\n`;
  let streams = 0;
  let release = () => {};
  const marked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopStreaming = await routeUntilStopped(page, `${reading}/events`, async (route) => {
    streams += 1;
    if (streams === 1) {
      const body = Array.from({ length: 125 }, (_, i) => line(i + 1)).join("");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `${body}event: reconnect\ndata: {}\n\n`,
      });
      return;
    }
    if (streams === 2) await marked;
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: line(126) });
  });
  try {
    await row.getByRole("link").click();
    const theater = page.getByRole("dialog", { name: /^Watching the review of/ });
    const sixty = theater.locator("li").filter({ hasText: "row 060" });
    await expect(sixty).toHaveCount(1, { timeout: 30_000 });
    await sixty.evaluate((element) => element.setAttribute("data-marked", "yes"));
    release();
    await expect(theater.locator("li").filter({ hasText: "row 126" })).toHaveCount(1);
    // The marked row still holds the line it was marked on.
    await expect(theater.locator('li[data-marked="yes"]')).toContainText("row 060");
  } finally {
    release();
    await stopStreaming();
    await stopReading();
  }
});

test("the dashboard names a stage it does not know by its id", async ({ page }) => {
  // Audit finding U10: a stage from a newer server showed as nothing and
  // "stage 0 of 10". What the bar polls is answered with a run on one.
  const stop = await routeUntilStopped(page, "**/api/reviews/attention", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        active: {
          id: "NEWER",
          status: "running",
          projectName: "app",
          fromBranch: "feature/newer-server",
          intoBranch: "main",
          currentStage: "s9_threat_model",
          startedAt: new Date().toISOString(),
          costEquivalentUsd: 0,
        },
      },
    });
  });
  try {
    await page.goto("/");
    // The Live scan card holding the run's link; its stage line reads the
    // name alone, with no number after it.
    const card = page
      .getByRole("main")
      .locator('a[href="/reviews/NEWER"]')
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')][1]");
    await expect(card.getByText("threat model", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(await card.getByText(/stage \d+ of/).count()).toBe(0);
    // Started a moment ago: it read "just now elapsed" (review round 15).
    await expect(card.getByText("under a minute elapsed")).toBeVisible();
    await shootAll(page, card, "live-scan-unknown-stage");
  } finally {
    await stop();
  }
});

test("a stage the review screen does not know is named, and given no number", async ({ page }) => {
  // Review round 16: the review's header read "threat model, stage 0 of up
  // to 10" for a stage a newer server ran, and a lettered id such as s7b_
  // kept its prefix. A finished review is read as running on such a stage.
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const reading = `**${await row.getByRole("link").getAttribute("href")}`.replace(
    "/reviews/",
    "/api/reviews/",
  );
  const stop = await routeUntilStopped(page, reading, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { review: { status: string } };
    await route.fulfill({
      response,
      json: {
        ...body,
        running: true,
        review: { ...body.review, status: "running", currentStage: "s7b_threat_model" },
      },
    });
  });
  try {
    await row.getByRole("link").click();
    const theater = page.getByRole("dialog", { name: /^Watching the review of/ });
    await expect(theater).toBeVisible({ timeout: 30_000 });
    await expect(theater.getByText(/threat model/).first()).toBeVisible();
    expect(await theater.getByText(/s7b/).count()).toBe(0);
    await page.keyboard.press("Escape");
    await expect(theater).toHaveCount(0);
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    await expect(header.getByText(/threat model/)).toBeVisible();
    expect(await header.getByText(/stage \d+ of up to/).count()).toBe(0);
    expect(await header.getByText(/s7b/).count()).toBe(0);
    await shootAll(page, header, "unknown-stage-header");
  } finally {
    await stop();
  }
});

test("an unproven finding offers no Confirm, by button or by key", async ({ page }) => {
  // Only proven findings reach the report: an open question can only be
  // dismissed (PG-2 (a), D-185). Its review is one the usage-limit test
  // before this one leaves awaiting decisions: a review of its own would
  // use up scripted answers the later tests read by count. Its verified
  // criticals are shown as open questions, so with none decided yet, the
  // queue, worst first, opens on one; its warnings stay verified, each as if
  // its finder had called it critical.
  const listed = (await (await page.request.get("/api/reviews")).json()) as {
    reviews: { id: string; status: string; findings: { confirmed: number; dismissed: number } }[];
  };
  const waiting = listed.reviews.find(
    (review) =>
      review.status === "awaiting_confirmation" &&
      review.findings.confirmed === 0 &&
      review.findings.dismissed === 0,
  );
  expect(
    waiting,
    "a review awaiting decisions, none made yet (left by the usage-limit test)",
  ).toBeDefined();
  // Verified again below: shown as it is, proven (WP-D2).
  const provenAgain = new Set<string>();
  const stop = await routeUntilStopped(page, `**/api/reviews/${waiting!.id}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      findings: { id: string; status: string; severity: string; verificationNote: string | null }[];
    };
    await route.fulfill({
      response,
      json: {
        ...body,
        findings: body.findings.map((finding) =>
          finding.status !== "verified" || provenAgain.has(finding.id)
            ? finding
            : finding.severity === "WARNING"
              ? { ...finding, raisedSeverity: "CRITICAL" }
              : { ...finding, status: "open_question", verificationNote: "Could not be settled." },
        ),
      },
    });
  });
  let confirms = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/confirm")) confirms += 1;
  });
  await page.goto(`/reviews/${waiting!.id}`);
  await expect(page.getByTestId("not-proven")).toContainText(
    "Not proven, so it cannot go into the report.",
  );
  await expect(page.getByText("Verification: Could not be settled.")).toBeVisible();
  await expect(page.getByRole("region", { name: "How it was proven" })).toHaveCount(0);
  await expect(page.getByText("Shift+C", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
  // Left out, not judged harmless: it was never proven either way (D-190).
  await expect(page.getByLabel("Why leave it out?")).toBeVisible();
  await page.locator("body").press("Shift+C");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(confirms).toBe(0);

  // A proven one beside it: the verifier's severity, with the finder's next
  // to it where they differ (PG-3, D-185), and each quoted step reachable by
  // the keyboard, so a long line scrolls (review round R7, R8).
  // The card's title, not a severity group's heading, "CRITICAL (6)".
  const title = page.getByRole("heading", { level: 3 }).filter({ hasNotText: /\(\d+\)$/ });
  const openTitle = await title.textContent();
  await page.locator("body").press("G");
  await expect(page.getByText("Finder said CRITICAL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Why is this not a problem?")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeVisible();
  const proof = page.getByRole("region", { name: "How it was proven" });
  await expect(proof.getByRole("group", { name: "Step 1, as quoted" })).toHaveAttribute(
    "tabindex",
    "0",
  );

  // Moving from Confirm onto an open question took the button away, and the
  // focus fell to the page; the finding's title takes it.
  await confirm.focus();
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect(page.getByTestId("not-proven")).toBeVisible();
  await expect(title).toHaveText(openTitle!);
  await expect(title).toBeFocused();

  // Photographed in both themes and at phone width, for the grade, the
  // title holding the focus.
  const evidence = join(
    fileURLToPath(new URL("..", import.meta.url)),
    "review",
    `${new Date().toISOString().slice(0, 10)}-e2e`,
  );
  mkdirSync(evidence, { recursive: true });
  const desktop = page.viewportSize();
  for (const [scheme, name] of [
    ["light", "unproven-light"],
    ["dark", "unproven-dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator("body").screenshot({
      path: join(evidence, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("body").screenshot({
    path: join(evidence, "unproven-phone.png"),
    animations: "disabled",
    caret: "hide",
  });
  if (desktop) await page.setViewportSize(desktop);

  // Verified again: a paid request, so what it costs is said, and nothing is
  // sent, until Send is pressed (WP-D2). Answered here as the server answers
  // a proof that holds; the server's side is unit-tested.
  // The first Send is refused as a sign-in changed since the dialog read it
  // would be; the second is held until released, as a real one is for minutes.
  const sent: unknown[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const stopVerifying = await routeUntilStopped(
    page,
    "**/api/findings/*/verify-again",
    async (route) => {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) {
        await route.fulfill({
          status: 409,
          json: {
            error:
              "This request will cost API usage, billed per token, which this page had not " +
              "said yet. Read the notice, then press again.",
            code: "BillingNotShown",
            cli: { state: "perToken", authMethod: "api_key" },
          },
        });
        return;
      }
      await held;
      provenAgain.add(new URL(route.request().url()).pathname.split("/")[3]!);
      await route.fulfill({ json: { status: "verified" } });
    },
  );
  const verifyButton = page.getByRole("button", { name: "Verify again" });
  const dialog = page.getByRole("group", { name: "Verify again" });
  // Not now sends nothing, and gives the focus back to the button that opened it.
  await verifyButton.click();
  await expect(dialog).toBeFocused();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(verifyButton).toBeFocused();
  await verifyButton.click();
  // Both verifiers, as in a run (WP-E): the second only if the first proves it.
  await expect(dialog).toContainText(
    "This asks claude-fable-5[1m] again in a fresh session and, if it proves the finding, " +
      "claude-opus-5-5 too: up to two requests",
  );
  await expect(dialog).toContainText(/Each can take up to \d+ minutes\./);
  expect(sent).toHaveLength(0);
  // From the top: the dialog taking the focus scrolls the page, and a body
  // capture of a scrolled page draws the fixed top bar out of place.
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const [scheme, name] of [
    ["light", "verify-again-light"],
    ["dark", "verify-again-dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator("body").screenshot({
      path: join(evidence, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, "verify-again-phone.png"), animations: "disabled" });
  if (desktop) await page.setViewportSize(desktop);

  // Refused: the dialog now says it bills per token, and the next Send says so.
  const sendRequest = page.getByRole("button", { name: "Send request" });
  await sendRequest.click();
  await expect(page.getByText(/^This request will cost API usage, billed per token/)).toBeVisible();
  await expect(dialog).toContainText("using your Claude usage, billed per token.");

  // In flight: the finding cannot be dismissed nor the review completed, and
  // the dialog says how long it can take and that leaving stops it.
  await page.getByLabel("Why leave it out?").fill("Asked while it was out.");
  await sendRequest.click();
  await expect(dialog).toContainText("Waiting for the answer.");
  await expect(dialog).toContainText("Leaving this page stops the request.");
  await expect(page.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Complete review" })).toBeDisabled();
  for (const [scheme, name] of [
    ["light", "verify-again-waiting-light"],
    ["dark", "verify-again-waiting-dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("body").screenshot({
      path: join(evidence, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.screenshot({
    path: join(evidence, "verify-again-waiting-phone.png"),
    animations: "disabled",
  });
  if (desktop) await page.setViewportSize(desktop);
  release();

  await expect(page.getByTestId("verified-again")).toHaveText(
    `Proven: ${openTitle!.replace(/\.$/, "")}. It can be confirmed now.`,
  );
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await expect(title).toBeFocused();
  expect(sent).toEqual([
    expect.objectContaining({ costShown: true }),
    expect.objectContaining({ costShown: true, billingShown: "perToken" }),
  ]);
  // From the top: a body capture of a scrolled page draws the fixed top bar
  // across the middle of it.
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const [scheme, name] of [
    ["light", "verified-again-light"],
    ["dark", "verified-again-dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator("body").screenshot({
      path: join(evidence, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  // Centred, clear of the fixed top bar an edge scroll leaves it under.
  await page
    .getByTestId("verified-again")
    .evaluate((notice) => notice.scrollIntoView({ block: "center" }));
  await page.screenshot({
    path: join(evidence, "verified-again-phone.png"),
    animations: "disabled",
  });
  if (desktop) await page.setViewportSize(desktop);
  await stopVerifying();
  await stop();
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
  // Its row says cancelled while the manager still removes its worktrees,
  // and the next test deletes it; waited for so that delete is not refused
  // (review of the D-166 fixes).
  const cancelled = new URL(page.url()).pathname.split("/").pop()!;
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/reviews/${cancelled}`)).json()) as {
            running: boolean;
          }
        ).running,
      { timeout: 60_000 },
    )
    .toBe(false);
});

test("a new review starts on the model used last, while a probe vouches for it", async ({
  page,
}) => {
  // The one used last, else the first a probe vouches for; the picker took
  // the first probed model every time (MVP 7.1). The suite has
  // one probed model fit to review, so a second is marked available in the
  // answer here; creating a review refuses one registered for mechanical
  // work, so such a model is never the one used last.
  const second = "claude-opus-5[1m]";
  const answer = (lastUsed: string) =>
    routeUntilStopped(page, "**/api/models", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        models: { id: string; availability: string }[];
      };
      await route.fulfill({
        response,
        json: {
          ...body,
          models: body.models.map((model) =>
            model.id === second ? { ...model, availability: "available" } : model,
          ),
          lastUsed,
        },
      });
    });
  const chosen = page.locator("label", { has: page.locator('input[name="model"]:checked') });

  for (const [lastUsed, shown] of [
    [second, "Opus 5 (1M context)"],
    ["claude-fable-5[1m]", "Fable 5 (1M context)"],
    // One no longer registered falls back to the first a probe vouches for,
    // in picker order: the recommended families first, Opus 5.5 first as the
    // recommended default (D-184), probed by the journey as the second
    // verifier of its Fable review (WP-E).
    ["claude-gone-4", "Opus 5.5"],
  ] as const) {
    const stop = await answer(lastUsed);
    await fillANewReview(page);
    await expect(chosen).toContainText(shown);
    await stop();
  }
});

test("a project's name and default branch are edited from its page (D-51)", async ({ page }) => {
  // Editable in the data model, with no route or screen for either (MVP 7.1).
  // The fixture's detected default is feature/rename-prefs, also its newest
  // branch, so the test moves it to main: set to itself, nothing was shown
  // to change (review of the 7.1 changes).
  await page.goto("/projects");
  await page.getByRole("link", { name: "app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "app", level: 1, exact: true })).toBeVisible();
  const projectId = page.url().split("/").pop()!;
  const stored = async () =>
    (
      (await (await page.request.get(`/api/projects/${projectId}`)).json()) as {
        project: { name: string; defaultBranch: string };
      }
    ).project;
  const before = (await stored()).defaultBranch;
  expect(before).not.toBe("main");
  const name = page.getByLabel("Name", { exact: true });
  const branch = page.getByLabel("Default branch");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(branch).toBeEnabled({ timeout: 30_000 });
  await expect(branch).toHaveValue(before);

  await name.fill("app, renamed");
  await branch.selectOption("main");
  await save.click();
  await expect(
    page.getByRole("heading", { name: "app, renamed", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("default main")).toBeVisible();
  expect(await stored()).toMatchObject({ name: "app, renamed", defaultBranch: "main" });

  // A rename alone keeps the default, once the branches are read: the
  // select took the newest branch when they arrived, and a save moved the
  // default to it (review of the 7.1 changes).
  await page.reload();
  await expect(page.getByLabel("Default branch")).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByLabel("Default branch")).toHaveValue("main");
  await page.getByLabel("Name", { exact: true }).fill("app, renamed again");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "app, renamed again", level: 1, exact: true }),
  ).toBeVisible();
  expect((await stored()).defaultBranch).toBe("main");

  // A blank name is refused with the server's words, and nothing changes.
  await page.getByLabel("Name", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^name: /)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "app, renamed again", level: 1, exact: true }),
  ).toBeVisible();

  // Put back, for the tests after.
  await page.reload();
  await expect(page.getByLabel("Default branch")).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel("Name", { exact: true }).fill("app");
  await page.getByLabel("Default branch").selectOption(before);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "app", level: 1, exact: true })).toBeVisible();
  expect(await stored()).toMatchObject({ name: "app", defaultBranch: before });
});

test("a project's own tests and e2e are set from its page, off until turned on (WP-I)", async ({
  page,
}) => {
  // D-191, D-192: a review may run the project's tests and grade its e2e
  // screenshots, on a throwaway copy of the branch, only once a person turns
  // it on, told first that it runs the branch's code on this machine.
  await page.goto("/projects");
  await page.getByRole("link", { name: "app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "app", level: 1, exact: true })).toBeVisible();
  const projectId = page.url().split("/").pop()!;
  const off = {
    enabled: false,
    installCommand: null,
    testCommand: null,
    e2eCommand: null,
    screenshotDir: null,
    designStandardPath: null,
  };
  try {
    const card = page.getByRole("heading", { name: "Tests and design" }).locator("..");
    await expect(card).toContainText("Off: a review reads the code and runs none of it.");
    await shootAll(page, card, "project-checks-off");
    const warning = card.getByText(/runs the branch's own code on this machine, as you/);
    await expect(warning).toHaveCount(0);

    await card.getByLabel("Run this project's tests and e2e on each review").check();
    await expect(warning).toBeVisible();
    await card.getByLabel(/^Tests/).fill("npm test");
    await card.getByLabel(/^E2E/).fill("npm run e2e");
    const save = card.getByRole("button", { name: "Save checks" });
    await save.click();
    // Screenshots only from an e2e run with its folder named (D-192), said
    // in the card in its label's words (review round 7).
    await expect(
      card.getByText(
        "Screenshots folder: An e2e command and the folder it saves screenshots to go together.",
      ),
    ).toBeVisible();
    await shootAll(page, card, "project-checks-refused");

    await card.getByLabel("Screenshots folder").fill("review/screens");
    await card.getByLabel("Design standard").fill("docs/04-UI-DESIGN.md");
    await save.click();
    await expect(card).toContainText("On: each review also runs these on a throwaway copy");
    const stored = async () =>
      (
        (await (await page.request.get(`/api/projects/${projectId}/checks`)).json()) as {
          checks: Record<string, unknown>;
        }
      ).checks;
    expect(await stored()).toEqual({
      enabled: true,
      installCommand: null,
      testCommand: "npm test",
      e2eCommand: "npm run e2e",
      screenshotDir: "review/screens",
      designStandardPath: "docs/04-UI-DESIGN.md",
    });

    await page.reload();
    await expect(card.getByLabel("Run this project's tests and e2e on each review")).toBeChecked();
    await expect(card.getByLabel("Screenshots folder")).toHaveValue("review/screens");
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "project-checks");

    // The header too, whose address ran off a phone where a temporary path is
    // long (macOS CI, run 40072390549).
    const desktop = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(
        fileURLToPath(new URL("..", import.meta.url)),
        "review",
        `${new Date().toISOString().slice(0, 10)}-e2e`,
        "project-header-phone.png",
      ),
      animations: "disabled",
    });
    if (desktop) await page.setViewportSize(desktop);
  } finally {
    // Put back whatever happened, or every later review would run npm.
    const reset = await page.request.put(`/api/projects/${projectId}/checks`, { data: off });
    expect.soft(reset.status(), "the checks turned off again").toBe(200);
  }
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

test("a click as the intent box gives up the focus lands where it was aimed", async ({ page }) => {
  // Review round 15, seen in the journey: leaving the intent box asks the
  // pre-flight again, and its card emptied while it did, so a page scrolled
  // to its foot shrank under the pointer and a click on Advanced landed on
  // what slid into its place. The pre-flight asked again is held here, so
  // the page stays as it is while it waits.
  await fillANewReview(page);
  await page
    .getByLabel(/What was this change meant to do/)
    .fill("Rename the prefs field and migrate every consumer.");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopHolding = await answerOnce(page, "**/api/reviews/preflight", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.getByText("Advanced", { exact: true }).click();
    await expect(page.getByText("Working out what this review will examine...")).toBeVisible();
    const fold = page
      .locator("details")
      .filter({ has: page.getByText("Advanced", { exact: true }) });
    await expect(fold).toHaveAttribute("open", "");
    await shootAll(page, page.locator("form"), "preflight-asked-again");
    // Landed before the route is taken away: unrouted while it was still
    // held, the request was handled for it and the held one failed.
    release();
    await expect(page.getByText("What this review will examine", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    release();
    await stopHolding();
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

test("a review that finished with nothing to decide can be completed", async ({ page }) => {
  // Review round 13: a finished run waits on a person even with no findings,
  // and its page offered no Complete review, the queue that holds it being
  // mounted only with findings to decide, so the commonest clean outcome could
  // not be finished; D-224's empty text then called it stopped. The fixture's
  // review always finds something, so its reading is answered as a finished
  // one with nothing on the table.
  const asClean = async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { review: { status: string } };
    await route.fulfill({
      response,
      json: {
        ...body,
        running: false,
        queued: false,
        review: { ...body.review, status: "awaiting_confirmation" },
        findings: [],
        checkFindings: [],
      },
    });
  };
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  // The review's own address: "**/api/reviews/*" is the top bar's attention
  // poll too.
  const reading = `**${await row.getByRole("link").getAttribute("href")}`.replace(
    "/reviews/",
    "/api/reviews/",
  );
  await page.route(reading, asClean);
  try {
    await row.getByRole("link").click();
    await expect(
      page.getByText("No code findings: the review raised none that verification kept."),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("All 0 decided.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete review" })).toBeEnabled();
    await expect(page.getByText("None were reported before the review stopped.")).toHaveCount(0);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, page.getByRole("main"), "review-finished-clean");
  } finally {
    await page.unroute(reading, asClean);
  }
});

test("an older reading of a review landing last does not put back what it said", async ({
  page,
}) => {
  // Audit finding U1: readings of a review were applied as they landed, so
  // an older one landing after a newer one put back a status or a stage the
  // run had left. The page's first reading is answered as a finished review
  // read while it ran, and held until the others have landed.
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  // The review's own address: "**/api/reviews/*" is the top bar's attention
  // poll too.
  const reading = `**${await row.getByRole("link").getAttribute("href")}`.replace(
    "/reviews/",
    "/api/reviews/",
  );
  const stopAnswering = await answerOnce(page, reading, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { running: boolean; review: { status: string } };
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({
      response,
      json: { ...body, running: true, review: { ...body.review, status: "running" } },
    });
  });
  try {
    await row.getByRole("link").click();
    // The review's own header: the list it was opened from says "complete"
    // too, for a moment after the click.
    await page.waitForURL(/\/reviews\/[A-Z0-9]+$/);
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    await page.waitForTimeout(2_500);
    await expect(header.getByText("complete", { exact: true })).toBeVisible();
    await expect(header.getByText("running", { exact: true })).toHaveCount(0);
  } finally {
    await stopAnswering();
  }
});

test("a run that ends before its page's stream listens is still seen to end", async ({ page }) => {
  // Review round 13: the page reads the review, then opens its stream, and a
  // run ending between the two was announced to no stream; the page showed
  // it running until the stream was next opened, up to ten minutes later
  // (D-221). The reading taken before the stream listens is answered as that
  // stale one: a finished review read as running. Not `times: 1`, see
  // answerOnce.
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  // The review's own address: "**/api/reviews/*" is the top bar's attention
  // poll too.
  const reading = `**${await row.getByRole("link").getAttribute("href")}`.replace(
    "/reviews/",
    "/api/reviews/",
  );
  const stopAnswering = await answerOnce(page, reading, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { running: boolean; review: { status: string } };
    await route.fulfill({
      response,
      json: { ...body, running: true, review: { ...body.review, status: "running" } },
    });
  });
  try {
    await row.getByRole("link").click();
    // The review's own header: the list it was opened from says "complete"
    // too, for a moment after the click.
    await page.waitForURL(/\/reviews\/[A-Z0-9]+$/);
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    await expect(header.getByText("complete", { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await stopAnswering();
  }
});

test("an error page for an answer is said, and the button comes back", async ({ page }) => {
  // Audit finding U2: these handlers read the answer as JSON bare, so a
  // proxy's HTML error page threw inside them, nothing was said, and the
  // button went back to idle as if it had worked. Each is answered here with
  // such a page. Import, which a double click sent twice, is also held a
  // moment to see it refuse a second click.
  const gateway = { status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" };

  await test.step("importing a ruleset", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = await answerOnce(page, "**/api/rulesets/import", async (route) => {
      await held;
      await route.fulfill(gateway);
    });
    await page.goto("/rulesets");
    await page.getByLabel("Name").fill("Gateway sweep");
    await page.getByPlaceholder("Paste the markdown protocol here").fill("# Gateway sweep\n");
    let imports = 0;
    const counting = (request: import("@playwright/test").Request) => {
      if (new URL(request.url()).pathname === "/api/rulesets/import") imports += 1;
    };
    page.on("request", counting);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const importing = page.getByRole("button", { name: "Importing..." });
    await expect(importing).toBeDisabled();
    // A second press, Enter in the form, while the first is out: sent once.
    await page.getByLabel("Name").press("Enter");
    release();
    const form = page.getByRole("main").locator("form").first();
    await expect(form.getByText("The document could not be imported.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    expect(imports).toBe(1);
    page.off("request", counting);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, form, "gateway-import");
    await stop();
  });

  await test.step("changing a rule", async () => {
    await page.goto("/rulesets");
    await page.getByRole("main").getByRole("link", { name: "Example protocol" }).first().click();
    const rule = page.getByRole("main").getByRole("checkbox").first();
    await expect(rule).toBeEnabled({ timeout: 30_000 });
    const stop = await answerOnce(page, "**/api/rulesets/*/rules/*", (route) =>
      route.fulfill(gateway),
    );
    const before = await rule.isChecked();
    await rule.click();
    await expect(page.getByText("The rule could not be changed.")).toBeVisible();
    await expect(rule).toBeEnabled();
    expect(await rule.isChecked()).toBe(before);
    await stop();
  });

  await test.step("fetching a project", async () => {
    const stop = await answerOnce(page, "**/api/projects/*/fetch", (route) =>
      route.fulfill(gateway),
    );
    await page.goto("/projects");
    const card = page
      .getByRole("main")
      .locator("li")
      .filter({ has: page.getByRole("link", { name: "app", exact: true }) });
    await card.getByRole("button", { name: "Fetch now" }).click();
    // On the project's own card, naming it, not under the add form.
    await expect(card.getByText("app could not be fetched.")).toBeVisible();
    await expect(page.locator("form").getByText("could not be fetched")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Fetch now" })).toBeEnabled();
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "gateway-fetch");
    await stop();
  });

  await test.step("probing a model", async () => {
    const stop = await answerOnce(page, "**/api/models/*/probe", (route) => route.fulfill(gateway));
    await page.goto("/settings");
    const probe = page.getByRole("button", { name: "Probe", exact: true }).first();
    await expect(probe).toBeEnabled({ timeout: 30_000 });
    await probe.click();
    // Beside the models, not a screen above them at the top of the page.
    const failed = page.getByText("The probe failed.");
    await expect(failed).toBeVisible();
    expect((await failed.boundingBox())!.y).toBeGreaterThan(
      (await page.getByRole("heading", { name: "Models" }).boundingBox())!.y,
    );
    await expect(probe).toBeEnabled();
    await stop();
  });

  await test.step("deleting all data", async () => {
    // Answered by the route alone: were it to reach the server, every later
    // test would find nothing to read.
    let answered = 0;
    const refuse = async (route: import("@playwright/test").Route) => {
      answered += 1;
      await route.fulfill(gateway);
    };
    await page.route("**/api/system/data", refuse);
    try {
      await page.getByRole("button", { name: "Delete all data" }).click();
      await page.getByRole("button", { name: "Yes, delete everything" }).click();
      // In the Danger zone, beside the button pressed.
      const danger = page
        .getByRole("main")
        .locator("div")
        .filter({ has: page.getByRole("heading", { name: "Danger zone" }) })
        .last();
      await expect(danger.getByText("The data could not be deleted.")).toBeVisible();
      expect(answered).toBe(1);
      await expect(page.getByRole("button", { name: "Yes, delete everything" })).toBeEnabled();
      expect(await accessibilityViolations(page)).toEqual([]);
      await shootAll(page, danger, "gateway-settings");
    } finally {
      await page.unroute("**/api/system/data", refuse);
    }
    // Kept, the message goes with the question it answered.
    await page.getByRole("button", { name: "Keep it all" }).click();
    await expect(page.getByText("The data could not be deleted.")).toHaveCount(0);
  });
});

test("a stream frame that is not JSON is read past, and the review read again", async ({
  page,
}) => {
  // Audit finding U5: a frame cut short by a proxy threw inside the page's
  // listener and was lost, with the status change it carried; and one that
  // parsed to null threw at its kind (review round 14). Answered once by the
  // route with one of each; not `times: 1`, see answerOnce.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const reading = `**${await row.getByRole("link").getAttribute("href")}`.replace(
    "/reviews/",
    "/api/reviews/",
  );
  // In the order they were sent: the page reads the review, then opens its
  // stream, so what came after the stream is what the stream caused.
  const sent: { what: "read" | "stream"; at: number }[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") return;
    if (path === reading.slice(2)) sent.push({ what: "read", at: Date.now() });
    if (path === `${reading.slice(2)}/events`) sent.push({ what: "stream", at: Date.now() });
  });
  const stopAnswering = await answerOnce(page, `${reading}/events`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: update\ndata: {"kind":"status","sta\n\nevent: update\ndata: null\n\n',
    }),
  );
  try {
    await row.getByRole("link").click();
    await page.waitForResponse((response) => response.url().endsWith("/events"));
    await page.waitForTimeout(1_000);
    const stream = sent.findIndex((entry) => entry.what === "stream");
    expect(stream, "the stream was opened").toBeGreaterThan(0);
    const streamAt = sent[stream]!.at;
    // Within 800 ms of the stream: one reading as it opened, and one in place
    // of each frame it could not read. A closed stream is opened again after
    // a second at the soonest, and its fallback poll reads after two.
    expect(
      sent.slice(stream + 1).filter((entry) => entry.what === "read" && entry.at <= streamAt + 800)
        .length,
    ).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    await stopAnswering();
  }
});

test("a ruleset chosen as the default is the one a new review starts on", async ({ page }) => {
  // D-225: a ruleset is made the default on its own page, the list says
  // which, and a new review starts on it rather than on the first by name.
  // A copy of the example named to come last is the default here, and the
  // choice is undone after, so the tests after start where they did.
  const listed = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string; name: string }[];
  };
  const example = listed.rulesets.find((ruleset) => ruleset.name === "Example protocol")!;
  const made = await page.request.post(`/api/rulesets/${example.id}/duplicate`, {
    data: { tier: "global", name: "Zz default sweep" },
  });
  expect(made.status()).toBe(201);
  const { rulesetId } = (await made.json()) as { rulesetId: string };
  const projects = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = projects.projects.find((project) => project.name === "app")!;
  let draft: string | undefined;
  try {
    await page.goto(`/rulesets/${rulesetId}`);
    await page.getByRole("button", { name: "Use by default for new reviews" }).click();
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    await expect(header.getByText("default for new reviews")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop using by default" })).toBeVisible();
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, header, "ruleset-default");

    await page.goto("/rulesets");
    const row = page.getByRole("main").locator("li").filter({ hasText: "Zz default sweep" });
    await expect(row.getByText("default", { exact: true })).toBeVisible({ timeout: 30_000 });
    await shootAll(page, row, "rulesets-default-row");

    await page.goto(`/reviews/new?projectId=${app.id}`);
    // The select that offers the copy: "Rules" also names the profile picker.
    const rules = page
      .locator("select")
      .filter({ has: page.locator(`option[value="${rulesetId}"]`) });
    await expect(rules).toHaveValue(rulesetId, { timeout: 30_000 });

    // A draft's Start begins on it too (review round 15): a new review whose
    // start is refused for this test, removed after.
    await fillANewReview(page);
    const stopRefusing = await answerOnce(page, "**/api/reviews/*/start", (route) =>
      route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
    );
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/reviews" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Start review" }).click();
    draft = ((await (await creation).json()) as { review: { id: string } }).review.id;
    await expect(page.getByText("Refused for this test.")).toBeVisible();
    await stopRefusing();
    await page.goto(`/reviews/${draft}`);
    await expect(page.getByLabel("Ruleset to start with")).toHaveValue(rulesetId, {
      timeout: 30_000,
    });
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, header, "draft-start-default");

    // Stopped from its own page, no ruleset is the default.
    await page.goto(`/rulesets/${rulesetId}`);
    await page.getByRole("button", { name: "Stop using by default" }).click();
    await expect(
      page.getByRole("button", { name: "Use by default for new reviews" }),
    ).toBeVisible();
    const after = (await (await page.request.get("/api/rulesets")).json()) as {
      defaultRulesetId: string | null;
    };
    expect(after.defaultRulesetId).toBeNull();
  } finally {
    if (draft) {
      const removed = await page.request.delete(`/api/reviews/${draft}`);
      expect.soft(removed.status(), "the draft removed").toBe(200);
    }
    const cleared = await page.request.put("/api/settings", { data: { defaultRulesetId: null } });
    expect.soft(cleared.status(), "the default cleared").toBe(200);
  }
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

test("an address carrying a token is refused, and the token is never shown back", async ({
  page,
}) => {
  // The app stores no secrets, as the form says: a token in the address was
  // kept in the table, shown on the project's pages and echoed in every git
  // error (audit finding 2, D-208; review round 10).
  await page.goto("/projects");
  const address = page.getByPlaceholder("git@github.com:you/your-app.git");
  const token = "ghp_SECRET0123456789";
  await address.fill(`https://user:${token}@github.com/acme/app.git`);
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(
    page.getByText(
      "This address carries a password or token, which Trysquare would have to store. Add " +
        "https://github.com/acme/app.git instead and let git's credential helper sign in, or " +
        "use the repository's SSH address.",
    ),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(token);
  // Nothing was stored, as the server keeps it, not only as the list shows.
  const stored = (await (await page.request.get("/api/projects")).json()) as {
    projects: { gitUrl: string }[];
  };
  expect(stored.projects.some((project) => project.gitUrl.includes("acme"))).toBe(false);
  // The card, so the refusal under the form is in the picture.
  await shootAll(
    page,
    page.getByRole("main").locator("form").first().locator(".."),
    "project-add-token-refused",
  );

  // A project whose address is long, which ran the list off a phone until
  // its column was bounded; seeded here, as the fixture's own address is
  // long only where the temporary folder is (review round 10).
  const long = `file://${join(E2E_ROOT, "a-repository-whose-address-is-far-too-long-for-any-phone-to-show.git")}`;
  await address.fill(long);
  await page.getByRole("button", { name: "Add project" }).click();
  const row = page.getByRole("main").locator("li").filter({ hasText: "far-too-long" });
  await expect(row.getByText("clone failed")).toBeVisible({ timeout: 60_000 });
  try {
    // Its git error scrolls sideways, so it must take the focus to be read
    // by keyboard (review round 10).
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, page.getByRole("main").locator("ul").first(), "projects-list");
  } finally {
    const listed = (await (await page.request.get("/api/projects")).json()) as {
      projects: { id: string; gitUrl: string }[];
    };
    for (const project of listed.projects.filter((each) => each.gitUrl === long)) {
      const removed = await page.request.delete(`/api/projects/${project.id}`);
      expect.soft(removed.status(), "the long-address project removed").toBe(200);
    }
  }
});

test("a project kept with a token in its address says so, and how to be rid of it", async ({
  page,
}) => {
  // Audit finding R3, D-223: a project added before D-208 refused tokens in
  // an address keeps its token in the database and the clone's settings, and
  // the screens, which no longer show it, said nothing of it. The fixture's
  // address carries none, so the server's answer is made to read as one that
  // does; what the server serves is a unit test. The list reads it as a clone
  // that failed, which left no clone to hold it, and the page as one whose
  // address carries a user name alone (review round 13).
  type Served = {
    name: string;
    gitUrl: string;
    cloneStatus: string;
    storedCredentials?: { kind: string; address: string } | null;
  };
  const kept = (project: Served, inList: boolean): Served =>
    project.name !== "app"
      ? project
      : inList
        ? {
            ...project,
            gitUrl: "https://***@github.com/acme/app.git",
            cloneStatus: "failed",
            storedCredentials: {
              kind: "a password or token",
              address: "https://github.com/acme/app.git",
            },
          }
        : {
            ...project,
            gitUrl: "https://***@github.com/acme/app.git",
            storedCredentials: {
              kind: "a user name or token",
              address: "https://github.com/acme/app.git",
            },
          };
  const asKept = async (route: import("@playwright/test").Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { projects?: Served[]; project?: Served };
    await route.fulfill({
      response,
      json: body.projects
        ? { ...body, projects: body.projects.map((project) => kept(project, true)) }
        : body.project
          ? { ...body, project: kept(body.project, false) }
          : body,
    });
  };
  const one = /\/api\/projects\/[^/?]+$/;
  await page.route("**/api/projects", asKept);
  await page.route(one, asKept);
  try {
    await page.goto("/projects");
    const card = page
      .getByRole("main")
      .locator("li")
      .filter({ has: page.getByRole("link", { name: "app", exact: true }) });
    await expect(
      card.getByText("A password or token is still kept for this address."),
    ).toBeVisible();
    // No clone, so only the database holds it.
    await expect(card).toContainText(
      "it stays on this machine, in Trysquare's database. Delete this project and add " +
        "https://github.com/acme/app.git instead to be rid of it.",
    );
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "project-token-kept-card");

    await card.getByRole("link", { name: "app", exact: true }).click();
    await expect(page.getByRole("heading", { name: "app", level: 1 })).toBeVisible();
    const notice = page
      .getByRole("main")
      .getByText("A user name or token is still kept for this address.");
    await expect(notice).toBeVisible();
    await expect(page.getByRole("main")).toContainText(
      "in Trysquare's database and in the clone's settings.",
    );
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, page.getByRole("main"), "project-token-kept-page");
  } finally {
    await page.unroute("**/api/projects", asKept);
    await page.unroute(one, asKept);
  }
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
    page.getByRole("list", { name: "Activity log" }).getByText(/stalled call was never cancelled/),
  ).toBeVisible({ timeout: 30_000 });
  page.off("request", countStreams);
});

test("a Start refused after the review was made leaves no second draft at the next", async ({
  page,
}) => {
  // Pressed again, Start made another review each time, and the first was
  // left a draft nobody had asked for (review of the D-162 fixes). Started
  // again instead, it ran on the branch tips pinned at the first press, and
  // a draft started or cancelled elsewhere was pressed at for ever (review of
  // the D-163 fixes). So the next press removes the draft it left, if it is
  // still one, and makes the review afresh, pinned to the tips as they are.
  await fillANewReview(page);
  const creates: string[] = [];
  const deletes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === "/api/reviews") creates.push(path);
    if (request.method() === "DELETE") deletes.push(path);
  });
  const stopRefusing = await routeUntilStopped(page, "**/api/reviews/*/start", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
  );
  const made = async () => {
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/reviews" &&
        response.request().method() === "POST",
    );
    await start.click();
    const { review } = (await (await creation).json()) as { review: { id: string } };
    await expect(page.getByText("Refused for this test.")).toBeVisible();
    await expect(start).toBeEnabled();
    return review.id;
  };
  const start = page.getByRole("button", { name: "Start review" });
  const first = await made();
  const second = await made();
  expect(second).not.toBe(first);
  expect(creates).toHaveLength(2);
  expect(deletes).toEqual([`/api/reviews/${first}`]);
  expect((await page.request.get(`/api/reviews/${first}`)).status()).toBe(404);

  // The server judges whether it is still one: here it is not, started or
  // put in line from another tab, so it is left and a review made afresh
  // (review of the D-164 fixes).
  const answerRemoval = (id: string, answer: { status: number; json: object }) =>
    routeUntilStopped(page, `**/api/reviews/${id}?unstarted=1`, (route) =>
      route.request().method() === "DELETE" ? route.fulfill(answer) : route.fallback(),
    );
  const stopLeft = await answerRemoval(second, {
    status: 409,
    json: { error: "No longer a draft.", code: "NotAnUnstartedDraft" },
  });
  const third = await made();
  expect(creates).toHaveLength(3);
  await stopLeft();

  // A removal that fails is said, and no review is made over it.
  const stopFailing = await answerRemoval(third, {
    status: 500,
    json: { error: "Refused for this test: the removal.", code: "Test" },
  });
  await start.click();
  await expect(
    page.getByText("Refused for this test: the removal. Press Start again to try again."),
  ).toBeVisible();
  expect(creates).toHaveLength(3);
  await stopFailing();

  // A dropped request says its reason with no full stop of its own, so one
  // is added before the next sentence (review of the D-165 fixes).
  const stopDropping = await routeUntilStopped(
    page,
    `**/api/reviews/${third}?unstarted=1`,
    (route) => (route.request().method() === "DELETE" ? route.abort("failed") : route.fallback()),
  );
  await start.click();
  await expect(
    page.getByText(/could not be removed: .+\. Press Start again to try again\.$/),
  ).toBeVisible();
  await stopDropping();
  await stopRefusing();
  for (const id of [second, third]) {
    expect((await page.request.delete(`/api/reviews/${id}`)).status()).toBe(200);
  }
});

test("an interactive review's own screen says its commands would cost, before Start", async ({
  page,
}) => {
  // The server asks nothing for an interactive review, which starts no CLI,
  // so only the new-review screen warned of the commands it prints, which run
  // this CLI; a draft's Start or a Resume on its own screen said nothing
  // (review of the D-163 fixes).
  const listed = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const made = await page.request.post("/api/reviews", {
    data: {
      projectId: app.id,
      fromBranch: "feature/rename-prefs",
      intoBranch: "main",
      model: "claude-fable-5[1m]",
      engineMode: "interactive",
    },
  });
  expect(made.status()).toBe(201);
  const { review } = (await made.json()) as { review: { id: string } };
  const notice = page.getByTestId("per-token-notice");

  // Held until the check answers: pressed before, Start went ahead with
  // nothing said (review of the D-165 fixes).
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = await routeUntilStopped(page, "**/api/auth*", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      json: {
        cli: { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "api_key" },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    });
  });
  await page.goto(`/reviews/${review.id}`);
  const draftStart = page.getByRole("button", { name: "Start review" });
  await expect(draftStart).toBeVisible({ timeout: 30_000 });
  // The ruleset is read by then, so Start is off for the check alone.
  await expect(page.getByLabel("Ruleset to start with")).not.toHaveValue("");
  await expect(draftStart).toBeDisabled();
  release();
  await expect(draftStart).toBeEnabled();
  await expect(notice).toContainText(
    "The commands this review prints will cost API usage, billed per token.",
  );
  await stop();

  // On the suite's subscription, once the check has answered, nothing.
  const checked = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth" && response.ok(),
  );
  await page.reload();
  await checked;
  await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
  // Two frames, so the answer has been applied: an absence passes at once
  // (review of the D-164 fixes).
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(notice).toHaveCount(0);
  // The terminal they run in is the person's own, which the check never
  // sees, so that is said on a subscription too (review of D-174's changes).
  await expect(page.getByTestId("terminal-environment-note")).toContainText(
    "These commands run in your own terminal, with its environment",
  );

  // A check that fails is said, not taken as nothing to say (review of the
  // D-164 fixes).
  const stopFailing = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test: the check." } }),
  );
  await page.reload();
  await expect(
    page.getByText(
      "Refused for this test: the check. Whether the commands this review prints would cost API usage is not known.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveCount(0);
  await stopFailing();
  expect((await page.request.delete(`/api/reviews/${review.id}`)).status()).toBe(200);
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

  // Waiting, it offers to leave the line, not to be cancelled: cancelling
  // ended for good a review that never ran (audit finding S6, D-224).
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  // Nor does it say every hunk was accounted for before anything has run.
  await expect(page.getByText("Findings appear once the review has run.")).toBeVisible();
  await expect(page.getByText(/Every hunk was accounted for/)).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
  await shootAll(page, page.getByRole("main"), "review-queued");
  await page.getByRole("button", { name: "Leave the line", exact: true }).click();
  await expect(page.getByText(/Waiting for the running review to finish/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await shootAll(page, page.getByRole("main"), "review-left-line");

  // Both cancelled, the one out of the line first, so neither runs on into
  // the suites after.
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
    "check-findings": "CheckFindingNotFoundError",
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
    "POST findings/[id]/verify-again": { data: { costShown: true } },
    "POST models/[id]/probe": { data: {} },
    "GET projects/[id]": {},
    "DELETE projects/[id]": {},
    "PATCH projects/[id]": { data: { name: "Swept" } },
    "GET projects/[id]/branches": {},
    "GET projects/[id]/checks": {},
    "POST check-findings/[id]/confirm": { data: {} },
    "POST check-findings/[id]/dismiss": { data: { reason: "Asked by the sweep." } },
    "GET check-findings/[id]/screenshot": {},
    "PUT projects/[id]/checks": {
      data: {
        enabled: false,
        installCommand: null,
        testCommand: null,
        e2eCommand: null,
        screenshotDir: null,
        designStandardPath: null,
      },
    },
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
    "POST reviews/[id]/leave-queue": { data: {} },
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
    "PUT rulesets/[id]/default": {},
    "DELETE rulesets/[id]/default": {},
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

/** Settings, once the check it runs as it opens has landed, so a check mocked after is the next. */
async function openSettings(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByTestId("cli-status")).toContainText("fake-claude.mjs", {
    timeout: 30_000,
  });
}

test("Settings keeps the latest check's answer, not the one that lands last", async ({ page }) => {
  // The check a saved path asks could answer before the one Settings asked
  // as it opened, and that older answer, landing last, took the card, the
  // probes' notice and their hold with it (review of the D-165 fixes).
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  let staleSent = false;
  const stop = await routeUntilStopped(page, "**/api/auth*", async (route) => {
    asked += 1;
    if (asked === 1) {
      await held;
      await route.fulfill({
        status: 200,
        json: { cli: { state: "cannotRun", path: "/old/claude", message: "no answer in time." } },
      });
      staleSent = true;
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        cli: { state: "perToken", path: "/new/claude", version: "2.1.301", authMethod: "api_key" },
      },
    });
  });
  await page.goto("/settings");
  const path = page.getByLabel("CLI path");
  await expect(path).toHaveValue("", { timeout: 30_000 });
  await path.fill("/new/claude");
  await path.blur();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const notice = page.getByTestId("per-token-notice");
  await expect(notice).toContainText("A probe will cost API usage");
  release();
  // Until the older answer has been sent, the checks after would pass on
  // the newer one still showing (review of the D-166 fixes).
  await expect.poll(() => staleSent).toBe(true);
  // The older answer, landed now, changes nothing.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(notice).toContainText("A probe will cost API usage");
  await expect(page.getByTestId("cli-status")).toContainText("/new/claude");
  await stop();
  await path.fill("");
  await path.blur();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
});

test("Settings holds its probes and its check until the check it asks as it opens lands", async ({
  page,
}) => {
  // A probe pressed before that answer spent with no notice, and a check
  // pressed meanwhile could be overwritten by the older answer landing last
  // (review of the D-163 fixes).
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = await answerOnce(page, "**/api/auth*", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  const check = page.getByRole("button", { name: "Checking..." });
  const probeAll = page.getByRole("button", { name: "Probe all" });
  const probes = page.getByRole("button", { name: "Probe", exact: true });
  // The models read first, so a probe is off for the check, not for an empty
  // list, which also turns Probe all off (review of the D-164 fixes).
  await expect(probes.first()).toBeVisible({ timeout: 30_000 });
  expect(await probes.count()).toBeGreaterThan(0);
  for (const probe of await probes.all()) {
    await expect(probe).toBeDisabled();
  }
  await expect(probeAll).toBeDisabled();
  await expect(check).toBeDisabled();
  release();
  await expect(page.getByTestId("cli-status")).toContainText("fake-claude.mjs", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Check the CLI" })).toBeEnabled();
  await expect(probeAll).toBeEnabled();
  await stop();
});

test("Settings says as it opens that probes would cost API usage, above the models", async ({
  page,
}) => {
  // A probe is a real call, and under a sign-in billing per token it costs
  // API usage, which Settings said only once Check the CLI was pressed
  // (review of D-161). The check is free, so it runs as Settings opens.
  const stop = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        cli: { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "api_key" },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    }),
  );
  await page.goto("/settings");
  const notice = page.getByTestId("per-token-notice");
  await expect(notice).toContainText("A probe will cost API usage, billed per token.");
  await expect(notice).toContainText("so a probe draws on paid API usage");
  await expect(page.getByTestId("cli-status")).toContainText("Signed in (api_key)");
  const models = page.getByRole("heading", { name: "Models", level: 2 });
  expect(
    await notice.evaluate(
      (shown, heading) =>
        (shown.compareDocumentPosition(heading as Node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      await models.elementHandle(),
    ),
  ).toBe(true);
  await stop();

  // The suite's fake draws on a subscription, which says nothing of cost.
  await openSettings(page);
  await expect(notice).toHaveCount(0);
});

test("the CLI's check says each way it cannot run a review, and a check that failed", async ({
  page,
}) => {
  await openSettings(page);
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
      "Signed in (api_key) some other way than your Claude subscription: reviews will cost API usage, billed per token.",
    ],
    [
      // No method named: how it bills is not claimed (review of the D-153 fixes).
      { state: "maybePerToken", path: "/opt/claude", version: "2.1.301" },
      "the CLI did not say how: unless it is your Claude subscription, reviews may cost API usage, billed per token.",
    ],
    [
      // Nor for a token with no source named, which may be a subscription's
      // (review of D-161).
      {
        state: "maybePerToken",
        path: "/opt/claude",
        version: "2.1.301",
        authMethod: "oauth_token",
      },
      "Signed in with a token (oauth_token): one made by claude setup-token draws on your Claude subscription, and any other may cost API usage, billed per token.",
    ],
    [
      { state: "maybePerToken", path: "/opt/claude", version: "2.1.301", authMethod: "newer" },
      "Signed in (newer), a way this app does not know: unless it is your Claude subscription, reviews may cost API usage, billed per token.",
    ],
    [
      { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "third_party" },
      "Signed in (third_party) some other way than your Claude subscription: reviews will cost API usage, billed per token.",
    ],
    [
      { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "third_party" },
      "This is another provider set by a managed Claude Code policy, which wins over a sign-in and over this app: whoever manages Claude Code for you can remove it.",
    ],
  ];
  for (const [cli, said] of answers) {
    const stop = await answerOnce(page, "**/api/auth*", (route) =>
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
  const stopNoPath = await answerOnce(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: { cli: { state: "cannotRun", message: "the guard refused it." } },
    }),
  );
  await check.click();
  await expect(status).toContainText("the guard refused it.");
  await expect(page.getByTestId("cli-path")).toHaveCount(0);
  await stopNoPath();
  const stop = await answerOnce(page, "**/api/auth*", (route) =>
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
  await expect(page.getByRole("button", { name: "Check the CLI" })).toBeEnabled({
    timeout: 30_000,
  });
  // A path saved is checked again, so the card and the probes' notice speak
  // of the CLI a probe now uses (review of the D-164 fixes).
  const rechecked = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/auth",
    { timeout: 10_000 },
  );
  await path.fill("  /opt/claude/bin/claude  ");
  await path.blur();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await rechecked;
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
  const signedOut = {
    status: 409,
    json: {
      error:
        "The Claude Code CLI at /opt/claude is not signed in, so the review cannot run. Sign it in from a terminal, in this project's directory, with the command below, then start the review again.",
      code: "CliNotReady",
      signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
    },
  };
  const stop = await routeUntilStopped(page, "**/api/reviews", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill(signedOut);
  });
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText(/is not signed in, so the review cannot run/)).toBeVisible();
  // On a line of its own, so it is copied without the sentence after it
  // (review of D-161).
  await expect(page.getByTestId("sign-in-command")).toHaveText("npm run claude -- auth login");
  await expect(page).toHaveURL(/\/reviews\/new/);
  await stop();

  // And a draft's own Start, refused the same way: the real server makes the
  // review, and its first start is refused for this test, leaving a draft.
  const stopFirstStart = await answerOnce(page, "**/api/reviews/*/start", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
  );
  const creation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reviews" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start review" }).click();
  const { review } = (await (await creation).json()) as { review: { id: string } };
  await expect(page.getByText("Refused for this test.")).toBeVisible();
  await stopFirstStart();
  const stopStarts = await routeUntilStopped(page, "**/api/reviews/*/start", (route) =>
    route.fulfill(signedOut),
  );
  await page.goto(`/reviews/${review.id}`);
  const draftStart = page.getByRole("button", { name: "Start review" });
  await expect(draftStart).toBeVisible({ timeout: 30_000 });
  await draftStart.click();
  await expect(page.getByText(/is not signed in, so the review cannot run/)).toBeVisible();
  await expect(page.getByTestId("sign-in-command")).toHaveText("npm run claude -- auth login");
  await stopStarts();
  expect((await page.request.delete(`/api/reviews/${review.id}`)).status()).toBe(200);
});

test("a signed-out CLI's check shows the command that signs it in", async ({ page }) => {
  // Shown for the person to run, never run by the app (MVP 6.3, D-159).
  await openSettings(page);
  const stop = await answerOnce(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        cli: {
          state: "signedOut",
          path: "/opt/claude",
          version: "2.1.301",
          configDirectory: "/home/someone/.claude",
        },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    }),
  );
  await page.getByRole("button", { name: "Check the CLI" }).click();
  await expect(page.getByTestId("cli-status")).toContainText(
    "Sign it in from a terminal, in this project's directory, then check again:",
  );
  await expect(page.getByTestId("sign-in-command")).toHaveText("npm run claude -- auth login");
  // Where the sign-in lives, which a terminal set up otherwise would miss
  // (review of the 6.2 and 6.3 changes).
  await expect(page.getByTestId("cli-status")).toContainText(
    "The sign-in this check read is kept in /home/someone/.claude.",
  );
  await stop();

  // With no command in the answer, no instruction pointing at nothing.
  const stopBare = await answerOnce(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: { cli: { state: "signedOut", path: "/opt/claude", version: "2.1.301" } },
    }),
  );
  await page.getByRole("button", { name: "Check the CLI" }).click();
  await expect(page.getByTestId("cli-status")).toContainText("Not signed in.");
  await expect(page.getByTestId("cli-status")).not.toContainText("Sign it in");
  await stopBare();
});

test("the new-review screen asks the CLI once, for both engines", async ({ page }) => {
  // An interactive review's commands read no settings, as a headless review
  // reads none (D-174), so one answer is each engine's: the screen asked a
  // second time, for the person's user settings, which D-174 retired.
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/auth") asked.push(url.search);
  });
  const checked = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth",
  );
  await fillANewReview(page);
  await checked;
  await page.getByText("Advanced", { exact: true }).click();
  // That answer cannot speak for the terminal an interactive review's
  // commands run in, so that is said of them whatever it was (review of
  // D-174's changes).
  const terminal = page.getByTestId("terminal-environment-note");
  await expect(terminal).toHaveCount(0);
  await page.getByTestId("engine-mode").selectOption("interactive");
  await expect(terminal).toContainText(
    "These commands run in your own terminal, with its environment, which this app cannot see",
  );
  // Its second verifier's command names the paired model, so it is listed
  // here as for a headless review (D-185, review round 3).
  const examined = page.getByText("What this review will examine", { exact: true }).locator("..");
  await expect(examined.getByText("Second verifier", { exact: true })).toBeVisible();
  const evidence = join(
    fileURLToPath(new URL("..", import.meta.url)),
    "review",
    `${new Date().toISOString().slice(0, 10)}-e2e`,
  );
  mkdirSync(evidence, { recursive: true });
  const desktop = page.viewportSize();
  for (const [scheme, name] of [
    ["light", "mode-b-preflight-light"],
    ["dark", "mode-b-preflight-dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await examined.screenshot({ path: join(evidence, `${name}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await examined.screenshot({
    path: join(evidence, "mode-b-preflight-phone.png"),
    animations: "disabled",
  });
  if (desktop) await page.setViewportSize(desktop);
  await page.getByTestId("engine-mode").selectOption("headless");
  await expect(terminal).toHaveCount(0);
  expect(asked).toEqual([""]);
});

test("a sign-in that bills per token is said before Start, strictly, and Start stays on", async ({
  page,
}) => {
  // Reviews draw on the subscription by default; a CLI signed in with a key
  // is told before Start that a review costs API usage (D-161). The suite's
  // own fake is signed in through a subscription, which shows no notice:
  // read once the check has answered, which "none yet" would also pass
  // before (review of D-161).
  const checked = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth" && response.ok(),
  );
  await fillANewReview(page);
  await checked;
  await expect(page.getByTestId("per-token-notice")).toHaveCount(0);

  const stop = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        cli: { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "api_key" },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    }),
  );
  await fillANewReview(page);
  const notice = page.getByTestId("per-token-notice");
  await expect(notice).toContainText("This review will cost API usage, billed per token.");
  await expect(notice).toContainText("(api_key)");
  await expect(notice).toContainText("npm run claude -- auth login");
  await expect(page.getByRole("button", { name: "Start review" })).toBeEnabled();
  // An interactive review prints commands that run this same CLI in the
  // person's own terminal, so it is said of them, not hidden (review of the
  // D-162 fixes).
  await page.getByText("Advanced", { exact: true }).click();
  await page.getByTestId("engine-mode").selectOption("interactive");
  await expect(notice).toContainText(
    "The commands this review prints will cost API usage, billed per token.",
  );
  await expect(notice).toContainText("so each one draws on paid API usage");
  // Said once, beside it, as on a subscription.
  await expect(notice).not.toContainText("your own terminal");
  await expect(page.getByTestId("terminal-environment-note")).toBeVisible();
  await page.getByTestId("engine-mode").selectOption("headless");
  await expect(notice).toContainText("This review will cost API usage, billed per token.");
  await stop();

  // A token whose source the CLI does not name may be a subscription's, so
  // the notice says it may cost, not that it will (review of D-161).
  const stopToken = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        cli: {
          state: "maybePerToken",
          path: "/opt/claude",
          version: "2.1.301",
          authMethod: "oauth_token",
        },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    }),
  );
  await fillANewReview(page);
  await expect(notice).toContainText("This review may cost API usage, billed per token.");
  await expect(notice).toContainText("(oauth_token)");
  await expect(notice).toContainText("claude setup-token");
  // As hedged as Settings and the run note (review of the D-162 fixes).
  await expect(notice).toContainText("and any other may cost API usage.");
  await expect(notice).not.toContainText("will cost");
  // A token set for the CLI wins over a sign-in, so none is offered.
  await expect(notice).not.toContainText("auth login");
  await stopToken();

  // So do an apiKeyHelper and another provider, so the setting is named
  // instead (review of the D-162 fixes). With no settings read and the
  // provider variables kept from the CLI, only a managed policy sets them
  // (D-174).
  for (const [authMethod, setting] of [
    ["api_key_helper", "an apiKeyHelper"],
    ["third_party", "another provider"],
  ] as const) {
    const stopSetting = await routeUntilStopped(page, "**/api/auth*", (route) =>
      route.fulfill({
        status: 200,
        json: {
          cli: { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod },
          signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
        },
      }),
    );
    await fillANewReview(page);
    await expect(notice).toContainText(`(${authMethod})`);
    // The check asks as every review reads, so a setting it names applies
    // and is said to (D-170, D-174).
    await expect(notice).toContainText("This review will cost API usage, billed per token.");
    await expect(notice).toContainText(
      `This is ${setting} set by a managed Claude Code policy, which wins over a sign-in and over this app: whoever manages Claude Code for you can remove it.`,
    );
    await expect(notice).not.toContainText("auth login");
    await page.getByText("Advanced", { exact: true }).click();
    await page.getByTestId("engine-mode").selectOption("interactive");
    await expect(notice).toContainText(
      "The commands this review prints will cost API usage, billed per token.",
    );
    await expect(notice).toContainText(
      `This is ${setting} set by a managed Claude Code policy, which wins over a sign-in and over this app: whoever manages Claude Code for you can remove it.`,
    );
    await stopSetting();
  }
});

test("a managed policy is said on Settings and before a review starts, and none is not", async ({
  page,
}) => {
  // A policy outranks every flag the app passes, `--setting-sources ""`
  // included, so it is warned of rather than overridden (D-174 item 3).
  const found = String.raw`C:\Program Files\ClaudeCode\managed-settings.json`;
  const unchecked = String.raw`HKCU\SOFTWARE\Policies\ClaudeCode\Settings: reg.exe did not answer in time`;
  const stopAuth = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        cli: { state: "subscription", path: "/opt/claude", version: "2.1.301" },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
        managedPolicy: { found: [found], unchecked: [unchecked] },
      },
    }),
  );
  const notice = page.getByTestId("managed-policy-notice");
  const notLooked = page.getByTestId("managed-policy-unchecked");

  await page.goto("/settings");
  await expect(notice).toContainText("A managed Claude Code policy is set on this machine.");
  await expect(notice).toContainText(found);
  // Settings alone says where it could not look, in one block with it.
  await expect(notLooked).toContainText(unchecked);
  await expect(page.getByTestId("managed-policy")).toContainText(unchecked);

  await fillANewReview(page);
  await expect(notice).toContainText("It outranks what this app sets");
  await expect(notice).toContainText(found);
  await expect(notLooked).toHaveCount(0);

  // A draft, from the real server, whose first start is refused for this test.
  const stopFirst = await answerOnce(page, "**/api/reviews/*/start", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
  );
  const creation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reviews" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start review" }).click();
  const { review } = (await (await creation).json()) as { review: { id: string } };
  await expect(page.getByText("Refused for this test.")).toBeVisible();
  await stopFirst();

  // A headless draft's own screen, whose Start asks nothing of the CLI first.
  await page.goto(`/reviews/${review.id}`);
  await expect(page.getByRole("button", { name: "Start review" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(notice).toContainText(found);
  await stopAuth();

  // A check that fails is said there too, not taken as no policy (review of
  // D-174's changes).
  const stopFailing = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test: the check." } }),
  );
  await page.reload();
  await expect(
    page.getByText(
      "Refused for this test: the check. Whether this review would run under a managed Claude Code policy is not known.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await stopFailing();

  // The real route: what it says is what is drawn, nothing for nothing,
  // whatever this machine holds. Two frames, so the answer has been applied:
  // an absence passes at once (review of the D-164 fixes).
  const frames = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const realAnswer = async () => {
    const answered = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth" && response.ok(),
    );
    return ((await (await answered).json()) as { managedPolicy: { found: string[] } })
      .managedPolicy;
  };
  let real = realAnswer();
  await page.reload();
  const onReview = await real;
  await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
  await frames();
  await expect(notice).toHaveCount(onReview.found.length > 0 ? 1 : 0);
  expect((await page.request.delete(`/api/reviews/${review.id}`)).status()).toBe(200);

  // Settings draws no spaced, empty block where there is nothing to say.
  real = realAnswer();
  await page.goto("/settings");
  const onSettings = (await real) as { found: string[]; unchecked: string[] };
  await frames();
  await expect(page.getByTestId("managed-policy")).toHaveCount(
    onSettings.found.length + onSettings.unchecked.length > 0 ? 1 : 0,
  );
});

test("a billing notice follows the last answer, not the first", async ({ page }) => {
  // Kept once shown, it stood beside a refusal for a CLI signed out since,
  // whose own sign-in line it contradicted (review of the D-162 fixes).
  const signedOut = {
    status: 409,
    json: {
      error:
        "The Claude Code CLI at /opt/claude is not signed in, so the review cannot run. Sign it in from a terminal, in this project's directory, with the command below, then start the review again.",
      code: "CliNotReady",
      signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
    },
  };
  const stopAuth = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        cli: { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "api_key" },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    }),
  );
  await fillANewReview(page);
  const notice = page.getByTestId("per-token-notice");
  await expect(notice).toContainText("This review will cost API usage");
  const refuseCreate = async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill(signedOut);
  };
  await page.route("**/api/reviews", refuseCreate);
  const start = page.getByRole("button", { name: "Start review" });
  await start.click();
  await expect(page.getByTestId("sign-in-command")).toBeVisible();
  await expect(notice).toHaveCount(0);
  await page.unroute("**/api/reviews", refuseCreate);

  // A draft, from the real server, whose first start is refused for this test.
  await fillANewReview(page);
  const stopFirst = await answerOnce(page, "**/api/reviews/*/start", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
  );
  const creation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reviews" && response.request().method() === "POST",
  );
  await start.click();
  const { review } = (await (await creation).json()) as { review: { id: string } };
  await expect(page.getByText("Refused for this test.")).toBeVisible();
  await stopFirst();
  await stopAuth();

  let pressed = 0;
  const stopStarts = await routeUntilStopped(page, "**/api/reviews/*/start", async (route) => {
    pressed += 1;
    // The fourth goes to the real server, whose fake draws on a subscription.
    if (pressed === 4) return route.fallback();
    await route.fulfill(
      pressed !== 2
        ? {
            status: 409,
            json: {
              error:
                "This review will cost API usage, billed per token, which this page had not said yet. Read the notice, then press again.",
              code: "BillingNotShown",
              cli: {
                state: "perToken",
                path: "/opt/claude",
                version: "2.1.301",
                authMethod: "api_key",
              },
              signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
            },
          }
        : signedOut,
    );
  });
  await page.goto(`/reviews/${review.id}`);
  const draftStart = page.getByRole("button", { name: "Start review" });
  await expect(draftStart).toBeVisible({ timeout: 30_000 });
  await draftStart.click();
  await expect(notice).toContainText("This review will cost API usage");
  await draftStart.click();
  await expect(page.getByTestId("sign-in-command")).toBeVisible();
  await expect(notice).toHaveCount(0);
  // Said again, then a start that goes ahead: the notice was for that start,
  // and the next is asked afresh (7a8aba8).
  await draftStart.click();
  await expect(notice).toContainText("This review will cost API usage");
  await draftStart.click();
  await expect(draftStart).toHaveCount(0, { timeout: 30_000 });
  await stopStarts();
  // Let the run end before it is removed: its row, and the manager, which
  // refuses a delete while it still holds the run, its row already saying
  // it ended (review of the D-165 fixes).
  await expect
    .poll(
      async () => {
        const read = (await (await page.request.get(`/api/reviews/${review.id}`)).json()) as {
          review: { status: string };
          running: boolean;
        };
        return read.running ? "held" : read.review.status;
      },
      { timeout: 60_000 },
    )
    .not.toMatch(/^(held|draft|running|verifying)$/);
  // Read once the run has ended and the screen has settled on it.
  await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect((await page.request.delete(`/api/reviews/${review.id}`)).status()).toBe(200);
});

test("a sign-in billing per token that a page had not shown is refused, shown, then sent", async ({
  page,
}) => {
  // A check that failed showed no notice, and Start went ahead; a Resume or a
  // draft's Start showed none at all (review of D-161). The server refuses
  // either, and the page shows what it was told and says it showed it next.
  const stopAuth = await routeUntilStopped(page, "**/api/auth*", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test: the check." } }),
  );
  await fillANewReview(page);
  const notice = page.getByTestId("per-token-notice");
  await expect(notice).toHaveCount(0);

  const creates: unknown[] = [];
  let refuseCreate = true;
  const answerCreate = async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    creates.push(route.request().postDataJSON());
    if (!refuseCreate) return route.fallback();
    refuseCreate = false;
    await route.fulfill({
      status: 409,
      json: {
        error:
          "This review will cost API usage, billed per token, which this page had not said yet. Read the notice, then press again.",
        code: "BillingNotShown",
        cli: { state: "perToken", path: "/opt/claude", version: "2.1.301", authMethod: "api_key" },
        signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
      },
    });
  };
  await page.route("**/api/reviews", answerCreate);
  const start = page.getByRole("button", { name: "Start review" });
  await start.click();
  await expect(notice).toContainText("This review will cost API usage, billed per token.");
  await expect(page.getByText("which this page had not said")).toBeVisible();
  expect(creates[0]).not.toHaveProperty("billingShown");

  // Said now, so the next Start says it was: the real server makes the
  // review, and its start is refused for this test, leaving a draft.
  const stopStart = await answerOnce(page, "**/api/reviews/*/start", (route) =>
    route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
  );
  const creation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reviews" && response.request().method() === "POST",
  );
  await start.click();
  const { review } = (await (await creation).json()) as { review: { id: string } };
  expect(creates[1]).toMatchObject({ billingShown: "perToken" });
  await expect(page.getByText("Refused for this test.")).toBeVisible();
  await stopStart();
  await page.unroute("**/api/reviews", answerCreate);
  await stopAuth();

  // The draft's own Start, on a page with no notice until refused.
  const starts: unknown[] = [];
  const stopStarts = await routeUntilStopped(page, "**/api/reviews/*/start", async (route) => {
    starts.push(route.request().postDataJSON());
    await route.fulfill(
      starts.length === 1
        ? {
            status: 409,
            json: {
              error:
                "This review may cost API usage, billed per token, which this page had not said yet. Read the notice, then press again.",
              code: "BillingNotShown",
              cli: {
                state: "maybePerToken",
                path: "/opt/claude",
                version: "2.1.301",
                authMethod: "oauth_token",
              },
              signIn: { command: "npm run claude -- auth login", place: "projectDirectory" },
            },
          }
        : { status: 500, json: { error: "Refused for this test, again.", code: "Test" } },
    );
  });
  await page.goto(`/reviews/${review.id}`);
  const draftStart = page.getByRole("button", { name: "Start review" });
  await expect(draftStart).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveCount(0);
  await draftStart.click();
  await expect(notice).toContainText("This review may cost API usage, billed per token.");
  await expect(notice).toContainText("claude setup-token");
  expect(starts[0]).not.toHaveProperty("billingShown");
  await draftStart.click();
  await expect(page.getByText("Refused for this test, again.")).toBeVisible();
  expect(starts[1]).toMatchObject({ billingShown: "maybePerToken" });
  await stopStarts();
  // Not left for the suites after this to find.
  expect((await page.request.delete(`/api/reviews/${review.id}`)).status()).toBe(200);
});
