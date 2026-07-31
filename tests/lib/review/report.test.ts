/**
 * The report a completed review produces.
 *
 * Pure input in, markdown out, so these tests are about the text itself: what
 * it says, what it refuses to leave out, and what it must never contain.
 */

import { describe, expect, it } from "vitest";
import { exportFileName, renderReport, type ReportInput } from "@/lib/review/report";

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
  openQuestions: [],
  coverage: { totalFiles: 10, totalHunks: 12, totalSweepHits: 0 },
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

  it("lists open questions separately from findings", () => {
    const report = renderReport({
      ...BASE,
      openQuestions: [{ ...FINDING, issue: "Could not be settled from the code." }],
    });
    expect(report).toContain("## Open questions");
    expect(report).toContain("Could not be settled from the code.");
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
      openQuestions: [{ ...FINDING }],
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
