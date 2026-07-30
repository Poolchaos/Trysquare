/**
 * What each stage is actually shown.
 *
 * The model has read access to the worktree, so it can open any file it needs.
 * What it cannot discover for itself is the change set: which files changed,
 * where the hunks are, what the mechanical sweep already found, and what a
 * deleted file used to contain. Those are computed deterministically before
 * any model runs and are inlined here, so a stage is never guessing at the
 * shape of the work and can be held to accounting for all of it.
 *
 * Pure functions over already-gathered data: no filesystem, no database, so
 * the exact text a stage receives is unit-testable.
 */

import type { RepoRole } from "@/lib/domain/enums";
import type { ParsedFile, ParsedHunk } from "@/lib/git/diff";
import type { ChangedSymbol } from "@/lib/git/symbols";

export interface ChangedFileEntry {
  repo: RepoRole;
  /** Directory name under the worktree root, as the model sees it. */
  slug: string;
  file: ParsedFile;
}

export interface SweepHitEntry {
  path: string;
  line: number;
  ruleCode: string;
  pattern: string;
  excerpt: string;
}

export interface CandidateEntry {
  findingId: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  severity: string;
  issue: string;
  mechanism: string;
}

export interface StageContentInput {
  files: readonly ChangedFileEntry[];
  sweepHits: readonly SweepHitEntry[];
  /** Only for a linked review: contract changes in the dependency. */
  changedSymbols?: readonly ChangedSymbol[];
  /** Pre-change contents, keyed by qualified path, for reviewing deletions. */
  baseContents?: ReadonlyMap<string, string>;
}

/** Paths are qualified by repository, matching what the model sees on disk. */
export function qualifiedPath(entry: ChangedFileEntry): string {
  return `${entry.slug}/${entry.file.path}`;
}

function fileHeadline(entry: ChangedFileEntry): string {
  const parts = [`${qualifiedPath(entry)} (${entry.file.changeType}`];
  if (entry.file.oldPath) parts.push(`, was ${entry.slug}/${entry.file.oldPath}`);
  if (entry.file.isBinary) parts.push(", binary");
  if (entry.file.isModeChangeOnly) parts.push(", mode change only");
  parts.push(`, +${entry.file.addedLines}/-${entry.file.removedLines})`);
  return parts.join("");
}

/**
 * One hunk, with the line numbers a finding must cite.
 *
 * Every added line is prefixed with its number in the post-change file. A
 * model reading a bare diff has to count lines to cite one, and counting is
 * exactly where citations drift; the numbers are therefore given rather than
 * left to be derived.
 */
export function renderHunk(entry: ChangedFileEntry, hunk: ParsedHunk): string {
  const lines: string[] = [
    `hunk ${hunk.hunkIndex} of ${qualifiedPath(entry)}` +
      (hunk.section ? ` (in ${hunk.section})` : ""),
  ];

  // Added and context lines advance the counter; removed lines do not exist
  // in the post-change file and so have no number to cite.
  let lineNumber = hunk.newStart;
  for (const raw of hunk.lines) {
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("-")) {
      lines.push(`       - ${raw.slice(1)}`);
      continue;
    }
    const marker = raw.startsWith("+") ? "+" : " ";
    lines.push(`${String(lineNumber).padStart(6)} ${marker} ${raw.slice(1)}`);
    lineNumber += 1;
  }

  return lines.join("\n");
}

export function renderChangeSummary(input: StageContentInput): string {
  const lines = input.files.map((entry) => `- ${fileHeadline(entry)}`);
  const hunkCount = input.files.reduce((total, entry) => total + entry.file.hunks.length, 0);
  return [
    `The change set contains ${input.files.length} file(s) and ${hunkCount} hunk(s):`,
    "",
    ...lines,
  ].join("\n");
}

export function renderRiskPrompt(input: StageContentInput): string {
  return [
    renderChangeSummary(input),
    "",
    "Classify each file above by the risk categories it touches, with a one-line",
    "reason for each. Use the exact paths shown. Report no findings.",
  ].join("\n");
}

export function renderComprehensionPrompt(input: StageContentInput): string {
  return [
    renderChangeSummary(input),
    "",
    "The full diff follows. Read each changed file in the worktree, and read the",
    "files it calls into, which the diff does not show. List those chain files by",
    "path so the record shows what was actually read.",
    "",
    renderAllHunks(input),
    "",
    "Explain what each file's change does and why. Report no findings.",
  ].join("\n");
}

