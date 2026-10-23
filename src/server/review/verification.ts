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
  holdFirstProof,
  markKilled,
  markOpenQuestion,
  markVerified,
  statusOf,
  type Finding,
} from "@/server/db/repositories/findings";
import type { KillKind } from "@/lib/domain/enums";
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

/**
 * @param refs Each candidate's label, when not its position: the second
 *   verifier is asked under the first's labels, so a candidate keeps its
 *   label through both (WP-E).
 */
export function renderVerificationFor(
  candidates: readonly Finding[],
  context: VerificationContext,
  refs?: readonly string[],
): string {
  return renderVerificationPrompt(
    candidates.map((finding, index) => ({
      // Positional, because the candidate order is fixed by the stage
      // answers that produced it, and those are replayed byte for byte.
      // A database id here would change on every resume and the
      // verification stage could never be replayed.
      ref: refs?.[index] ?? refFor(index),
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

type Verdict = ReturnType<typeof parseVerdicts>[number];
type ProvenVerdict = Extract<Verdict, { verdict: "verified" }>;

/** A finding the first verifier proved, held for the second (WP-E). */
export interface HeldProof {
  finding: Finding;
  /** The label both verifiers know it by. */
  ref: string;
  verdict: ProvenVerdict;
}

/**
 * What the program checks of a proof, whichever verifier gave it: the rule
 * applies, a step is at the cited lines, and every step is the code at its
 * lines.
 */
async function checkProof(
  context: VerificationContext,
  finding: Finding,
  verdict: ProvenVerdict,
): Promise<{ ok: true } | { ok: false; by: KillKind; why: string; ruleDoesNotApply?: true }> {
  // A finding the rule it cites does not cover is not a violation of it,
  // however real the code (proof-and-steps plan, WP-C).
  if (!verdict.ruleApplies) {
    return {
      ok: false,
      by: "verification",
      why: verdict.note || "no reason given",
      ruleDoesNotApply: true,
    };
  }

  // The path passes through the code the finding is about, and may end
  // where the failure shows: the cause at line 4, the harm at line 5 (D-194,
  // from WP-H, where the last step had to be the cited lines and three real
  // defects were left open). The verifier may correct where that code sits,
  // but not move the finding onto other code: a true quotation of lines the
  // finding is not about verified it, and the finding then moved (D-99).
  if (citedStep(finding, verdict.evidence) === undefined) {
    const inFile = verdict.evidence.filter((step) => step.path === finding.filePath);
    return {
      ok: false,
      by: "quote_check",
      why:
        inFile.length === 0
          ? `The proof never passes through the cited ${finding.filePath}.`
          : `Verification quoted ${inFile.map(spanOf).join(" and ")}, which does not ` +
            `overlap the cited ${spanOf(finding)}.`,
    };
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
    return {
      ok: false,
      by: "quote_check",
      why: `${describeStep(verdict.evidence, failing.index)} ${failing.reason}.`,
    };
  }
  return { ok: true };
}

function proofOf(verdict: ProvenVerdict) {
  return {
    severity: verdict.severity,
    trigger: verdict.trigger,
    evidence: verdict.evidence,
    guardsSearched: verdict.guardsSearched,
  };
}

/** The first step at the cited lines, which checkProof requires there is. */
function citedStep(finding: Finding, evidence: ProvenVerdict["evidence"]) {
  return evidence.find((step) => step.path === finding.filePath && rangesOverlap(finding, step));
}

function markProven(context: VerificationContext, held: HeldProof, second?: ProvenVerdict): void {
  // Where the proof found the cited code, which may correct its lines.
  const cited = citedStep(held.finding, held.verdict.evidence)!;
  markVerified(context.db, held.finding.id, {
    quotedCode: cited.quote,
    lineStart: cited.lineStart,
    lineEnd: cited.lineEnd,
    note: held.verdict.note,
    proof: proofOf(held.verdict),
    ...(second === undefined ? {} : { secondProof: proofOf(second) }),
  });
}

/**
 * Applies the first verifier's verdicts. With `hold`, a finding whose proof
 * holds is not marked yet but returned, for the second verifier (WP-E).
 */
export async function applyVerdicts(
  context: VerificationContext,
  candidates: readonly Finding[],
  verdicts: ReturnType<typeof parseVerdicts>,
  options: { hold?: boolean } = {},
): Promise<VerdictTally & { held: HeldProof[] }> {
  const { db } = context;
  const tally: VerdictTally = { verified: 0, killed: 0, openQuestions: 0, killedByQuoteCheck: 0 };
  const held: HeldProof[] = [];

  for (const verdict of verdicts) {
    const index = indexOfRef(verdict.ref);
    const finding = candidates[index];
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

    const checked = await checkProof(context, finding, verdict);
    if (!checked.ok) {
      markKilled(
        db,
        finding.id,
        checked.ruleDoesNotApply
          ? `The verifier found that the rule it cites does not apply: ${checked.why}`
          : checked.why,
        checked.by,
      );
      tally.killed += 1;
      if (checked.by === "quote_check") tally.killedByQuoteCheck += 1;
      continue;
    }

    const proven = { finding, ref: refFor(index), verdict };
    if (options.hold) {
      // In a run, so the live view counts it proven once meanwhile; an open
      // question verified again keeps its status until both have answered.
      if (statusOf(finding) === "candidate") {
        holdFirstProof(context.db, finding.id, proofOf(verdict));
      }
      held.push(proven);
    } else markProven(context, proven);
    tally.verified += 1;
  }
  return { ...tally, held };
}

/**
 * Applies the second verifier's verdicts to the findings the first proved
 * (WP-E, D-188). Both proofs holding verifies it, the first's severity
 * standing and the second's proof kept beside it; anything else makes it an
 * open question naming the second verifier, so one verifier cannot override
 * the other.
 */
export async function applySecondVerdicts(
  context: VerificationContext,
  held: readonly HeldProof[],
  verdicts: ReturnType<typeof parseVerdicts>,
  model: string,
): Promise<{ verified: number; disagreed: number }> {
  let verified = 0;
  let disagreed = 0;
  for (const proven of held) {
    // By the label as S5 reads it, "c1" for C1, or a proof both gave goes unread.
    const second = verdicts.find((verdict) => indexOfRef(verdict.ref) === indexOfRef(proven.ref));
    let why: string | null;
    if (second === undefined) why = "gave no verdict for it.";
    else if (second.verdict === "killed") why = `refuted it: ${second.note || "no reason given."}`;
    else if (second.verdict === "open_question") {
      why = `could not settle it: ${second.note || "no reason given."}`;
    } else {
      const checked = await checkProof(context, proven.finding, second);
      why = checked.ok
        ? null
        : checked.ruleDoesNotApply
          ? `found the rule it cites does not apply: ${checked.why}`
          : `gave a proof that did not hold: ${checked.why}`;
      if (checked.ok) {
        markProven(context, proven, second);
        verified += 1;
        continue;
      }
    }
    markOpenQuestion(
      context.db,
      proven.finding.id,
      `The second verifier, ${model}, ${why}`,
      proofOf(proven.verdict),
    );
    disagreed += 1;
  }
  return { verified, disagreed };
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
