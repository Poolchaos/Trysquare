/**
 * The report a completed review produces.
 *
 * Pure input in, markdown out, so these tests are about the text itself: what
 * it says, what it refuses to leave out, and what it must never contain.
 */

import { describe, expect, it } from "vitest";
import {
  exportFileName,
  renderReport,
  renderReportHtml,
  type ReportInput,
} from "@/lib/review/report";

const FINDING = {
  filePath: "app/src/orders/save.ts",
  lineStart: 4,
  lineEnd: 4,
  severity: "CRITICAL",
  ruleCode: "1",
  issue: "The await was removed, so the save is not waited for.",
  comment: "The caller returns before the write lands, and a failure is unobservable.",
  mechanism: "traced from the change to save.ts:4",
  quotedCode: "  repository.save(order);",
};

const BASE: ReportInput = {
  projectName: "app",
  fromBranch: "feature/rename-prefs",
  intoBranch: "main",
  fromCommit: "a".repeat(40),
  mergeBaseCommit: "b".repeat(40),
  confirmed: [FINDING],
  dismissed: [],
  leftOutUnproven: [],
  coverage: {
    totalFiles: 10,
    totalHunks: 12,
    totalSweepHits: 0,
    refutedOnlyHunks: 0,
    refutedOnlySweepHits: 0,
  },
  chainFilesRead: 3,
  rulesetName: "Example protocol",
  rulesetVersion: 2,
  model: "claude-fable-5[1m]",
  effort: "high",
  profile: "full-context",
  usage: {
    inputTokens: 500,
    outputTokens: 100,
    cacheReadTokens: 10_000,
    costEquivalentUsd: 0.021,
  },
  startedAt: "2026-07-31T10:00:00.000Z",
  completedAt: "2026-07-31T10:04:30.000Z",
};

describe("what the report says was found", () => {
  it("opens with the count by severity", () => {
    const report = renderReport({
      ...BASE,
      confirmed: [FINDING, { ...FINDING, severity: "WARNING", lineStart: 9, lineEnd: 9 }],
    });
    expect(report).toContain("2 confirmed finding(s): 1 critical, 1 warning.");
  });

  it("groups findings with the most severe first", () => {
    const report = renderReport({
      ...BASE,
      confirmed: [
        { ...FINDING, severity: "NITPICK" },
        { ...FINDING, severity: "CRITICAL" },
        { ...FINDING, severity: "WARNING" },
      ],
    });
    expect(report.indexOf("### CRITICAL")).toBeLessThan(report.indexOf("### WARNING"));
    expect(report.indexOf("### WARNING")).toBeLessThan(report.indexOf("### NITPICK"));
  });

  it("keeps a confirmed nitpick, because a person already decided it", () => {
    // The imported protocol's severity policy governs what the engine raises.
    // What a human chose to keep is not the report's to second-guess.
    const report = renderReport({
      ...BASE,
      confirmed: [{ ...FINDING, severity: "NITPICK", issue: "A small thing worth keeping." }],
    });
    expect(report).toContain("A small thing worth keeping.");
  });

  it("carries the quoted code that was checked against the file", () => {
    expect(renderReport(BASE)).toContain("  repository.save(order);");
  });

  it("uses the labelled structure the protocol defines", () => {
    // File, lines, issue and comment, each findable without reading a
    // paragraph, because a finding is read by someone deciding what to fix.
    const report = renderReport(BASE);
    expect(report).toContain("File: app/src/orders/save.ts");
    expect(report).toContain("Lines: 4");
    expect(report).toContain("Rule: 1");
    expect(report).toContain("Issue: The await was removed, so the save is not waited for.");
    expect(report).toContain(
      "Comment: The caller returns before the write lands, and a failure is unobservable.",
    );
  });

  it("gives a range only when the finding spans more than one line", () => {
    expect(renderReport(BASE)).toContain("Lines: 4");
    expect(renderReport(BASE)).not.toContain("Lines: 4 - 4");
    expect(
      renderReport({ ...BASE, confirmed: [{ ...FINDING, lineStart: 4, lineEnd: 9 }] }),
    ).toContain("Lines: 4 - 9");
  });

  it("keeps code out of the comment line and in the quotation", () => {
    // The comment is what a person reads to decide; the code is the evidence
    // underneath it, quoted and byte-checked.
    const report = renderReport(BASE);
    const commentLine = report.split("\n").find((line) => line.startsWith("Comment: "));
    expect(commentLine).toBeDefined();
    expect(commentLine).not.toContain("repository.save");
    expect(report).toContain("repository.save(order);");
  });

  it("omits the rule line when a finding carries no rule code", () => {
    expect(renderReport({ ...BASE, confirmed: [{ ...FINDING, ruleCode: null }] })).not.toContain(
      "Rule:",
    );
  });
});

