/**
 * The note a finished run leaves on its review.
 *
 * `killed` counts every kill and `killedByQuoteCheck` the program's own, so
 * the verifier's refutations are the difference: the note used to give the
 * whole of `killed` as refuted beside the quotation check's count, saying
 * three findings were both refuted and discarded (review of 4.24 to 4.27).
 */
export function runSummary(
  fileCount: number,
  result: {
    candidatesRaised: number;
    verified: number;
    killed: number;
    killedByQuoteCheck: number;
    openQuestions: number;
  },
): string {
  return (
    `Reviewed ${fileCount} changed file(s): ${result.candidatesRaised} candidate(s) raised, ` +
    `${result.verified} verified, ${result.killed - result.killedByQuoteCheck} refuted, ` +
    `${result.openQuestions} left open, ${result.killedByQuoteCheck} discarded by the ` +
    "quotation check."
  );
}
