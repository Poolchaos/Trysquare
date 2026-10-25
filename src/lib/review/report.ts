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

/** What a project's own checks found and a person decided (WP-I, D-197). */
export interface ReportCheck {
  command: string | null;
  /**
   * A design finding's screenshot, by its name under the review's
   * screenshots, and as an image the report carries whole; null when it is
   * gone or over what one report carries.
   */
  screenshotName?: string | null;
  screenshotDataUri?: string | null;
  severity: string;
  issue: string;
  /** The output where it failed. */
  evidence: string;
  verificationNote: string | null;
  dismissReason?: string | null;
}

export type DesignChecked =
  | "graded"
  | "partly graded"
  | "none gradable"
  | "no e2e command"
  | "e2e not run"
  | "no screenshots";

const DESIGN_SAID: Record<DesignChecked, string> = {
  graded: "The screenshots its e2e saved were graded A to D.",
  // Said rather than counted among the graded (review round 9).
  "partly graded":
    "The screenshots its e2e saved were graded A to D, but for some left out, which the run notes name and say why.",
  "none gradable":
    "The design was not checked: none of the screenshots its e2e saved could be graded, and the run notes say why.",
  "no e2e command": "The design was not checked: the project has no e2e command.",
  "e2e not run": "The design was not checked: its e2e did not run.",
  "no screenshots": "The design was not checked: its e2e saved no screenshot.",
};

/** How each of a project's own commands ended in this review's copy. */
export interface ReportCheckRun {
  step: "install" | "tests" | "e2e";
  command: string;
  outcome: "passed" | "failed" | "timed out" | "cancelled";
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
  /** Dismissed open questions: never proven, so possibly real (D-190). */
  leftOutUnproven: readonly ReportFinding[];
  /**
   * The project's own checks (WP-I, D-197), when the review ran them: how
   * each command ended, and what was confirmed or dismissed of what failed.
   */
  checks?: {
    ran: readonly ReportCheckRun[];
    confirmed: readonly ReportCheck[];
    dismissed: readonly ReportCheck[];
    /** Graded C or D by one grader and not the other, then left out (D-190). */
    leftOutUnproven: readonly ReportCheck[];
    /**
     * Whether the screens were graded, and if not why: a project with no
     * e2e gets "design not checked", never a grade (WP-I step 4).
     */
    design?: DesignChecked;
  };

