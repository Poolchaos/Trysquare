/**
 * Grading a project's screens (WP-I step 4, D-199): what the grader is told,
 * and the check that every screenshot asked about was graded once.
 */

import { describe, expect, it } from "vitest";
import { buildStageArgs } from "@/lib/engine/command";
import {
  GradesMismatchError,
  assertGradesMatch,
  composeDesignSystemPrompt,
  renderDesignPrompt,
} from "@/lib/review/design";

const graded = (...names: string[]) =>
  names.map((screenshot) => ({ screenshot, opened: true, grade: "A" as const, whatIsOff: "" }));

describe("the grades a stage answers with", () => {
  it("are taken when each screenshot asked about is graded once", () => {
    expect(() =>
      assertGradesMatch(graded("home.png", "phone/x.png"), ["home.png", "phone/x.png"]),
    ).not.toThrow();
  });

  it("are refused when a screen is left out, doubled, or not one asked about", () => {
    expect(() => assertGradesMatch(graded("home.png"), ["home.png", "settings.png"])).toThrow(
      "settings.png was not graded",
    );
    expect(() => assertGradesMatch(graded("home.png", "home.png"), ["home.png"])).toThrow(
      "home.png was graded 2 times",
    );
    expect(() => assertGradesMatch(graded("home.png", "other.png"), ["home.png"])).toThrow(
      GradesMismatchError,
    );
  });

  it("are refused when a screen could not be opened, rather than graded D for it", () => {
    // The prompt said to grade an unopenable screen D: both graders saying
    // so made a proven finding of a file nobody had seen (review round 8).
    expect(() =>
      assertGradesMatch(
        [{ screenshot: "home.png", opened: false, grade: "D", whatIsOff: "Could not open it." }],
        ["home.png"],
      ),
    ).toThrow("home.png could not be opened");
  });

  it("are refused when a C or D does not say what is off", () => {
    expect(() =>
      assertGradesMatch(
        [{ screenshot: "home.png", opened: true, grade: "C", whatIsOff: "  " }],
        ["home.png"],
      ),
    ).toThrow("home.png was graded C without saying what is off");
    // An A or B may say nothing.
    expect(() =>
      assertGradesMatch(
        [{ screenshot: "home.png", opened: true, grade: "B", whatIsOff: "" }],
        ["home.png"],
      ),
    ).not.toThrow();
  });
});

describe("what a grader is told", () => {
  it("says the scale, and the project's standard when it has one", () => {
    const prompt = composeDesignSystemPrompt({
      second: false,
      standard: "Buttons are 44px tall.",
      outputContract: "CONTRACT",
    });
    expect(prompt).toContain("- C: works but visibly off");
    expect(prompt).toContain("# The project's design standard\n\nButtons are 44px tall.");
    expect(prompt).toContain("by looking at the image");
    expect(prompt).not.toContain("second, independent grader");
    expect(
      composeDesignSystemPrompt({ second: true, standard: null, outputContract: "C" }),
    ).toContain("you are not shown its grades");
  });

  it("lists each screenshot by the name to grade it under, where it is, and its hash", () => {
    expect(
      renderDesignPrompt([
        {
          name: "phone/home.png",
          path: "/runs/x/checks/screenshots/phone/home.png",
          sha256: "ab12",
        },
      ]),
    ).toBe(
      "Grade these 1 screenshot(s), each exactly once, by the name given:\n\n- phone/home.png: /runs/x/checks/screenshots/phone/home.png (sha256 ab12)",
    );
  });

  it("is a different request for a different image under the same name", () => {
    // The request's identity is its prompt (promptHashFor): a resume after
    // the e2e saved another image must not replay the old one's grade.
    const shot = { name: "home.png", path: "/s/home.png" };
    expect(renderDesignPrompt([{ ...shot, sha256: "aa" }])).not.toBe(
      renderDesignPrompt([{ ...shot, sha256: "bb" }]),
    );
  });

  it("says an unopened screen is said, not graded", () => {
    const prompt = composeDesignSystemPrompt({
      second: false,
      standard: null,
      outputContract: "C",
    });
    expect(prompt).toContain("say opened: false, and the review stops rather than guess");
    expect(prompt).not.toContain("is graded D, saying so");
  });

  it("may read the screenshots' folder only when the stage names it (D-198)", () => {
    const base = {
      prompt: "p",
      systemPrompt: "s",
      model: "claude-opus-5-5",
      outputFormat: "stream-json" as const,
    };
    expect(buildStageArgs(base)).not.toContain("--add-dir");
    const args = buildStageArgs({ ...base, addDirs: ["/runs/x/checks/screenshots"] });
    expect(args[args.indexOf("--add-dir") + 1]).toBe("/runs/x/checks/screenshots");
    // Still read-only.
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
  });
});
