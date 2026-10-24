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
  /**
   * Planted, and graded C or D by both graders, with what the first said is
   * off: both failing a screen is not both naming its defect, which only a
   * reading of the words can tell (review round 9).
   */
  found: { screenshot: string; defect: DesignDefect; grade: string; whatIsOff: string }[];
  /** Planted, and not proven, saying where it stopped. */
  missed: { screenshot: string; defect: DesignDefect; why: string }[];
  /** Clean, and graded C or D by both: a design fault the key does not have. */
  falsePositives: { screenshot: string; grade: string; whatIsOff: string }[];
  /** Clean, graded C or D by one grader only, or not yet by the second. */
  cleanOpen: string[];
  /** Graded C or D, but not a screenshot the key names. */
  unkeyed: { screenshot: string; status: string }[];
}

export function scoreDesign(
  rows: readonly GradedScreen[],
  key: readonly DesignKeyScreen[],
): DesignScore {
  const score: DesignScore = {
    found: [],
    missed: [],
    falsePositives: [],
    cleanOpen: [],
    unkeyed: [],
  };
  const design = rows.filter((row) => row.kind === "design");
  for (const screen of key) {
    const row = design.find((each) => each.screenshotPath === screen.screenshot);
    // Both graders failed it, whatever a person has decided since.
    const proven =
      row !== undefined &&
      (row.status === "verified" ||
        row.status === "confirmed" ||
        (row.status === "dismissed" && row.dismissedFrom === "verified"));
    if (screen.defect !== null) {
      if (proven) {
        score.found.push({
          screenshot: screen.screenshot,
          defect: screen.defect,
          grade: row.grade ?? "",
          whatIsOff: row.evidence,
        });
      } else {
        score.missed.push({
          screenshot: screen.screenshot,
          defect: screen.defect,
          why:
            row === undefined
              ? "the first grader passed it"
              : row.status === "candidate"
                ? // S5c never answered: a failed or stopped run, not a grade.
                  "the second grader never answered"
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
  for (const row of design) {
    if (!key.some((screen) => screen.screenshot === row.screenshotPath)) {
      score.unkeyed.push({ screenshot: row.screenshotPath ?? "", status: row.status });
    }
  }
  return score;
}
