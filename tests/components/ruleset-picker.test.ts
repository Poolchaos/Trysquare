/**
 * What a list of ticks comes to, before anything is asked of the server
 * (RS-4a, review round 25).
 */

import { describe, expect, it } from "vitest";
import { firstListed, rulesetChoice } from "@/components/ruleset-picker";

const listed = [
  {
    id: "a",
    name: "General",
    tier: "global",
    version: 1,
    ruleCount: 2,
    ruleTotal: 2,
    codes: ["1", "2"],
  },
  {
    id: "b",
    name: "TypeScript",
    tier: "tech",
    version: 3,
    ruleCount: 1,
    ruleTotal: 1,
    codes: ["21"],
  },
  { id: "c", name: "Ours", tier: "project", version: 1, ruleCount: 1, ruleTotal: 2, codes: ["2"] },
];

describe("the rulesets ticked for a review", () => {
  it("go in the list's order, whatever order they were ticked in", () => {
    // One set, one request: ticked the other way round, the pre-flight was
    // otherwise asked again about the same rulesets.
    expect(rulesetChoice(listed, ["b", "a"])).toEqual({
      ids: ["a", "b"],
      refusal: "",
      noneTicked: false,
    });
  });

  it("leave out one that is no longer listed", () => {
    expect(rulesetChoice(listed, ["gone", "b"]).ids).toEqual(["b"]);
    expect(rulesetChoice(listed, ["gone"])).toEqual({ ids: [], refusal: "", noneTicked: true });
  });

  it("are refused in the server's words when two hold a rule under one number", () => {
    expect(rulesetChoice(listed, ["a", "c"]).refusal).toBe(
      'These rulesets cannot judge one review together: rule 2 is in "General" and "Ours". ' +
        "A finding names its rule by number alone, so a number may be in only one of a " +
        "review's rulesets. Leave one of them out, or change the numbers in one.",
    );
  });

  it("are said to be none only where there is a list to tick", () => {
    expect(rulesetChoice(listed, []).noneTicked).toBe(true);
    expect(rulesetChoice([], null).noneTicked).toBe(false);
  });
});

describe("the ruleset ticked on arrival where no default is set", () => {
  it("is the first the list draws, tier by tier, not the first by name", () => {
    // The server lists by name alone: "Company base rules" comes before
    // "General", and was ticked while the list drew General first.
    const byName = [
      { ...listed[2]!, id: "p", name: "Company base rules", tier: "project" },
      { ...listed[0]!, id: "g", name: "General", tier: "global" },
      { ...listed[1]!, id: "t", name: "TypeScript", tier: "tech" },
    ];
    expect(firstListed(byName)?.name).toBe("General");
    expect(firstListed(byName.slice(0, 1))?.name).toBe("Company base rules");
    expect(firstListed([])).toBeUndefined();
  });
});
