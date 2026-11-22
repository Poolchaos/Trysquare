import { describe, expect, it } from "vitest";
import { ruleCountWords } from "@/lib/rulesets/rule-count";

describe("how many rules a listed ruleset holds", () => {
  it("is its rules, when all are switched on", () => {
    expect(ruleCountWords(12, 12)).toBe("12 rules");
    expect(ruleCountWords(1, 1)).toBe("1 rule");
    expect(ruleCountWords(0, 0)).toBe("0 rules");
  });

  it("is those switched on of all, when some are off, as its own page counts them", () => {
    expect(ruleCountWords(9, 12)).toBe("9 of 12 rules on");
    expect(ruleCountWords(0, 15)).toBe("0 of 15 rules on");
    expect(ruleCountWords(0, 1)).toBe("0 of 1 rule on");
  });
});
