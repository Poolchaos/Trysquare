/**
 * Grading a project's screens (proof-and-steps plan, WP-I step 4; D-191,
 * D-192, D-198): every screenshot its own e2e saved, graded A to D by
 * looking at the image, against the project's design standard when it has
 * one. A C or D is a finding, and the paired model grades it again, not
 * shown the first grade; both must say C or D for it to stand.
 */

import { z } from "zod";

export const GRADES = ["A", "B", "C", "D"] as const;
export type Grade = (typeof GRADES)[number];

/** What each grade means, as the maintainer grades this app's own screens. */
export const GRADE_SCALE = [
  "- A: ready to ship, nothing to change.",
  "- B: ready to ship, minor polish noted that no user would trip on.",
  "- C: works but visibly off: alignment, spacing, overflow, contrast, hierarchy or copy.",
  "- D: broken or misleading: clipped, overlapping, unreadable, the wrong state or the wrong data.",
].join("\n");

/** Screenshots per request: each image costs the model a read. */
export const DESIGN_BATCH = 8;

export const designGradesSchema = z.object({
  grades: z
    .array(
      z.object({
        /** The screenshot's name exactly as the prompt lists it. */
        screenshot: z.string().min(1),
        /** Whether the grader opened the image: one it could not is no grade. */
        opened: z.boolean(),
        grade: z.enum(GRADES),
        /** For a C or D, what is off and where; for an A or B, may be empty. */
        whatIsOff: z.string(),
      }),
    )
    .min(1),
});
export type DesignGrades = z.infer<typeof designGradesSchema>;

export function isFailingGrade(grade: Grade): grade is "C" | "D" {
  return grade === "C" || grade === "D";
}

/** A D is broken, so critical; a C works but is off, so a warning. */
export function severityOfGrade(grade: "C" | "D"): "CRITICAL" | "WARNING" {
  return grade === "D" ? "CRITICAL" : "WARNING";
}

export function composeDesignSystemPrompt(options: {
  /** The second grader, which is not shown the first grade. */
  second: boolean;
  /** The project's design standard, verbatim, or null for the scale alone. */
  standard: string | null;
  outputContract: string;
}): string {
  return [
    "You grade screenshots of a project's own screens, saved by its own end-to-end tests,",
    "for whether the design is ready to ship.",
    ...(options.second
      ? [
          "",
          "You are the second, independent grader: another grader has already graded these",
          "screenshots, and you are not shown its grades.",
        ]
      : []),
    "",
    "# How to grade",
    "",
    "Open every screenshot listed with the Read tool and grade it by looking at the image",
    "itself, never from its name. Grade each one on this scale:",
    "",
    GRADE_SCALE,
    "",
    "For a C or a D, say what is off and where on the screen, specifically enough that",
    "someone could find it. Say opened: true only for a screenshot you opened and looked at;",
    "for one you could not open, say opened: false, and the review stops rather than guess.",
    ...(options.standard === null
      ? []
      : ["", "# The project's design standard", "", options.standard.trim()]),
    "",
    "# Output",
    "",
    options.outputContract,
  ].join("\n");
}

export interface DesignScreenshot {
  /** Relative to the screenshots folder, as the project's e2e named it. */
  name: string;
  path: string;
  /**
   * Of the image's bytes. In the prompt so that the request's identity is
   * the image's: a resume after the e2e saved a different one asks again
   * rather than replaying a grade of the old (review round 8).
   */
  sha256: string;
}

export function renderDesignPrompt(screenshots: readonly DesignScreenshot[]): string {
  return [
    `Grade these ${screenshots.length} screenshot(s), each exactly once, by the name given:`,
    "",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path} (sha256 ${shot.sha256})`),
  ].join("\n");
}

export class GradesMismatchError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `The grading stage did not open and grade each screenshot it was given exactly once: ` +
        `${problems.join("; ")}.`,
    );
    this.name = "GradesMismatchError";
  }
}

/**
 * Every screenshot asked about, opened and graded once, and nothing else: a
 * screen the answer left out would read as one that passed (as a hunk left
 * out would), and a C or D must say what is off for anyone to act on it.
 */
export function assertGradesMatch(grades: DesignGrades["grades"], asked: readonly string[]): void {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const grade of grades) {
    seen.set(grade.screenshot, (seen.get(grade.screenshot) ?? 0) + 1);
    if (!grade.opened) problems.push(`${grade.screenshot} could not be opened`);
    else if (isFailingGrade(grade.grade) && grade.whatIsOff.trim() === "") {
      problems.push(`${grade.screenshot} was graded ${grade.grade} without saying what is off`);
    }
  }
  for (const name of asked) {
    if (!seen.has(name)) problems.push(`${name} was not graded`);
  }
  for (const [name, count] of seen) {
    if (!asked.includes(name)) problems.push(`${name} was not asked about`);
    else if (count > 1) problems.push(`${name} was graded ${count} times`);
  }
  if (problems.length > 0) throw new GradesMismatchError(problems);
}
