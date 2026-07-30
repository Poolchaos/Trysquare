/**
 * Reconciling what a stage said it did against what it was asked to do.
 *
 * The adversarial stage is asked to account for every hunk and every sweep
 * hit. This module checks that it actually did, before anything downstream
 * treats the review as complete. It is separate from the database ledger so
 * the reconciliation is pure and testable: given what was asked and what came
 * back, what is unaccounted for.
 */

export interface HunkRef {
  path: string;
  hunkIndex: number;
}

export interface SweepRef {
  path: string;
  line: number;
  ruleCode: string;
}

/** A changed exported contract in a linked dependency. */
export interface SymbolRef {
  symbol: string;
  path: string;
}

export interface AdversarialAccounting {
  /** Hunks the stage attached findings to. */
  hunksWithFindings: readonly HunkRef[];
  /** Hunks the stage examined and explicitly cleared. */
  hunksCleared: readonly HunkRef[];
  sweepDispositions: readonly SweepRef[];
  /** Only for a linked review; absent is treated as none reported. */
  symbolDispositions?: readonly SymbolRef[];
}

export interface Reconciliation {
  unaccountedHunks: HunkRef[];
  unaccountedSweeps: SweepRef[];
  unaccountedSymbols: SymbolRef[];
  /** Reported by the stage but never asked for: a sign it invented context. */
  unknownHunks: HunkRef[];
  unknownSweeps: SweepRef[];
  unknownSymbols: SymbolRef[];
}

const hunkKey = (ref: HunkRef) => `${ref.path}::${ref.hunkIndex}`;
const sweepKey = (ref: SweepRef) => `${ref.path}::${ref.line}::${ref.ruleCode}`;
const symbolKey = (ref: SymbolRef) => `${ref.path}::${ref.symbol}`;

/**
 * Compares what was asked against what came back.
 *
 * Both directions matter. Something unaccounted for means work was skipped
 * while the review looked complete. Something reported that was never asked
 * for means the stage is describing a change set that does not exist, which
 * makes the rest of its output unsafe to trust.
 */
export function reconcileAdversarial(
  expectedHunks: readonly HunkRef[],
  expectedSweeps: readonly SweepRef[],
  reported: AdversarialAccounting,
  expectedSymbols: readonly SymbolRef[] = [],
): Reconciliation {
  const accountedHunks = new Set(
    [...reported.hunksWithFindings, ...reported.hunksCleared].map(hunkKey),
  );
  const accountedSweeps = new Set(reported.sweepDispositions.map(sweepKey));
  const reportedSymbols = reported.symbolDispositions ?? [];
  const accountedSymbols = new Set(reportedSymbols.map(symbolKey));

  const expectedHunkKeys = new Set(expectedHunks.map(hunkKey));
  const expectedSweepKeys = new Set(expectedSweeps.map(sweepKey));
  const expectedSymbolKeys = new Set(expectedSymbols.map(symbolKey));

  return {
    unaccountedHunks: expectedHunks.filter((hunk) => !accountedHunks.has(hunkKey(hunk))),
    unaccountedSweeps: expectedSweeps.filter((sweep) => !accountedSweeps.has(sweepKey(sweep))),
    unaccountedSymbols: expectedSymbols.filter(
      (symbol) => !accountedSymbols.has(symbolKey(symbol)),
    ),
    unknownHunks: [...reported.hunksWithFindings, ...reported.hunksCleared].filter(
      (hunk) => !expectedHunkKeys.has(hunkKey(hunk)),
    ),
    unknownSweeps: reported.sweepDispositions.filter(
      (sweep) => !expectedSweepKeys.has(sweepKey(sweep)),
    ),
    unknownSymbols: reportedSymbols.filter((symbol) => !expectedSymbolKeys.has(symbolKey(symbol))),
  };
}

export function isReconciled(result: Reconciliation): boolean {
  return (
    result.unaccountedHunks.length === 0 &&
    result.unaccountedSweeps.length === 0 &&
    result.unaccountedSymbols.length === 0 &&
    result.unknownHunks.length === 0 &&
    result.unknownSweeps.length === 0 &&
    result.unknownSymbols.length === 0
  );
}

export class StageDidNotAccountError extends Error {
  constructor(readonly result: Reconciliation) {
    const parts: string[] = [];
    if (result.unaccountedHunks.length > 0) {
      parts.push(
        `${result.unaccountedHunks.length} hunk(s) were neither given a finding nor cleared ` +
          `(for example ${result.unaccountedHunks
            .slice(0, 3)
            .map((h) => `${h.path} hunk ${h.hunkIndex}`)
            .join(", ")})`,
      );
    }
    if (result.unaccountedSweeps.length > 0) {
      parts.push(`${result.unaccountedSweeps.length} sweep hit(s) were left undispositioned`);
    }
    if (result.unknownHunks.length > 0) {
      parts.push(
        `${result.unknownHunks.length} hunk(s) were reported that are not in the change set`,
      );
    }
    if (result.unknownSweeps.length > 0) {
      parts.push(`${result.unknownSweeps.length} sweep hit(s) were reported that were never found`);
    }
    if (result.unaccountedSymbols.length > 0) {
      parts.push(
        `${result.unaccountedSymbols.length} changed exported symbol(s) were left ` +
          `undispositioned (for example ${result.unaccountedSymbols
            .slice(0, 3)
            .map((symbol) => `${symbol.symbol} in ${symbol.path}`)
            .join(", ")})`,
      );
    }
    if (result.unknownSymbols.length > 0) {
      parts.push(
        `${result.unknownSymbols.length} symbol(s) were dispositioned that did not change`,
      );
    }
    super(
      `The adversarial stage did not account for the change set: ${parts.join("; ")}. ` +
        `A hunk nobody mentioned is a hunk nobody reviewed.`,
    );
    this.name = "StageDidNotAccountError";
  }
}

export function assertReconciled(result: Reconciliation): void {
  if (!isReconciled(result)) throw new StageDidNotAccountError(result);
}
