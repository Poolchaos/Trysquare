import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IncompleteRuleCoverageError,
  assertBatchesCoverEverything,
  composeSystemPrompt,
  planRuleBatches,
  renderRule,
  renderRuleIndex,
  themesForPath,
} from "@/lib/rulesets/compose";
import { importProtocol } from "@/lib/rulesets/import";

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url)),
  "utf8",
);
const { ruleset } = importProtocol(EXAMPLE);
const FILES = ["src/orders/total.ts", "src/ui/Cart.tsx", "docs/notes.md"];

describe("what a stage is told", () => {
  it("sends the protocol's own wording, not a paraphrase of it", () => {
    const prompt = composeSystemPrompt({
      directives: ruleset.directives,
      rules: ruleset.rules,
      stage: "s3_adversarial",
      includeFullRules: true,
      outputContract: "Answer with JSON.",
    });

    // Summarising a rule to save tokens would change what is being checked.
    expect(prompt).toContain("payload as User");
    expect(prompt).toContain("userSchema.parse");
    expect(prompt).toContain("Read every file in the execution chain");
  });

  it("sends only an index when the stage does not apply the rules", () => {
    const prompt = composeSystemPrompt({
      directives: ruleset.directives,
      rules: ruleset.rules,
      stage: "s2_comprehension",
      includeFullRules: false,
      outputContract: "Answer with JSON.",
    });

    expect(prompt).toContain("3 (CRITICAL): Unchecked Cast");
    expect(prompt).not.toContain("userSchema.parse");
  });

  it("tells the comprehension stage not to produce findings yet", () => {
    const prompt = composeSystemPrompt({
      directives: [],
      rules: [],
      stage: "s2_comprehension",
      includeFullRules: false,
      outputContract: "",
    });
    expect(prompt).toContain("Report no findings in this stage");
  });

  it("warns the adversarial stage that an unmentioned hunk fails the run", () => {
    const prompt = composeSystemPrompt({
      directives: [],
      rules: [],
      stage: "s3_adversarial",
      includeFullRules: true,
      outputContract: "",
    });
    expect(prompt).toContain("treated as unreviewed");
  });

  it("tells verification to report the lines it actually found", () => {
    const prompt = composeSystemPrompt({
      directives: [],
      rules: [],
      stage: "s5_verification",
      includeFullRules: false,
      outputContract: "",
    });
    expect(prompt).toContain("not the ones you were given");
  });

  it("renders a rule with every part the author wrote", () => {
    const rule = ruleset.rules.find((r) => r.code === "3")!;
    const rendered = renderRule(rule);
    expect(rendered).toContain("Rule 3: Unchecked Cast");
    expect(rendered).toContain("Severity: CRITICAL");
    expect(rendered).toContain("Violation example");
    expect(rendered).toContain("Correct pattern");
    expect(rendered).toContain("How to detect it");
    expect(rendered).toContain("Why it matters");
  });

  it("lists every rule in the index", () => {
    expect(renderRuleIndex(ruleset.rules).split("\n")).toHaveLength(ruleset.rules.length);
  });
});

describe("dividing the work by model profile", () => {
  it("sends everything in one request on a full-context model", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "full-context");
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!.rules).toHaveLength(ruleset.rules.length);
    expect(plan.batches[0]!.files).toEqual(FILES);
  });

  it("splits by theme on a chunked model, still covering every file", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "chunked");
    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) expect(batch.files).toEqual(FILES);
  });

  it("goes file by file on a decomposed model", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "decomposed");
    for (const batch of plan.batches) expect(batch.files).toHaveLength(1);
    expect(plan.batches.length).toBeGreaterThan(FILES.length);
  });

  it("gives a mechanical-only model no rules to judge against", () => {
    // It is not trusted with judgment, so it is never asked for any.
    expect(planRuleBatches(ruleset.rules, FILES, "mechanical-only").batches).toEqual([]);
  });

  it("makes more requests as the model gets weaker, not fewer rules", () => {
    const full = planRuleBatches(ruleset.rules, FILES, "full-context");
    const chunked = planRuleBatches(ruleset.rules, FILES, "chunked");
    const decomposed = planRuleBatches(ruleset.rules, FILES, "decomposed");

    expect(chunked.batches.length).toBeGreaterThan(full.batches.length);
    expect(decomposed.batches.length).toBeGreaterThan(chunked.batches.length);
  });
});

