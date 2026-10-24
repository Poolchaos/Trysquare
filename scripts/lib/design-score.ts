/**
 * A review of the design fixture scored against its key (WP-I step 6): for
 * each screenshot, what the key planted and what the two graders made of it.
 */

export type DesignDefect = "overflow" | "contrast" | "clipped";

export interface DesignKeyScreen {
  screenshot: string;
  page: string;
  viewport: "desktop" | "phone";
  defect: DesignDefect | null;
}

export interface DesignManifest {
  branch: string;
  screens: DesignKeyScreen[];
}

/** A design check finding as the review left it. */
export interface GradedScreen {
  kind: string;
  /** The screenshot's name (review round 8). */
  screenshotPath: string | null;
  status: string;
  grade: string | null;
  evidence: string;
  verificationNote: string | null;
  dismissedFrom?: string | null;
}

export interface DesignScore {
  /** Planted, and graded C or D by both graders. */
  found: { screenshot: string; defect: DesignDefect; grade: string }[];
  /** Planted, and not proven: passed by the first grader, or by the second. */
  missed: { screenshot: string; defect: DesignDefect; why: string }[];
  /** Clean, and graded C or D by both: a design fault the key does not have. */
  falsePositives: { screenshot: string; grade: string; whatIsOff: string }[];
  /** Clean, graded C or D by one grader only. */
  cleanOpen: string[];
}

export function scoreDesign(
  rows: readonly GradedScreen[],
  key: readonly DesignKeyScreen[],
): DesignScore {
  const score: DesignScore = { found: [], missed: [], falsePositives: [], cleanOpen: [] };
  for (const screen of key) {
    const row = rows.find(
      (each) => each.kind === "design" && each.screenshotPath === screen.screenshot,
    );
    // Both graders failed it, whatever a person has decided since.
    const proven =
      row !== undefined &&
      (row.status === "verified" ||
        row.status === "confirmed" ||
        (row.status === "dismissed" && row.dismissedFrom === "verified"));
    if (screen.defect !== null) {
      if (proven)
        score.found.push({
          screenshot: screen.screenshot,
          defect: screen.defect,
          grade: row.grade ?? "",
        });
      else {
        score.missed.push({
          screenshot: screen.screenshot,
          defect: screen.defect,
          why:
            row === undefined
              ? "the first grader passed it"
              : `the second grader did not fail it${row.verificationNote ? `: ${row.verificationNote}` : ""}`,
        });
      }
    } else if (proven) {
      score.falsePositives.push({
        screenshot: screen.screenshot,
        grade: row.grade ?? "",
        whatIsOff: row.evidence,
      });
    } else if (row !== undefined) {
      score.cleanOpen.push(screen.screenshot);
    }
  }
  return score;
}
