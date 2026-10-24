/**
 * The design fixture's score (WP-I step 6): each screenshot by what the key
 * planted and what the two graders made of it.
 */

import { describe, expect, it } from "vitest";
import { scoreDesign, type DesignKeyScreen } from "../../scripts/lib/design-score";

const key: DesignKeyScreen[] = [
  { screenshot: "desktop/help.png", page: "pages/help.html", viewport: "desktop", defect: null },
  {
    screenshot: "phone/checkout.png",
    page: "pages/checkout.html",
    viewport: "phone",
    defect: "overflow",
  },
  { screenshot: "phone/help.png", page: "pages/help.html", viewport: "phone", defect: null },
  {
    screenshot: "phone/profile.png",
    page: "pages/profile.html",
    viewport: "phone",
    defect: "clipped",
  },
  {
    screenshot: "phone/receipt.png",
    page: "pages/receipt.html",
    viewport: "phone",
    defect: "contrast",
  },
];

const row = (screenshotPath: string, status: string, extra: object = {}) => ({
  kind: "design",
  screenshotPath,
  status,
  grade: "D",
  evidence: "Something is off.",
  verificationNote: null,
  ...extra,
});

describe("a design fixture review's score", () => {
  it("finds a planted screen both graders failed, whatever a person decided after", () => {
    const score = scoreDesign(
      [
        row("phone/checkout.png", "verified"),
        row("phone/profile.png", "confirmed"),
        row("phone/receipt.png", "dismissed", { dismissedFrom: "verified", grade: "C" }),
      ],
      key,
    );
    expect(score.found.map((hit) => [hit.screenshot, hit.defect, hit.grade])).toEqual([
      ["phone/checkout.png", "overflow", "D"],
      ["phone/profile.png", "clipped", "D"],
      ["phone/receipt.png", "contrast", "C"],
    ]);
    expect(score.missed).toEqual([]);
  });

  it("misses a planted screen the first grader passed, or the second", () => {
    const score = scoreDesign(
      [
        row("phone/checkout.png", "open_question", {
          verificationNote: "The second grader, claude-fable-5-1, graded it B.",
        }),
        row("phone/profile.png", "dismissed", { dismissedFrom: "open_question" }),
        row("phone/receipt.png", "verified"),
      ],
      key,
    );
    expect(score.missed).toEqual([
      {
        screenshot: "phone/checkout.png",
        defect: "overflow",
        why: "the second grader did not fail it: The second grader, claude-fable-5-1, graded it B.",
      },
      {
        screenshot: "phone/profile.png",
        defect: "clipped",
        why: "the second grader did not fail it",
      },
    ]);
    expect(scoreDesign([], key).missed.map((miss) => miss.why)).toEqual([
      "the first grader passed it",
      "the first grader passed it",
      "the first grader passed it",
    ]);
  });

  it("says a planted screen the second grader never answered on, rather than blame it", () => {
    // A run stopped in S5c left its rows candidates: it was scored "the
    // second grader did not fail it", which no grader said (review round 9).
    const score = scoreDesign([row("phone/checkout.png", "candidate")], key);
    expect(score.missed[0]).toEqual({
      screenshot: "phone/checkout.png",
      defect: "overflow",
      why: "the second grader never answered",
    });
  });

  it("carries what the first grader said beside a found screen", () => {
    const score = scoreDesign(
      [row("phone/checkout.png", "verified", { evidence: "The table runs off the right." })],
      key,
    );
    expect(score.found[0]!.whatIsOff).toBe("The table runs off the right.");
  });

  it("names a failed screen the key does not have, rather than drop it", () => {
    const score = scoreDesign([row("phone/extra.png", "verified")], key);
    expect(score.unkeyed).toEqual([{ screenshot: "phone/extra.png", status: "verified" }]);
  });

  it("counts a clean screen both failed as a false positive, and one failed once apart", () => {
    const score = scoreDesign(
      [
        row("desktop/help.png", "verified", { grade: "C", evidence: "The button is small." }),
        row("phone/help.png", "open_question"),
        // A code finding's row is no screen's.
        { ...row("phone/checkout.png", "verified"), kind: "test" },
      ],
      key,
    );
    expect(score.falsePositives).toEqual([
      { screenshot: "desktop/help.png", grade: "C", whatIsOff: "The button is small." },
    ]);
    expect(score.cleanOpen).toEqual(["phone/help.png"]);
    expect(score.missed.map((miss) => miss.screenshot)).toContain("phone/checkout.png");
  });
});
