import { describe, expect, it } from "vitest";
import { sharedCodes, sharedCodesRefusal } from "@/lib/rulesets/shared-codes";

describe("the rule codes a review's rulesets share", () => {
  it("are none when every code is in one ruleset", () => {
    expect(
      sharedCodes([
        { name: "General", codes: ["1", "2"] },
        { name: "TypeScript", codes: ["21", "22"] },
      ]),
    ).toEqual([]);
    expect(sharedCodes([{ name: "General", codes: ["1", "2"] }])).toEqual([]);
    expect(sharedCodes([])).toEqual([]);
  });

  it("are grouped by the rulesets that hold them", () => {
    expect(
      sharedCodes([
        { name: "General", codes: ["1", "2", "3", "4a"] },
        { name: "Ours", codes: ["2", "3", "9"] },
        { name: "Theirs", codes: ["3", "4a", "7"] },
      ]),
    ).toEqual([
      { codes: ["2"], rulesets: ["General", "Ours"] },
      { codes: ["3"], rulesets: ["General", "Ours", "Theirs"] },
      { codes: ["4a"], rulesets: ["General", "Theirs"] },
    ]);
  });

  it("are told apart exactly: 1 is not 10 and 4 is not 4a", () => {
    expect(
      sharedCodes([
        { name: "A", codes: ["1", "4"] },
        { name: "B", codes: ["10", "4a"] },
      ]),
    ).toEqual([]);
  });

  it("are refused in words that name each code and the rulesets it is in", () => {
    expect(
      sharedCodesRefusal([
        { codes: ["1", "2", "3"], rulesets: ["General", "TypeScript"] },
        { codes: ["9"], rulesets: ["General", "TypeScript", "Ours"] },
      ]),
    ).toBe(
      'These rulesets cannot judge one review together: rules 1, 2 and 3 are in "General" and ' +
        '"TypeScript"; rule 9 is in "General", "TypeScript" and "Ours". A finding names its rule ' +
        "by number alone, so a number may be in only one of a review's rulesets. Leave one of " +
        "them out, or change the numbers in one.",
    );
  });
});
