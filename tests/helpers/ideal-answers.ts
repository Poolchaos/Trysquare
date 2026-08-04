/**
 * The answers a correct reviewer would give about the seeded fixture.
 *
 * Built from the fixture's manifest rather than from a model, so tests that
 * use these measure the pipeline and the service rather than today's model
 * behaviour. Two callers need them and must not drift apart: the engine
 * quality gate, which runs the pipeline in process, and the service tests,
 * which drive the whole thing through the fake CLI reading answers from
 * files. Both build from here.
 *
 * `extraFindings` and `misquote` exist so a test can make this reviewer lie
 * in a specific way and watch the pipeline discard the lie.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { ParsedFile } from "@/lib/git/diff";
import { changedExportedSymbols } from "@/lib/git/symbols";
import type { ImportedRule } from "@/lib/rulesets/model";
import { runSweeps } from "@/lib/review/sweep";
import type {
  adversarialStageSchema,
  comprehensionStageSchema,
  deletionStageSchema,
  riskStageSchema,
} from "@/lib/review/stage-schemas";
import { isDeletionCandidate } from "@/server/review/content";
import type { StageRequest, StageResponse } from "@/server/review/pipeline";

export interface SeededDefect {
  id: string;
  repo: string;
  file: string;
  marker: string;
  line: number;
  ruleCode: string;
  severity: "CRITICAL" | "WARNING" | "NITPICK";
  kind: "addition" | "deletion" | "cross-repo" | "deleted-file";
  /** For a deleted-file defect: the file removed whole, while `file` is its surviving caller. */
  deletedFile?: string;
  /** For a cross-repo defect: the dependency symbol whose contract moved. */
  dependsOnSymbol?: string;
}

export interface SeededManifest {
  defects: SeededDefect[];
  cleanFiles: string[];
}

/** A changed file as the model sees it: repo-qualified by its worktree slug. */
export interface FileEntry {
  repo: "primary" | "linked";
  slug: string;
  file: ParsedFile;
}

export interface IdealAnswerInput {
  files: readonly FileEntry[];
  manifest: SeededManifest;
  /** Where the two repositories are checked out side by side. */
  worktreeRoot: string;
  rules: readonly ImportedRule[];
  /** Findings this reviewer should raise on top of the seeded defects. */
  extraFindings?: readonly Record<string, unknown>[];
  /** Quote code that is not there, for the findings marked as invented. */
  misquote?: boolean;
}

/**
 * A verdict the reviewer wants to give, before it knows what the prompt will
 * call each candidate.
 *
 * Labels are assigned by position when the verification prompt is built, so an
 * answer written in advance cannot name them. These are keyed by the place in
 * the code instead, and resolved to labels at the moment the stage asks its
 * question. This is test plumbing, not product behaviour: a real reviewer is
 * handed the labels in its prompt.
 */
export interface VerdictByLine {
  path: string;
  lineStart: number;
  verdict: "verified" | "killed" | "open_question";
  quotedCode: string;
  note: string;
}

export interface IdealStageOutputs {
  s1: z.infer<typeof riskStageSchema>;
  s2: z.infer<typeof comprehensionStageSchema>;
  s3: z.infer<typeof adversarialStageSchema>;
  s4: z.infer<typeof deletionStageSchema>;
  /** Resolved to prompt labels at run time; see VerdictByLine. */
  s5ByLine: VerdictByLine[];
}

const qualifyIn = (repo: string, path: string): string =>
  `${repo === "app" ? "app" : "shared-core"}/${path}`;

const qualify = (defect: SeededDefect): string => qualifyIn(defect.repo, defect.file);

