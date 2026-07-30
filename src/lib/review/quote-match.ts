/**
 * Checking a finding's quoted code against the file it cites.
 *
 * This is the last line of defence against a review that reads well and is
 * wrong. The verification stage is asked to open the file and quote what it
 * found; this compares that quote against the file on disk. If they disagree,
 * the finding dies regardless of how confident the model was, because a
 * citation that does not match the code is not evidence of anything.
 *
 * The comparison is deliberately strict about content and forgiving only about
 * things that carry no meaning: a trailing newline, and the common indentation
 * a quote may have lost. Anything looser would let a paraphrase pass as a
 * quotation, which is exactly the failure being prevented.
 */

export type QuoteMismatch =
  | { kind: "out-of-range"; fileLines: number }
  | { kind: "empty-quote" }
  | { kind: "content-differs"; actual: string };

export type QuoteCheck =
  { matches: true; actual: string } | { matches: false; reason: QuoteMismatch };

/** Removes the indentation shared by every non-blank line. */
export function stripCommonIndent(text: string): string {
  const lines = text.split("\n");
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const smallest = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => (line.trim() === "" ? line.trim() : line.slice(smallest))).join("\n");
}

function normalise(text: string): string {
  // Trailing whitespace on a line and a trailing newline are invisible and
  // carry no meaning, so they are not grounds to kill a finding.
  return stripCommonIndent(
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n+$/, ""),
  );
}

/**
 * Confirms the quoted code really is what stands at those lines.
 *
 * Line numbers are 1-indexed and inclusive, matching what a finding reports
 * and what an editor shows.
 */
export function checkQuotedCode(
  fileContents: string,
  lineStart: number,
  lineEnd: number,
  quotedCode: string,
): QuoteCheck {
  if (quotedCode.trim() === "") return { matches: false, reason: { kind: "empty-quote" } };

  const lines = fileContents.split("\n");
  // A file ending in a newline yields a trailing empty element that is not a
  // real line, and citing it would otherwise look valid.
  const lineCount =
    lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

  if (lineStart < 1 || lineEnd < lineStart || lineEnd > lineCount) {
    return { matches: false, reason: { kind: "out-of-range", fileLines: lineCount } };
  }

  const actual = lines.slice(lineStart - 1, lineEnd).join("\n");
  if (normalise(actual) === normalise(quotedCode)) return { matches: true, actual };

  return { matches: false, reason: { kind: "content-differs", actual } };
}

export function describeMismatch(reason: QuoteMismatch): string {
  switch (reason.kind) {
    case "empty-quote":
      return "the finding quoted no code, so there is nothing to check it against";
    case "out-of-range":
      return `the cited lines are outside the file, which has ${reason.fileLines} lines`;
    case "content-differs":
      return "the code at the cited lines is not what the finding quoted";
  }
}
