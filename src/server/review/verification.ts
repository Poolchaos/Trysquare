/**
 * The verification stage's question, and the program's checks on its answer.
 *
 * Shared by S5 in the pipeline and by verifying an open question again
 * (proof-and-steps plan, WP-D2), so a finding proven on its own is held to
 * exactly the checks a finding proven in a run is.
 */

import { readFile } from "node:fs/promises";
import { sep } from "node:path";
import { insideRoot } from "@/lib/paths";
import { renderRule } from "@/lib/rulesets/compose";
import type { ImportedRule } from "@/lib/rulesets/model";
import { rangesOverlap } from "@/lib/review/coverage";
import { describeStep, firstFailingStep } from "@/lib/review/evidence";
import { verificationStageSchema } from "@/lib/review/stage-schemas";
import type { Db } from "@/server/db/client";
import {
  markKilled,
  markOpenQuestion,
  markVerified,
  type Finding,
} from "@/server/db/repositories/findings";
import { realPath } from "@/server/real-path";
import { numberedLines, renderVerificationPrompt } from "./content";

export interface VerificationContext {
  db: Db;
  worktreeRoot: string;
  /** Each deleted file's lines before deletion, by qualified path (D-106). */
  baseContents?: ReadonlyMap<string, string> | undefined;
  rules: readonly ImportedRule[];
}

export interface VerdictTally {
  verified: number;
  killed: number;
  openQuestions: number;
  killedByQuoteCheck: number;
}

/** The label a candidate is given in the verification prompt. */
export function refFor(index: number): string {
  return `C${index + 1}`;
}

function indexOfRef(ref: string): number {
  const parsed = Number.parseInt(ref.replace(/^C/i, ""), 10);
  return Number.isFinite(parsed) ? parsed - 1 : -1;
}

export function renderVerificationFor(
  candidates: readonly Finding[],
  context: VerificationContext,
): string {
  return renderVerificationPrompt(
    candidates.map((finding, index) => ({
      // Positional, because the candidate order is fixed by the stage
      // answers that produced it, and those are replayed byte for byte.
      // A database id here would change on every resume and the
      // verification stage could never be replayed.
      ref: refFor(index),
      path: finding.filePath,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      severity: finding.severity,
      issue: finding.issue,
      mechanism: finding.mechanism,
      ruleCode: finding.ruleCode,
      comment: finding.comment,
    })),
    // The verifier reads only the worktree, which a deleted file has left
    // (D-106), so each one cited comes with it, once.
    Object.fromEntries(
      [...new Set(candidates.map((finding) => finding.filePath))].flatMap((path) => {
        const before = context.baseContents?.get(path);
        return before === undefined ? [] : [[path, numberedLines(before)]];
      }),
    ),
    // Each cited rule verbatim, once, so whether it applies is judged
    // against what it says (proof-and-steps plan, WP-C).
    Object.fromEntries(
      context.rules
        .filter((rule) => candidates.some((finding) => finding.ruleCode === rule.code))
        .map((rule) => [rule.code, renderRule(rule)]),
    ),
  );
}

export function parseVerdicts(output: unknown, candidateCount: number) {
  const parsed = verificationStageSchema.parse(output);
  assertVerdictsMatch(parsed.verdicts, candidateCount);
  return parsed.verdicts;
}

