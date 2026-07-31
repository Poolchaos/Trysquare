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