describe("what the report says was examined", () => {
  it("states the counts, so an empty result is not mistaken for no work", () => {
    // The difference between nothing wrong and nothing looked at is the whole
    // value of the thing.
    const report = renderReport({ ...BASE, confirmed: [] });
    expect(report).toContain("No confirmed findings.");
    expect(report).toContain("10 changed file(s) and 12 hunk(s) were read");
    expect(report).toContain("3 file(s) outside the change set were opened");
  });

  it("says plainly when the sweep found nothing, rather than omitting it", () => {
    expect(renderReport(BASE)).toContain("The mechanical sweep found nothing to disposition.");
  });

  it("reports sweep hits when there were some", () => {
    const report = renderReport({
      ...BASE,
      coverage: { ...BASE.coverage, totalSweepHits: 4 },
    });
    expect(report).toContain("4 mechanical sweep hit(s) were each dispositioned.");
  });

  it("says what rests only on findings verification refuted", () => {
    // Accounted for (D-97), but a reader is not left to assume the findings
    // raised there stood.
    const report = renderReport({
      ...BASE,
      coverage: {
        ...BASE.coverage,
        totalSweepHits: 4,
        refutedOnlyHunks: 2,
        refutedOnlySweepHits: 1,
      },
    });
    expect(report).toContain(
      "2 hunk(s) and 1 sweep hit(s) were accounted for only by findings that verification refuted.",
    );
  });

  it("names only the kind that rests on a refutation", () => {
    const report = renderReport({
      ...BASE,
      coverage: { ...BASE.coverage, refutedOnlyHunks: 3 },
    });
    expect(report).toContain("3 hunk(s) were accounted for only by findings");
    expect(report).not.toContain("sweep hit(s) were accounted for only");
  });

  it("says nothing of refutations when every finding raised stood", () => {
    expect(renderReport(BASE)).not.toContain("refuted");
  });
});

describe("what the report keeps about the human's decisions", () => {
  it("records dismissals with their reasons", () => {
    // A dismissal is evidence about the engine. Dropping it would throw away
    // the only signal that says which prompts need work.
    const report = renderReport({
      ...BASE,
      dismissed: [{ ...FINDING, dismissReason: "Deliberate: the caller already guards this." }],
    });
    expect(report).toContain("## Dismissed");
    expect(report).toContain("Deliberate: the caller already guards this.");
  });

  it("lists a finding left out unproven apart from the dismissed, with its reason", () => {
    // It may still be real, so it is not counted as a person rejecting it (D-190).
    const report = renderReport({
      ...BASE,
      leftOutUnproven: [{ ...FINDING, dismissReason: "Could not prove it here." }],
    });
    expect(report).toContain("## Left out unproven");
    expect(report).toContain("Reason: Could not prove it here.");
    expect(report).not.toContain("## Dismissed");
    expect(report).not.toContain("## Open questions");
    const html = renderReportHtml({
      ...BASE,
      leftOutUnproven: [{ ...FINDING, dismissReason: "Could not prove it here." }],
    });
    expect(html).toContain("Left out unproven (1)");
    expect(html).toContain("Left out: Could not prove it here.");
  });

  it("quotes the author's description as a claim that was checked", () => {
    const report = renderReport({ ...BASE, intent: "Rename the prefs field." });
    expect(report).toContain("> Rename the prefs field.");
    expect(report).toContain("checked against the code");
  });
});

