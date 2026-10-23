/**
 * Whether a finding is one of the fixture's planted defects, as the demo
 * scores a run against its key.
 */

export interface KeyedDefect {
  /** Qualified by its repository, as every path in a review is. */
  path: string;
  line: number;
  /**
   * Where the change was made, for a defect whose harm shows in another file
   * (D-195): both real-model runs cited the change, with a proof running to
   * the harm, and the key counted them missed. A null line is anywhere in
   * the file, a deleted one having no lines left to point at.
   */
  changeSite?: { path: string; line: number | null };
}

/** Within two lines: a reviewer that cites the guard rather than the line it guards has still found the defect. */
const near = (cited: number, line: number) => Math.abs(cited - line) <= 2;

export function findsDefect(
  finding: { filePath: string; lineStart: number },
  defect: KeyedDefect,
): boolean {
  if (finding.filePath === defect.path && near(finding.lineStart, defect.line)) return true;
  const site = defect.changeSite;
  return (
    site !== undefined &&
    finding.filePath === site.path &&
    (site.line === null || near(finding.lineStart, site.line))
  );
}
