/**
 * The report a completed review produces.
 *
 * Pure: everything it needs is gathered by the caller, so the exact text is
 * unit-testable without a database.
 *
 * Two things distinguish this from a list of findings. It says what was
 * examined as well as what was found, because a reader cannot otherwise tell
 * "nothing is wrong" from "nothing was looked at", and that distinction is the
 * whole value of a review. And it records what a person decided, including the
 * findings they rejected and why, because a dismissal is evidence about the
 * engine and throwing it away would waste the only signal that says which
 * prompts need work.
 *
 * The protocol's own prose about output format is deliberately not parsed.
 * Rendering arbitrary instructions is not tractable, and a report whose shape
 * depended on prompt-shaped text would change meaning without anyone editing
 * the code that writes it.
 */

const SEVERITY_ORDER = ["CRITICAL", "WARNING", "NITPICK"] as const;

export interface ReportFinding {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: string;
  ruleCode: string | null;
  issue: string;
  comment: string;
  mechanism: string;
  quotedCode: string;
  dismissReason?: string | null;
}

export interface ReportInput {
  projectName: string;
  fromBranch: string;
  intoBranch: string;
  fromCommit: string;
  mergeBaseCommit: string;
  linked?: { projectName: string; fromBranch: string; fromCommit: string } | undefined;
  intent?: string | null;

  confirmed: readonly ReportFinding[];
  dismissed: readonly ReportFinding[];
  openQuestions: readonly ReportFinding[];

  coverage: {
    totalFiles: number;
    totalHunks: number;
    totalSweepHits: number;
  };
  chainFilesRead: number;

  rulesetName: string;
  rulesetVersion: number;
  model: string;
  effort: string;
  profile: string;

  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costEquivalentUsd: number;
  };
  startedAt: string | null;
  completedAt: string | null;
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];

  lines.push(`# Review: ${input.projectName} ${input.fromBranch} into ${input.intoBranch}`);
  lines.push("");
  lines.push(summary(input));
  lines.push("");

  if (input.intent) {
    lines.push("## What the change was for");
    lines.push("");
    lines.push("As described by its author, and checked against the code rather than taken on:");
    lines.push("");
    lines.push(`> ${input.intent.split("\n").join("\n> ")}`);
    lines.push("");
  }

  lines.push("## What was examined");
  lines.push("");
  lines.push(completeness(input));
  lines.push("");

  if (input.confirmed.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const severity of SEVERITY_ORDER) {
      const group = input.confirmed.filter((finding) => finding.severity === severity);
      if (group.length === 0) continue;
      lines.push(`### ${severity} (${group.length})`);
      lines.push("");
      for (const finding of group) lines.push(...renderFinding(finding));
    }
  }

  if (input.openQuestions.length > 0) {
    lines.push("## Open questions");
    lines.push("");
    lines.push("Raised, checked, and not settled from the code alone.");
    lines.push("");
    for (const finding of input.openQuestions) lines.push(...renderFinding(finding));
  }

  if (input.dismissed.length > 0) {
    lines.push("## Dismissed");
    lines.push("");
    lines.push(
      "Raised by the review and rejected by a person. Kept because a dismissal is " +
        "evidence about the engine, not an absence of one.",
    );
    lines.push("");
    for (const finding of input.dismissed) {
      lines.push(
        `- ${finding.filePath}:${finding.lineStart} ${finding.issue}` +
          (finding.dismissReason ? ` Reason: ${finding.dismissReason}` : ""),
      );
    }
    lines.push("");
  }

  lines.push("## How this review was run");
  lines.push("");
  lines.push(...footer(input));

  return `${lines.join("\n").trimEnd()}\n`;
}

function summary(input: ReportInput): string {
  const counts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: input.confirmed.filter((finding) => finding.severity === severity).length,
  })).filter((entry) => entry.count > 0);

  if (counts.length === 0) {
    return (
      `No confirmed findings. ${input.coverage.totalHunks} hunk(s) across ` +
      `${input.coverage.totalFiles} file(s) were examined and every one was accounted for.`
    );
  }

  const parts = counts.map((entry) => `${entry.count} ${entry.severity.toLowerCase()}`);
  return `${input.confirmed.length} confirmed finding(s): ${parts.join(", ")}.`;
}

/**
 * The statement that lets a reader trust an empty findings list.
 *
 * Every number here is what the app counted and reconciled, not what a model
 * claimed: the coverage invariants mean the review could not have finished
 * with a hunk unaccounted for.
 */