describe("the footer that makes a report reproducible", () => {
  it("names the ruleset version, model, effort and pinned commits", () => {
    const report = renderReport(BASE);
    expect(report).toContain("Ruleset: Example protocol version 2");
    expect(report).toContain("Model: claude-fable-5[1m], effort high, profile full-context");
    expect(report).toContain(`Reviewed: ${"a".repeat(40)} against merge base ${"b".repeat(40)}`);
  });

  it("separates cached tokens from fresh ones", () => {
    expect(renderReport(BASE)).toContain("500 fresh input, 10000 cached read, 100 output");
  });

  it("names the dependency when two repositories were reviewed together", () => {
    const report = renderReport({
      ...BASE,
      linked: {
        projectName: "shared-core",
        fromBranch: "feature/rename-prefs",
        fromCommit: "c".repeat(40),
      },
    });
    expect(report).toContain("Together with: shared-core feature/rename-prefs");
  });

  it("reports how long it took, and omits it when it cannot be known", () => {
    expect(renderReport(BASE)).toContain("Took: 4m 30s");
    expect(renderReport({ ...BASE, completedAt: null })).not.toContain("Took:");
  });
});

describe("the house style the report is held to", () => {
  it("contains no em dash", () => {
    // Binding on every surface, output included.
    const report = renderReport({
      ...BASE,
      intent: "Rename the prefs field.",
      dismissed: [{ ...FINDING, dismissReason: "Deliberate." }],
      leftOutUnproven: [{ ...FINDING }],
    });
    expect(report).not.toContain(String.fromCharCode(8212));
    expect(report).not.toContain(String.fromCharCode(8211));
  });

  it("ends with exactly one newline", () => {
    const report = renderReport(BASE);
    expect(report.endsWith("\n")).toBe(true);
    expect(report.endsWith("\n\n")).toBe(false);
  });
});

describe("the file an export is written to", () => {
  it("turns branch slashes into hyphens, so no directories are invented", () => {
    expect(
      exportFileName({
        projectSlug: "app",
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        at: "2026-07-31T10:04:30.000Z",
      }),
    ).toBe("app--feature-rename-prefs--into--main--2026-07-31.md");
  });

  it("uses the UTC day, so a second export the same day replaces the first", () => {
    const morning = exportFileName({
      projectSlug: "app",
      fromBranch: "x",
      intoBranch: "main",
      at: "2026-07-31T01:00:00.000Z",
    });
    const evening = exportFileName({
      projectSlug: "app",
      fromBranch: "x",
      intoBranch: "main",
      at: "2026-07-31T23:00:00.000Z",
    });
    expect(morning).toBe(evening);
  });
});