describe("the completeness invariant", () => {
  it("holds on every profile that produces judgment", () => {
    // The promise: every rule/file pair is either checked, or named as
    // deliberately excluded. Nothing goes unchecked without being recorded.
    for (const profile of ["full-context", "chunked", "decomposed"] as const) {
      const plan = planRuleBatches(ruleset.rules, FILES, profile);
      expect(() => assertBatchesCoverEverything(plan, ruleset.rules, FILES), profile).not.toThrow();
    }
  });

  it("checks every rule against every file on the profiles that do not narrow", () => {
    for (const profile of ["full-context", "chunked"] as const) {
      const plan = planRuleBatches(ruleset.rules, FILES, profile);
      expect(plan.excluded, profile).toEqual([]);
    }
  });

  it("records what a narrowing profile left out, with a reason", () => {
    // A React rule genuinely should not be applied to a markdown file, but a
    // reduced review must never be indistinguishable from a complete one.
    const plan = planRuleBatches(ruleset.rules, FILES, "decomposed");
    expect(plan.excluded.length).toBeGreaterThan(0);
    for (const pair of plan.excluded) {
      expect(pair.reason).toMatch(/does not apply/);
    }
    // Every exclusion is for a file the theme really does not fit.
    expect(plan.excluded.every((pair) => pair.file === "docs/notes.md")).toBe(true);
  });

  it("never both covers and excludes the same pair", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "decomposed");
    const covered = new Set(
      plan.batches.flatMap((b) => b.rules.map((r) => `${r.code} ${b.files[0]}`)),
    );
    for (const pair of plan.excluded) {
      expect(covered.has(`${pair.rule} ${pair.file}`), `${pair.rule} ${pair.file}`).toBe(false);
    }
  });

  it("refuses an exclusion from a profile that is not allowed to narrow", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "chunked");
    plan.excluded.push({ rule: "1", file: FILES[0]!, reason: "no reason at all" });
    expect(() => assertBatchesCoverEverything(plan, ruleset.rules, FILES)).toThrow(
      IncompleteRuleCoverageError,
    );
  });

  it("catches a plan that skips a rule without saying so", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "full-context");
    plan.batches[0]!.rules = plan.batches[0]!.rules.slice(1);
    expect(() => assertBatchesCoverEverything(plan, ruleset.rules, FILES)).toThrow(
      IncompleteRuleCoverageError,
    );
  });

  it("catches a plan that skips a file", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "chunked");
    for (const batch of plan.batches)
      batch.files = batch.files.filter((f) => f !== "docs/notes.md");
    expect(() => assertBatchesCoverEverything(plan, ruleset.rules, FILES)).toThrow(
      /docs\/notes\.md/,
    );
  });

  it("names how much is missing so the failure is actionable", () => {
    const plan = planRuleBatches(ruleset.rules, FILES, "full-context");
    plan.batches = [];
    try {
      assertBatchesCoverEverything(plan, ruleset.rules, FILES);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain(
        `${ruleset.rules.length * FILES.length} rule/file pair(s)`,
      );
    }
  });
});

describe("which themes a file could involve", () => {
  it("recognises TypeScript and React from the extension", () => {
    expect(themesForPath("src/a.ts")).toContain("typescript");
    expect(themesForPath("src/a.tsx")).toContain("react");
    expect(themesForPath("src/a.ts")).not.toContain("react");
  });

  it("always includes general, so an untagged rule reaches every file", () => {
    for (const path of ["src/a.ts", "README.md", "Dockerfile"]) {
      expect(themesForPath(path), path).toContain("general");
    }
  });

  it("recognises tests and data access by name", () => {
    expect(themesForPath("tests/orders.test.ts")).toContain("testing");
    expect(themesForPath("src/server/db/repositories/orders.ts")).toContain("database");
  });
});
