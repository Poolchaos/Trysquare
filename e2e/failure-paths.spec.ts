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
import { expect, test, type Locator, type Response, type Route } from "@playwright/test";
import { answerOnce, routeUntilStopped } from "./answer-once";
import { sidewaysOverflow } from "./overflow";
import { accessibilityViolations } from "./axe";
import { runTimeWords } from "@/lib/review/run-time";
import {
  ANSWERS_DIR,
  APP_REPO,
  COUNTER_FILE,
  E2E_ROOT,
  GIT_CONFIG,
  LIMIT_TRIGGER,
  MY_EMAIL,
  PROTOCOL_PATH,
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

  await page.getByTestId("ruleset-picker").getByRole("link").first().focus();
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

test("the pre-flight says what its token figure is the size of", async ({ page }) => {
  // The card said "Estimated tokens" beside "Model requests", and the figure
  // is the rules and the change as one prompt, where a review sends five
  // requests or more (the seventeenth grade, AE3).
  let size = 0;
  const stopReading = await routeUntilStopped(page, "**/api/reviews/preflight", async (route) => {
    const response = await route.fetch();
    size = ((await response.json()) as { estimatedTokens: number }).estimatedTokens;
    await route.fulfill({ response });
  });
  await fillANewReview(page);
  const examined = page.getByText("What this review will examine", { exact: true }).locator("..");
  const figure = examined
    .getByText("Rules and change", { exact: true })
    .locator("..")
    .locator("dd");
  expect(size).toBeGreaterThan(0);
  await expect(figure).toHaveText(`about ${size.toLocaleString("en-US")} tokens`);
  await expect(examined.getByText("Estimated tokens")).toHaveCount(0);
  await stopReading();

  const evidence = join(
    fileURLToPath(new URL("..", import.meta.url)),
    "review",
    `${new Date().toISOString().slice(0, 10)}-e2e`,
  );
  mkdirSync(evidence, { recursive: true });
  const whole = (cell: Locator) =>
    cell.evaluate((element) => element.scrollWidth <= element.clientWidth);
  const desktop = page.viewportSize();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await examined.screenshot({
      path: join(evidence, `preflight-prompt-size-${scheme}.png`),
      animations: "disabled",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await whole(figure)).toBe(true);
  await examined.screenshot({
    path: join(evidence, "preflight-prompt-size-phone.png"),
    animations: "disabled",
  });

  // The widest figure the chosen model's window takes whole: past four
  // fifths of it the work is split (`budgetFor`), which changes the counts
  // beside it. The route's own answer with that size, so the rest of the
  // card is as the server gives it.
  const window = 1_000_000;
  const largest = Math.floor(window * 0.8) - 1;
  await expect(
    page
      .getByTestId("model-picker")
      .locator("li")
      .filter({ has: page.getByRole("radio", { checked: true }) }),
  ).toContainText(`${window.toLocaleString("en-US")} token window`);
  const stopStaging = await routeUntilStopped(page, "**/api/reviews/preflight", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({ response, json: { ...body, estimatedTokens: largest } });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(figure).toHaveText("about 799,999 tokens", { timeout: 60_000 });
  expect(await whole(figure)).toBe(true);
  const sideways = await sidewaysOverflow(page);
  expect(sideways.by, sideways.culprits.join("\n")).toBeLessThanOrEqual(0);
  await examined.screenshot({
    path: join(evidence, "preflight-prompt-size-largest-phone.png"),
    animations: "disabled",
  });
  if (desktop) await page.setViewportSize(desktop);
  await stopStaging();
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
    // Said of the rules a file is sent, not of every rule: `decomposed`
    // leaves pairs out, and the step is the same words on every profile.
    await expect(steps.locator('[aria-current="step"]')).toContainText(
      "Each change goes to the model with the rules sent for its file",
    );
    await expect(steps.getByRole("listitem").nth(0)).toContainText(/Done.*rules frozen/);
    await expect(steps.getByRole("listitem").nth(1)).toContainText(/Done.*files given to read/);
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
      ["discarded by the quotation check", "0"],
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
      ["discarded by the quotation check", "0"],
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
/** The space, in pixels, between the bottom of one element and the top of the one under it. */
async function gapBetween(above: Locator, below: Locator): Promise<number> {
  const upper = (await above.boundingBox())!;
  const lower = (await below.boundingBox())!;
  return lower.y - (upper.y + upper.height);
}

/**
 * The window left and come back to, as when a ruleset is changed in another
 * tab. Sent by hand: Playwright keeps every page focused, so opening a
 * second one takes the focus from none.
 */
async function comeBack(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
}

async function shootAll(
  page: import("@playwright/test").Page,
  region: Locator,
  name: string,
  /** The last element of the picture, when it is of several one under another. */
  through?: Locator,
): Promise<void> {
  const evidence = join(
    fileURLToPath(new URL("..", import.meta.url)),
    "review",
    `${new Date().toISOString().slice(0, 10)}-e2e`,
  );
  mkdirSync(evidence, { recursive: true });
  const shoot = async (file: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const first = await region.boundingBox();
    const last = through ? await through.boundingBox() : first;
    if (!first || !last) throw new Error(`${name} has no box to photograph.`);
    const left = Math.min(first.x, last.x);
    const right = Math.max(first.x + first.width, last.x + last.width);
    await page.screenshot({
      path: join(evidence, `${file}.png`),
      fullPage: true,
      clip: { x: left, y: first.y, width: right - left, height: last.y + last.height - first.y },
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

test("a review that stopped short shows what the project's checks found", async ({ page }) => {
  // The seventeenth grade, AE15: a failing command is recorded before any
  // stage and the lists count it, and a paused, failed or cancelled
  // review's page drew none of it and said "No findings". The first model
  // call here meets a usage limit, after the checks ran; the review is then
  // cancelled. The count is put back after, as the test above does.
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
  let cancelled = false;
  try {
    const on = await page.request.put(`/api/projects/${app.id}/checks`, {
      data: checks(`"${process.execPath}" "${failing}"`),
    });
    expect(on.status()).toBe(200);
    armLimit();
    await startAReview(page);
    reviewId = page.url().split("/").pop()!;
    await expect(page.getByText("paused limit")).toBeVisible({ timeout: 60_000 });

    const section = page.getByRole("region", { name: "Tests and design" });
    await expect(section).toContainText("The tests fail on this branch.");
    await expect(section.getByRole("group", { name: "Where it failed" })).toContainText(
      "2 failing: totals, refunds",
    );
    await expect(section).toContainText(
      "What the project's own checks found on this branch. You decide it with the code " +
        "findings once the review has run to its end. A resume keeps this result. The " +
        "checks run again only if the project's checks were changed since, and with " +
        "the checks switched off since, the result is dropped.",
    );
    // Read, not decided: nothing here to press.
    await expect(section.getByRole("button")).toHaveCount(0);
    const none = page.getByText("No code findings", { exact: true }).locator("..");
    await expect(none).toContainText(
      "None were reported before the review stopped. What the project's own checks found " +
        "is above.",
    );
    // What the reviews list counts for it is what the page shows.
    const listed = (await (await page.request.get("/api/reviews")).json()) as {
      reviews: { id: string; findings: { total: number } }[];
    };
    expect(listed.reviews.find((review) => review.id === reviewId)!.findings.total).toBe(1);
    await expect(section.getByRole("listitem")).toHaveCount(1);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, section, "checks-stopped");
    await shootAll(page, none, "no-code-findings-stopped");

    const stopped = await page.request.post(`/api/reviews/${reviewId}/cancel`, { data: {} });
    expect(stopped.status()).toBe(200);
    cancelled = true;
    await page.reload();
    await expect(section).toContainText(
      "What the project's own checks found on this branch before the review was cancelled. " +
        "A cancelled review is not decided and has no report.",
      { timeout: 30_000 },
    );
    await expect(section.getByRole("listitem")).toHaveCount(1);
    await expect(section.getByRole("button")).toHaveCount(0);
    await shootAll(page, section, "checks-cancelled");
  } finally {
    rmSync(LIMIT_TRIGGER, { force: true });
    const off = await page.request.put(`/api/projects/${app.id}/checks`, { data: checks(null) });
    expect.soft(off.status(), "the checks turned off again").toBe(200);
    if (reviewId !== "" && !cancelled) {
      const ended = await page.request.post(`/api/reviews/${reviewId}/cancel`, { data: {} });
      expect.soft(ended.status(), "the review cancelled").toBe(200);
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

  // The dashboard meanwhile (the seventeenth grade, AE1): it drew the pause
  // as a live scan, its clock counting on. The bar says Paused, the review
  // is listed as paused, and nothing is drawn as live.
  const pausedAt = page.url();
  let answers = 0;
  const counted = (response: Response) => {
    if (response.url().endsWith("/api/reviews/attention")) answers += 1;
  };
  page.on("response", counted);
  await page.goto("/");
  const dashboard = page.getByRole("main");
  await expect(page.getByRole("banner").getByText("Paused", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("paused limit").first()).toBeVisible();
  // The bar and the dashboard each ask what is in flight. Both have been
  // answered by the fourth answer, and an absence read before that would
  // hold on a page that had not yet been told of the pause.
  await expect.poll(() => answers, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  page.off("response", counted);
  expect(await dashboard.getByText("Live scan", { exact: true }).count()).toBe(0);
  expect(await dashboard.getByText(/elapsed/).count()).toBe(0);
  // Nor is it said to have found nothing: it has not run to its findings
  // (AE16). Projects said "no findings" beside the pause.
  const project = dashboard
    .locator("li")
    .filter({ has: page.getByRole("link", { name: "app", exact: true }) });
  await expect(project).toContainText("paused limit");
  expect(await project.getByText("no findings").count()).toBe(0);
  // Needs you lists it (D-259): it goes on only when a person presses
  // Resume, and the widget said nothing was waiting on them.
  const paused = dashboard
    .getByRole("list", { name: "Needs you" })
    .locator(`a[href="${new URL(pausedAt).pathname}"]`);
  await expect(paused).toContainText("paused at the usage limit: Resume once it clears");
  await expect(paused).toContainText(/waiting (under a minute|\d+[mhd])/);
  expect(await dashboard.getByText("Nothing is waiting on you.").count()).toBe(0);
  await shootAll(page, dashboard, "dashboard-paused-at-limit");
  await page.goto(pausedAt);
  await expect(page.getByText("paused limit")).toBeVisible({ timeout: 30_000 });

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

  // Run detail's Stages (the seventeenth grade, AE2). The stage that met the
  // limit was asked twice, and its line said "2 attempts" beside the second
  // request's time alone. It says two requests, and the time of both.
  const id = page.url().split("/").pop()!;
  const read = (await (await page.request.get(`/api/reviews/${id}`)).json()) as {
    stages: { stage: string; startedAt: string; endedAt: string }[];
  };
  const perStage = new Map<string, typeof read.stages>();
  for (const row of read.stages) {
    perStage.set(row.stage, [...(perStage.get(row.stage) ?? []), row]);
  }
  const askedTwice = [...perStage.values()].filter((rows) => rows.length === 2);
  expect(askedTwice).toHaveLength(1);
  const [first, second] = askedTwice[0]!.map(
    (row) => Date.parse(row.endedAt) - Date.parse(row.startedAt),
  );
  expect(first).toBeGreaterThan(0);
  const both = first! + second!;
  await page.getByText("Run detail", { exact: true }).click();
  const stages = page.getByRole("heading", { name: "Stages" }).locator("..");
  const line = stages.getByRole("listitem").filter({ hasText: "2 requests" });
  await expect(line).toHaveCount(1);
  await expect(
    line.getByText(both < 1000 ? `${both}ms` : `${(both / 1000).toFixed(1)}s`, { exact: true }),
  ).toBeVisible();
  expect(await stages.getByText(/attempts/).count()).toBe(0);

  // A run note says its day as well as its time (the seventeenth grade,
  // AE24): this review ran, paused and ran again, and one resumed on a later
  // day keeps the notes of both. Worded as the reader's own browser words it.
  const notes = page.getByRole("heading", { name: "What this run recorded" }).locator("..");
  const stamp = notes.locator("time").first();
  const at = await stamp.getAttribute("datetime");
  expect(Number.isNaN(Date.parse(at!))).toBe(false);
  const worded = await page.evaluate(
    (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }),
    at!,
  );
  expect(worded).toContain(String(new Date(at!).getFullYear()));
  await expect(stamp).toHaveText(worded);
  await shootAll(page, notes, "run-notes-dated");
  await shootAll(page, stages, "stages-two-requests");

  // The run's time beside totals that sum both runs (the seventeenth grade,
  // AE6). The first run asked once before the limit, so the cost is both
  // runs' and the time the second's: each screen says whose time it is.
  const listed = (await (await page.request.get("/api/reviews")).json()) as {
    reviews: {
      id: string;
      model: string;
      ranBefore: boolean;
      startedAt: string;
      runEndedAt: string;
    }[];
  };
  const resumed = listed.reviews.find((review) => review.id === id)!;
  expect(resumed.ranBefore).toBe(true);
  const took = runTimeWords(Date.parse(resumed.runEndedAt) - Date.parse(resumed.startedAt));
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(header.getByText(`last run took ${took}`, { exact: true })).toBeVisible();
  const tile = page.getByText("Last run", { exact: true }).locator("..");
  await expect(tile).toContainText(took);
  expect(await page.getByText("Duration", { exact: true }).count()).toBe(0);
  await shootAll(page, header, "last-run-header");
  // Both tiles: the cost of every run beside the time of the last.
  await shootAll(page, tile.locator(".."), "last-run-tiles");

  await page.goto("/reviews");
  const inList = page
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href="/reviews/${id}"]`) });
  await expect(inList.getByText(`last run ${took}`, { exact: true })).toBeVisible();
  // Counted as the queue holds them, the killed out of the total (D-253): this
  // review read "0 of 10 confirmed" here beside "0 of 9 decided" on its page.
  const detail = (await (await page.request.get(`/api/reviews/${id}`)).json()) as {
    findings: { status: string }[];
  };
  const queued = detail.findings.filter((finding) => finding.status !== "killed").length;
  expect(queued).toBeLessThan(detail.findings.length);
  await expect(inList.getByText(`0 of ${queued} confirmed`, { exact: true })).toBeVisible();
  await shootAll(page, inList, "last-run-list");

  await page.goto("/");
  const inRecent = page.getByRole("row").filter({ has: page.locator(`a[href="/reviews/${id}"]`) });
  await expect(inRecent.getByText(`last run ${took}`, { exact: true })).toBeVisible();
  await shootAll(page, inRecent, "last-run-recent");
  // On a phone the table scrolls sideways inside its card, and the row's own
  // shot stops at the card's edge, short of the time. Photographed again
  // with the time scrolled into view, the card whole.
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await inRecent.getByText(`last run ${took}`, { exact: true }).scrollIntoViewIfNeeded();
  await page
    .getByRole("table")
    .locator("..")
    .screenshot({
      path: join(
        fileURLToPath(new URL("..", import.meta.url)),
        "review",
        `${new Date().toISOString().slice(0, 10)}-e2e`,
        "last-run-recent-phone.png",
      ),
      animations: "disabled",
    });
  // Every status in the table on one line: "AWAITING YOUR DECISION" broke
  // over three at this width, in a table that scrolls sideways (D-258).
  const badges = page.getByRole("table").locator("tbody td:last-child span");
  const heights = await badges.evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent,
      height: Math.round(node.getBoundingClientRect().height),
    })),
  );
  expect(heights.map((badge) => badge.text)).toContain("awaiting your decision");
  // One line of 11px type with its padding and border is under 30px; two are over.
  expect(heights.filter((badge) => badge.height > 30)).toEqual([]);
  if (desktop) await page.setViewportSize(desktop);
  // At desk width the table fits its card, the badge whole, and the model id
  // is never broken: kept on one line, the badge took the room the model's
  // column had, and the id broke at its hyphens over three lines.
  const card = page.getByRole("table").locator("..");
  expect(await card.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  // The pair is whole there too. Its column is the one that gives, and with
  // the author's column beside it "into main" was cut to "int" (D-297).
  const pair = inRecent.getByText("feature/rename-prefs into main", { exact: true }).first();
  expect(await pair.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
  const model = inRecent.getByText(resumed.model, { exact: true });
  expect(await model.evaluate((node) => node.getClientRects().length)).toBe(1);
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

test("Rule yield says when it lists some of the rules cited and not all", async ({ page }) => {
  // The seventeenth grade, AE24: the card lists eight, the worst yield
  // first, and said nothing of the rest. The journey's review cites more
  // rules than that, so the card is read against the scoreboard's own
  // answer.
  type Yield = { ruleCode: string; rulesetName: string | null; confirmed: number; total: number };
  const board = (await (await page.request.get("/api/scoreboard")).json()) as {
    ruleYield: Yield[];
  };
  expect(board.ruleYield.length, "more rules cited than the card lists").toBeGreaterThan(8);
  await page.goto("/");
  const card = page.getByRole("heading", { name: "Rule yield" }).locator("..");
  const rows = card.getByRole("listitem");
  await expect(rows).toHaveCount(8);
  // Exact: "Rule 1" is also the start of "Rule 11".
  for (const [row, listed] of [
    [rows.first(), board.ruleYield[0]!],
    [rows.last(), board.ruleYield[7]!],
  ] as const) {
    await expect(row.getByText(`Rule ${listed.ruleCode}`, { exact: true })).toBeVisible();
    // With the ruleset the rule is in: a number names a rule in one ruleset
    // only (the eighteenth grade, AF3).
    expect(listed.rulesetName).not.toBeNull();
    await expect(row.getByText(`in ${listed.rulesetName}`, { exact: true })).toBeVisible();
    await expect(
      row.getByText(`${listed.confirmed}/${listed.total}`, { exact: true }),
    ).toBeVisible();
  }
  await expect(card.getByTestId("rules-not-listed")).toHaveText(
    `The 8 confirmed least often, of ${board.ruleYield.length} rules cited.`,
  );
  await shootAll(page, card, "rule-yield-some");

  // With every rule listed there is no such line: answered with its first
  // eight, as a machine whose findings cite eight rules would be. The card
  // alone is read, the page's other figures not being that machine's.
  const stop = await routeUntilStopped(page, "**/api/scoreboard", async (route) => {
    const response = await route.fetch();
    const answered = (await response.json()) as { ruleYield: Yield[] };
    await route.fulfill({
      response,
      json: { ...answered, ruleYield: answered.ruleYield.slice(0, 8) },
    });
  });
  await page.reload();
  await expect(rows).toHaveCount(8);
  expect(await card.getByTestId("rules-not-listed").count()).toBe(0);
  await stop();
});

test("a cost is named for what it is, a cost equivalent", async ({ page }) => {
  // The seventeenth grade, AE5: the figure is what the CLI says the usage
  // would cost at API prices, and on a subscription nothing is spent. The
  // dashboard called it "Total spend" and a review's page "$ cost"; the
  // report and the records call it the cost equivalent, and so do these.
  const board = (await (await page.request.get("/api/scoreboard")).json()) as {
    spendUsd: number;
    recent: { id: string; costUsd: number }[];
  };
  await page.goto("/");
  const tile = page.getByText("Cost equivalent", { exact: true }).first().locator("..");
  await expect(tile).toContainText(`$${board.spendUsd.toFixed(2)}`);
  expect(await page.getByText(/spend/i).count()).toBe(0);
  await shootAll(page, tile, "cost-equivalent-dashboard");
  const head = page.getByRole("table").getByRole("row").first();
  await expect(head.getByRole("columnheader", { name: "Cost equivalent" })).toBeVisible();
  expect(await head.getByRole("columnheader", { name: "Cost", exact: true }).count()).toBe(0);
  await shootAll(page, head, "cost-equivalent-recent");

  const costed = board.recent.find((row) => row.costUsd > 0)!;
  await page.goto(`/reviews/${costed.id}`);
  const onReview = page.getByText("Cost equivalent", { exact: true }).first().locator("..");
  await expect(onReview).toContainText(`$${costed.costUsd.toFixed(2)}`);
  expect(await page.getByText("$ cost", { exact: true }).count()).toBe(0);
  await shootAll(page, onReview.locator(".."), "cost-equivalent-review");
});

test("a quiet dashboard keeps its times and its waiting list current", async ({ page }) => {
  // Audit finding U3: the clock behind "waiting 4m" ticked only while a
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
    // A wait is a span, not a moment: "waiting 2m", never "waiting 2m ago" (D-258).
    const waiting = page.getByText(/^waiting (under a minute|\d+[mhd])$/).first();
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
    // The region that says it is there, empty, before anything fails, and
    // is marked: the same node says it after (review round 17).
    const region = page.getByTestId("scoreboard-status");
    await expect(region).toHaveText("");
    await region.evaluate((node) => node.setAttribute("data-marked", "before"));
    const again = boards;
    failNext = true;
    awaiting += 1;
    await page.clock.fastForward("00:05");
    await expect.poll(() => boards).toBeGreaterThan(again);
    // Said while the old figures stand (review round 16), and gone once a
    // read lands.
    const stale = region.getByText(/What is shown is the last reading/);
    await expect(stale).toBeVisible();
    await expect(region).toHaveAttribute("role", "status");
    await expect(region).toHaveAttribute("data-marked", "before");
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
    await expect(page.getByText("Cost equivalent").first()).toBeVisible({ timeout: 30_000 });
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
  // The page's Activity log is the second feed (review round 16): it slides
  // on the third stream, once one of its rows is marked.
  let releaseLog = () => {};
  const markedInLog = new Promise<void>((resolve) => {
    releaseLog = resolve;
  });
  // Any stream after those is held until the test ends: answered, each
  // repeated its line, and a row could appear twice before it was counted.
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
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
    if (streams === 2) {
      await marked;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: line(126) });
      return;
    }
    if (streams === 3) {
      await markedInLog;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: line(127) });
      return;
    }
    await finished;
    await route.abort().catch(() => undefined);
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

    // The page's own feed, its last forty, the same way.
    await page.keyboard.press("Escape");
    await expect(theater).toHaveCount(0);
    const log = page.getByRole("list", { name: "Activity log" });
    const hundred = log.locator("li").filter({ hasText: "row 100" });
    await expect(hundred).toHaveCount(1);
    await hundred.evaluate((element) => element.setAttribute("data-marked", "log"));
    releaseLog();
    await expect(log.locator("li").filter({ hasText: "row 127" })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(log.locator('li[data-marked="log"]')).toContainText("row 100");
  } finally {
    release();
    releaseLog();
    finish();
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

test("the dashboard counts a run's stage and the reviews as the other screens do", async ({
  page,
}) => {
  // The Live scan said "stage 4 of 10" where the review's page says "of up
  // to 10", a run asking fewer when nothing is graded; and the tile counted
  // every review as "started", a draft never started among them (the
  // seventeenth grade, AE19 and AE17). A draft is made here, and removed.
  const projects = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = projects.projects.find((project) => project.name === "app")!;
  const made = await page.request.post("/api/reviews", {
    data: {
      projectId: app.id,
      fromBranch: "feature/rename-prefs",
      intoBranch: "main",
      model: "claude-fable-5[1m]",
    },
  });
  expect(made.status()).toBe(201);
  const draft = ((await made.json()) as { review: { id: string } }).review;
  const stop = await routeUntilStopped(page, "**/api/reviews/attention", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as object;
    await route.fulfill({
      response,
      json: {
        ...body,
        active: {
          id: "COUNTED",
          status: "running",
          projectName: "app",
          fromBranch: "feature/rename-prefs",
          intoBranch: "main",
          currentStage: "s3_adversarial",
          startedAt: new Date().toISOString(),
          costEquivalentUsd: 0,
        },
      },
    });
  });
  try {
    await page.goto("/");
    const card = page
      .getByRole("main")
      .locator('a[href="/reviews/COUNTED"]')
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')][1]");
    await expect(card.getByText("Adversarial · stage 4 of up to 10", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await shootAll(page, card, "live-scan-stage-count");

    const board = (await (await page.request.get("/api/scoreboard")).json()) as {
      reviewsTotal: number;
      reviewsCompleted: number;
    };
    // The draft is one, never started, and not completed.
    expect(board.reviewsTotal).toBeGreaterThan(board.reviewsCompleted);
    const tile = page
      .getByRole("main")
      .getByText("Reviews completed", { exact: true })
      .locator("..");
    await expect(tile).toContainText(`${board.reviewsTotal} in all`);
    expect(await tile.getByText(/started/).count()).toBe(0);
    await shootAll(page, tile, "reviews-completed-tile");
  } finally {
    await stop();
    const removed = await page.request.delete(`/api/reviews/${draft.id}`);
    expect.soft(removed.status(), "the draft removed").toBe(200);
  }
});

test("a review resumed into the line no longer says how its last run ended", async ({ page }) => {
  // Review round 16: after a watched run ended, a Resume that put the review
  // in the line left the ending said beside a badge saying queued. A
  // finished review is read as running, then as failed, then, once Resume
  // is pressed, as waiting in the line; the start itself is answered here.
  await page.goto("/reviews");
  const row = page.getByRole("main").locator("ul > li").filter({ hasText: "complete" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const href = (await row.getByRole("link").getAttribute("href"))!;
  const reading = `**${href.replace("/reviews/", "/api/reviews/")}`;
  let phase: "running" | "failed" | "queued" = "running";
  const stopReading = await routeUntilStopped(page, reading, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { review: object };
    await route.fulfill({
      response,
      json: {
        ...body,
        running: phase === "running",
        queued: phase === "queued",
        review: { ...body.review, status: phase === "running" ? "running" : "failed" },
      },
    });
  });
  const stopStarting = await routeUntilStopped(page, `${reading}/start`, (route) =>
    route.fulfill({ status: 200, json: { status: "queued" } }),
  );
  // Its stream refused, so the page polls every two seconds and reads the
  // run end; the queued reading is the first the watch Resume opens makes.
  // The real stream of a review not running stays open and says nothing,
  // so nothing would read the staged changes.
  const stopStreaming = await routeUntilStopped(page, `${reading}/events`, (route) =>
    route.abort(),
  );
  try {
    await row.getByRole("link").click();
    const theater = page.getByRole("dialog", { name: /^Watching the review of/ });
    await expect(theater).toBeVisible({ timeout: 30_000 });
    phase = "failed";
    const said = page.getByTestId("run-ending");
    await expect(said).toHaveText("The run is over: it failed.", { timeout: 30_000 });
    phase = "queued";
    await page.getByRole("button", { name: "Resume" }).click();
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    await expect(header.getByText("queued", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(said).toHaveText("");
  } finally {
    await stopStreaming();
    await stopStarting();
    await stopReading();
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
    const stageLine = theater.getByText(/threat model/).first();
    await expect(stageLine).toBeVisible();
    expect(await theater.getByText(/s7b/).count()).toBe(0);
    // The theater's line, which 8b202dc changed, photographed too (review
    // round 17).
    await shootAll(page, stageLine.locator(".."), "unknown-stage-theater");
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
  // Only a proven finding can be confirmed: an open question can only be
  // dismissed (PG-2 (a), D-185). Its review is one the usage-limit test
  // before this one leaves awaiting decisions: a review of its own would
  // use up scripted answers the later tests read by count. Its verified
  // criticals are shown as open questions, so with none decided yet, the
  // queue, worst first, opens on one; its warnings stay verified, each as if
  // its finder had called it critical. Shown as the server keeps one the
  // second verifier did not prove: the first proof, and no second. Left with
  // its second proof, the page counted it proven by both and open at once.
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
              : {
                  ...finding,
                  status: "open_question",
                  verificationNote: "Could not be settled.",
                  secondProofJson: null,
                },
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
    "Not proven, so it cannot be confirmed as a finding.",
  );
  await expect(page.getByText("Verification: Could not be settled.")).toBeVisible();
  // The summary's figures divide what was raised: none is counted twice.
  const summary = page.getByRole("region", { name: "How the review went" });
  const figure = async (label: string) => {
    const term = summary.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) });
    return Number(await term.locator("..").getByRole("definition").first().textContent());
  };
  const raised = await figure("Raised");
  const provenByBoth = await figure("Proven by both");
  const open = await figure("Open question");
  expect(open).toBeGreaterThan(1);
  expect(provenByBoth).toBeGreaterThan(0);
  expect(provenByBoth + open).toBeLessThanOrEqual(raised);
  await expect(summary.getByRole("listitem").nth(3)).toContainText(
    `${provenByBoth} proven by both verifiers, ${open} open questions,`,
  );
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
    // From the top: a body capture draws the sticky top bar where the page
    // is scrolled to, and g g had left it across the middle of the queue.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("body").screenshot({
      path: join(evidence, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
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
      "claude-opus-5-5 too: two requests at most, and one more for either if its answer " +
      "comes back in the wrong shape, using your Claude usage",
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

test("a finding killed on verifying again is said for the kill it was", async ({ page }) => {
  // The seventeenth grade, AE12: the notice said "Its proof did not hold" of
  // every kill. There are two. The verifier refutes the finding, with a
  // reason and no proof; or it gives a proof and the quotation check fails
  // it, which is no refutation. A review of its own, answered by the fake
  // and not staged: its verifier leaves two findings open, then answers one
  // press each way. The answers are written past those setup wrote, then
  // taken away, the count put back, as the grading test does.
  const callsBefore = readFileSync(COUNTER_FILE, "utf8");
  const written = readdirSync(ANSWERS_DIR).filter((file) => /^\d{3}\.json$/.test(file)).length;
  const numbered = (n: number) => join(ANSWERS_DIR, `${String(n).padStart(3, "0")}.json`);
  const perRun = written / 2;
  expect(perRun, "a run's answers as setup writes them").toBe(6);
  const [s1, s2, s3, s4, s5, s5b] = Array.from({ length: perRun }, (_, index) =>
    readFileSync(numbered(index + 1), "utf8"),
  );
  type Step = { path: string; lineStart: number; lineEnd: number; quote: string };
  type Verdict = { ref: string; verdict: string; evidence?: Step[] };
  const first = JSON.parse(s5!) as { verdicts: Verdict[] };
  const [refuted, discarded] = first.verdicts.filter((verdict) => verdict.verdict === "verified");
  expect(discarded?.evidence?.[0], "two findings the first verifier proves").toBeDefined();
  const leftOpen = new Set([refuted!.ref, discarded!.ref]);
  const REASON = "A caller checks the value before this line runs.";
  const answers = [
    s1,
    s2,
    s3,
    s4,
    JSON.stringify({
      verdicts: first.verdicts.map((verdict) =>
        leftOpen.has(verdict.ref)
          ? { ref: verdict.ref, verdict: "open_question", note: "Could not be settled." }
          : verdict,
      ),
    }),
    // The second verifier is asked only about what the first proved.
    JSON.stringify({
      verdicts: (JSON.parse(s5b!) as { verdicts: Verdict[] }).verdicts.filter(
        (verdict) => !leftOpen.has(verdict.ref),
      ),
    }),
    JSON.stringify({ verdicts: [{ ref: refuted!.ref, verdict: "killed", note: REASON }] }),
    JSON.stringify({
      verdicts: [
        {
          ...discarded!,
          evidence: [{ ...discarded!.evidence![0]!, quote: "const somethingThatIsNotThere = 1;" }],
        },
      ],
    }),
  ];
  const extra = answers.map((_, index) => numbered(written + 1 + index));
  answers.forEach((answer, index) => writeFileSync(extra[index]!, answer!));
  writeFileSync(COUNTER_FILE, String(written), "utf8");

  let reviewId = "";
  try {
    await startAReview(page);
    reviewId = page.url().split("/").pop()!;
    await expect(page.getByText("awaiting your decision")).toBeVisible({ timeout: 120_000 });
    type Row = {
      id: string;
      status: string;
      killedBy: string | null;
      filePath: string;
      lineStart: number;
      issue: string;
      verificationNote: string | null;
    };
    const rows = async () =>
      ((await (await page.request.get(`/api/reviews/${reviewId}`)).json()) as { findings: Row[] })
        .findings;
    const open = (await rows()).filter((row) => row.status === "open_question");
    expect(open).toHaveLength(2);
    // Each answer names its finding by where it is, so each press is on that one.
    const at = (verdict: Verdict) => {
      const [, path, line] = /^<<candidate:(.+):(\d+)>>$/.exec(verdict.ref)!;
      return open.find((row) => row.filePath === path && String(row.lineStart) === line)!;
    };
    const queue = page.getByRole("navigation", { name: "Findings" });
    const notice = page.getByTestId("verified-again");
    const verifyAgain = async (row: Row) => {
      await queue.getByRole("button").filter({ hasText: row.issue }).click();
      await expect(page.getByTestId("not-proven")).toBeVisible();
      await page.getByRole("button", { name: "Verify again" }).click();
      await page.getByRole("button", { name: "Send request" }).click();
    };
    const listed = "under Refuted in verification, in Run detail";

    const refutedRow = at(refuted!);
    await verifyAgain(refutedRow);
    await expect(notice).toHaveText(
      `Refuted by the verifier: ${refutedRow.issue.replace(/\.$/, "")}. It has left the queue, ` +
        `and the verifier's reason is ${listed}.`,
      { timeout: 60_000 },
    );
    await expect(queue.getByRole("button").filter({ hasText: refutedRow.issue })).toHaveCount(0);
    await shootAll(page, notice, "verified-again-refuted");

    const discardedRow = at(discarded!);
    await verifyAgain(discardedRow);
    await expect(notice).toHaveText(
      `Discarded by the quotation check: ${discardedRow.issue.replace(/\.$/, "")}. The verifier ` +
        "gave a proof that did not pass the check, so the finding has left the queue. What " +
        `the check found is ${listed}.`,
      { timeout: 60_000 },
    );
    await expect(queue.getByRole("button").filter({ hasText: discardedRow.issue })).toHaveCount(0);
    await shootAll(page, notice, "verified-again-discarded");

    // Where the notice sends the reader, each is listed with its reason, and
    // the server kept which kill each was.
    const after = await rows();
    const kept = (row: Row) => after.find((candidate) => candidate.id === row.id)!;
    expect(kept(refutedRow)).toMatchObject({
      status: "killed",
      killedBy: "verification",
      verificationNote: REASON,
    });
    expect(kept(discardedRow)).toMatchObject({ status: "killed", killedBy: "quote_check" });
    await page.getByText("Run detail", { exact: true }).click();
    const refutedCard = page
      .getByRole("heading", { name: "Refuted in verification" })
      .locator("..");
    await expect(
      refutedCard.getByRole("listitem").filter({ hasText: refutedRow.issue }),
    ).toContainText(REASON);
    await expect(
      refutedCard.getByRole("listitem").filter({ hasText: discardedRow.issue }),
    ).toContainText(kept(discardedRow).verificationNote!);
    await expect(
      page.getByText(
        `Verified again: ${discardedRow.filePath}:${discardedRow.lineStart} ${discardedRow.issue} ` +
          "is now killed, its proof failing the quotation check.",
      ),
    ).toBeVisible();
  } finally {
    if (reviewId !== "") {
      const deleted = await page.request.delete(`/api/reviews/${reviewId}`);
      expect.soft(deleted.status(), "the review deleted").toBe(200);
    }
    for (const file of extra) rmSync(file, { force: true });
    writeFileSync(COUNTER_FILE, callsBefore, "utf8");
  }
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
    ["/settings", "**/api/settings", (on) => on.getByLabel("Timeout per call (minutes)")],
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
  // list is not an empty one: "No rulesets yet" and "Start a ruleset
  // first" would be untrue then (D-137).
  // Each named by its read, and keyed by it (D-138).
  await expect(page.getByText("Rulesets: Refused for this test: the rulesets.")).toBeVisible();
  await expect(page.getByText("Models: Refused for this test: the models.")).toBeVisible();
  await expect(page.getByText(/No rulesets yet|Start a ruleset first/)).toHaveCount(0);
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
  // one with nothing on the table: no finding, so no hunk that rests on a
  // refuted one either. Left with the fixture's count, the page said none were
  // raised beside a hunk accounted for only by findings verification refuted.
  const asClean = async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    type Spent = {
      inputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      outputTokens: number;
      costEquivalentUsd: number;
    };
    const body = (await response.json()) as {
      review: {
        status: string;
        completedAt: string | null;
        usageInputTokens: number;
        usageCacheCreationTokens: number;
        usageCacheReadTokens: number;
        usageOutputTokens: number;
        costEquivalentUsd: number;
      };
      stages: ({ stage: string } & Spent)[];
      coverage: { refutedOnlyHunks: number; refutedOnlySweepHits: number };
    };
    // With nothing raised, verification asks nothing: its requests go, with
    // what they spent, and a review still waiting has no completion time.
    const proving = body.stages.filter((row) => row.stage.startsWith("s5"));
    const spent = (key: keyof Spent) => proving.reduce((sum, row) => sum + row[key], 0);
    await route.fulfill({
      response,
      json: {
        ...body,
        running: false,
        queued: false,
        review: {
          ...body.review,
          status: "awaiting_confirmation",
          completedAt: null,
          usageInputTokens: body.review.usageInputTokens - spent("inputTokens"),
          usageCacheCreationTokens:
            body.review.usageCacheCreationTokens - spent("cacheCreationTokens"),
          usageCacheReadTokens: body.review.usageCacheReadTokens - spent("cacheReadTokens"),
          usageOutputTokens: body.review.usageOutputTokens - spent("outputTokens"),
          costEquivalentUsd: body.review.costEquivalentUsd - spent("costEquivalentUsd"),
        },
        stages: body.stages.filter((row) => !row.stage.startsWith("s5")),
        findings: [],
        checkFindings: [],
        coverage: { ...body.coverage, refutedOnlyHunks: 0, refutedOnlySweepHits: 0 },
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
    await expect(
      page.getByText("Everything the change touched ended with a finding or an explicit clear."),
    ).toBeVisible();
    await expect(page.getByText("verification refuted")).toHaveCount(0);
    const proving = page
      .getByRole("region", { name: "How the review went" })
      .getByRole("listitem")
      .nth(3);
    await expect(proving).toContainText("Nothing to prove.");
    await expect(proving).toContainText("no requests");
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
    // The form opens on a template (RT-1b); a document is the second way.
    await page.getByRole("radio", { name: "A document", exact: true }).check();
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
      await page.getByRole("button", { name: "Delete projects, reviews and rulesets" }).click();
      await page.getByRole("button", { name: "Yes, delete them" }).click();
      // In the Danger zone, beside the button pressed.
      const danger = page
        .getByRole("main")
        .locator("div")
        .filter({ has: page.getByRole("heading", { name: "Danger zone" }) })
        .last();
      await expect(danger.getByText("The data could not be deleted.")).toBeVisible();
      expect(answered).toBe(1);
      await expect(page.getByRole("button", { name: "Yes, delete them" })).toBeEnabled();
      expect(await accessibilityViolations(page)).toEqual([]);
      await shootAll(page, danger, "gateway-settings");
    } finally {
      await page.unroute("**/api/system/data", refuse);
    }
    // Kept, the message goes with the question it answered.
    await page.getByRole("button", { name: "Keep them" }).click();
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
    // The copy is ticked, and nothing else is.
    const picker = page.getByTestId("ruleset-picker");
    await expect(picker.getByRole("checkbox", { name: /^Zz default sweep v\d+$/ })).toBeChecked({
      timeout: 30_000,
    });
    await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(1);

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
    const draftRules = page.getByTestId("ruleset-picker");
    await expect(draftRules.getByRole("checkbox", { name: /^Zz default sweep v\d+$/ })).toBeChecked(
      { timeout: 30_000 },
    );
    await expect(draftRules.getByRole("checkbox", { checked: true })).toHaveCount(1);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(
      page,
      draftRules.locator("xpath=ancestor::div[@role='group']/.."),
      "draft-start-default",
    );

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

test("a ruleset with nothing switched on is refused before Start, in the run's words", async ({
  page,
}) => {
  // The pre-flight sized every rule, one switched off too, so a ruleset with
  // none on showed a card of counts beside a Start the run then refused (the
  // seventeenth grade, AE4). The copy the test above left is switched off
  // rule by rule and put back after; made here when that test has not run.
  const listed = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string; name: string }[];
  };
  let rulesetId = listed.rulesets.find((ruleset) => ruleset.name === "Zz default sweep")?.id;
  if (rulesetId === undefined) {
    const example = listed.rulesets.find((ruleset) => ruleset.name === "Example protocol")!;
    const made = await page.request.post(`/api/rulesets/${example.id}/duplicate`, {
      data: { tier: "global", name: "Zz default sweep" },
    });
    expect(made.status()).toBe(201);
    rulesetId = ((await made.json()) as { rulesetId: string }).rulesetId;
  }
  const detail = (await (await page.request.get(`/api/rulesets/${rulesetId}`)).json()) as {
    rules: { code: string; enabled: boolean }[];
  };
  const wereOn = detail.rules.filter((rule) => rule.enabled).map((rule) => rule.code);
  expect(wereOn.length).toBeGreaterThan(0);
  const switchAll = async (enabled: boolean) => {
    for (const code of wereOn) {
      const patched = await page.request.patch(
        `/api/rulesets/${rulesetId}/rules/${encodeURIComponent(code)}`,
        { data: { enabled } },
      );
      expect.soft(patched.status(), `rule ${code} switched ${enabled ? "on" : "off"}`).toBe(200);
    }
  };
  await switchAll(false);
  try {
    await fillANewReview(page);
    // The copy alone: the one ticked on arrival is unticked first.
    const picker = page.getByTestId("ruleset-picker");
    await picker.getByRole("checkbox", { checked: true }).uncheck();
    await picker.getByRole("checkbox", { name: /^Zz default sweep v\d+$/ }).check();
    await expect(picker.locator("li").filter({ hasText: "Zz default sweep" })).toContainText(
      /0 of \d+ rules on/,
    );
    const refusal = page.getByText(
      'Ruleset "Zz default sweep" has no enabled rules, so a review using it would check ' +
        "nothing and report a clean result for the wrong reason.",
      { exact: true },
    );
    await expect(refusal).toBeVisible({ timeout: 60_000 });
    // Read once, the refusal being the answer: no card of counts beside it.
    expect(await page.getByText("What this review will examine", { exact: true }).count()).toBe(0);
    const start = page.getByRole("button", { name: "Start review" });
    await expect(start).toBeDisabled();
    const beside = start.locator("..");
    await expect(beside).toContainText(
      "The pre-flight says this review would refuse to start: see above.",
    );
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, refusal, "preflight-nothing-switched-on");
    await shootAll(page, beside, "preflight-nothing-switched-on-start");
  } finally {
    await switchAll(true);
  }
});

test("several rulesets are ticked for one review, and two that share a rule number are refused beside the list", async ({
  page,
}) => {
  // RS-4 (D-288): the Rules picker was one select, so a review had one
  // ruleset whatever the server took. Two rulesets made here, removed after:
  // the first shares no number with the example, the second shares 91 with
  // the first.
  const imported = async (name: string, markdown: string): Promise<string> => {
    const made = await page.request.post("/api/rulesets/import", {
      data: { name, tier: "project", markdown },
    });
    expect(made.status()).toBe(201);
    return ((await made.json()) as { rulesetId: string }).rulesetId;
  };
  const first = await imported(
    "Zz first of two",
    "# First\n\n## Rules\n\n### 90. Dates\n\n**Rule:** Dates are UTC.\n\n" +
      "### 91. Names\n\n**Rule:** A name says what the thing holds.\n",
  );
  const second = await imported(
    "Zz second of two",
    "# Second\n\n## Rules\n\n### 91. Units\n\n**Rule:** A duration says its unit.\n",
  );
  let draft: string | undefined;
  try {
    const preflights: string[][] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname !== "/api/reviews/preflight") return;
      preflights.push((request.postDataJSON() as { rulesetIds: string[] }).rulesetIds);
    });
    await fillANewReview(page);
    const picker = page.getByTestId("ruleset-picker");
    const start = page.getByRole("button", { name: "Start review" });
    const beside = start.locator("..");
    const card = picker.locator("xpath=ancestor::div[@role='group']/..");

    // One ticked on arrival, as before: the default, else the first.
    await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(1);
    const onArrival = preflights.at(-1)!;
    expect(onArrival).toHaveLength(1);

    // A second ticked: the pre-flight is asked about both, in the list's
    // order, and answers, and Start is on.
    const sized = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/reviews/preflight" &&
        (response.request().postDataJSON() as { rulesetIds: string[] }).rulesetIds.length === 2,
    );
    await picker.getByRole("checkbox", { name: /^Zz first of two v\d+$/ }).check();
    expect((await sized).status()).toBe(200);
    const both = [...onArrival, first];
    expect(preflights.at(-1)).toEqual(both);
    await expect(page.getByText("What this review will examine", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(start).toBeEnabled();
    await expect(picker.getByRole("link", { name: "Zz first of two, 2 rules" })).toHaveAttribute(
      "href",
      `/rulesets/${first}`,
    );
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "rules-two-ticked");

    // Start sends both. Refused for this test, so no run is needed to read
    // what was sent; the draft it leaves is removed after.
    const stopRefusing = await answerOnce(page, "**/api/reviews/*/start", (route) =>
      route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
    );
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/reviews" &&
        response.request().method() === "POST",
    );
    const starting = page.waitForRequest((request) =>
      /\/api\/reviews\/[^/]+\/start$/.test(new URL(request.url()).pathname),
    );
    await start.click();
    draft = ((await (await creation).json()) as { review: { id: string } }).review.id;
    expect(((await starting).postDataJSON() as { rulesetIds: string[] }).rulesetIds).toEqual(both);
    await expect(page.getByText("Refused for this test.")).toBeVisible();
    await stopRefusing();

    // A third that shares 91 with the second: said under the list in the
    // words the server refuses the set with, nothing asked of the pre-flight,
    // and Start off with the reason beside it.
    const asked = preflights.length;
    await picker.getByRole("checkbox", { name: /^Zz second of two v\d+$/ }).check();
    const refusal = card.getByText(
      'These rulesets cannot judge one review together: rule 91 is in "Zz first of two" and ' +
        '"Zz second of two". A finding names its rule by number alone, so a number may be in ' +
        "only one of a review's rulesets. Leave one of them out, or change the numbers in one.",
      { exact: true },
    );
    await expect(refusal).toBeVisible();
    await expect(start).toBeDisabled();
    await expect(beside).toContainText("The ticked rulesets share a rule number: see Rules above.");
    await expect(page.getByText("What this review will examine", { exact: true })).toHaveCount(0);
    expect(preflights).toHaveLength(asked);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "rules-share-a-number");
    await shootAll(page, beside, "rules-share-a-number-start");

    // None ticked: said, and Start stays off.
    const ticked = picker.getByRole("checkbox", { checked: true });
    while ((await ticked.count()) > 0) await ticked.first().uncheck();
    await expect(
      card.getByText(
        "No ruleset is ticked, and a review needs at least one to judge the change against.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(start).toBeDisabled();
    await expect(beside).toContainText("No ruleset is ticked: see Rules above.");
    await shootAll(page, card, "rules-none-ticked");
  } finally {
    if (draft) {
      const removed = await page.request.delete(`/api/reviews/${draft}`);
      expect.soft(removed.status(), "the draft removed").toBe(200);
    }
    for (const id of [first, second]) {
      const removed = await page.request.delete(`/api/rulesets/${id}`);
      expect.soft(removed.status(), "the ruleset removed").toBe(200);
    }
  }
});

test("a ruleset renumbered or deleted in another tab is on the list again on the way back, and Start is off beside a set the server refuses", async ({
  page,
}) => {
  // Review round 25. The list of rulesets was read once, as the screen
  // opened, so the refusal for two that share a number stood after one was
  // renumbered in another tab, which is what its own words say to do. And a
  // set the pre-flight refused, for a ruleset deleted since say, left Start
  // on: pressed, it made a review and was refused again in the same words.
  const imported = async (name: string, markdown: string, replace = false): Promise<string> => {
    const made = await page.request.post("/api/rulesets/import", {
      data: { name, tier: "project", markdown, ...(replace ? { replace: true } : {}) },
    });
    expect(made.status()).toBe(201);
    return ((await made.json()) as { rulesetId: string }).rulesetId;
  };
  const firstDoc =
    "# First\n\n## Rules\n\n### 90. Dates\n\n**Rule:** Dates are UTC.\n\n" +
    "### 91. Names\n\n**Rule:** A name says what the thing holds.\n";
  const secondDoc = (code: number) =>
    `# Second\n\n## Rules\n\n### ${code}. Units\n\n**Rule:** A duration says its unit.\n`;
  const first = await imported("Zz return first", firstDoc);
  const second = await imported("Zz return second", secondDoc(91));
  let secondGone = false;
  try {
    const preflights: string[][] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname !== "/api/reviews/preflight") return;
      preflights.push((request.postDataJSON() as { rulesetIds: string[] }).rulesetIds);
    });
    await fillANewReview(page);
    const picker = page.getByTestId("ruleset-picker");
    const start = page.getByRole("button", { name: "Start review" });
    const beside = start.locator("..");
    const card = picker.locator("xpath=ancestor::div[@role='group']/..");
    const refusal = card.getByText(/^These rulesets cannot judge one review together/);
    const examined = page.getByText("What this review will examine", { exact: true });
    const onArrival = preflights.at(-1)!;
    expect(onArrival).toHaveLength(1);

    await picker.getByRole("checkbox", { name: /^Zz return first v\d+$/ }).check();
    await picker.getByRole("checkbox", { name: /^Zz return second v\d+$/ }).check();
    await expect(refusal).toBeVisible();
    await expect(start).toBeDisabled();

    // Renumbered in another tab, as the refusal says to: on the way back
    // the list is read again, the refusal goes, and the three are sized.
    await imported("Zz return second", secondDoc(92), true);
    await comeBack(page);
    await expect(refusal).toHaveCount(0);
    await expect(
      picker.getByRole("checkbox", { name: "Zz return second v2", exact: true }),
    ).toBeChecked();
    await expect(examined).toBeVisible({ timeout: 60_000 });
    expect(preflights.at(-1)).toEqual([...onArrival, first, second]);
    await expect(start).toBeEnabled();

    // A ticked ruleset given a rule in another tab: the answer on screen
    // was for its rules as they were, so on the way back it is asked again
    // though the same rulesets are ticked.
    const asked = preflights.length;
    await imported(
      "Zz return first",
      `${firstDoc}\n### 93. Money\n\n**Rule:** An amount says its currency.\n`,
      true,
    );
    await comeBack(page);
    await expect(picker.getByRole("link", { name: "Zz return first, 3 rules" })).toBeVisible();
    await expect.poll(() => preflights.length).toBe(asked + 1);
    expect(preflights.at(-1)).toEqual([...onArrival, first, second]);
    await expect(start).toBeEnabled({ timeout: 60_000 });

    // A set the list on screen takes for one that can run, asked about
    // before the window is come back to, as a script that changes a ruleset
    // leaves it: the pre-flight refuses it as a start would, and Start is
    // off beside the refusal. First the second given 91 again.
    const wouldRefuse = "The pre-flight says this review would refuse to start: see above.";
    const arrived = picker.locator(`li:has(a[href="/rulesets/${onArrival[0]}"]) input`);
    await imported("Zz return second", secondDoc(91), true);
    await arrived.uncheck();
    await expect(
      page.getByText(
        'These rulesets cannot judge one review together: rule 91 is in "Zz return first" and ' +
          '"Zz return second". A finding names its rule by number alone, so a number may be in ' +
          "only one of a review's rulesets. Leave one of them out, or change the numbers in one.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60_000 });
    await expect(refusal).toHaveCount(0);
    await expect(start).toBeDisabled();
    await expect(beside).toContainText(wouldRefuse);
    // Come back to, the list says it itself, under the rulesets.
    await comeBack(page);
    await expect(refusal).toBeVisible();

    // Then the second deleted, and asked about alone.
    const deleted = await page.request.delete(`/api/rulesets/${second}`);
    expect(deleted.status()).toBe(200);
    secondGone = true;
    await picker.getByRole("checkbox", { name: /^Zz return first v\d+$/ }).uncheck();
    await expect(page.getByText(`Ruleset ${second} was not found.`, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(start).toBeDisabled();
    await expect(beside).toContainText(wouldRefuse);
    await shootAll(page, beside, "rules-set-refused-start");

    // Come back to, the list no longer holds it, and none is ticked.
    await comeBack(page);
    await expect(picker.getByRole("checkbox", { name: /^Zz return second/ })).toHaveCount(0);
    await expect(beside).toContainText("No ruleset is ticked: see Rules above.");
    await arrived.check();
    await expect(start).toBeEnabled({ timeout: 60_000 });
    expect(preflights.at(-1)).toEqual(onArrival);
  } finally {
    for (const id of secondGone ? [first] : [first, second]) {
      const removed = await page.request.delete(`/api/rulesets/${id}`);
      expect.soft(removed.status(), "the ruleset removed").toBe(200);
    }
  }
});

test("the scoreboard says whose branch each recent review was of", async ({ page }) => {
  // WP-L, the third slice (D-297). Every review this suite makes is of a
  // branch the fixture's author committed last, and the suite's server
  // commits as that author (playwright.config.ts): each is the person's
  // until Settings keeps somebody else's email.
  const table = page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: "Author" }) });
  const card = table.locator("..");
  const authors = table.locator("tbody tr td:nth-child(2)");
  const keep = (emails: string[]) =>
    page.request.put("/api/settings", { data: { identities: emails } });
  try {
    await page.goto("/");
    await expect(authors.first()).toHaveText("You", { timeout: 30_000 });
    await expect(authors.first().locator("span")).toHaveAttribute("title", MY_EMAIL);
    expect(new Set(await authors.allTextContents())).toEqual(new Set(["You"]));
    // A sixth column, and the table still inside its card at desk width.
    expect(await card.evaluate((box) => box.scrollWidth - box.clientWidth)).toBeLessThanOrEqual(0);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "scoreboard-authors-mine");

    // Somebody else's email kept: the same reviews are the fixture author's,
    // said by the name the commits were made with.
    expect((await keep(["someone-else@example.invalid"])).status()).toBe(200);
    await page.reload();
    await expect(authors.first()).toHaveText("Fixture", { timeout: 30_000 });
    await expect(authors.first().locator("span")).toHaveAttribute("title", MY_EMAIL);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "scoreboard-authors-theirs");

    // The widest the row gets: a long name, a run after an earlier one, and
    // a review awaiting a decision. The board's own answer with those three
    // put on its rows, since no review here has a long-named author. The
    // table stays inside its card at desk width, the name cut and its email
    // in its title. Held because the pair's column gives: a longer name
    // takes its room from the pair, and the table does not widen.
    const longName = "Alexandria Featherstonehaugh-Montgomery";
    const real = (await (await page.request.get("/api/scoreboard")).json()) as {
      recent: Record<string, unknown>[];
    };
    const stopWidest = await routeUntilStopped(page, "**/api/scoreboard", (route) =>
      route.fulfill({
        json: {
          ...real,
          recent: real.recent.map((row) => ({
            ...row,
            author: { name: longName, email: "alexandria@example.invalid" },
            mine: false,
            status: "awaiting_confirmation",
            ranBefore: true,
            durationMs: 754_000,
          })),
        },
      }),
    );
    await page.reload();
    await expect(authors.first()).toHaveText(longName, { timeout: 30_000 });
    expect(await card.evaluate((box) => box.scrollWidth - box.clientWidth)).toBeLessThanOrEqual(0);
    const cut = authors.first().locator("span");
    expect(await cut.evaluate((name) => name.scrollWidth > name.clientWidth)).toBe(true);
    await expect(cut).toHaveAttribute("title", "alexandria@example.invalid");
    await shootAll(page, card, "scoreboard-authors-widest");
    await stopWidest();

    // Nothing kept and a git config that cannot be read: said under the
    // table in git's words, the board and the names there all the same.
    expect((await keep([])).status()).toBe(200);
    writeFileSync(GIT_CONFIG, "[user\n");
    await page.reload();
    await expect(
      card.getByText(
        /^Which of these branches are yours is not known, because git's config could not be read: .*bad config line 1/,
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(authors.first()).toHaveText("Fixture");
    await shootAll(page, card, "scoreboard-authors-unknown");
  } finally {
    writeFileSync(GIT_CONFIG, `[user]\n\tname = Fixture\n\temail = ${MY_EMAIL}\n`);
    expect.soft((await keep([])).status(), "the kept emails emptied").toBe(200);
  }
});

test("the dashboard lists a running interactive review under Needs you, and says its usage is not in the cost", async ({
  page,
}) => {
  // The twentieth grade, AH1 and AH3. "Nothing is waiting on you" stood over
  // a review that goes on only when the person runs the command its page
  // prints, and the cost figure summed the zeros recorded for it. No test
  // here runs a review by hand, so the board's own answer is given one such
  // review; what the server answers for one is held by the unit tests.
  const real = (await (await page.request.get("/api/scoreboard")).json()) as {
    recent: { id: string; projectName: string; fromBranch: string; intoBranch: string }[];
  };
  const row = real.recent[0]!;
  const stop = await routeUntilStopped(page, "**/api/scoreboard", (route) =>
    route.fulfill({
      json: {
        ...real,
        interactiveReviews: 1,
        awaitingReviews: [
          {
            id: row.id,
            status: "interactive",
            projectName: row.projectName,
            fromBranch: row.fromBranch,
            intoBranch: row.intoBranch,
            decided: 0,
            total: 0,
            since: null,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  const needsYou = page.getByRole("list", { name: "Needs you" });
  await expect(needsYou.getByRole("listitem")).toHaveCount(1, { timeout: 30_000 });
  await expect(needsYou).toContainText("runs in your terminal: its page prints the command to run");
  await expect(page.getByText("Nothing is waiting on you.")).toHaveCount(0);
  const cost = page.getByText("1 interactive review not counted", { exact: true });
  await expect(cost).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await shootAll(page, needsYou.locator(".."), "needs-you-interactive");
  await shootAll(page, cost.locator(".."), "cost-interactive-not-counted");
  await stop();
});

test("an interactive review's command is on its page whenever the page is opened", async ({
  page,
}) => {
  // The twenty-first grade, AI1. The command an interactive stage waits on
  // was said once, to whoever was listening: a page opened afterwards, or
  // reloaded, showed none, and the stage ran out its timeout. Started here
  // before any page is open, so nothing was listening when it was said.
  const listed = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const rulesets = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string; name: string }[];
  };
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
  try {
    const started = await page.request.post(`/api/reviews/${review.id}/start`, {
      data: {
        rulesetIds: [rulesets.rulesets.find((row) => row.name === "Example protocol")!.id],
      },
    });
    expect(started.status()).toBe(200);
    // The first stage that asks a model is waiting before the page opens.
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get(`/api/reviews/${review.id}`)).json()) as {
              waiting: { stage: string } | null;
            }
          ).waiting?.stage ?? null,
        { timeout: 60_000 },
      )
      .toBe("s1_risk");

    await page.goto(`/reviews/${review.id}`);
    const turn = page.getByTestId("waiting-command");
    await expect(turn).toBeVisible({ timeout: 30_000 });
    await expect(turn).toContainText("s1_risk is waiting for you");
    await expect(turn).toContainText("'--model' 'claude-fable-5[1m]'");
    await expect(turn).toContainText("then save the JSON answer to");
    await page.reload();
    await expect(turn).toContainText("s1_risk is waiting for you", { timeout: 30_000 });
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, turn.locator(".."), "interactive-your-turn");
    // On a phone the command can be scrolled to and read whole. The view is
    // a fixed column with a scroll of its own, so the shot above shows only
    // what was in sight; this one is of the phone's screen with the command
    // scrolled to.
    const desk = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    const command = turn.locator("pre");
    await command.scrollIntoViewIfNeeded();
    await expect(command).toBeInViewport();
    expect((await command.boundingBox())!.height).toBeGreaterThan(100);
    // At this width the command is taller than its box and scrolls in it,
    // and a box that scrolls has to take the keyboard's focus. A scan at
    // desk width alone met one only where the paths ran longer (the macOS
    // job of run 45020353625).
    expect(
      await command.evaluate((node) => node.scrollHeight > node.clientHeight),
      "the command scrolls in its box at this width",
    ).toBe(true);
    expect(await accessibilityViolations(page)).toEqual([]);
    const evidence = join(
      fileURLToPath(new URL("..", import.meta.url)),
      "review",
      `${new Date().toISOString().slice(0, 10)}-e2e`,
    );
    await page.screenshot({
      path: join(evidence, "interactive-your-turn-phone-view.png"),
      animations: "disabled",
    });
    // By the keyboard: End takes the box to the command's last line, and
    // the ring says where the focus is.
    await command.focus();
    await page.keyboard.press("End");
    await expect
      .poll(() =>
        command.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1),
      )
      .toBe(true);
    expect(await command.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({
        path: join(evidence, `interactive-your-turn-focused-phone-${scheme}.png`),
        animations: "disabled",
      });
    }
    if (desk) await page.setViewportSize(desk);
    await command.scrollIntoViewIfNeeded();
    await expect(command).toBeFocused();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({
        path: join(evidence, `interactive-your-turn-focused-${scheme}.png`),
        animations: "disabled",
      });
    }
    await page.emulateMedia({ colorScheme: "light" });

    // And the dashboard sends the person there, as a review that needs them.
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Needs you" })).toContainText(
      "runs in your terminal: its page prints the command to run",
      { timeout: 30_000 },
    );

    // Cancelled, nothing is waited on and the card goes.
    expect((await page.request.post(`/api/reviews/${review.id}/cancel`)).status()).toBe(200);
    await page.goto(`/reviews/${review.id}`);
    await expect(page.getByText("cancelled", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(turn).toHaveCount(0);
  } finally {
    await page.request.post(`/api/reviews/${review.id}/cancel`);
    // A cancel is asked of a run and takes a moment to end it; a review
    // still running is refused its removal.
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get(`/api/reviews/${review.id}`)).json()) as {
              running: boolean;
            }
          ).running,
        { timeout: 30_000 },
      )
      .toBe(false);
    const removed = await page.request.delete(`/api/reviews/${review.id}`);
    expect.soft(removed.status(), "the review removed").toBe(200);
  }
});