  coverage: {
    totalFiles: number;
    totalHunks: number;
    totalSweepHits: number;
    refutedOnlyHunks: number;
    refutedOnlySweepHits: number;
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

/**
 * Text a person or a model wrote, made literal for the markdown it goes into
 * (audit finding S1): kept on its line, since a reason holding a line break
 * and "## Confirmed" wrote a section of its own, and with markdown's own
 * characters escaped, so a link, an image or raw HTML reads as the text it
 * is. A finding's words can be steered by the code under review.
 *
 * A lone carriage return ends a line in markdown as a line feed does, and
 * some of this text starts a line, where a leading "-", "+", "=" or "1." is
 * a list, a rule or a heading's underline and four spaces are code; and an
 * entity such as "&lt;" is read as the character it names (review round 12).
 */
function md(text: string): string {
  return text
    .replace(LINE_BREAK, " ")
    .trim()
    .replace(/[\\`*_[\]<>#!~|&]/g, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2")
    .replace(/^[-+=]/, "\\$&");
}

/** Every line ending markdown knows, with the spaces either side of it. */
const LINE_BREAK = /\s*(?:\r\n?|\n)\s*/g;

/** One line of code, in a span longer than any run of backticks inside it. */
function code(text: string): string {
  const flat = text.replace(LINE_BREAK, " ");
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${ticks}${pad}${flat}${pad}${ticks}`;
}

/**
 * Lines of code in a fence longer than any run of backticks inside them: a
 * fixed three ended at the first quoted line holding three, and the rest
 * read as markdown (audit finding S1).
 */
function fenced(text: string): string[] {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return [fence, text, fence];
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];

  lines.push(
    `# Review: ${md(input.projectName)} ${md(input.fromBranch)} into ${md(input.intoBranch)}`,
  );
  lines.push("");
  lines.push(summary(input));
  lines.push("");

  if (input.intent) {
    lines.push("## What the change was for");
    lines.push("");
    lines.push("As described by its author, and checked against the code rather than taken on:");
    lines.push("");
    lines.push(...input.intent.split(/\r\n?|\n/).map((line) => `> ${md(line)}`));
    lines.push("");
  }

  lines.push("## What was examined");
  lines.push("");
  lines.push(completeness(input));
  lines.push("");
  const ran = checksRan(input);
  if (ran !== null) {
    lines.push(ran);
    lines.push("");
  }

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

  const confirmedChecks = input.checks?.confirmed ?? [];
  const dismissedChecks = input.checks?.dismissed ?? [];
  const leftOutChecks = input.checks?.leftOutUnproven ?? [];
  const allChecks = [...confirmedChecks, ...leftOutChecks, ...dismissedChecks];
  if (allChecks.length > 0) {
    lines.push("## Tests and design");
    lines.push("");
    lines.push(checksIntro(allChecks));
    lines.push("");
    for (const check of confirmedChecks) {
      lines.push(`### ${check.severity}: ${md(check.issue)}`);
      lines.push("");
      if (check.command)
        lines.push(`Ran ${code(check.command)}. ${md(check.verificationNote ?? "")}`.trimEnd());
      if (check.screenshotName) {
        lines.push(`Screenshot ${code(check.screenshotName)}: ${md(check.evidence)}`);
        if (check.verificationNote) lines.push("", md(check.verificationNote));
      }
      lines.push("");
      if (!check.screenshotName && check.evidence.trim() !== "") {
        lines.push(...fenced(check.evidence.trimEnd()));
        lines.push("");
      }
    }
    const listed = (heading: string, checks: readonly ReportCheck[]) => {
      if (checks.length === 0) return;
      lines.push(heading);
      lines.push("");
      for (const check of checks) {
        lines.push(
          `- ${md(check.issue)}` +
            (check.command ? ` (${code(check.command)})` : "") +
            (check.screenshotName ? ` (screenshot ${code(check.screenshotName)})` : "") +
            (check.dismissReason ? ` Reason: ${md(check.dismissReason)}` : ""),
        );
      }
      lines.push("");
    };
    listed(
      "Left out unproven by a person, graded C or D by one grader and not the other, so possibly real:",
      leftOutChecks,
    );
    listed("Dismissed by a person:", dismissedChecks);
  }

  const leftOut = (heading: string, why: string, findings: readonly ReportFinding[]) => {
    if (findings.length === 0) return;
    lines.push(`## ${heading}`);
    lines.push("");
    lines.push(why);
    lines.push("");
    for (const finding of findings) {
      lines.push(
        `- ${md(finding.filePath)}:${finding.lineStart} ${md(finding.issue)}` +
          (finding.dismissReason ? ` Reason: ${md(finding.dismissReason)}` : ""),
      );
    }
    lines.push("");
  };
  leftOut(
    "Left out unproven",
    "Raised by the review, not proven by verification, and left out by a person. " +
      "Kept apart from the dismissed because each may still be real.",
    input.leftOutUnproven,
  );
  leftOut(
    "Dismissed",
    "Raised by the review and rejected by a person. Kept because a dismissal is " +
      "evidence about the engine, not an absence of one.",
    input.dismissed,
  );

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

  const checks = input.checks?.confirmed.length ?? 0;
  const fromChecks = `${checks} confirmed from the project's own checks`;
  if (counts.length === 0) {
    return (
      (checks === 0
        ? "No confirmed findings. "
        : `No confirmed findings in the code; ${fromChecks}. `) +
      `${input.coverage.totalHunks} hunk(s) across ` +
      `${input.coverage.totalFiles} file(s) were examined and every one was accounted for.`
    );
  }

  const parts = counts.map((entry) => `${entry.count} ${entry.severity.toLowerCase()}`);
  return (
    `${input.confirmed.length} confirmed finding(s): ${parts.join(", ")}` +
    (checks === 0 ? "." : `; and ${fromChecks}.`)
  );
}

/** What the section holds: failing commands, screens graded C or D, or both. */
export function checksIntro(checks: readonly ReportCheck[]): string {
  const ran = checks.some((check) => check.command !== null);
  const screens = checks.some((check) => Boolean(check.screenshotName));
  if (ran && screens) {
    return "What the project's own tests and e2e found on this branch, run by the app on a copy of it, and the screens its e2e saved that were graded C or D.";
  }
  return screens
    ? "The screens the project's own e2e saved, on a copy of this branch, that were graded C or D."
    : "What the project's own tests and e2e found on this branch, run by the app on a copy of it.";
}

/**
 * How the project's own checks ended, when the review ran them, or null.
 * Exported for the page's typeset report, as completeness is.
 */
export function checksRan(input: Pick<ReportInput, "checks">): string | null {
  const ran = input.checks?.ran ?? [];
  if (ran.length === 0) return null;
  const names = { install: "the install", tests: "the tests", e2e: "the e2e tests" };
  const design = input.checks?.design;
  return (
    "The project's own checks ran on a copy of the branch: " +
    ran.map((run) => `${names[run.step]} ${run.outcome}`).join("; ") +
    "." +
    (design === undefined ? "" : ` ${DESIGN_SAID[design]}`)
  );
}

/**
 * The statement that lets a reader trust an empty findings list.
 *
 * Every number here is what the app counted and reconciled, not what a model
 * claimed: the coverage invariants mean the review could not have finished
 * with a hunk unaccounted for.
 *
 * Exported for the page's typeset report, so the two cannot say different
 * things about what was examined.
 */
export function completeness(input: Pick<ReportInput, "coverage" | "chainFilesRead">): string {
  const refuted = refutedOnlySentence(input.coverage);
  const sweep =
    input.coverage.totalSweepHits === 0
      ? "The mechanical sweep found nothing to disposition."
      : `${input.coverage.totalSweepHits} mechanical sweep hit(s) were each dispositioned.`;

  return (
    `${input.coverage.totalFiles} changed file(s) and ${input.coverage.totalHunks} hunk(s) were ` +
    `read, and each hunk was either given a finding or cleared with a reason. ${sweep} ` +
    (refuted ? `${refuted} ` : "") +
    `${input.chainFilesRead} file(s) outside the change set were opened to follow what it calls into.`
  );
}

/**
 * What rests only on refuted findings (D-97), or null when nothing does.
 *
 * Such a hunk or hit counts as accounted for, since verification read the code
 * and gave its reason, but a reader is told rather than left to assume every
 * finding raised there stood.
 */
export function refutedOnlySentence(coverage: {
  refutedOnlyHunks: number;
  refutedOnlySweepHits: number;
}): string | null {
  const parts = [
    ...(coverage.refutedOnlyHunks > 0 ? [`${coverage.refutedOnlyHunks} hunk(s)`] : []),
    ...(coverage.refutedOnlySweepHits > 0 ? [`${coverage.refutedOnlySweepHits} sweep hit(s)`] : []),
  ];
  return parts.length === 0
    ? null
    : `${parts.join(" and ")} were accounted for only by findings that verification refuted.`;
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
    `File: ${md(finding.filePath)}`,
    `Lines: ${lineRange(finding)}`,
    ...(finding.ruleCode ? [`Rule: ${md(finding.ruleCode)}`] : []),
    `Issue: ${md(finding.issue)}`,
    `Comment: ${md(finding.comment)}`,
    ...(finding.mechanism ? [`Mechanism: ${md(finding.mechanism)}`] : []),
    "",
    ...(finding.quotedCode ? [...fenced(finding.quotedCode), ""] : []),
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
    `- Ruleset: ${md(input.rulesetName)} version ${input.rulesetVersion}`,
    `- Model: ${input.model}, effort ${input.effort}, profile ${input.profile}`,
    `- Reviewed: ${input.fromCommit} against merge base ${input.mergeBaseCommit}`,
  ];

  if (input.linked) {
    rows.push(
      `- Together with: ${md(input.linked.projectName)} ${md(input.linked.fromBranch)} ` +
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

/**
 * A screen, in the order its card on the review page shows it: what is off,
 * the second grader's note, then the screenshot, or its name when the
 * report does not carry it.
 */
function designBody(check: ReportCheck): string {
  const shot = check.screenshotDataUri
    ? `<img src="${check.screenshotDataUri}" alt="${escapeHtml(`The screen ${check.screenshotName}. What is off: ${check.evidence}`)}" style="max-width:100%;border:1px solid var(--line);border-radius:4px;margin-top:.5rem">`
    : `<p class="c">The screenshot, ${escapeHtml(check.screenshotName ?? "")}, is not carried in this report: it is gone, or over what one report carries.</p>`;
  return (
    `<p class="c">What is off: ${escapeHtml(check.evidence)}</p>` +
    (check.verificationNote ? `<p class="c">${escapeHtml(check.verificationNote)}</p>` : "") +
    shot
  );
}

/** A failing command: the note, then its output where it failed. */
function commandBody(check: ReportCheck): string {
  return (
    (check.verificationNote ? `<p class="c">${escapeHtml(check.verificationNote)}</p>` : "") +
    (check.evidence.trim() !== "" ? `<pre><code>${escapeHtml(check.evidence)}</code></pre>` : "")
  );
}

export function renderReportHtml(input: ReportInput): string {
  const counts = input.confirmed.reduce<Record<string, number>>((all, finding) => {
    all[finding.severity] = (all[finding.severity] ?? 0) + 1;
    return all;
  }, {});
  const checkCount = input.checks?.confirmed.length ?? 0;
  const summary =
    `${input.confirmed.length} confirmed finding${input.confirmed.length === 1 ? "" : "s"}` +
    (Object.keys(counts).length > 0
      ? `: ${SEVERITY_ORDER.filter((severity) => counts[severity])
          .map((severity) => `${counts[severity]} ${severity.toLowerCase()}`)
          .join(", ")}`
      : "") +
    (checkCount > 0 ? `; and ${checkCount} confirmed from the project's own checks` : "") +
    ".";
  const ranLine = checksRan(input);
  const checkItems = (checks: readonly ReportCheck[], decided: string) =>
    checks
      .map(
        (check) => `
      <li class="f ${escapeHtml(check.severity.toLowerCase())}">
        <p class="t">${escapeHtml(check.issue)}
          ${check.command ? `<span class="w">${escapeHtml(check.command)}</span>` : ""}
        </p>
        ${check.screenshotName ? designBody(check) : commandBody(check)}
        ${check.dismissReason ? `<p class="w">${decided}: ${escapeHtml(check.dismissReason)}</p>` : ""}
      </li>`,
      )
      .join("");
  const confirmedChecks = input.checks?.confirmed ?? [];
  const dismissedChecks = input.checks?.dismissed ?? [];
  const leftOutChecks = input.checks?.leftOutUnproven ?? [];
  const allChecks = [...confirmedChecks, ...leftOutChecks, ...dismissedChecks];
  const checksGroup = (label: string, checks: readonly ReportCheck[], decided: string) =>
    checks.length === 0
      ? ""
      : `<h3>${label} (${checks.length})</h3><ul class="fs">${checkItems(checks, decided)}</ul>`;
  const checksSection =
    allChecks.length === 0
      ? ""
      : `<h2>Tests and design (${allChecks.length})</h2>
<p class="c">${escapeHtml(checksIntro(allChecks))}</p>
${checksGroup("Confirmed", confirmedChecks, "Dismissed")}
${checksGroup("Left out unproven", leftOutChecks, "Left out")}
${checksGroup("Dismissed", dismissedChecks, "Dismissed")}`;

  const group = (
    label: string,
    findings: readonly ReportFinding[],
    reasonLabel = "Dismissed",
  ): string => {
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
        ${finding.dismissReason ? `<p class="w">${reasonLabel}: ${escapeHtml(finding.dismissReason)}</p>` : ""}
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
<p class="c">${escapeHtml(completeness(input))}</p>
${ranLine === null ? "" : `<p class="c">${escapeHtml(ranLine)}</p>`}
${input.intent ? `<h3>What the change was for</h3><blockquote>${escapeHtml(input.intent)}</blockquote>` : ""}
${group("Confirmed", input.confirmed)}
${checksSection}
${group("Left out unproven", input.leftOutUnproven, "Left out")}
${group("Dismissed", input.dismissed)}
<footer>${escapeHtml(input.model)} at effort ${escapeHtml(input.effort)}, ${escapeHtml(input.profile)} profile, against ${escapeHtml(input.rulesetName)} v${input.rulesetVersion}.
Commit ${escapeHtml(input.fromCommit.slice(0, 12))}, merge base ${escapeHtml(input.mergeBaseCommit.slice(0, 12))}.
Cost equivalent $${input.usage.costEquivalentUsd.toFixed(4)}.</footer>
</body></html>
`;
}