function completeness(input: ReportInput): string {
  const sweep =
    input.coverage.totalSweepHits === 0
      ? "The mechanical sweep found nothing to disposition."
      : `${input.coverage.totalSweepHits} mechanical sweep hit(s) were each dispositioned.`;

  return (
    `${input.coverage.totalFiles} changed file(s) and ${input.coverage.totalHunks} hunk(s) were ` +
    `read, and each hunk was either given a finding or cleared with a reason. ${sweep} ` +
    `${input.chainFilesRead} file(s) outside the change set were opened to follow what it calls into.`
  );
}

/**
 * One finding, in the structure the protocol defines.
 *
 * Labelled fields rather than prose, because a finding is read by someone
 * deciding what to fix: the file, the lines, what is wrong and what it breaks,
 * each findable without reading a paragraph. The comment is plain language by
 * contract; the code that proves it sits below, quoted and byte-checked,
 * rather than inside the sentence explaining it.
 */
function renderFinding(finding: ReportFinding): string[] {
  return [
    `File: ${finding.filePath}`,
    `Lines: ${lineRange(finding)}`,
    ...(finding.ruleCode ? [`Rule: ${finding.ruleCode}`] : []),
    `Issue: ${finding.issue}`,
    `Comment: ${finding.comment}`,
    ...(finding.mechanism ? [`Mechanism: ${finding.mechanism}`] : []),
    "",
    ...(finding.quotedCode ? ["```", finding.quotedCode, "```", ""] : []),
  ];
}

/** A single line, or a range when the finding genuinely spans one. */
function lineRange(finding: ReportFinding): string {
  return finding.lineEnd > finding.lineStart
    ? `${finding.lineStart} - ${finding.lineEnd}`
    : String(finding.lineStart);
}

function footer(input: ReportInput): string[] {
  const rows = [
    `- Ruleset: ${input.rulesetName} version ${input.rulesetVersion}`,
    `- Model: ${input.model}, effort ${input.effort}, profile ${input.profile}`,
    `- Reviewed: ${input.fromCommit} against merge base ${input.mergeBaseCommit}`,
  ];

  if (input.linked) {
    rows.push(
      `- Together with: ${input.linked.projectName} ${input.linked.fromBranch} ` +
        `at ${input.linked.fromCommit}`,
    );
  }

  rows.push(
    `- Tokens: ${input.usage.inputTokens} fresh input, ${input.usage.cacheReadTokens} cached ` +
      `read, ${input.usage.outputTokens} output`,
    `- Cost equivalent: ${input.usage.costEquivalentUsd.toFixed(4)} USD`,
  );

  const duration = elapsed(input.startedAt, input.completedAt);
  if (duration) rows.push(`- Took: ${duration}`);

  return rows;
}