/**
 * The screen itself in light, dark and at a phone's width, with a part of
 * it scrolled into sight first. For the scan view, a fixed column with a
 * scroll of its own, which `shootAll`'s clip of the whole page cannot reach.
 */
async function shootView(
  page: import("@playwright/test").Page,
  target: Locator,
  name: string,
): Promise<void> {
  const evidence = join(
    fileURLToPath(new URL("..", import.meta.url)),
    "review",
    `${new Date().toISOString().slice(0, 10)}-e2e`,
  );
  mkdirSync(evidence, { recursive: true });
  const shoot = async (file: string) => {
    await target.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, `${file}.png`), animations: "disabled" });
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

/** Where an interactive stage's command says to save its answer. */
function answerPathIn(command: string): string {
  const found = /then save the JSON answer to (.+-output\.json)\. The command needs/.exec(command);
  if (!found) throw new Error(`The command names no answer file: ${command}`);
  return found[1]!;
}

/** An interactive review of the fixture's branch, with what a test needs to answer it as a person would. */
async function interactiveReview(page: import("@playwright/test").Page) {
  const listed = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = listed.projects.find((project) => project.name === "app")!;
  const rulesets = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string; name: string }[];
  };
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
  const read = async () =>
    (await (await page.request.get(`/api/reviews/${review.id}`)).json()) as {
      running: boolean;
      review: { status: string; verifierModel: string | null };
      waiting: { stage: string; text: string } | null;
    };
  return {
    id: review.id,
    read,
    start: async () => {
      const started = await page.request.post(`/api/reviews/${review.id}/start`, {
        data: {
          rulesetIds: [rulesets.rulesets.find((row) => row.name === "Example protocol")!.id],
        },
      });
      expect(started.status()).toBe(200);
    },
    /** The command of a stage, once that stage waits on the person. */
    waitingOn: async (stage: string): Promise<string> => {
      let command = "";
      await expect
        .poll(
          async () => {
            const waiting = (await read()).waiting;
            command = waiting?.text ?? "";
            return waiting?.stage ?? null;
          },
          { timeout: 60_000 },
        )
        .toBe(stage);
      return command;
    },
    /** Ended and deleted, whatever the test left it doing. */
    remove: async () => {
      await page.request.post(`/api/reviews/${review.id}/cancel`);
      // A cancel is asked of a run and takes a moment to end it; a review
      // still running is refused its removal.
      await expect.poll(async () => (await read()).running, { timeout: 30_000 }).toBe(false);
      const removed = await page.request.delete(`/api/reviews/${review.id}`);
      expect.soft(removed.status(), "the review removed").toBe(200);
    },
  };
}

