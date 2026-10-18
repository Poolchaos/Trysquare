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

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { answerOnce } from "./answer-once";
import { APP_REPO, PROTOCOL_PATH, REFUTED_ISSUE, REFUTED_NOTE } from "./setup";

/**
 * The confirmation queue can only be photographed from here: by the time the
 * theme passes run, this review is complete and the queue is a report.
 */
const EVIDENCE = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "review",
  `${new Date().toISOString().slice(0, 10)}-e2e`,
);

/** Distinctive enough that finding it in the export cannot be a coincidence. */
const EDITED_COMMENT = "Rewritten by hand: this bills a sub-cent invoice as zero.";

/**
 * Counts the page reading the review it shows afresh, from now until stopped.
 * That review's own path, not any under /api/reviews: the top bar polls
 * /api/reviews/attention, which counted as a reload the page never made.
 */
function countReviewReads(page: import("@playwright/test").Page) {
  const own = `/api${new URL(page.url()).pathname}`;
  const counter = { count: 0, stop: () => page.off("request", onRequest) };
  function onRequest(request: import("@playwright/test").Request) {
    if (request.method() === "GET" && new URL(request.url()).pathname === own) counter.count += 1;
  }
  page.on("request", onRequest);
  return counter;
}

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
    // The fidelity report: the sentence a reader trusts the ruleset with, made
    // of the importer's own counts rather than reassurance.
    await expect(page.getByText(/All \d+ lines of the document are accounted for/)).toBeVisible();
  });

  await test.step("the project page lists its branches with how far they have moved", async () => {
    await page.goto("/projects");
    await page.getByRole("link", { name: "app", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Branches" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Dependencies" })).toBeVisible();
  });

  await test.step("a model must be probed before it can be chosen", async () => {
    await page.getByRole("link", { name: "New review" }).click();
    await expect(page.getByRole("heading", { name: "New review" })).toBeVisible();

    // Nothing has been probed, so nothing is selectable and the form cannot
    // start: an unprobed model is a guess, and the app does not guess.
    const picker = page.getByTestId("model-picker");
    await expect(picker.getByText("never probed").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start review" })).toBeDisabled();

    const fable = picker.locator("li").filter({ hasText: "Fable 5 (1M context)" });
    await fable.getByRole("button", { name: "Probe" }).click();

    // The probe unlocks the row and fills in what it learned: the window it
    // reported, the profile the registry maps it to, and when it was asked.
    await expect(fable.getByText(/1,000,000 token window/)).toBeVisible({ timeout: 30_000 });
    await expect(fable.getByText(/full-context profile/)).toBeVisible();
    await expect(fable.getByText(/probed just now/)).toBeVisible();
  });

  await test.step("setting up a review shows what it will examine first", async () => {
    // The branch list says when it was read from the remote, so a stale
    // morning tab is distinguishable from a fresh one.
    await expect(page.getByText(/Fetched from the remote at/)).toBeVisible();

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
    // The branch under review is excluded, and the fixture's bare-clone HEAD
    // is that same branch, so the fallback picks the first remaining branch
    // by recency then refname. That is main only while rename-prefs-migrated
    // keeps sorting after it; this assertion is what catches a fixture branch
    // ever sorting ahead.
    await expect(page.getByLabel("Compare against")).toHaveValue("main");
    await expect(
      page.getByLabel("Compare against").locator("option", { hasText: "feature/rename-prefs" }),
    ).toHaveCount(0);
    await page
      .getByLabel(/What was this change meant to do/)
      .fill("Rename the prefs field and migrate every consumer.");

    // The CLI's top effort tier is never offered, on cost (D-125); the tier
    // below it is, since this model runs it (D-122).
    const effort = page.getByLabel("Effort");
    await expect(effort.locator("option")).toHaveCount(4);
    await expect(effort.locator("option", { hasText: "Extra high" })).toHaveCount(1);
    await expect(effort.locator("option", { hasText: "Max" })).toHaveCount(0);
    await expect(effort).toHaveValue("high");

    // Extra high chosen, then a model the CLI runs without it: the picker
    // shows and sends high instead, rather than an effort the run would not
    // get. Haiku 4.5, since every current model does run it (D-123); it can
    // be picked here though the server refuses it a review. Back on Fable the
    // choice stays high: it used to come back as Extra high on its own, and
    // a review started then ran at it (review of 4.5 to 4.7).
    const picker = page.getByTestId("model-picker");
    await effort.selectOption("xhigh");
    await page.getByRole("button", { name: /model\(s\) that need probing/ }).click();
    const haiku = picker.locator("li").filter({ hasText: "Haiku 4.5" });
    await haiku.getByRole("button", { name: "Probe" }).click();
    await expect(haiku.getByText(/probed just now/)).toBeVisible({ timeout: 30_000 });
    await haiku.locator("label").click();
    await expect(effort.locator("option")).toHaveCount(3);
    await expect(effort).toHaveValue("high");
    await picker.locator("li").filter({ hasText: "Fable 5 (1M context)" }).locator("label").click();
    await expect(effort.locator("option")).toHaveCount(4);
    await expect(effort).toHaveValue("high");

    // The pre-flight is free and read-only, so it appears on its own once the
    // four decisions are made.
    await expect(page.getByText("What this review will examine")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Files changed")).toBeVisible();
    await expect(page.getByText("Merge base")).toBeVisible();
    await expect(page.getByText(/pinned again when the review starts/)).toBeVisible();
  });

  await test.step("the advanced fold offers only honest downgrades", async () => {
    await page.getByText("Advanced", { exact: true }).click();
    await expect(page.getByText("Adversarial requests by profile")).toBeVisible();

    // Choosing a weaker profile is reflected in the numbers before anything
    // is spent: the preview and the run read the same resolution.
    const requestsRow = page.getByText("Model requests").locator("..").locator("dd");
    const fullContextRequests = Number(await requestsRow.textContent());
    await page.getByTestId("profile-override").selectOption("decomposed");
    await expect(page.getByText(/Downgraded from full-context to decomposed/)).toBeVisible();
    await expect
      .poll(async () => Number(await requestsRow.textContent()))
      .toBeGreaterThan(fullContextRequests);

    // Back to the model's own, so the run below is the one the answers are
    // scripted for.
    await page.getByTestId("profile-override").selectOption("");
    await expect(page.getByText(/Downgraded from/)).toBeHidden();
    await page.getByText("Advanced", { exact: true }).click();
  });

  await test.step("Enter in the branch filter filters, and starts nothing", async () => {
    // The filter sits inside the start form, so Enter there submitted it and
    // started a paid review from a keystroke meant for a search box (5.2).
    // Pressed once the form is ready, which is when it used to submit.
    await expect(page.getByRole("button", { name: "Start review" })).toBeEnabled();
    let creates = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/reviews") {
        creates += 1;
      }
    });
    const filter = page.getByPlaceholder("Filter branches");
    await filter.fill("rename");
    await filter.press("Enter");
    await page.waitForTimeout(500);
    expect(creates).toBe(0);
    await expect(page).toHaveURL(/\/reviews\/new/);
    await filter.fill("");
  });

  await test.step("starting it walks the stages and then stops for a person", async () => {
    await page.getByRole("button", { name: "Start review" }).click();
    await expect(page).toHaveURL(/\/reviews\/[A-Z0-9]+$/i, { timeout: 60_000 });
    await expect(page.getByText("awaiting your decision")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/\d+ of \d+ decided/)).toBeVisible();
  });

  await test.step("the run screen accounts for the whole change set", async () => {
    // The distinction the coverage panel exists to make: a review that found
    // nothing has to be readable apart from one that looked at nothing.
    //
    // Once the review is waiting on a decision the run detail folds away, so
    // the queue is not below a screenful of finished work. What must survive
    // the fold is this sentence: whether anything went unaccounted for is not
    // a thing to make someone open a disclosure to learn.
    await expect(
      page.getByText("Everything the change touched ended with a finding or an explicit clear."),
    ).toBeVisible();
    // Accounted for, but a refutation is said, not folded away with the rest.
    await expect(
      page.getByText("1 hunk(s) were accounted for only by findings that verification refuted."),
    ).toBeVisible();

    await page.getByText("Run detail", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
    await expect(page.getByText(/Files.*\d+ of \d+ accounted for/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Refuted in verification" })).toBeVisible();
    await expect(page.getByText(REFUTED_ISSUE)).toBeVisible();
    await expect(page.getByText(REFUTED_NOTE)).toBeVisible();

    // The deterministic ends of the pipeline. They write no stage row, so
    // they are the rows most easily lost, and they are the parts of a review
    // a model cannot be blamed for.
    const stages = page.getByRole("heading", { name: "Stages" }).locator("..");
    await expect(stages.getByText("Prepare")).toBeVisible();
    await expect(stages.getByText("Audit")).toBeVisible();
    await expect(stages.getByText(/fresh,.*cached,.*out, \$/).first()).toBeVisible();

    // Left as a reader finds it, so the screenshot below photographs the
    // queue-first layout rather than this test's own expansion.
    await page.getByText("Run detail", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Coverage" })).toBeHidden();
  });

  await test.step("the queue mid-decision is photographed for the design review", async () => {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.locator("body").screenshot({
      path: join(EVIDENCE, "journey-confirmation.png"),
      animations: "disabled",
      caret: "hide",
    });
  });

  await test.step("the active finding carries what the decision needs", async () => {
    // A person deciding a finding is usually deciding whether the rule says
    // what the engine claims, and then whether this change caused it. Both
    // answers have to be on the screen, from the review's own frozen ruleset
    // and its own diff rather than from today's versions of either.
    await page.getByRole("button", { name: /^Rule / }).click();
    await expect(page.getByText(/^#{2,3} .*\d/m).first()).toBeVisible();

    await page.locator("body").press("Enter");
    await expect(page.getByRole("heading", { name: "What the change did here" })).toBeVisible();
    await expect(page.getByText(/^@@ -\d+,\d+ \+\d+,\d+ @@/m)).toBeVisible();
    await expect(page.getByRole("heading", { name: "The file as it stands" })).toBeVisible();
    await page.locator("body").press("Enter");
  });

  await test.step("a reason typed on one finding does not follow the cursor", async () => {
    // It used to. The reason was one shared string, so an abandoned draft on
    // one finding was still in the box on the next, and dismissing that one
    // recorded, permanently, why something else was not a problem.
    const reasonBox = page.getByLabel("Why is this not a problem?");
    await reasonBox.fill("Abandoned: meant for this one.");
    // Escape leaves the input, which is what hands the keyboard back to the
    // queue: keys typed into a field must never also drive it.
    await reasonBox.press("Escape");
    await page.locator("body").press("j");
    await expect(reasonBox).toHaveValue("");
    await page.locator("body").press("k");
    // Coming back finds the draft where it was left, which is the other half
    // of keeping it per finding rather than merely clearing it on the move.
    await expect(reasonBox).toHaveValue("Abandoned: meant for this one.");
  });

  await test.step("a held key does not walk the queue deciding findings", async () => {
    // An auto-repeat used to confirm its way down the list. Nothing may enter
    // a report without a person deciding it, and holding a key is not
    // deciding twenty things.
    const before = await page.getByText(/\d+ of \d+ decided/).textContent();
    await page.locator("body").dispatchEvent("keydown", { key: "c", repeat: true });
    await page.waitForTimeout(300);
    await expect(page.getByText(/\d+ of \d+ decided/)).toHaveText(String(before));
  });

  await test.step("a decision that does not get through says so, and decides nothing", async () => {
    // A dropped connection, and a server error whose body is not JSON, both
    // used to fail in silence: the decision was lost and looked made.
    const before = await page.getByText(/\d+ of \d+ decided/).textContent();
    await page.route("**/api/findings/*/confirm", (route) => route.abort(), { times: 1 });
    await page.locator("body").press("c");
    await expect(page.getByText(/The decision could not be sent/)).toBeVisible();

    await page.route(
      "**/api/findings/*/confirm",
      (route) =>
        route.fulfill({ status: 500, contentType: "text/html", body: "<html>Server error</html>" }),
      { times: 1 },
    );
    await page.locator("body").press("c");
    await expect(page.getByText("The decision could not be recorded.")).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ decided/)).toHaveText(String(before));

    // A review another tab completed or cancelled refuses the decision, and
    // the page used to keep offering decisions on it (D-119 review). Answered
    // once by the route, the way the server does, and the page reads the
    // review again so it shows where the review really is. Not `times: 1`:
    // see answerOnce.
    const reloads = countReviewReads(page);
    const stopRefusing = await answerOnce(page, "**/api/findings/*/confirm", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            'Review "01J" is completed: its findings are decided only while it awaits confirmation.',
          code: "ReviewNotDecidingError",
        }),
      }),
    );
    await page.locator("body").press("c");
    await expect(page.getByText(/its findings are decided only while it awaits/)).toBeVisible();
    await expect.poll(() => reloads.count, { timeout: 15_000 }).toBeGreaterThan(0);
    reloads.stop();
    await stopRefusing();
  });

  await test.step("one finding is dismissed with a reason", async () => {
    // Nothing is reported until a person says so, so completing is refused
    // while anything is still undecided.
    await expect(page.getByRole("button", { name: "Complete review" })).toBeDisabled();

    await page
      .getByLabel("Why is this not a problem?")
      .fill("Deliberate: the caller already guards this.");
    // The reply is held back so `g g` lands while the decision is in flight,
    // which is what a quick hand does and what macOS CI hit by chance (run
    // 39005536267): the queue used to move the selection when the reply came,
    // taking the person away from where they had just gone.
    // Routed once and never unrouted: unrouting while the held request was
    // being delivered is the likeliest reason its fetch failed in the page on
    // Ubuntu CI (run 39014501683), the server having answered 200.
    await page.route(
      "**/api/findings/*/dismiss",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Dismiss" }).click();

    // The decision is a record, not a transient: g g returns to the top of the
    // queue, where the dismissed finding still sits with its reason.
    await page.locator("body").press("g");
    await page.locator("body").press("g");
    await expect(page.getByText(/1 of \d+ decided/)).toBeVisible();
    await expect(page.getByText("Deliberate: the caller already guards this.")).toBeVisible();
  });

  await test.step("a comment is rewritten before the finding is confirmed", async () => {
    // One step down from the dismissed finding is the next one still open.
    await page.locator("body").press("j");

    await page.locator("body").press("e");
    const editor = page.getByLabel("Comment, as it will appear in the report");
    await expect(editor).toBeFocused();
    await editor.fill(EDITED_COMMENT);
    // Escape leaves the editor without losing the draft; only then can c
    // drive the queue again, since keys typed into an input never do.
    await editor.press("Escape");
    await page.locator("body").press("c");

    // The decision lands in the list, and stepping back onto the confirmed
    // finding shows the rewritten comment marked as the person's.
    await expect(page.getByText("in report").first()).toBeVisible();
    await page.locator("body").press("k");
    await expect(page.getByText("(edited)")).toBeVisible();
    await expect(page.getByText(EDITED_COMMENT)).toBeVisible();
    // Back onto an open finding, or the confirms below would press c at a
    // decided one and decide nothing.
    await page.locator("body").press("j");
  });

  let decidedTotal = 0;

  await test.step("the rest are confirmed from the keyboard", async () => {
    for (let guard = 0; guard < 30; guard += 1) {
      if ((await page.getByRole("button", { name: "Confirm" }).count()) === 0) break;
      await page.locator("body").press("c");
      await page.waitForTimeout(200);
    }
    await expect(page.getByRole("button", { name: "Complete review" })).toBeEnabled({
      timeout: 30_000,
    });

    // Held for the report assertion below: every finding is decided now, and
    // exactly one of them was dismissed.
    const decided = await page.getByText(/\d+ of \d+ decided/).textContent();
    decidedTotal = Number(/(\d+) of \d+ decided/.exec(decided ?? "")?.[1] ?? 0);
    expect(decidedTotal).toBeGreaterThan(1);
  });

  await test.step("completing it produces a report that can be exported", async () => {
    // A refusal whose body was not JSON threw past the message (D-119 review).
    await page.route(
      "**/api/reviews/*/complete",
      (route) =>
        route.fulfill({ status: 500, contentType: "text/html", body: "<html>Server error</html>" }),
      { times: 1 },
    );
    await page.getByRole("button", { name: "Complete review" }).click();
    await expect(page.getByText("The review could not be completed.")).toBeVisible();

    // Refused as another tab having completed it first, the page says so and
    // reads the review again, to show where it really is.
    const reloads = countReviewReads(page);
    const stopRefusing = await answerOnce(page, "**/api/reviews/*/complete", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "This review is completed, so there is nothing to complete.",
          code: "NotAwaitingConfirmation",
        }),
      }),
    );
    await page.getByRole("button", { name: "Complete review" }).click();
    await expect(
      page.getByText("This review is completed, so there is nothing to complete."),
    ).toBeVisible();
    await expect.poll(() => reloads.count, { timeout: 15_000 }).toBeGreaterThan(0);
    reloads.stop();
    await stopRefusing();

    await page.getByRole("button", { name: "Complete review" }).click();
    await expect(page.getByRole("heading", { name: "Report" })).toBeVisible({ timeout: 30_000 });

    // The report says what was examined, not only what was found, and is
    // typeset rather than printed as raw markdown. The document's structure is
    // asserted against the exported file below, which is where it is actually
    // promised; here the claim is that a person can read it.
    await expect(page.getByRole("heading", { name: "What was examined" })).toBeVisible();
    await expect(page.getByText(/confirmed finding/)).toBeVisible();
    await expect(page.getByText(/app\/src\//).first()).toBeVisible();
    await expect(page.getByText(EDITED_COMMENT)).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    // The path shown is the HTML one, because that is the file a person
    // sends to whoever fixes the code.
    await expect(page.getByText(/Written to .*exports.*\.html/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the exported file on disk carries the words a person wrote", async () => {
    // The screen showing the edit is not the same claim as the file carrying
    // it: the export is what leaves the app, so it is what gets read here,
    // off the disk, rather than trusted from the page that just rendered it.
    const written = await page.getByText(/Written to .*exports/).textContent();
    const htmlPath = written?.replace(/^Written to /, "").trim() ?? "";
    expect(htmlPath).not.toBe("");
    // Both files land: the HTML to hand over, the markdown to keep.
    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain("<!doctype html>");
    const path = htmlPath.replace(/\.html$/, ".md");
    const report = readFileSync(path, "utf8");
    expect(report).toContain(`Comment: ${EDITED_COMMENT}`);

    // The report contains the confirmed set and nothing else. One finding was
    // dismissed, so the findings section holds exactly the rest, and the
    // dismissed one appears only in its own section with its reason. This is
    // the promise the whole app rests on: nothing reaches a report that a
    // person did not accept.
    const findingsSection = report.slice(
      report.indexOf("## Findings"),
      report.indexOf("## Dismissed"),
    );
    const reported = findingsSection.match(/^File: /gm) ?? [];
    expect(reported).toHaveLength(decidedTotal - 1);

    const dismissedSection = report.slice(report.indexOf("## Dismissed"));
    expect(dismissedSection).toContain("Deliberate: the caller already guards this.");
    expect(findingsSection).not.toContain("Deliberate: the caller already guards this.");

    // A refuted finding is counted in what was examined and is not reported.
    expect(report).toContain(
      "1 hunk(s) were accounted for only by findings that verification refuted.",
    );
    expect(report).not.toContain(REFUTED_ISSUE);
  });
});

test("the scoreboard counts what the machine has actually run", async ({ page }) => {
  // Runs after the journey, which leaves one completed review behind, so the
  // numbers here are counted from real work rather than seeded.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Review scoreboard" })).toBeVisible();

  await expect(page.getByText("Total spend")).toBeVisible();
  // The journey's one kill is the verifier refuting a finding (D-97), which
  // cited real code and is not invention; it used to count as some (4.24).
  const invention = page.getByText("Invention rate").locator("..");
  await expect(invention.getByText(/^0%$/)).toBeVisible();

  // The journey confirmed several findings and dismissed one, so precision is
  // a real fraction rather than the dash an undecided app would show.
  const precision = page.getByText("Precision").locator("..");
  await expect(precision.getByText(/^\d+%$/)).toBeVisible();

  // Rule yield names its rules; anonymous bars would measure nothing anyone
  // could act on.
  await expect(page.getByRole("heading", { name: "Rule yield" })).toBeVisible();
  await expect(page.getByText(/^Rule \w+$/).first()).toBeVisible();

  // And the recent table carries the review it just ran.
  await expect(page.getByRole("table")).toContainText("feature/rename-prefs");
});
