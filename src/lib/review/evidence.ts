/**
 * The path a verifier traces from a trigger to the failure, each step quoted
 * from the code, and the check that each step is there (the proof-and-steps
 * plan, WP-C). One quotation proved the cited code existed; a path proves how
 * the failure is reached, and every step of it is found in the file or the
 * finding is discarded.
 */

import { checkQuotedCode, describeMismatch } from "./quote-match";

export interface EvidenceStep {
  path: string;
  lineStart: number;
  lineEnd: number;
  quote: string;
}

/**
 * The first step not found in the code, or null when every step is.
 *
 * @param contents Each file's text by the path a step names; null when it
 *   could not be read.
 */
export function firstFailingStep(
  steps: readonly EvidenceStep[],
  contents: ReadonlyMap<string, string | null>,
): { index: number; reason: string } | null {
  for (const [index, step] of steps.entries()) {
    const text = contents.get(step.path) ?? null;
    if (text === null) return { index, reason: "names a file that could not be read" };
    const check = checkQuotedCode(text, step.lineStart, step.lineEnd, step.quote);
    if (!check.matches) {
      return { index, reason: `did not match the file: ${describeMismatch(check.reason)}` };
    }
  }
  return null;
}

/** "Evidence step 2 of 3 (app/x.ts lines 10 to 12)", for the note a kill leaves. */
export function describeStep(steps: readonly EvidenceStep[], index: number): string {
  const step = steps[index];
  if (step === undefined) return `Evidence step ${index + 1} of ${steps.length}`;
  const lines =
    step.lineStart === step.lineEnd
      ? `line ${step.lineStart}`
      : `lines ${step.lineStart} to ${step.lineEnd}`;
  return `Evidence step ${index + 1} of ${steps.length} (${step.path} ${lines})`;
}