test("an interactive review answered stage by stage says only what the app knows of who answered", async ({
  page,
}) => {
  // Review round 27 and the lines the twenty-first grade's AI8 left. Each
  // stage is answered as a person would: the prompt its command names is
  // read, and the answer saved where the command says.
  const { resolveCandidateTokens } = await import("../tests/helpers/ideal-answers");
  const numbered = (n: number) => join(ANSWERS_DIR, `${String(n).padStart(3, "0")}.json`);
  const answer = (command: string, index: number) => {
    const path = answerPathIn(command);
    const prompt = readFileSync(path.replace(/-output\.json$/, "-prompt.md"), "utf8");
    writeFileSync(
      path,
      resolveCandidateTokens(readFileSync(numbered(index), "utf8"), prompt),
      "utf8",
    );
  };
  const review = await interactiveReview(page);
  try {
    await review.start();
    const risk = await review.waitingOn("s1_risk");
    await page.goto(`/reviews/${review.id}`);
    const turn = page.getByTestId("waiting-command");
    await expect(turn).toContainText("s1_risk is waiting for you", { timeout: 30_000 });

    // The next stage's command reaches a page that is listening. It is in
    // the card, once: the feed printed it whole a second time, both shells'
    // commands as one unbroken run.
    answer(risk, 1);
    const comprehension = await review.waitingOn("s2_comprehension");
    await expect(turn).toContainText("s2_comprehension is waiting for you", { timeout: 30_000 });
    const feed = page.getByRole("log", { name: "Scan activity" });
    await expect(feed).toContainText(
      "Comprehension is waiting for you: run the command in Your turn.",
    );
    expect(await feed.innerText()).not.toContain("--model");
    // And the line can be read. Under the card the feed took what the
    // column had left at desk width, a sliver that cut it.
    const line = feed.getByText("Comprehension is waiting for you: run the command in Your turn.");
    await line.scrollIntoViewIfNeeded();
    const feedBox = (await feed.boundingBox())!;
    const lineBox = (await line.boundingBox())!;
    expect(feedBox.height).toBeGreaterThanOrEqual(200);
    expect(lineBox.y).toBeGreaterThanOrEqual(feedBox.y);
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(feedBox.y + feedBox.height);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootView(page, feed, "interactive-feed-waiting");

    answer(comprehension, 2);
    answer(await review.waitingOn("s3_adversarial"), 3);
    answer(await review.waitingOn("s4_deletions"), 4);

    // Verification is said to do what its command does. "In a fresh
    // session" is what the app arranges for a headless review alone.
    const verification = await review.waitingOn("s5_verification");
    const does = page.getByText(
      "Re-check every candidate, from a command that starts a session of its own",
    );
    await expect(does).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("in a fresh session")).toHaveCount(0);
    await shootView(page, does, "interactive-verification-stage");
    answer(verification, 5);
    answer(await review.waitingOn("s5b_second_verification"), 6);
    await expect
      .poll(async () => (await review.read()).review.status, { timeout: 60_000 })
      .toBe("awaiting_confirmation");
    const verifier = (await review.read()).review.verifierModel;
    expect(verifier).not.toBeNull();

    // The queue names the models as the ones the commands named, and the
    // sessions as the person's: the app saw neither answer.
    await page.goto(`/reviews/${review.id}`);
    const proven = page.getByText("your own sessions, on the commands that named");
    await expect(proven).toBeVisible({ timeout: 30_000 });
    await expect(proven.locator("..")).toHaveText(
      `Proven in your own sessions, on the commands that named claude-fable-5[1m] and then ${verifier}`,
    );
    await expect(page.getByText("and again by")).toHaveCount(0);
    const agreed = page.getByText("The second verifier's answer, from the command that named");
    await expect(agreed).toHaveText(
      `The second verifier's answer, from the command that named ${verifier}, agreed`,
    );
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, proven.locator(".."), "interactive-proven-in");
    await shootAll(
      page,
      page.getByRole("heading", { name: "How the findings were proven" }).locator(".."),
      "interactive-second-agreed",
    );
  } finally {
    await review.remove();
  }
});