export function buildIdealStageOutputs(input: IdealAnswerInput): IdealStageOutputs {
  const { files, manifest, worktreeRoot, rules } = input;

  /** The exact text at a line in the checked-out file, for an honest quotation. */
  const lineText = (qualifiedPath: string, line: number): string => {
    const contents = readFileSync(join(worktreeRoot, qualifiedPath), "utf8").split("\n");
    return contents[line - 1] ?? "";
  };

  const sweepHits = runSweeps(
    files.map((entry) => ({ repo: entry.repo, file: entry.file })),
    rules,
  ).hits.map((hit) => {
    const entry = files.find((f) => f.file.path === hit.path && f.repo === hit.repo);
    return { ...hit, path: `${entry?.slug ?? ""}/${hit.path}` };
  });

  // A deleted-file defect cannot be an S3 finding: its caller is not in the
  // change set, and the pipeline rejects an S3 finding whose file has no hunk.
  // It is raised by S4, the stage that reads removals, and faces only the
  // quote check against the surviving caller in the worktree.
  const findingFor = (defect: SeededDefect) => ({
    path: qualify(defect),
    lineStart: defect.line,
    lineEnd: defect.line,
    severity: defect.severity,
    ruleCode: defect.ruleCode,
    issue: `Seeded defect: ${defect.id}`,
    comment: `The change introduces ${defect.id}.`,
    mechanism:
      defect.kind === "deleted-file"
        ? `traced from the deletion of ${defect.deletedFile} to its caller ${defect.file}:${defect.line}`
        : `traced from the change to ${defect.file}:${defect.line}`,
  });
  const findings = manifest.defects
    .filter((defect) => defect.kind !== "deleted-file")
    .map(findingFor);
  const s4Findings = manifest.defects
    .filter((defect) => defect.kind === "deleted-file")
    .map(findingFor);

  /** The hunk a finding falls in, mirroring how the pipeline maps them. */
  const hunkFor = (path: string, line: number): number => {
    const entry = files.find((f) => `${f.slug}/${f.file.path}` === path);
    if (!entry) return 0;
    const containing = entry.file.hunks.find(
      (hunk) => line >= hunk.newStart && line < hunk.newStart + Math.max(hunk.newLines, 1),
    );
    return containing?.hunkIndex ?? entry.file.hunks[0]?.hunkIndex ?? 0;
  };

  const withFindings = new Set(
    findings.map((finding) => `${finding.path}::${hunkFor(finding.path, finding.lineStart)}`),
  );

  const clearedHunks = files.flatMap((entry) =>
    entry.file.hunks
      .filter((hunk) => !withFindings.has(`${entry.slug}/${entry.file.path}::${hunk.hunkIndex}`))
      .map((hunk) => ({
        path: `${entry.slug}/${entry.file.path}`,
        hunkIndex: hunk.hunkIndex,
        reason: "Read in full; the change is correct and introduces no defect.",
      })),
  );

  const sweepDispositions = sweepHits.map((hit) => {
    const backing = findings.find(
      (finding) => finding.path === hit.path && Math.abs(finding.lineStart - hit.line) <= 2,
    );
    return backing
      ? {
          path: hit.path,
          line: hit.line,
          ruleCode: hit.ruleCode,
          disposition: "finding" as const,
          reason: "This is the defect the finding describes.",
        }
      : {
          path: hit.path,
          line: hit.line,
          ruleCode: hit.ruleCode,
          disposition: "cleared" as const,
          reason: "Examined; the pattern is benign here.",
        };
  });

  const linkedFiles = files.filter((entry) => entry.repo === "linked").map((entry) => entry.file);
  // Qualified exactly as the pipeline now qualifies its expectation and its
  // prompt: the worktree path, slug first.
  const linkedSlug = files.find((entry) => entry.repo === "linked")?.slug;
  const symbolPath = (path: string) => (linkedSlug ? `${linkedSlug}/${path}` : path);
  const symbolDispositions = changedExportedSymbols(linkedFiles).map((symbol) => {
    const broken = manifest.defects.find((defect) => defect.kind === "cross-repo");
    const isRenamedField = symbol.name === "Prefs";
    return isRenamedField && broken
      ? {
          symbol: symbol.name,
          path: symbolPath(symbol.path),
          consumersChecked: [qualify(broken)],
          verdict: "finding" as const,
          reason: "One consumer still reads the field under its old name.",
        }
      : {
          symbol: symbol.name,
          path: symbolPath(symbol.path),
          consumersChecked: [],
          verdict: "no_consumers_found" as const,
          reason: "Nothing in the primary repository reads this yet.",
        };
  });

  const extras = (input.extraFindings ?? []) as typeof findings;
  const allFindings = [...findings, ...extras];

  // The union: S5 is asked about every candidate whatever stage raised it, so
  // an S4 finding missing here would surface far away, as an open question
  // that fails the verified-count assertions.
  const s5ByLine: VerdictByLine[] = [...allFindings, ...s4Findings].map((finding) => {
    const invented = String(finding.issue ?? "").startsWith("Invented");
    return {
      path: finding.path,
      lineStart: finding.lineStart,
      verdict: "verified",
      // Quoted from the file, which is what makes the check pass. When asked
      // to misquote, the reviewer reports plausible code that is not at those
      // lines, exactly as a confident but wrong reviewer would.
      quotedCode:
        input.misquote && invented
          ? "const somethingThatIsNotThere = true;"
          : lineText(finding.path, finding.lineStart),
      note: "Confirmed against the checked-out file.",
    };
  });

  return {
    s1: {
      files: files.map((entry) => ({
        path: `${entry.slug}/${entry.file.path}`,
        riskTags: [],
        reason: "Assessed.",
      })),
    },
    s2: {
      files: files.map((entry) => ({
        path: `${entry.slug}/${entry.file.path}`,
        summary: "Read in full, including the files it calls into.",
        chainFilesRead: [],
        uncertainties: [],
      })),
    },
    s3: { findings: allFindings, clearedHunks, sweepDispositions, symbolDispositions },
    s4: {
      findings: s4Findings,
      // Every file the deletion prompt lists, accounted for by name. An
      // ideal reviewer answers for all of them, including the ones it finds
      // harmless, because the pipeline reconciles this list against what it
      // showed and a silent omission is the failure being guarded against.
      reviewedDeletions: files.filter(isDeletionCandidate).map((entry) => {
        const path = `${entry.slug}/${entry.file.path}`;
        const owner = manifest.defects.find(
          (defect) =>
            defect.kind === "deleted-file" &&
            defect.deletedFile !== undefined &&
            qualifyIn(defect.repo, defect.deletedFile) === path,
        );
        if (owner) {
          return {
            path,
            behaviourRemoved: "The whole file, read in full before it was removed.",
            dependents: [qualify(owner)],
            reason: `Deleted whole while ${owner.file} still imports and calls it.`,
          };
        }
        return {
          path,
          behaviourRemoved:
            entry.file.changeType === "deleted"
              ? "The whole file, read in full before it was removed."
              : "The removed lines, read in the surrounding context.",
          dependents: [],
          reason: "Searched the worktree for callers; nothing depends on what went.",
        };
      }),
    },
    s5ByLine,
  };
}