describe("the report as a file someone else can open", () => {
  it("carries its own styles and asks the network for nothing", () => {
    // The point of the HTML export is that it survives being sent somewhere.
    // A stylesheet link, a font request or a script would each make it
    // depend on something the recipient may not have.
    const html = renderReportHtml(BASE);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<link[^>]+href/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("escapes the code it quotes, because code is full of angle brackets", () => {
    const html = renderReportHtml({
      ...BASE,
      confirmed: [
        {
          filePath: "app/src/render.ts",
          lineStart: 3,
          lineEnd: 3,
          severity: "CRITICAL",
          ruleCode: "1",
          issue: "Unescaped markup",
          comment: 'Renders "user" input directly.',
          mechanism: "traced from the change",
          quotedCode: 'el.innerHTML = "<img src=x onerror=alert(1)>";',
        },
      ],
    });

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("says the same counts as the markdown it ships beside", () => {
    // Two renderings of one build; a reader who has both must not find them
    // disagreeing about how many findings there were.
    const html = renderReportHtml(BASE);
    const markdown = renderReport(BASE);
    const fromMarkdown = /(\d+) confirmed finding/.exec(markdown)?.[1];
    expect(fromMarkdown).toBeDefined();
    expect(html).toContain(`${fromMarkdown} confirmed finding`);
  });

  it("states what was examined in the markdown's own words", () => {
    // It was written out twice and had drifted: with no sweep hits the HTML
    // claimed "0 mechanical sweep hit(s) were each dispositioned".
    const input = { ...BASE, coverage: { ...BASE.coverage, refutedOnlyHunks: 1 } };
    const html = renderReportHtml(input);
    expect(html).toContain("The mechanical sweep found nothing to disposition.");
    expect(html).toContain(
      "1 hunk(s) were accounted for only by findings that verification refuted.",
    );
  });
});

describe("what a project's own checks found (WP-I, D-197)", () => {
  const failingTests = {
    command: "npm test",
    severity: "CRITICAL",
    issue: "The tests fail on this branch.",
    evidence: "2 failing: totals, refunds",
    verificationNote: "Exited with code 1, as the app ran it.",
  };
  const ran = [
    { step: "install" as const, command: "npm ci", outcome: "passed" as const },
    { step: "tests" as const, command: "npm test", outcome: "failed" as const },
  ];

  it("counts a confirmed one, where no code finding was confirmed", () => {
    // Said "No confirmed findings" with a failing suite confirmed (round 7).
    const report = renderReport({
      ...BASE,
      confirmed: [],
      checks: { ran, confirmed: [failingTests], dismissed: [], leftOutUnproven: [] },
    });
    expect(report).toContain(
      "No confirmed findings in the code; 1 confirmed from the project's own checks.",
    );
    expect(report).toContain("## Tests and design");
    expect(report).toContain("### CRITICAL: The tests fail on this branch.");
    expect(report).toContain("Ran `npm test`. Exited with code 1, as the app ran it.");
    expect(report).toContain("```\n2 failing: totals, refunds\n```");
  });

  it("names them beside the code findings when both were confirmed", () => {
    const report = renderReport({
      ...BASE,
      checks: { ran, confirmed: [failingTests], dismissed: [], leftOutUnproven: [] },
    });
    expect(report).toMatch(
      /confirmed finding\(s\): .+; and 1 confirmed from the project's own checks\./,
    );
  });

  it("says how each command ended, beside what was examined", () => {
    const report = renderReport({
      ...BASE,
      checks: { ran, confirmed: [], dismissed: [], leftOutUnproven: [] },
    });
    expect(report).toContain(
      "The project's own checks ran on a copy of the branch: the install passed; the tests failed.",
    );
    // Run, and nothing decided from them: no section.
    expect(report).not.toContain("## Tests and design");
    // Not run: nothing said of them at all.
    expect(renderReport(BASE)).not.toContain("own checks");
  });

  it("keeps a dismissed one with its reason", () => {
    const report = renderReport({
      ...BASE,
      confirmed: [],
      checks: {
        ran,
        confirmed: [],
        dismissed: [{ ...failingTests, dismissReason: "Flaky on this machine." }],
        leftOutUnproven: [],
      },
    });
    expect(report).toContain("Dismissed by a person:");
    expect(report).toContain(
      "- The tests fail on this branch. (`npm test`) Reason: Flaky on this machine.",
    );
    expect(report).toContain("No confirmed findings. ");
  });

  it("says the same in the exported page", () => {
    const html = renderReportHtml({
      ...BASE,
      checks: { ran, confirmed: [failingTests], dismissed: [], leftOutUnproven: [] },
    });
    expect(html).toContain("; and 1 confirmed from the project's own checks.");
    expect(html).toContain("<h2>Tests and design (1)</h2>");
    expect(html).toContain("2 failing: totals, refunds");
    expect(html).toContain("the tests failed.");
  });
});

describe("a screen graded C or D, in the report (WP-I step 4)", () => {
  const design = {
    command: null,
    severity: "CRITICAL",
    issue: "The screen home.png is graded D.",
    evidence: "The totals column runs off the card.",
    verificationNote: "Graded D again by the second grader, claude-opus-5-5: overflows.",
    screenshotName: "home.png",
    screenshotDataUri: "data:image/png;base64,UE5H",
  };

  it("says which screen and what is off, not as code", () => {
    const report = renderReport({
      ...BASE,
      checks: { ran: [], confirmed: [design], dismissed: [], leftOutUnproven: [] },
    });
    expect(report).toContain("### CRITICAL: The screen home.png is graded D.");
    expect(report).toContain("Screenshot `home.png`: The totals column runs off the card.");
    // Screens alone: not said to be what commands found (review round 8).
    expect(report).toContain(
      "The screens the project's own e2e saved, on a copy of this branch, that were graded C or D.",
    );
    expect(report).not.toContain("run by the app on a copy of it.");
    expect(report).toContain("Graded D again by the second grader");
    expect(report).not.toContain("```\nThe totals column");
  });

  it("carries the screen itself in the exported page, so it is whole on its own", () => {
    const html = renderReportHtml({
      ...BASE,
      checks: { ran: [], confirmed: [design], dismissed: [], leftOutUnproven: [] },
    });
    expect(html).toContain('<img src="data:image/png;base64,UE5H"');
    expect(html).toContain("What is off: The totals column runs off the card.");
    expect(html).toContain('alt="The screen home.png. What is off: The totals column runs off');
  });

  it("names a screen it does not carry, and never sets what is off as code", () => {
    // Without its image the screen fell to a failing command's layout: what
    // is off set as output, the screenshot not named (review round 8).
    const html = renderReportHtml({
      ...BASE,
      checks: {
        ran: [],
        confirmed: [{ ...design, screenshotName: "phone/home.png", screenshotDataUri: null }],
        dismissed: [],
        leftOutUnproven: [],
      },
    });
    expect(html).toContain("The screenshot, phone/home.png, is not carried in this report");
    expect(html).toContain("What is off: The totals column runs off the card.");
    expect(html).not.toContain("<pre><code>The totals column");
  });

  it("keeps one graded C or D by one grader only apart, as possibly real (D-190)", () => {
    const open = {
      ...design,
      issue: "The screen phone/home.png is graded C.",
      screenshotName: "phone/home.png",
      verificationNote: "The second grader, claude-opus-5-5, graded it B.",
      dismissReason: "Agreed with design.",
    };
    const input = {
      ...BASE,
      checks: { ran: [], confirmed: [], dismissed: [], leftOutUnproven: [open] },
    };
    const report = renderReport(input);
    expect(report).toContain(
      "Left out unproven by a person, graded C or D by one grader and not the other, so possibly real:",
    );
    expect(report).toContain(
      "- The screen phone/home.png is graded C. (screenshot `phone/home.png`) Reason: Agreed with design.",
    );
    expect(report).not.toContain("Dismissed by a person:");
    const html = renderReportHtml(input);
    expect(html).toContain("<h3>Left out unproven (1)</h3>");
    expect(html).toContain("Left out: Agreed with design.");
    expect(html).not.toContain("<h3>Dismissed");
  });

  it("says both when the section holds failing commands and screens", () => {
    const report = renderReport({
      ...BASE,
      checks: {
        ran: [],
        confirmed: [design],
        dismissed: [
          {
            command: "npm test",
            severity: "CRITICAL",
            issue: "The tests fail.",
            evidence: "1 failing",
            verificationNote: null,
            dismissReason: "Flaky.",
          },
        ],
        leftOutUnproven: [],
      },
    });
    expect(report).toContain(
      "What the project's own tests and e2e found on this branch, run by the app on a copy of it, and the screens its e2e saved that were graded C or D.",
    );
  });
});