test("an interactive answer in the wrong shape is a failed stage on the review's page, naming no log", async ({
  page,
}) => {
  // The twenty-first grade, AI5. A refused answer left no stage row, the
  // failure standing in a run note alone, and a failed interactive stage
  // named a transcript only a headless stage writes.
  const review = await interactiveReview(page);
  try {
    await review.start();
    writeFileSync(answerPathIn(await review.waitingOn("s1_risk")), "{oops", "utf8");
    await expect
      .poll(async () => (await review.read()).review.status, { timeout: 60_000 })
      .toBe("failed");

    await page.goto(`/reviews/${review.id}`);
    const failure = page.getByText(
      /^invalid_output: The s1_risk stage did not return a JSON object/,
    );
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/s1_risk\.log/)).toHaveCount(0);
    // Nor does the row call the stage answered: no answer was taken.
    const row = failure.locator("../..");
    await expect(row).toContainText("For you to answer in your own session");
    await expect(row).not.toContainText("Answered in your own session");
    await expect(page.getByTestId("waiting-command")).toHaveCount(0);
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, failure.locator("../.."), "interactive-refused-answer");
  } finally {
    await review.remove();
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
  await expect(
    page.getByTestId("ruleset-picker").getByRole("checkbox", { checked: true }),
  ).toHaveCount(1);
  await expect(draftStart).toBeDisabled();
  release();
  await expect(draftStart).toBeEnabled();
  await expect(notice).toContainText(
    "The commands this review prints will cost API usage, billed per token.",
  );
  // Apart from each other and from the Rules card under them: nothing said
  // above a review's body carried space of its own, so each sat flush on
  // the next (review round 25).
  const terminalNote = page.getByTestId("terminal-environment-note");
  const rulesCard = page
    .getByTestId("ruleset-picker")
    .locator("xpath=ancestor::div[@role='group']/..");
  expect(await gapBetween(notice, terminalNote)).toBeGreaterThanOrEqual(12);
  expect(await gapBetween(terminalNote, rulesCard)).toBeGreaterThanOrEqual(16);
  await shootAll(page, notice, "draft-notices-over-rules", rulesCard);
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

test("a draft's own Start ticks several rulesets, and refuses two that share a rule number", async ({
  page,
}) => {
  // RS-4b: the draft's Start was one select beside the header's buttons, so
  // a draft started from its own page had one ruleset. The same list as New
  // review's, in the page's body. Two rulesets made here, removed after: the
  // first shares no number with the example, the second shares 91 with the
  // first.
  const imported = async (name: string, markdown: string): Promise<string> => {
    const made = await page.request.post("/api/rulesets/import", {
      data: { name, tier: "project", markdown },
    });
    expect(made.status()).toBe(201);
    return ((await made.json()) as { rulesetId: string }).rulesetId;
  };
  const first = await imported(
    "Zz draft first",
    "# First\n\n## Rules\n\n### 90. Dates\n\n**Rule:** Dates are UTC.\n\n" +
      "### 91. Names\n\n**Rule:** A name says what the thing holds.\n",
  );
  const second = await imported(
    "Zz draft second",
    "# Second\n\n## Rules\n\n### 91. Units\n\n**Rule:** A duration says its unit.\n",
  );
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
    },
  });
  expect(made.status()).toBe(201);
  const { review } = (await made.json()) as { review: { id: string } };
  let secondGone = false;
  try {
    await page.goto(`/reviews/${review.id}`);
    const picker = page.getByTestId("ruleset-picker");
    const card = picker.locator("xpath=ancestor::div[@role='group']/..");
    const start = card.getByRole("button", { name: "Start review" });
    const tickedRows = picker.locator("li").filter({ has: page.locator("input:checked") });
    await expect(tickedRows).toHaveCount(1, { timeout: 30_000 });
    const onArrival = (await tickedRows.getByRole("link").getAttribute("href"))!.split("/").pop()!;
    // Apart from what follows it: the card sat flush on the Stages card,
    // which a shot of the card alone does not show (seen grading
    // draft-no-ruleset-light.png).
    expect(
      await gapBetween(card, card.locator("xpath=following-sibling::*[1]")),
    ).toBeGreaterThanOrEqual(16);

    // A third that shares 91 with the second ticked beside it: said under
    // the list in the server's words, and Start is off.
    await picker.getByRole("checkbox", { name: /^Zz draft first v\d+$/ }).check();
    await expect(start).toBeEnabled();
    await picker.getByRole("checkbox", { name: /^Zz draft second v\d+$/ }).check();
    await expect(
      card.getByText(
        'These rulesets cannot judge one review together: rule 91 is in "Zz draft first" and ' +
          '"Zz draft second". A finding names its rule by number alone, so a number may be in ' +
          "only one of a review's rulesets. Leave one of them out, or change the numbers in one.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(start).toBeDisabled();
    expect(await accessibilityViolations(page)).toEqual([]);
    await shootAll(page, card, "draft-rules-share-a-number");

    // None ticked: said, and Start stays off.
    const ticked = picker.getByRole("checkbox", { checked: true });
    while ((await ticked.count()) > 0) await ticked.first().uncheck();
    await expect(
      card.getByText(
        "No ruleset is ticked, and a review needs at least one to judge the change against.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(start).toBeDisabled();
    await shootAll(page, card, "draft-rules-none-ticked");

    // Two that share nothing: Start sends both, in the list's order though
    // the lower one was ticked first. Refused for this test, so no run is
    // needed to read what was sent.
    await picker.getByRole("checkbox", { name: /^Zz draft first v\d+$/ }).check();
    await picker.locator(`li:has(a[href="/rulesets/${onArrival}"]) input`).check();
    await expect(start).toBeEnabled();
    await shootAll(page, card, "draft-rules-two-ticked");
    const stopRefusing = await answerOnce(page, "**/api/reviews/*/start", (route) =>
      route.fulfill({ status: 500, json: { error: "Refused for this test.", code: "Test" } }),
    );
    const starting = page.waitForRequest(
      (request) => new URL(request.url()).pathname === `/api/reviews/${review.id}/start`,
    );
    await start.click();
    expect((await starting).postDataJSON()).toEqual({ rulesetIds: [onArrival, first] });
    const refused = page.getByText("Refused for this test.");
    await expect(refused).toBeVisible();
    await stopRefusing();
    // What the page says above the card stands apart from it (review round
    // 25): it sat flush on the card.
    expect(await gapBetween(refused, card)).toBeGreaterThanOrEqual(16);

    // The list is read again on the way back to the window (review round
    // 25). It was read once, so a ruleset deleted in another tab stayed
    // listed and ticked, and the refusal for the two stood over a ruleset
    // that was no longer there.
    await picker.getByRole("checkbox", { name: /^Zz draft second v\d+$/ }).check();
    await expect(start).toBeDisabled();
    const deleted = await page.request.delete(`/api/rulesets/${second}`);
    expect(deleted.status()).toBe(200);
    secondGone = true;
    await comeBack(page);
    await expect(picker.getByRole("checkbox", { name: /^Zz draft second v\d+$/ })).toHaveCount(0);
    await expect(card.getByText(/^These rulesets cannot judge one review together/)).toHaveCount(0);
    await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await expect(start).toBeEnabled();
  } finally {
    const removed = await page.request.delete(`/api/reviews/${review.id}`);
    expect.soft(removed.status(), "the draft removed").toBe(200);
    for (const id of secondGone ? [first] : [first, second]) {
      const gone = await page.request.delete(`/api/rulesets/${id}`);
      expect.soft(gone.status(), "the ruleset removed").toBe(200);
    }
  }
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

  // With no ruleset at all, the draft says so and where one is made. It said
  // "import one", one of three ways since the form there opens on a
  // template. Staged as the server answers an app with none.
  const stopNone = await answerOnce(page, "**/api/rulesets", (route) =>
    route.fulfill({ json: { rulesets: [], defaultRulesetId: null } }),
  );
  await page.goto(`/reviews/${review.id}`);
  await expect(page.getByText("No ruleset to start it with yet:")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("link", { name: "make one" })).toHaveAttribute("href", "/rulesets");
  await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
  await shootAll(page, page.locator("main"), "draft-no-ruleset");
  await stopNone();

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
  // The one ticked on arrival, read off its row's link to the ruleset.
  const tickedRow = page
    .getByTestId("ruleset-picker")
    .locator("li")
    .filter({ has: page.locator("input:checked") });
  await expect(tickedRow).toHaveCount(1);
  const chosen = (await tickedRow.getByRole("link").getAttribute("href"))!.split("/").pop()!;
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
  expect(answer.request().postDataJSON()).toEqual({ rulesetIds: [chosen] });
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
  // Said of the setting, not of one: Settings can let more than one run. And
  // of a place, not of a review: a finding being verified again holds one too.
  await expect(
    page.getByText(
      "Waiting for a place. A running review holds one, and so does a finding being verified again. Settings limits how many run at once, because they share one usage limit.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
  await expect(page.getByTestId("ruleset-picker")).toHaveCount(0);

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
  await expect(page.getByText(/Waiting for a place/)).toHaveCount(0);
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
    "ruleset-templates": "TemplateNotFound",
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
    "POST ruleset-templates/[slug]/use": { data: { tier: "global" } },
    "GET rulesets/[id]": {},
    "DELETE rulesets/[id]": {},
    "GET rulesets/[id]/export": {},
    "POST rulesets/[id]/duplicate": { data: { tier: "global", name: "Swept" } },
    "PUT rulesets/[id]/default": {},
    "DELETE rulesets/[id]/default": {},
    "POST rulesets/[id]/rules": {
      data: { markdown: "### 99. Swept\n\n**Rule:** None.\n", version: 1 },
    },
    "PATCH rulesets/[id]/rules/[code]": { data: { enabled: true } },
    "PUT rulesets/[id]/rules/[code]": {
      data: { markdown: "### 99. Swept\n\n**Rule:** None.\n", version: 1 },
    },
    "DELETE rulesets/[id]/rules/[code]": { query: "?version=1" },
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
  // (review of D-161). The check sends no prompt, so it runs as Settings opens.
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

test("one ruleset is deleted from its page, asked once, a refusal said beside the control (RA-1)", async ({
  page,
}) => {
  // A copy made for this, so the rulesets the suites after this use stay.
  const before = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string; name: string }[];
    defaultRulesetId: string | null;
  };
  const copied = await page.request.post(`/api/rulesets/${before.rulesets[0]!.id}/duplicate`, {
    data: { tier: "global", name: "A copy to delete" },
  });
  expect(copied.status()).toBe(201);
  const { rulesetId } = (await copied.json()) as { rulesetId: string };

  await page.goto(`/rulesets/${rulesetId}`);
  await expect(page.getByRole("heading", { name: "A copy to delete", level: 1 })).toBeVisible();
  const card = page.getByRole("heading", { name: "Delete ruleset" }).locator("..");
  await expect(card).toContainText("A review already run keeps the rules it ran with.");
  // Not the default, so nothing is said of new reviews.
  expect(await card.getByText(/default for new reviews/).count()).toBe(0);

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  const yes = card.getByRole("button", { name: "Yes, delete A copy to delete" });
  await expect(yes).toBeVisible();
  await shootAll(page, card, "ruleset-delete-asked");
  await card.getByRole("button", { name: "Keep it" }).click();
  await expect(yes).toHaveCount(0);
  expect((await page.request.get(`/api/rulesets/${rulesetId}`)).status()).toBe(200);

  // Refused as the server refuses it while a review in line is to start on
  // it, which takes a second review waiting behind a running one to reach.
  const refusal =
    'A review waiting for a place will start on "A copy to delete" and has not taken its copy of the rules yet. Delete the ruleset once that review has started, or take the review out of the line first.';
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  const stop = await answerOnce(page, `**/api/rulesets/${rulesetId}`, (route) =>
    route.fulfill({ status: 409, json: { error: refusal, code: "RulesetAwaited" } }),
  );
  await yes.click();
  await expect(card.getByText(refusal)).toBeVisible();
  await stop();
  // The question is put away with the refusal: asked again, not left armed.
  await expect(yes).toHaveCount(0);
  await shootAll(page, card, "ruleset-delete-refused");

  // The default goes too, and the card says first what a new review will
  // then start on (D-266).
  expect((await page.request.put(`/api/rulesets/${rulesetId}/default`)).status()).toBe(200);
  await page.reload();
  await expect(card).toContainText(
    "It is the default for new reviews, which will then tick the first ruleset listed instead.",
  );
  await shootAll(page, card, "ruleset-delete-default");

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await yes.click();
  await expect(page).toHaveURL(/\/rulesets$/);
  await expect(page.getByRole("heading", { name: "Rulesets", level: 1 })).toBeVisible();
  expect(await page.getByText("A copy to delete").count()).toBe(0);
  const after = (await (await page.request.get("/api/rulesets")).json()) as typeof before;
  expect(after.rulesets.map((row) => row.id)).toEqual(before.rulesets.map((row) => row.id));
  expect(after.defaultRulesetId).toBeNull();
  // The default the suites after this found is put back.
  if (before.defaultRulesetId !== null) {
    const back = await page.request.put(`/api/rulesets/${before.defaultRulesetId}/default`);
    expect(back.status()).toBe(200);
  }
});

test("a rule's text is edited as its markdown: Save off until it changes, a refusal beside the field, then saved (RA-2)", async ({
  page,
}) => {
  // A copy made for this and deleted after, so the rulesets the suites
  // after this use stay as they are.
  const listed = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string }[];
  };
  const copied = await page.request.post(`/api/rulesets/${listed.rulesets[0]!.id}/duplicate`, {
    data: { tier: "global", name: "A copy to edit" },
  });
  expect(copied.status()).toBe(201);
  const { rulesetId } = (await copied.json()) as { rulesetId: string };
  try {
    await page.goto(`/rulesets/${rulesetId}`);
    await expect(page.getByText("version 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Silent Fallback", exact: true }).click();
    const panel = page.getByTestId("rule-text");
    await panel.getByRole("button", { name: "Edit text" }).click();
    const field = panel.getByLabel("Rule 2a as markdown");
    const save = panel.getByRole("button", { name: "Save rule" });
    const raw = await field.inputValue();
    expect(raw.startsWith("### 2a. Silent Fallback\n")).toBe(true);
    // Nothing changed, so nothing to save.
    await expect(save).toBeDisabled();
    await shootAll(page, panel, "rule-edit-unchanged");

    // Refused in the parser's words, beside the field, the text kept as typed.
    await field.fill(`A note to self.\n${raw}`);
    await save.click();
    await expect(
      panel.getByText(
        "Line 1 comes before the rule's heading, so it would belong to no rule. Start with the heading.",
      ),
    ).toBeVisible();
    expect(await field.inputValue()).toBe(`A note to self.\n${raw}`);
    // And shown in what will read, not left out of it.
    await expect(panel.locator("p").filter({ hasText: "A note to self." })).toBeVisible();
    await shootAll(page, panel, "rule-edit-refused");

    // A title changed and a line added: the preview reads it before a save.
    const edited = `${raw.replace("### 2a. Silent Fallback", "### 2a. Silent Fallback Value")}\nA line added in the app.\n`;
    await field.fill(edited);
    await expect(panel.locator("p").filter({ hasText: "A line added in the app." })).toBeVisible();
    // The refusal goes with the text it was about.
    await expect(panel.getByText(/comes before the rule's heading/)).toHaveCount(0);
    await save.click();
    // Saved: the row's title, the ruleset's version, and the rule left open
    // on what it now says, the editor closed.
    await expect(
      page.getByRole("button", { name: "Silent Fallback Value", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("version 2", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Edit text" })).toBeVisible();
    await expect(panel).toContainText("A line added in the app.");
    await shootAll(page, panel, "rule-edit-saved");
  } finally {
    expect((await page.request.delete(`/api/rulesets/${rulesetId}`)).status()).toBe(200);
  }
});

test("a rule is added from a starting block: Add off until it is written, a refusal beside the field, then placed in its section (RA-3)", async ({
  page,
}) => {
  // A copy made for this and deleted after, so the rulesets the suites
  // after this use stay as they are.
  const listed = (await (await page.request.get("/api/rulesets")).json()) as {
    rulesets: { id: string }[];
  };
  const copied = await page.request.post(`/api/rulesets/${listed.rulesets[0]!.id}/duplicate`, {
    data: { tier: "global", name: "A copy to add to" },
  });
  expect(copied.status()).toBe(201);
  const { rulesetId } = (await copied.json()) as { rulesetId: string };
  const bothThemes = async () => {
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
  };
  try {
    await page.goto(`/rulesets/${rulesetId}`);
    await expect(page.getByText("version 1", { exact: true })).toBeVisible();
    const region = page.getByTestId("new-rule");
    await region.getByRole("button", { name: "Add a rule" }).click();
    const field = region.getByLabel("New rule as markdown");
    const add = region.getByRole("button", { name: "Add rule" });
    const starting = await field.inputValue();
    expect(starting.startsWith("### 15. Title of the rule\n")).toBe(true);
    // The starting block is nobody's rule: nothing to add yet.
    await expect(add).toBeDisabled();
    // The document's last section, unless another is picked, and the tags
    // the text as it stands would get there.
    const section = region.getByLabel("Section");
    await expect(section).toHaveValue("Dependency Anti-Patterns");
    await expect(region).toContainText(
      "The rule goes to the end of this section of the ruleset's document. Tagged general, from the section's name and the rule's title.",
    );
    await bothThemes();
    await shootAll(page, region, "rule-add-starting");

    // Refused in the server's words while a line of the starting text is
    // left, beside the field, the text kept as typed.
    const titled = starting.replace("Title of the rule", "Unchecked Index");
    await field.fill(titled);
    await add.click();
    await expect(
      region.getByText(
        "Line 3 still holds the starting text. Write the rule's own there, or take that part out.",
      ),
    ).toBeVisible();
    expect(await field.inputValue()).toBe(titled);
    await shootAll(page, region, "rule-add-refused");

    // Written whole and sent to another section: what it will be tagged
    // there is said before anything is saved.
    await field.fill(
      "### 15. Unchecked Index\n\n**Rule:** Flag an index read with no check that the entry is there.\n\n**Severity:** CRITICAL\n",
    );
    await section.selectOption("Typing Anti-Patterns");
    await expect(region).toContainText(
      "Tagged typescript, from the section's name and the rule's title.",
    );
    // The refusal was about the text as sent: it goes once that changes,
    // where it stayed up naming a line since rewritten.
    await expect(region.getByText(/still holds the starting text/)).toHaveCount(0);
    await shootAll(page, region, "rule-add-written");
    await add.click();

    // Added: where it went is said, its row is open on what it says, and
    // the version moved.
    await expect(region.getByRole("status")).toHaveText(
      "Rule 15 added to Typing Anti-Patterns, and opened above.",
    );
    await expect(page.getByText("version 2", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unchecked Index", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByTestId("rule-text");
    await expect(panel).toContainText("Flag an index read with no check that the entry is there.");
    // After the last rule of the section it was sent to, tagged as said.
    const detail = (await (await page.request.get(`/api/rulesets/${rulesetId}`)).json()) as {
      rules: { code: string; tags: string[]; severity: string; enabled: boolean }[];
    };
    const codes = detail.rules.map((rule) => rule.code);
    expect(codes.slice(codes.indexOf("4"), codes.indexOf("4") + 3)).toEqual(["4", "15", "5"]);
    expect(detail.rules.find((rule) => rule.code === "15")).toMatchObject({
      tags: ["typescript"],
      severity: "CRITICAL",
      enabled: true,
    });
    await bothThemes();
    await shootAll(page, region, "rule-add-added");
    await shootAll(page, panel, "rule-add-opened");

    // Asked again, the field opens on the next code, the note put away.
    await region.getByRole("button", { name: "Add a rule" }).click();
    expect((await field.inputValue()).startsWith("### 16. Title of the rule\n")).toBe(true);
    await expect(region.getByRole("status")).toHaveCount(0);
    await region.getByRole("button", { name: "Cancel" }).click();
    await expect(field).toHaveCount(0);
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    expect((await page.request.delete(`/api/rulesets/${rulesetId}`)).status()).toBe(200);
  }
});

test("a rule switched off is set back by colour, its row readable in both themes", async ({
  page,
}) => {
  // The row was drawn at 55% opacity, which put its tags, its badge and
  // "off" under AA contrast in both themes. No test had asked axe of a
  // ruleset with a rule off.
  const made = await page.request.post("/api/rulesets/import", {
    data: {
      name: "A ruleset with a rule off",
      tier: "global",
      markdown: readFileSync(PROTOCOL_PATH, "utf8"),
    },
  });
  expect(made.status(), await made.text()).toBe(201);
  const { rulesetId } = (await made.json()) as { rulesetId: string };
  try {
    await page.goto(`/rulesets/${rulesetId}`);
    await expect(page.getByText("version 1", { exact: true })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Unchecked Cast" });
    await row.getByRole("checkbox").click();
    await expect(page.getByText("version 2", { exact: true })).toBeVisible();
    await expect(row.getByText("off", { exact: true })).toBeVisible();
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
    expect(await row.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
    await shootAll(page, page.getByRole("table"), "rule-switched-off");
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    expect((await page.request.delete(`/api/rulesets/${rulesetId}`)).status()).toBe(200);
  }
});

test("a rule is removed on its ruleset's page: asked once, a page behind the ruleset refused and read again, its place saying it went, and a ruleset left with none saying so (RA-4)", async ({
  page,
}) => {
  // Rulesets imported for this and deleted after: it needs nothing the
  // journey leaves, and the suites after this find theirs as they were.
  const imported = async (name: string, markdown: string) => {
    const made = await page.request.post("/api/rulesets/import", {
      data: { name, tier: "global", markdown },
    });
    expect(made.status(), await made.text()).toBe(201);
    return ((await made.json()) as { rulesetId: string }).rulesetId;
  };
  const rulesetId = await imported("A ruleset to remove from", readFileSync(PROTOCOL_PATH, "utf8"));
  const oneId = await imported(
    "A ruleset with one rule",
    "# One\n\n## Hygiene\n\n### 1. Left-In Logging\n\n**Rule:** Flag a console call left in.\n",
  );
  const bothThemes = async () => {
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
  };
  const panel = page.getByTestId("rule-text");
  const rulesCard = page.getByTestId("rules");
  try {
    await page.goto(`/rulesets/${rulesetId}`);
    await expect(page.getByText("version 1", { exact: true })).toBeVisible();
    await expect(page.getByText("15 rules", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Silent Fallback", exact: true }).click();
    await panel.getByRole("button", { name: "Remove rule" }).click();
    const yes = panel.getByRole("button", { name: "Yes, remove rule 2a" });
    await expect(yes).toBeVisible();
    // What a removal is, against switching the rule off, before it is done.
    await expect(panel).toContainText(
      "Removing rule 2a takes its text out of this ruleset and out of the document it exports. Reviews already run keep it. To keep the text and leave the rule out of new reviews, switch it off instead.",
    );
    // The focus is on the answer that changes nothing, and goes back to the
    // control once the question is put away.
    await expect(panel.getByRole("button", { name: "Keep it" })).toBeFocused();
    await bothThemes();
    await shootAll(page, panel, "rule-remove-asked");
    await panel.getByRole("button", { name: "Keep it" }).click();
    await expect(yes).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Remove rule" })).toBeFocused();
    expect((await page.request.get(`/api/rulesets/${rulesetId}`)).status()).toBe(200);

    // The ruleset changes behind this page, as another tab would change it.
    // The server refuses the removal, and the page reads the ruleset again
    // and says so beside the control, the question put away.
    const changed = await page.request.patch(`/api/rulesets/${rulesetId}/rules/3`, {
      data: { enabled: false },
    });
    expect(changed.status()).toBe(200);
    await panel.getByRole("button", { name: "Remove rule" }).click();
    await yes.click();
    await expect(
      panel.getByText(
        "Rule 2a was not removed. The ruleset changed since this page read it, and the page now shows it as it stands, at version 2. Remove the rule again if it should still go.",
      ),
    ).toBeVisible();
    await expect(yes).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Remove rule" })).toBeFocused();
    await expect(page.getByText("version 2", { exact: true })).toBeVisible();
    await expect(page.getByText("15 rules, 1 switched off", { exact: true })).toBeVisible();
    await shootAll(page, panel, "rule-remove-refused");

    // Asked again from the page as it now stands, and removed. The refusal
    // goes with the question it answered.
    await panel.getByRole("button", { name: "Remove rule" }).click();
    await expect(panel.getByText(/was not removed/)).toHaveCount(0);
    await yes.click();
    const note = rulesCard.getByRole("status");
    await expect(note).toHaveText("Rule 2a removed. Reviews already run keep it.");
    // The control that had the focus went with the rule, so the note takes it.
    await expect(note).toBeFocused();
    await expect(page.getByText("version 3", { exact: true })).toBeVisible();
    await expect(page.getByText("14 rules, 1 switched off", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Silent Fallback", exact: true })).toHaveCount(0);
    // Said where the rule was: after rule 2, before rule 3.
    const rows = await rulesCard.getByRole("row").allInnerTexts();
    const at = rows.findIndex((row) => row.includes("Rule 2a removed"));
    expect(rows[at - 1]).toContain("Swallowed Error");
    expect(rows[at + 1]).toContain("Unchecked Cast");
    const detail = (await (await page.request.get(`/api/rulesets/${rulesetId}`)).json()) as {
      rules: { code: string }[];
    };
    expect(detail.rules.map((rule) => rule.code)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
    ]);
    const document = await (await page.request.get(`/api/rulesets/${rulesetId}/export`)).text();
    expect(document).toContain("### 2. Swallowed Error");
    expect(document).not.toContain("### 2a. Silent Fallback");
    await bothThemes();
    await shootAll(page, rulesCard, "rule-remove-removed");

    // The note is about the last change, and goes with the next one.
    await rulesCard
      .getByRole("row")
      .filter({ hasText: "Missing Cleanup" })
      .getByRole("checkbox")
      .click();
    await expect(page.getByText("version 4", { exact: true })).toBeVisible();
    await expect(note).toHaveCount(0);

    // A rule removed behind this page while its question is up: the server
    // has no such rule, and the page reads the ruleset again and says the
    // rule had gone, where it would have shown a rule the ruleset lacks.
    await page
      .getByRole("button", { name: "Changed Default Nobody Opted Into", exact: true })
      .click();
    await panel.getByRole("button", { name: "Remove rule" }).click();
    const behind = await page.request.delete(`/api/rulesets/${rulesetId}/rules/14?version=4`);
    expect(behind.status()).toBe(200);
    await panel.getByRole("button", { name: "Yes, remove rule 14" }).click();
    const gone = page.getByText(
      "Rule 14 was already gone. The ruleset changed since this page read it, and the page now shows it as it stands, at version 5.",
    );
    await expect(gone).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Changed Default Nobody Opted Into", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("13 rules, 2 switched off", { exact: true })).toBeVisible();
    await shootAll(page, gone, "rule-remove-already-gone");

    // The last rule goes too, and the ruleset says what that leaves.
    await page.goto(`/rulesets/${oneId}`);
    await expect(page.getByText("1 rule", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Left-In Logging", exact: true }).click();
    await panel.getByRole("button", { name: "Remove rule" }).click();
    await panel.getByRole("button", { name: "Yes, remove rule 1" }).click();
    await expect(note).toHaveText("Rule 1 removed. Reviews already run keep it.");
    await expect(page.getByText("0 rules", { exact: true })).toBeVisible();
    await expect(rulesCard).toContainText(
      "This ruleset has no rules, so a review will not start on it. Add a rule below.",
    );
    await expect(rulesCard.getByRole("columnheader")).toHaveCount(0);
    await bothThemes();
    await shootAll(page, rulesCard, "rule-remove-none");

    // A rule written into a ruleset with none, which no screen reached
    // before a rule could be removed: no section to pick, and none promised.
    const region = page.getByTestId("new-rule");
    await region.getByRole("button", { name: "Add a rule" }).click();
    await expect(note).toHaveCount(0);
    const field = region.getByLabel("New rule as markdown");
    expect((await field.inputValue()).startsWith("### 1. Title of the rule\n")).toBe(true);
    await expect(region.getByLabel("Section")).toHaveCount(0);
    await expect(region).toContainText("The rule goes to the end of the ruleset's document.");
    expect(await region.getByText(/Tagged/).count()).toBe(0);
    await shootAll(page, region, "rule-add-to-none");
    await field.fill("### 1. Left-In Logging\n\n**Rule:** Flag a console call left in.\n");
    await region.getByRole("button", { name: "Add rule" }).click();
    await expect(region.getByRole("status")).toHaveText("Rule 1 added, and opened above.");
    await expect(page.getByText("1 rule", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Left-In Logging", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    // Under the section the document ends on, as the importer reads it there.
    const one = (await (await page.request.get(`/api/rulesets/${oneId}`)).json()) as {
      rules: { code: string; group: string; tags: string[] }[];
    };
    expect(one.rules).toMatchObject([{ code: "1", group: "Hygiene", tags: ["organisation"] }]);
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    for (const id of [rulesetId, oneId]) {
      expect((await page.request.delete(`/api/rulesets/${id}`)).status()).toBe(200);
    }
  }
});

test("a save or an add made behind the ruleset keeps the text and reads the ruleset again, and a rule with no text says so (review round 18)", async ({
  page,
}) => {
  // Imported for this and deleted after, as the removal's test does. The
  // last rule is its heading alone, with no line break after it.
  const made = await page.request.post("/api/rulesets/import", {
    data: {
      name: "A ruleset changed behind its page",
      tier: "global",
      markdown:
        "# Behind\n\n## Hygiene\n\n### 1. Left-In Logging\n\n**Rule:** Flag a console call left in.\n\n## Typing\n\n### 2. Unchecked Cast\n\n**Rule:** Flag a cast nothing checks.\n\n### 3. Heading Alone",
    },
  });
  expect(made.status(), await made.text()).toBe(201);
  const rulesetId = ((await made.json()) as { rulesetId: string }).rulesetId;
  const bothThemes = async () => {
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
  };
  const panel = page.getByTestId("rule-text");
  const adder = page.getByTestId("new-rule");
  const toggled = async (enabled: boolean) => {
    const changed = await page.request.patch(`/api/rulesets/${rulesetId}/rules/1`, {
      data: { enabled },
    });
    expect(changed.status()).toBe(200);
  };
  try {
    await page.goto(`/rulesets/${rulesetId}`);
    await expect(page.getByText("version 1", { exact: true })).toBeVisible();

    // A rule that is its heading alone: the row carries the heading, and
    // the opened rule says there is nothing under it, where it drew the
    // heading again as the rule's text.
    await page.getByRole("button", { name: "Heading Alone", exact: true }).click();
    await expect(panel).toContainText(
      "This rule has no text under its heading. Edit text to write what it asks.",
    );
    await expect(panel.getByRole("heading")).toHaveCount(0);
    await bothThemes();
    await shootAll(page, panel, "rule-no-text");

    // A rule's text is edited, and the ruleset changes behind the page as
    // another tab would change it. The save is refused, and the page reads
    // the ruleset again with the text kept as typed, where the text could
    // only be saved after a reload that lost it.
    await page.getByRole("button", { name: "Unchecked Cast", exact: true }).click();
    await panel.getByRole("button", { name: "Edit text" }).click();
    const field = panel.getByLabel("Rule 2 as markdown");
    const typed =
      "### 2. Unchecked Cast\n\n**Rule:** Flag a cast nothing checks.\n\nCasts in tests count too.\n";
    await field.fill(typed);
    await toggled(false);
    await panel.getByRole("button", { name: "Save rule" }).click();
    await expect(
      panel.getByText(
        "Not saved yet. The ruleset was changed since this page read it, though not rule 2's text. The page now shows the ruleset as it stands, at version 2, and your text is kept: press Save rule again.",
      ),
    ).toBeVisible();
    await expect(field).toHaveValue(typed);
    await expect(page.getByText("version 2", { exact: true })).toBeVisible();
    await expect(page.getByText("3 rules, 1 switched off", { exact: true })).toBeVisible();
    await bothThemes();
    await shootAll(page, panel, "rule-save-behind");
    await panel.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByText("version 3", { exact: true })).toBeVisible();
    await expect(panel).toContainText("Casts in tests count too.");
    await expect(field).toHaveCount(0);

    // The rule's own text changed behind the page: saving would put this
    // text in place of that change, so the page says which it is first.
    await panel.getByRole("button", { name: "Edit text" }).click();
    await field.fill(`${typed}\nAnd in fixtures.\n`);
    const elsewhere = await page.request.put(`/api/rulesets/${rulesetId}/rules/2`, {
      data: {
        markdown: "### 2. Unchecked Cast\n\n**Rule:** Flag a cast with no check before it.\n",
        version: 3,
      },
    });
    expect(elsewhere.status()).toBe(200);
    await panel.getByRole("button", { name: "Save rule" }).click();
    await expect(
      panel.getByText(
        "Not saved yet. Rule 2's text was changed since this page read it. The page now shows the ruleset as it stands, at version 4, and your text is kept: press Save rule again to put it in place of that change, or Cancel to see the rule as it now reads.",
      ),
    ).toBeVisible();
    await expect(field).toHaveValue(`${typed}\nAnd in fixtures.\n`);
    await shootAll(page, panel, "rule-save-behind-own-text");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel).toContainText("Flag a cast with no check before it.");

    // A new rule written while the ruleset changes behind the page: kept as
    // typed, and added on the next press.
    await adder.getByRole("button", { name: "Add a rule" }).click();
    const fresh = adder.getByLabel("New rule as markdown");
    await fresh.fill("### 4. Fresh Four\n\n**Rule:** Flag it.\n");
    await toggled(true);
    await adder.getByRole("button", { name: "Add rule" }).click();
    await expect(
      adder.getByText(
        "Not added yet. The ruleset was changed since this page read it. The page now shows it as it stands, at version 5, and your text is kept: press Add rule again.",
      ),
    ).toBeVisible();
    await expect(fresh).toHaveValue("### 4. Fresh Four\n\n**Rule:** Flag it.\n");
    await bothThemes();
    await shootAll(page, adder, "rule-add-behind");
    await adder.getByRole("button", { name: "Add rule" }).click();
    await expect(adder.getByRole("status")).toHaveText("Rule 4 added to Typing, and opened above.");

    // The section picked for a new rule loses its last rule: the rule can
    // no longer go there, and the page stops naming it and its tags.
    await adder.getByRole("button", { name: "Add a rule" }).click();
    await fresh.fill("### 5. Fresh Five\n\n**Rule:** Flag it.\n");
    await adder.getByLabel("Section").selectOption("Hygiene");
    await expect(adder).toContainText("Tagged organisation, from the section's name");
    await page.getByRole("button", { name: "Left-In Logging", exact: true }).click();
    await panel.getByRole("button", { name: "Remove rule" }).click();
    await panel.getByRole("button", { name: "Yes, remove rule 1" }).click();
    await expect(page.getByText("3 rules", { exact: true })).toBeVisible();
    await expect(adder.getByLabel("Section")).toHaveCount(0);
    await expect(adder).toContainText(
      "The rule goes after the last rule of the ruleset's document. Tagged typescript, from the section's name",
    );
    await expect(fresh).toHaveValue("### 5. Fresh Five\n\n**Rule:** Flag it.\n");
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    expect((await page.request.delete(`/api/rulesets/${rulesetId}`)).status()).toBe(200);
  }
});

test("a change that moves another rule's sweep patterns says so, and a code that sweep rows name is held with the way to change it (RA-5b)", async ({
  page,
}) => {
  // Imported for this and deleted after: the suites after this find their
  // rulesets as they were.
  const made = await page.request.post("/api/rulesets/import", {
    data: {
      name: "A ruleset with sweep rows",
      tier: "global",
      markdown: readFileSync(PROTOCOL_PATH, "utf8"),
    },
  });
  expect(made.status(), await made.text()).toBe(201);
  const { rulesetId } = (await made.json()) as { rulesetId: string };
  const bothThemes = async () => {
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
  };
  const panel = page.getByTestId("rule-text");
  const moved = (rules: string) =>
    `That also changed sweep patterns, which are read from table rows anywhere in the ruleset's document: ${rules}.`;
  try {
    await page.goto(`/rulesets/${rulesetId}`);
    await expect(page.getByText("version 1", { exact: true })).toBeVisible();

    // A table row written into rule 4's text names rule 5, which makes it a
    // sweep row of rule 5's, as it would be in an imported document.
    await page.getByRole("button", { name: "Index Signature Hiding a Typo", exact: true }).click();
    await panel.getByRole("button", { name: "Edit text" }).click();
    const field = panel.getByLabel("Rule 4 as markdown");
    await field.fill(
      `${await field.inputValue()}\n| Sweep for | What a hit means |\n| --- | --- |\n| \`setInterval\` | Rule 5: missing cleanup |\n`,
    );
    await panel.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByText("version 2", { exact: true })).toBeVisible();
    await expect(panel.getByRole("status")).toHaveText(moved("rule 5 now has 2 (it had 1)"));
    await bothThemes();
    await shootAll(page, panel, "rule-sweeps-moved-saved");

    // The sweep table names rule 6, so under another code it would lose its
    // patterns: refused, with the way a code is changed.
    await page.getByRole("button", { name: "Left-In Logging", exact: true }).click();
    await panel.getByRole("button", { name: "Edit text" }).click();
    const held = panel.getByLabel("Rule 6 as markdown");
    await held.fill((await held.inputValue()).replace("### 6.", "### 6a."));
    await panel.getByRole("button", { name: "Save rule" }).click();
    await expect(
      panel.getByText(
        "Rule 6 was not saved as 6a: table rows list its sweep patterns under 6, and under 6a it would lose them. Rows in the rule's own text can change with its heading. For rows elsewhere, change the code in the exported document and import that.",
      ),
    ).toBeVisible();
    await shootAll(page, panel, "rule-code-held");
    await panel.getByRole("button", { name: "Cancel" }).click();

    // A new rule whose own text holds its sweep row.
    await page.getByRole("button", { name: "Add a rule" }).click();
    await page
      .getByLabel("New rule as markdown")
      .fill(
        "### 15. Timer Left Running\n\n**Rule:** Flag a timer nothing clears.\n\n| Sweep for | What a hit means |\n| --- | --- |\n| `setImmediate` | Rule 15 |\n",
      );
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("version 3", { exact: true })).toBeVisible();
    await expect(panel.getByRole("status")).toHaveText(moved("rule 15 now has 1 (it had none)"));

    // Removed, rule 4 takes its row with it, and rule 5 the pattern it gave.
    await page.getByRole("button", { name: "Index Signature Hiding a Typo", exact: true }).click();
    await panel.getByRole("button", { name: "Remove rule" }).click();
    await panel.getByRole("button", { name: "Yes, remove rule 4" }).click();
    const gone = page.getByRole("status").filter({ hasText: "Rule 4 removed." });
    await expect(gone).toHaveText(
      `Rule 4 removed. Reviews already run keep it. ${moved("rule 5 now has 1 (it had 2)")}`,
    );
    await expect(gone).toBeFocused();
    await bothThemes();
    await shootAll(page, gone, "rule-sweeps-moved-removed");
  } finally {
    expect((await page.request.delete(`/api/rulesets/${rulesetId}`)).status()).toBe(200);
  }
});

test("a ruleset is started with no document: a name and a tier, nothing to export until it has a rule, and a name in use refused beside the form (RA-6)", async ({
  page,
}) => {
  const name = "Rules written here";
  const form = page.getByTestId("new-ruleset");
  const withDocument = form.getByRole("radio", { name: "A document", exact: true });
  const withNone = form.getByRole("radio", { name: "No document" });
  const create = form.getByRole("button", { name: "Create ruleset" });
  const bothThemes = async () => {
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
  };
  try {
    // With no ruleset yet, the list names both ways to start one. Staged as
    // the server answers an empty app: the journey has left its rulesets.
    const stopEmpty = await answerOnce(page, "**/api/rulesets", (route) =>
      route.fulfill({ json: { rulesets: [], defaultRulesetId: null } }),
    );
    await page.goto("/rulesets");
    await expect(page.getByText("No rulesets yet", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Start one from a template, paste a protocol document, or start with no document and write its rules on its page. Every review needs a ruleset.",
      ),
    ).toBeVisible();
    await bothThemes();
    await shootAll(page, page.locator("main"), "ruleset-new-none-yet");
    await stopEmpty();

    await page.goto("/rulesets");
    // The form opens on a template (RT-1b). Chosen from the keyboard: the
    // choice is three radios after the tier, a document the second.
    const withTemplate = form.getByRole("radio", { name: "A template", exact: true });
    await expect(withTemplate).toBeChecked();
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Tier").selectOption("tech");
    await form.getByLabel("Tier").focus();
    await page.keyboard.press("Tab");
    await expect(withTemplate).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(withDocument).toBeChecked();
    await expect(form.getByLabel("Protocol document")).toBeVisible();
    await expect(form.getByRole("button", { name: "Import" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(withNone).toBeChecked();
    await expect(form.getByLabel("Protocol document")).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Import" })).toHaveCount(0);
    await expect(form).toContainText(
      "The ruleset starts with no rules. You write them on its page, and a review will not start on it until it has one.",
    );
    await bothThemes();
    await shootAll(page, form, "ruleset-new-no-document");

    // Made, and opened: the next thing to do is write its first rule.
    await create.click();
    await expect(page).toHaveURL(/\/rulesets\/[A-Z0-9]+$/i);
    const rulesetId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByText("version 1", { exact: true })).toBeVisible();
    await expect(page.getByText("0 rules", { exact: true })).toBeVisible();
    const rulesCard = page.getByTestId("rules");
    await expect(rulesCard).toContainText(
      "This ruleset has no rules, so a review will not start on it. Add a rule below.",
    );
    // With no rule and no directive there is no document, and the control
    // says so where an empty file would have been downloaded.
    const exportOff = page.getByRole("button", { name: "Export document" });
    await expect(exportOff).toBeDisabled();
    await expect(exportOff).toHaveAccessibleDescription(
      "It has no document to export until a rule is written into it.",
    );
    await expect(rulesCard).toContainText(
      "It has no document to export until a rule is written into it.",
    );
    await expect(page.getByRole("link", { name: "Export document" })).toHaveCount(0);
    // It has no directive either, and says what a review is given without
    // one, where it offered to show "the 0 process directive(s)".
    await expect(
      page.getByText(
        "No process directives: the parts of a protocol that are not rules come with an imported document or a template and are not written here. A review on this ruleset is given its rules and the app's own instructions.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /process directive/ })).toHaveCount(0);
    const none = await page.request.get(`/api/rulesets/${rulesetId}/export`);
    expect(none.status()).toBe(409);
    expect(await none.json()).toEqual({
      error: `"${name}" has no rules and no directives, so it has no document to export. Write a rule into it first.`,
      code: "NothingToExport",
    });
    await bothThemes();
    await shootAll(page, page.locator("main"), "ruleset-new-empty");

    // Its first rule, written here. The document is then that rule.
    const block = "### 1. Left-In Logging\n\n**Rule:** Flag a console call left in.\n";
    const region = page.getByTestId("new-rule");
    await region.getByRole("button", { name: "Add a rule" }).click();
    await region.getByLabel("New rule as markdown").fill(block);
    await region.getByRole("button", { name: "Add rule" }).click();
    await expect(region.getByRole("status")).toHaveText("Rule 1 added, and opened above.");
    await expect(page.getByText("1 rule", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export document" })).toBeVisible();
    await expect(page.getByText(/no document to export/)).toHaveCount(0);
    const document = await page.request.get(`/api/rulesets/${rulesetId}/export`);
    expect(document.status()).toBe(200);
    expect(await document.text()).toBe(block);

    // Listed under its tier, and its name is then taken: a second one under
    // it is refused beside the form, nothing made, the name left to change.
    await page.goto("/rulesets");
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await form.getByText("No document", { exact: true }).click();
    await expect(withNone).toBeChecked();
    await expect(create).toBeDisabled();
    await form.getByLabel("Name").fill(name);
    await create.click();
    const refusal = form.getByText(
      `A ruleset called "${name}" already exists. Give the new one another name, or open "${name}" and add rules there.`,
    );
    await expect(refusal).toBeVisible();
    await expect(page).toHaveURL(/\/rulesets$/);
    await expect(form.getByLabel("Name")).toHaveValue(name);
    await bothThemes();
    await shootAll(page, form, "ruleset-new-name-taken");
    // The refusal was about that name, and goes when the name changes.
    await form.getByLabel("Name").fill(`${name}, again`);
    await expect(refusal).toHaveCount(0);
    await withDocument.check();
    await expect(form.getByLabel("Protocol document")).toBeVisible();

    // A document imported under the name of a ruleset that holds nothing is
    // not asked about: the question warns of rules replaced and switches
    // undone, and there are none (review round 19).
    const blank = `${name}, blank`;
    const started = await page.request.post("/api/rulesets", {
      data: { name: blank, tier: "global" },
    });
    expect(started.status()).toBe(201);
    await form.getByLabel("Name").fill(blank);
    await form.getByLabel("Protocol document").fill(`# Team rules\n\n## Hygiene\n\n${block}`);
    await form.getByRole("button", { name: "Import" }).click();
    await expect(
      form.getByText(
        "Imported 1 rule(s) and 2 directive(s) as version 2. All 8 lines of the document are accounted for.",
      ),
    ).toBeVisible();
    expect(await form.getByRole("button", { name: /^Replace/ }).count()).toBe(0);
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    const listed = (await (await page.request.get("/api/rulesets")).json()) as {
      rulesets: { id: string; name: string }[];
    };
    for (const row of listed.rulesets.filter((ruleset) => ruleset.name.startsWith(name))) {
      expect((await page.request.delete(`/api/rulesets/${row.id}`)).status()).toBe(200);
    }
  }
});

test("the template shelf is read by the server as built, and holds its four templates (RT-1 to RT-5)", async ({
  page,
}) => {
  // The shelf is a folder outside `src/`, read at run time: a build that
  // could not find it answers 500 here.
  const listed = await page.request.get("/api/ruleset-templates");
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual({
    templates: [
      expect.objectContaining({
        slug: "general",
        name: "General",
        version: 1,
        ruleCount: 12,
        modelRun: null,
      }),
      expect.objectContaining({
        slug: "typescript",
        name: "TypeScript",
        version: 3,
        ruleCount: 9,
        modelRun: null,
      }),
      expect.objectContaining({
        slug: "react",
        name: "React",
        version: 3,
        ruleCount: 8,
        modelRun: null,
      }),
      expect.objectContaining({
        slug: "http-api",
        name: "HTTP API and database",
        version: 3,
        ruleCount: 8,
        modelRun: null,
      }),
    ],
  });
});

test("a ruleset is started from a template: the form opens on the shelf, a shelf not read says so, and a name in use is refused beside the form (RT-1b)", async ({
  page,
}) => {
  const form = page.getByTestId("new-ruleset");
  const fromTemplate = form.getByRole("radio", { name: "A template", exact: true });
  const general = form.getByRole("radio", { name: /^General/ });
  const use = form.getByRole("button", { name: "Use this template" });
  const bothThemes = async () => {
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
  };
  try {
    // The shelf not read: said where the templates would be, the button
    // off, and a way to ask again.
    const stopRefusing = await answerOnce(page, "**/api/ruleset-templates", (route) =>
      route.fulfill({
        status: 500,
        json: { error: "Refused for this test: the templates.", code: "Test" },
      }),
    );
    await page.goto("/rulesets");
    await expect(fromTemplate).toBeChecked();
    await expect(form.getByText("Refused for this test: the templates.")).toBeVisible();
    await expect(use).toBeDisabled();
    await bothThemes();
    await shootAll(page, form, "ruleset-template-unread");
    await stopRefusing();
    await form.getByRole("button", { name: "Try again" }).click();

    // Read: the one template, chosen, with what it is for, how many rules
    // it holds and that no model has run it.
    await expect(general).toBeChecked();
    const entry = form
      .locator("label")
      .filter({ has: page.getByRole("radio", { name: /^General/ }) });
    await expect(entry).toContainText("12 rules");
    await expect(entry).toContainText("What any change is held to, whatever it is written in.");
    await expect(entry).toContainText("Not yet run against a model.");
    await expect(form.getByText("Left empty, the ruleset is called General.")).toBeVisible();
    await expect(form.getByLabel("Protocol document")).toHaveCount(0);
    await expect(use).toBeEnabled();
    await bothThemes();
    await shootAll(page, page.locator("main"), "ruleset-template-chosen");

    // Used with no name given: the ruleset takes the template's, and its
    // page opens on the rules, saying where they came from.
    await use.click();
    await expect(page).toHaveURL(/\/rulesets\/[A-Z0-9]+$/i);
    await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();
    await expect(page.getByText("12 rules", { exact: true })).toBeVisible();
    await expect(page.getByText(/Imported from the General template, version 1\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Swallowed error", exact: true })).toBeVisible();
    await bothThemes();
    await shootAll(page, page.locator("main"), "ruleset-from-template");

    // Used again: the name is taken, said beside the form, nothing made,
    // and the answer is a name of the person's own.
    await page.goto("/rulesets");
    await expect(general).toBeChecked();
    await use.click();
    const refusal = form.getByText(
      'A ruleset called "General" already exists. Give the new one another name, or open "General" and add rules there.',
    );
    await expect(refusal).toBeVisible();
    await expect(page).toHaveURL(/\/rulesets$/);
    await bothThemes();
    await shootAll(page, form, "ruleset-template-name-taken");
    await form.getByLabel("Name").fill("House rules");
    expect(await refusal.count()).toBe(0);
    await form.getByLabel("Tier").selectOption("project");
    await use.click();
    await expect(page.getByRole("heading", { name: "House rules", exact: true })).toBeVisible();
    await expect(page.getByText("12 rules", { exact: true })).toBeVisible();
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    const listed = (await (await page.request.get("/api/rulesets")).json()) as {
      rulesets: { id: string; name: string }[];
    };
    for (const row of listed.rulesets.filter((ruleset) =>
      ["General", "House rules"].includes(ruleset.name),
    )) {
      expect((await page.request.delete(`/api/rulesets/${row.id}`)).status()).toBe(200);
    }
  }
});

test("with no ruleset yet, a new review and the dashboard say to start one, where they said to import one", async ({
  page,
}) => {
  // The Rulesets form opens on a template (RT-1b), so importing is one way
  // of three. Each answer is staged as the server gives it for an app with
  // nothing in it: no ruleset, and a scoreboard of nothing, which a unit
  // test holds to what the server answers.
  const projects = (await (await page.request.get("/api/projects")).json()) as {
    projects: { id: string; name: string }[];
  };
  const app = projects.projects.find((project) => project.name === "app")!;
  const stopNone = await answerOnce(page, "**/api/rulesets", (route) =>
    route.fulfill({ json: { rulesets: [], defaultRulesetId: null } }),
  );
  await page.goto(`/reviews/new?projectId=${app.id}`);
  // Where the list would be, the card says there is none to tick.
  await expect(page.getByText("No rulesets yet", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("ruleset-picker")).toHaveCount(0);
  await expect(page.getByText("Start a ruleset first:")).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Rulesets", exact: true }),
  ).toHaveAttribute("href", "/rulesets");
  await expect(page.getByRole("button", { name: "Start review" })).toBeDisabled();
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await accessibilityViolations(page), scheme).toEqual([]);
  }
  await shootAll(page, page.locator("main"), "new-review-no-ruleset");
  await stopNone();

  const stopEmpty = await answerOnce(page, "**/api/scoreboard", (route) =>
    route.fulfill({
      json: {
        spendUsd: 0,
        reviewsCompleted: 0,
        reviewsTotal: 0,
        precision: null,
        proofsDiscardedRate: null,
        awaiting: 0,
        awaitingReviews: [],
        spendHistory: [],
        recent: [],
        ruleYield: [],
        projects: [],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("Nothing has been reviewed yet", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Add a project, start a ruleset from a template or from your own protocol, then pick two branches and run a review.",
      { exact: false },
    ),
  ).toBeVisible();
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await accessibilityViolations(page), scheme).toEqual([]);
  }
  await shootAll(page, page.locator("main"), "dashboard-nothing-reviewed");
  await stopEmpty();
  await page.emulateMedia({ colorScheme: "light" });
});

test("the addresses a result goes to are kept on Settings, which says nothing is sent yet, and a line that is not one address is refused beside the field (EM-2a)", async ({
  page,
}) => {
  const bothThemes = async () => {
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await accessibilityViolations(page), scheme).toEqual([]);
    }
  };
  try {
    await page.goto("/settings");
    const card = page
      .getByRole("main")
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: "Where results are sent" }) })
      .last();
    // Said before the field, on a line of its own: an address typed here
    // does nothing yet.
    await expect(card).toContainText(
      "The addresses a review's result is to be emailed to. The first is the default.",
    );
    await expect(
      card.getByText(
        "No mail account is set up yet, so nothing is sent. Addresses are kept for later.",
      ),
    ).toBeVisible();
    const field = card.getByLabel("Addresses, one per line");
    await expect(field).toHaveValue("");
    await bothThemes();
    await shootAll(page, card, "settings-result-addresses-none");

    // Two addresses, saved as the field is left, the first staying first.
    await field.fill("lead@example.invalid\n  team@example.invalid  ");
    await field.blur();
    await expect(card.getByText("Saved.", { exact: true })).toBeVisible();
    await expect(field).toHaveValue("lead@example.invalid\nteam@example.invalid");
    await page.reload();
    await expect(card.getByLabel("Addresses, one per line")).toHaveValue(
      "lead@example.invalid\nteam@example.invalid",
    );
    await bothThemes();
    await shootAll(page, card, "settings-result-addresses-kept");

    // A name with its address is two things: refused in words, the text
    // kept as typed, and what was stored left as it was.
    const again = card.getByLabel("Addresses, one per line");
    await again.fill("Lead <lead@example.invalid>");
    await again.blur();
    await expect(card).toContainText(
      'The list of addresses holds "Lead <lead@example.invalid>", which is not one email address: enter the address alone, as name@example.com',
    );
    await expect(again).toHaveValue("Lead <lead@example.invalid>");
    expect(await card.getByText("Saved.", { exact: true }).count()).toBe(0);
    const stored = (await (await page.request.get("/api/settings")).json()) as {
      settings: { resultAddresses: string[] };
    };
    expect(stored.settings.resultAddresses).toEqual([
      "lead@example.invalid",
      "team@example.invalid",
    ]);
    await bothThemes();
    await shootAll(page, card, "settings-result-addresses-refused");
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    expect(
      (await page.request.put("/api/settings", { data: { resultAddresses: [] } })).status(),
    ).toBe(200);
  }
});

test("a ruleset's page says what its exported document leaves out: a severity changed with the picker", async ({
  page,
}) => {
  // The export is the document, every rule's text byte for byte. A severity
  // changed beside the text is not in it, which a unit test holds
  // (rule-round-trip) and the page did not say (review round 19).
  await page.goto("/rulesets");
  await page.getByRole("main").getByRole("link", { name: "Example protocol", exact: true }).click();
  const said = page.getByText(
    "The exported document holds every rule's text, switched off or not: a severity changed with the picker here is not written into it.",
  );
  await expect(said).toBeVisible();
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await accessibilityViolations(page), scheme).toEqual([]);
  }
  await shootAll(page, said, "ruleset-export-leaves-out");
  await page.emulateMedia({ colorScheme: "light" });
});