/**
 * The candidates a verification prompt is asking about.
 *
 * The prompt embeds them as one JSON object, so this reads them back the same
 * way a model would have to.
 */
export function candidatesInPrompt(
  prompt: string,
): { ref: string; path: string; lineStart: number }[] {
  const start = prompt.indexOf("{");
  const end = prompt.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  const parsed = JSON.parse(prompt.slice(start, end + 1)) as {
    candidates?: { ref: string; path: string; lineStart: number }[];
  };
  return parsed.candidates ?? [];
}

/** Resolves the by-line verdicts against the candidates a prompt asks about. */
export function verdictsForPrompt(
  prompt: string,
  byLine: readonly VerdictByLine[],
): Record<string, unknown>[] {
  return candidatesInPrompt(prompt).map((candidate) => {
    const wanted = byLine.find(
      (verdict) => verdict.path === candidate.path && verdict.lineStart === candidate.lineStart,
    );
    return {
      ref: candidate.ref,
      verdict: wanted?.verdict ?? "open_question",
      quotedCode: wanted?.quotedCode ?? "",
      lineStart: candidate.lineStart,
      lineEnd: candidate.lineStart,
      note: wanted?.note ?? "No verdict was prepared for this candidate.",
    };
  });
}

/** An in-process reviewer that answers a pipeline run from these outputs. */
export function idealRunner(
  outputs: IdealStageOutputs,
): (request: StageRequest) => Promise<StageResponse> {
  return async (request: StageRequest): Promise<StageResponse> => {
    switch (request.stage) {
      case "s1_risk":
        return { output: outputs.s1, sessionId: "gate" };
      case "s2_comprehension":
        return { output: outputs.s2, sessionId: "gate" };
      case "s3_adversarial":
        return { output: outputs.s3, sessionId: "gate" };
      case "s4_deletions":
        return { output: outputs.s4, sessionId: "gate" };
      case "s5_verification":
        return {
          output: { verdicts: verdictsForPrompt(request.prompt, outputs.s5ByLine) },
          sessionId: "gate-verify",
        };
      default:
        return { output: {}, sessionId: "gate" };
    }
  };
}

/**
 * The token the fake CLI replaces with the label the prompt gave the candidate
 * at a place in the code. Shared with `fake-claude.mjs`, which does the
 * replacing.
 */
export function candidateToken(path: string, lineStart: number): string {
  return `<<candidate:${path}:${lineStart}>>`;
}

/**
 * The same answers as numbered files, for a run driven through the fake CLI.
 *
 * The order is the order the pipeline asks its questions: risk,
 * comprehension, adversarial, deletions, verification. A profile that batches
 * the adversarial stage asks it more than once, so callers that use one pass
 * a different sequence.
 */
export function answerSequence(outputs: IdealStageOutputs): unknown[] {
  return [
    outputs.s1,
    outputs.s2,
    outputs.s3,
    outputs.s4,
    {
      verdicts: outputs.s5ByLine.map((verdict) => ({
        ref: candidateToken(verdict.path, verdict.lineStart),
        verdict: verdict.verdict,
        quotedCode: verdict.quotedCode,
        lineStart: verdict.lineStart,
        lineEnd: verdict.lineStart,
        note: verdict.note,
      })),
    },
  ];
}

/** Materialises an answer sequence as 001.json, 002.json, and so on. */
export function writeAnswersDir(dir: string, answers: readonly unknown[]): string {
  mkdirSync(dir, { recursive: true });
  answers.forEach((answer, index) => {
    const name = `${String(index + 1).padStart(3, "0")}.json`;
    writeFileSync(join(dir, name), JSON.stringify(answer, null, 2));
  });
  return dir;
}