export async function applyVerdicts(
  context: VerificationContext,
  candidates: readonly Finding[],
  verdicts: ReturnType<typeof parseVerdicts>,
): Promise<VerdictTally> {
  const { db } = context;
  const tally: VerdictTally = { verified: 0, killed: 0, openQuestions: 0, killedByQuoteCheck: 0 };

  for (const verdict of verdicts) {
    const finding = candidates[indexOfRef(verdict.ref)];
    if (!finding) continue;

    if (verdict.verdict === "killed") {
      markKilled(db, finding.id, verdict.note || "Refuted during verification.", "verification");
      tally.killed += 1;
      continue;
    }
    if (verdict.verdict === "open_question") {
      markOpenQuestion(db, finding.id, verdict.note || "Could not be settled from the code.");
      tally.openQuestions += 1;
      continue;
    }

    // A finding the rule it cites does not cover is not a violation of it,
    // however real the code (proof-and-steps plan, WP-C).
    if (!verdict.ruleApplies) {
      markKilled(
        db,
        finding.id,
        `The verifier found that the rule it cites does not apply: ` +
          `${verdict.note || "no reason given"}`,
        "verification",
      );
      tally.killed += 1;
      continue;
    }

    // The last step is the failure, the code the finding is about. The
    // verifier may correct where it sits, but not move the finding onto
    // other code: a true quotation of lines the finding is not about
    // verified it, and the finding then moved to them (D-99).
    const failure = verdict.evidence[verdict.evidence.length - 1]!;
    if (failure.path !== finding.filePath || !rangesOverlap(finding, failure)) {
      markKilled(
        db,
        finding.id,
        failure.path !== finding.filePath
          ? `The proof ends in ${failure.path}, not in the cited ${finding.filePath}.`
          : `Verification quoted ${spanOf(failure)}, which does not overlap the cited ` +
              `${spanOf(finding)}.`,
        "quote_check",
      );
      tally.killed += 1;
      tally.killedByQuoteCheck += 1;
      continue;
    }

    // The verifier says it proved the finding. The program now checks every
    // step of that proof against the code, because a citation that does not
    // match is not evidence, however confident the wording. A deleted file
    // is checked against what it held, the only copy there is (D-106).
    const contents = new Map<string, string | null>();
    for (const path of new Set(verdict.evidence.map((step) => step.path))) {
      contents.set(
        path,
        context.baseContents?.get(path) ?? (await readFileIfPossible(context.worktreeRoot, path)),
      );
    }
    const failing = firstFailingStep(verdict.evidence, contents);
    if (failing !== null) {
      markKilled(
        db,
        finding.id,
        `${describeStep(verdict.evidence, failing.index)} ${failing.reason}.`,
        "quote_check",
      );
      tally.killed += 1;
      tally.killedByQuoteCheck += 1;
      continue;
    }

    markVerified(db, finding.id, {
      quotedCode: failure.quote,
      lineStart: failure.lineStart,
      lineEnd: failure.lineEnd,
      note: verdict.note,
      proof: {
        severity: verdict.severity,
        trigger: verdict.trigger,
        evidence: verdict.evidence,
        guardsSearched: verdict.guardsSearched,
      },
    });
    tally.verified += 1;
  }
  return tally;
}

export class VerdictsMismatchError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `The verification stage's verdicts do not match the candidates it was asked about: ` +
        `${problems.join("; ")}. A candidate takes one verdict, so the answer is ` +
        `refused.`,
    );
    this.name = "VerdictsMismatchError";
  }
}

/**
 * No candidate is given two verdicts. The second was applied as a second
 * state change and threw outside the checks that strike a refused answer, so
 * every resume replayed it (4.17). A verdict for no candidate is left aside
 * as before: its candidate goes to the person as an open question.
 */
function assertVerdictsMatch(verdicts: readonly { ref: string }[], candidateCount: number): void {
  const problems: string[] = [];
  const named = new Map<number, string>();
  for (const verdict of verdicts) {
    const index = indexOfRef(verdict.ref);
    if (index < 0 || index >= candidateCount) continue;
    const earlier = named.get(index);
    if (earlier !== undefined) {
      problems.push(
        `${refFor(index)} was given more than one verdict (as ${earlier} and ${verdict.ref})`,
      );
      continue;
    }
    named.set(index, verdict.ref);
  }
  if (problems.length > 0) throw new VerdictsMismatchError(problems);
}

function spanOf(range: { lineStart: number; lineEnd: number }): string {
  return range.lineStart === range.lineEnd
    ? `line ${range.lineStart}`
    : `lines ${range.lineStart} to ${range.lineEnd}`;
}

async function readFileIfPossible(root: string, qualifiedPath: string): Promise<string | null> {
  try {
    // A path a model named is contained like one from a diff: one that leaves
    // the worktree reads as unreadable, and the finding citing it is killed.
    // By where it really is, and read from there: a link the change
    // committed passes the text check and led the read wherever it pointed,
    // as it did the context route's (D-142, D-143; D-181 item 1).
    const [target, realRoot] = await Promise.all([
      realPath(insideRoot(root, qualifiedPath)),
      realPath(root),
    ]);
    if (target !== realRoot && !target.startsWith(realRoot + sep)) return null;
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}