function renderAllHunks(input: StageContentInput, only?: readonly string[]): string {
  const blocks: string[] = [];
  for (const entry of input.files) {
    if (only && !only.includes(qualifiedPath(entry))) continue;
    if (entry.file.hunks.length === 0) {
      blocks.push(
        `${qualifiedPath(entry)} has no hunks (${
          entry.file.isBinary
            ? "binary"
            : entry.file.isModeChangeOnly
              ? "mode change only"
              : entry.file.changeType
        }).`,
      );
      continue;
    }
    for (const hunk of entry.file.hunks) blocks.push(renderHunk(entry, hunk));
  }
  return blocks.join("\n\n");
}

export function renderSweepHits(hits: readonly SweepHitEntry[]): string {
  if (hits.length === 0) return "The mechanical sweep found no hits.";
  return [
    `The mechanical sweep found ${hits.length} hit(s). Every one must be`,
    "dispositioned: either it becomes a finding, or it is cleared with a reason.",
    "",
    ...hits.map(
      (hit) =>
        `- ${hit.path}:${hit.line} rule ${hit.ruleCode} matched /${hit.pattern}/: ${hit.excerpt}`,
    ),
  ].join("\n");
}

export function renderChangedSymbols(symbols: readonly ChangedSymbol[]): string {
  if (symbols.length === 0) return "";
  return [
    "",
    `The dependency repository changed ${symbols.length} exported symbol(s). Each is a`,
    "contract change that can only break at the consumer, so each must be",
    "dispositioned: find its consumers in the primary repository, check each one",
    "against the new contract, and either raise a finding or record which consumer",
    "files you verified.",
    "",
    ...symbols.map(
      (symbol) => `- ${symbol.name} (${symbol.kind}, ${symbol.change}) in ${symbol.path}`,
    ),
  ].join("\n");
}

export interface AdversarialScope {
  /** Restricts the prompt to one batch's files, for a chunked profile. */
  files?: readonly string[];
  theme?: string;
  batchNumber?: number;
  batchCount?: number;
}

export function renderAdversarialPrompt(
  input: StageContentInput,
  scope: AdversarialScope = {},
): string {
  const inScope = scope.files;
  const hits = inScope
    ? input.sweepHits.filter((hit) => inScope.includes(hit.path))
    : input.sweepHits;

  const header =
    scope.batchNumber && scope.batchCount
      ? `This is request ${scope.batchNumber} of ${scope.batchCount}` +
        (scope.theme ? `, covering the ${scope.theme} rules.` : ".") +
        " Account only for the hunks and sweep hits shown here."
      : "Account for every hunk and every sweep hit shown here.";

  return [
    header,
    "",
    renderChangeSummary(input),
    "",
    renderAllHunks(input, inScope),
    "",
    renderSweepHits(hits),
    renderChangedSymbols(input.changedSymbols ?? []),
    "",
    "Cite line numbers exactly as shown in the left column above: those are the",
    "line numbers in the file as it stands after the change. A hunk you do not",
    "mention is treated as unreviewed and fails the run.",
  ].join("\n");
}

export function renderDeletionPrompt(input: StageContentInput): string {
  const deletions = input.files.filter(
    (entry) => entry.file.changeType === "deleted" || entry.file.removedLines > 0,
  );

  if (deletions.length === 0) {
    return "This change set removes nothing. Report no findings and no reviewed deletions.";
  }

  const blocks = deletions.map((entry) => {
    const path = qualifiedPath(entry);
    const previous = input.baseContents?.get(path);
    const heading = `## ${path} (${entry.file.changeType})`;
    if (entry.file.changeType === "deleted" && previous !== undefined) {
      // A deleted file is not in the worktree, so its previous contents are
      // supplied here or the stage has nothing to review.
      return [heading, "", "Contents before deletion:", "", "```", previous, "```"].join("\n");
    }
    return [
      heading,
      "",
      "Removed lines are marked with a minus in the hunks below.",
      "",
      renderAllHunks({ ...input, files: [entry] }),
    ].join("\n");
  });

  return [
    `${deletions.length} file(s) removed code. For each, state what behaviour the`,
    "removed code provided and who depended on it. Search the worktree for callers.",
    "A removed guard, await, cleanup, or error handler is the highest risk.",
    "",
    ...blocks,
  ].join("\n\n");
}

export function renderVerificationPrompt(candidates: readonly CandidateEntry[]): string {
  if (candidates.length === 0) {
    return "There are no candidate findings to verify. Return an empty verdict list.";
  }
  return [
    `${candidates.length} candidate finding(s) follow. For each one, open the file in`,
    "the worktree, read the cited lines, and try to refute the finding. Look for a",
    "guard, default, narrowing, or upstream handling that already prevents it.",
    "",
    "Quote the code exactly as it appears in the file, and report the line numbers",
    "you actually found it at, not the ones given below. The quotation is compared",
    "against the file: if it does not match, the finding is discarded.",
    "",
    "```json",
    JSON.stringify({ candidates }, null, 2),
    "```",
  ].join("\n");
}
