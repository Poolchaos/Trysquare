import { describe, expect, it } from "vitest";
import { ruleCodeReader } from "@/lib/review/rule-codes";

const read = ruleCodeReader(["1", "2a", "11", "28"]);

describe("reading a rule code a model wrote in prose", () => {
  it("leaves a code that already matches the ruleset alone", () => {
    expect(read("11")).toBe("11");
    expect(read("2a")).toBe("2a");
  });

  it("reads the prose forms a model actually produces", () => {
    // "Rule 1" is what both live runs of the fixture came back with.
    expect(read("Rule 11")).toBe("11");
    expect(read("rule 2a")).toBe("2a");
    expect(read("Rule: 28")).toBe("28");
    expect(read("#11")).toBe("11");
    expect(read("Rule #2a")).toBe("2a");
    expect(read("  Rule 1  ")).toBe("1");
  });

  it("answers in the ruleset's own spelling, not the model's", () => {
    // The code is matched to a rule and then reported the way the protocol
    // wrote it, so two findings citing one rule cannot disagree about its name.
    expect(read("2A")).toBe("2a");
    expect(read("RULE 2A")).toBe("2a");
  });

  it("keeps a code it cannot resolve, rather than inventing or dropping one", () => {
    // The screen says such a code is not in the frozen ruleset, which is true
    // and useful. Nulling it would hide that the engine cited a rule at all,
    // and guessing the nearest code would put words in the protocol's mouth.
    expect(read("99")).toBe("99");
    expect(read("Rule 99")).toBe("Rule 99");
    expect(read("the timezone one")).toBe("the timezone one");
  });

  it("passes through nothing when there was nothing", () => {
    expect(read(null)).toBeNull();
    expect(read("")).toBe("");
    expect(read("   ")).toBe("   ");
  });

  it("does not let a prefix strip turn one rule into another", () => {
    // "11" must not be read as "1" by chopping at a boundary that is not
    // there: the prefix is a word and its punctuation, never digits.
    const strict = ruleCodeReader(["1"]);
    expect(strict("11")).toBe("11");
    expect(strict("Rule 11")).toBe("Rule 11");
  });
});