function elapsed(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const seconds = Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * The filename an export is written to.
 *
 * Branch names contain slashes, which would otherwise make directories nobody
 * asked for. The date is the UTC day so two exports of the same review on the
 * same day overwrite rather than accumulate near-identical files.
 */
export function exportFileName(input: {
  projectSlug: string;
  fromBranch: string;
  intoBranch: string;
  at: string;
}): string {
  const safe = (value: string) => value.replace(/[/\\]+/g, "-");
  return `${safe(input.projectSlug)}--${safe(input.fromBranch)}--into--${safe(input.intoBranch)}--${input.at.slice(0, 10)}.md`;
}

/**
 * The report as one self-contained HTML file.
 *
 * A report is written to be handed to whoever fixes the code, and markdown on
 * someone else's disk is not that: it renders differently in every viewer and
 * not at all in a browser. This is one file with its styles inline, no
 * scripts, no fonts, no requests, so it opens anywhere and keeps working
 * after the app that made it is gone.
 *
 * Everything is escaped on the way in. A finding quotes real code, and code
 * is full of angle brackets.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderReportHtml(input: ReportInput): string {
  const counts = input.confirmed.reduce<Record<string, number>>((all, finding) => {
    all[finding.severity] = (all[finding.severity] ?? 0) + 1;
    return all;
  }, {});
  const summary =
    `${input.confirmed.length} confirmed finding${input.confirmed.length === 1 ? "" : "s"}` +
    (Object.keys(counts).length > 0
      ? `: ${SEVERITY_ORDER.filter((severity) => counts[severity])
          .map((severity) => `${counts[severity]} ${severity.toLowerCase()}`)
          .join(", ")}`
      : "") +
    ".";

  const group = (label: string, findings: readonly ReportFinding[]): string => {
    if (findings.length === 0) return "";
    const items = [...findings]
      .sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity as never) - SEVERITY_ORDER.indexOf(b.severity as never),
      )
      .map(
        (finding) => `
      <li class="f ${escapeHtml(finding.severity.toLowerCase())}">
        <p class="t">${escapeHtml(finding.issue)}
          <span class="w">${escapeHtml(finding.filePath)}:${finding.lineStart}</span>
          ${finding.ruleCode ? `<span class="w">rule ${escapeHtml(finding.ruleCode)}</span>` : ""}
        </p>
        <p class="c">${escapeHtml(finding.comment)}</p>
        ${finding.dismissReason ? `<p class="w">Dismissed: ${escapeHtml(finding.dismissReason)}</p>` : ""}
        ${finding.quotedCode ? `<pre><code>${escapeHtml(finding.quotedCode)}</code></pre>` : ""}
      </li>`,
      )
      .join("");
    return `<h2>${escapeHtml(label)} (${findings.length})</h2><ul class="fs">${items}</ul>`;
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review: ${escapeHtml(input.projectName)} ${escapeHtml(input.fromBranch)} into ${escapeHtml(input.intoBranch)}</title>
<style>
:root { color-scheme: light dark; --ink: #16181d; --muted: #5c6370; --line: #d9dce2; --bg: #fff; --panel: #f7f8fa; --crit: #b3261e; --warn: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8eaed; --muted: #9aa2ad; --line: #2b303a; --bg: #14171c; --panel: #1a1e25; --crit: #f2857d; --warn: #e0a640; } }
body { margin: 0 auto; max-width: 52rem; padding: 2.5rem 1.5rem 4rem; background: var(--bg); color: var(--ink);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.4rem; margin: 0 0 .5rem; font-family: ui-monospace, monospace; }
.sum { font-size: 1.05rem; font-weight: 600; margin: 0 0 1.5rem; }
h2 { font-size: .8rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 2rem 0 .5rem; }
h3 { font-size: .95rem; margin: 1.5rem 0 .25rem; }
p { margin: .25rem 0; }
blockquote { margin: .25rem 0; border-left: 2px solid var(--line); padding-left: .75rem; color: var(--muted); }
.fs { list-style: none; margin: 0; padding: 0; }
.f { border: 1px solid var(--line); border-left-width: 3px; border-radius: 6px; padding: .75rem .9rem; margin: .5rem 0; background: var(--panel); }
.f.critical { border-left-color: var(--crit); } .f.warning { border-left-color: var(--warn); }
.t { font-weight: 600; }
.c { color: var(--muted); }
.w { font-weight: 400; font-size: .8rem; color: var(--muted); font-family: ui-monospace, monospace; margin-left: .5rem; }
pre { overflow-x: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: .6rem; margin: .5rem 0 0; }
code { font: 12.5px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
footer { margin-top: 2.5rem; border-top: 1px solid var(--line); padding-top: .75rem; font-size: .8rem; color: var(--muted); }
</style></head><body>
<h1>${escapeHtml(input.fromBranch)} into ${escapeHtml(input.intoBranch)}</h1>
<p class="sum">${escapeHtml(summary)}</p>
<h3>What was examined</h3>
<p class="c">${input.coverage.totalFiles} changed file(s) and ${input.coverage.totalHunks} hunk(s) were read, and each hunk was either given a finding or cleared with a reason. ${input.coverage.totalSweepHits} mechanical sweep hit(s) were each dispositioned. ${input.chainFilesRead} file(s) outside the change set were opened to follow what it calls into.</p>
${input.intent ? `<h3>What the change was for</h3><blockquote>${escapeHtml(input.intent)}</blockquote>` : ""}
${group("Confirmed", input.confirmed)}
${group("Open questions", input.openQuestions)}
${group("Dismissed", input.dismissed)}
<footer>${escapeHtml(input.model)} at effort ${escapeHtml(input.effort)}, ${escapeHtml(input.profile)} profile, against ${escapeHtml(input.rulesetName)} v${input.rulesetVersion}.
Commit ${escapeHtml(input.fromCommit.slice(0, 12))}, merge base ${escapeHtml(input.mergeBaseCommit.slice(0, 12))}.
Cost equivalent $${input.usage.costEquivalentUsd.toFixed(4)}.</footer>
</body></html>
`;
}
