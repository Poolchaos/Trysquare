import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportProtocol, importProtocol } from "@/lib/rulesets/import";
import type { Db } from "@/server/db/client";
import {
  RulesetNameTakenError,
  duplicateRuleset,
  hasReviewSnapshot,
  loadRuleset,
  patchRule,
  readReviewSnapshot,
  saveImportedRuleset,
  setRuleEnabled,
  writeReviewSnapshot,
} from "@/server/db/repositories/rulesets";
import { makeTestDb, seedProject, seedReview, type TestDb } from "./helpers";

const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
).ruleset;

let ctx: TestDb;
let db: Db;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  reviewId = seedReview(db, seedProject(db).id).id;
});

afterEach(() => ctx.cleanup());

function save() {
  return saveImportedRuleset(db, {
    name: "Example protocol",
    tier: "global",
    sourceDoc: "example-protocol.md",
    imported: PROTOCOL,
  });
}

describe("storing an imported protocol", () => {
  it("round-trips every rule and directive", () => {
    const { rulesetId } = save();
    const loaded = loadRuleset(db, rulesetId);

    expect(loaded.rules.map((rule) => rule.code)).toEqual(PROTOCOL.rules.map((rule) => rule.code));
    expect(loaded.directives.map((d) => d.title)).toEqual(PROTOCOL.directives.map((d) => d.title));
  });

  it("keeps each rule's text, examples and sweep patterns intact", () => {
    // The rule text reaches the model verbatim, so a lossy round trip here
    // would quietly change what is being checked.
    const { rulesetId } = save();
    const loaded = loadRuleset(db, rulesetId);

    const cast = loaded.rules.find((rule) => rule.code === "3")!;
    const original = PROTOCOL.rules.find((rule) => rule.code === "3")!;
    expect(cast.ruleText).toBe(original.ruleText);
    expect(cast.violationExample).toBe(original.violationExample);
    expect(cast.correctPattern).toBe(original.correctPattern);
    expect(cast.detection).toBe(original.detection);
    expect(cast.severity).toBe(original.severity);
    expect(cast.tags).toEqual(original.tags);
    expect(cast.sweepPatterns).toEqual(original.sweepPatterns);
  });

  it("survives a database round trip byte for byte", () => {
    // The importer's fidelity gate proves nothing is lost parsing the
    // document. This proves nothing is lost storing it either, which is what
    // lets the rulesets screen export a protocol that still matches its
    // source.
    const { rulesetId } = save();
    const original = readFileSync(
      new URL("../../fixtures/example-protocol.md", import.meta.url),
      "utf8",
    );
    expect(exportProtocol(loadRuleset(db, rulesetId))).toBe(original);
  });

  it("preserves the order the protocol declared", () => {
    const { rulesetId } = save();
    expect(loadRuleset(db, rulesetId).rules[0]?.code).toBe(PROTOCOL.rules[0]?.code);
  });

  it("does not move the version when the content is unchanged", () => {
    // Otherwise re-importing the same document would make every past review
    // look as though it was judged against something older.
    const first = save();
    const second = save();
    expect(second.changed).toBe(false);
    expect(second.version).toBe(first.version);
    expect(second.rulesetId).toBe(first.rulesetId);
  });

  it("moves the version when a rule actually changed", () => {
    const first = save();
    const edited = {
      ...PROTOCOL,
      rules: PROTOCOL.rules.map((rule) =>
        rule.code === "3" ? { ...rule, ruleText: "A different rule entirely." } : rule,
      ),
    };
    const second = saveImportedRuleset(db, {
      name: "Example protocol",
      tier: "global",
      imported: edited,
    });

    expect(second.changed).toBe(true);
    expect(second.version).toBe(first.version + 1);
    expect(loadRuleset(db, second.rulesetId).rules.find((r) => r.code === "3")?.ruleText).toBe(
      "A different rule entirely.",
    );
  });

  it("moves the version when a severity changes, exactly like the toggle", () => {
    // A WARNING promoted to CRITICAL is a different standard, and a report
    // naming "version 3" must identify exactly one standard.
    const { rulesetId, version } = save();
    const rule = PROTOCOL.rules[0]!;
    const target = rule.severity === "CRITICAL" ? "WARNING" : "CRITICAL";

    const bumped = patchRule(db, rulesetId, rule.code, { severity: target });
    expect(bumped.version).toBe(version + 1);
    expect(loadRuleset(db, rulesetId).rules.find((r) => r.code === rule.code)?.severity).toBe(
      target,
    );

    // Saying what is already true is not a change and costs no version.
    expect(patchRule(db, rulesetId, rule.code, { severity: target }).version).toBe(version + 1);
  });

  it("copies a ruleset into another tier as its own version 1", () => {
    // Promotion: a rule proven on one project becomes a standard elsewhere.
    // The copy carries the toggles as they stand, because what is promoted is
    // the ruleset as used, not the document as first imported.
    const { rulesetId } = save();
    const offCode = PROTOCOL.rules[0]!.code;
    setRuleEnabled(db, rulesetId, offCode, false);

    const copy = duplicateRuleset(db, rulesetId, { tier: "project", name: "Promoted" });
    expect(copy.version).toBe(1);
    expect(copy.rulesetId).not.toBe(rulesetId);

    const copied = loadRuleset(db, copy.rulesetId);
    expect(copied.rules).toHaveLength(PROTOCOL.rules.length);
    const enabledCopy = loadRuleset(db, copy.rulesetId, { enabledOnly: true });
    expect(enabledCopy.rules.some((rule) => rule.code === offCode)).toBe(false);
    // The original is untouched: same version, same toggles.
    expect(
      loadRuleset(db, rulesetId, { enabledOnly: true }).rules.some((r) => r.code === offCode),
    ).toBe(false);
  });

  it("refuses a duplicate whose name is taken, instead of overwriting it", () => {
    // saveImportedRuleset is keyed by name and replaces what it finds, so a
    // second copy under the same name handed back the FIRST copy's id, wiped
    // the edits made to it, and reset its version to 1 while past reviews
    // still named a later one.
    const { rulesetId } = save();
    const first = duplicateRuleset(db, rulesetId, { tier: "project", name: "Promoted" });
    setRuleEnabled(db, first.rulesetId, PROTOCOL.rules[0]!.code, false);

    expect(() => duplicateRuleset(db, rulesetId, { tier: "project", name: "Promoted" })).toThrow(
      RulesetNameTakenError,
    );

    // The first copy is exactly as it was left.
    expect(
      loadRuleset(db, first.rulesetId, { enabledOnly: true }).rules.some(
        (rule) => rule.code === PROTOCOL.rules[0]!.code,
      ),
    ).toBe(false);
  });

  it("drops a rule the document no longer contains", () => {
    // An import is the document's current state. A rule that survived a
    // deletion would keep being applied by every later review.
    const { rulesetId } = save();
    saveImportedRuleset(db, {
      name: "Example protocol",
      tier: "global",
      imported: { ...PROTOCOL, rules: PROTOCOL.rules.filter((rule) => rule.code !== "3") },
    });

    expect(loadRuleset(db, rulesetId).rules.some((rule) => rule.code === "3")).toBe(false);
  });
});

describe("the ruleset a review is judged against", () => {
  it("is frozen at the review, not read live", () => {
    const { rulesetId } = save();
    writeReviewSnapshot(db, reviewId, rulesetId);

    // Someone edits the rule after the review started.
    saveImportedRuleset(db, {
      name: "Example protocol",
      tier: "global",
      imported: {
        ...PROTOCOL,
        rules: PROTOCOL.rules.map((rule) =>
          rule.code === "3" ? { ...rule, ruleText: "Edited after the review began." } : rule,
        ),
      },
    });

    const snapshot = readReviewSnapshot(db, reviewId);
    const cast = snapshot.rules.find((rule) => rule.code === "3");
    expect(cast?.ruleText).toBe(PROTOCOL.rules.find((rule) => rule.code === "3")?.ruleText);
    expect(cast?.ruleText).not.toContain("Edited after");
  });

  it("carries every rule and directive the run will compose from", () => {
    const { rulesetId } = save();
    writeReviewSnapshot(db, reviewId, rulesetId);

    const snapshot = readReviewSnapshot(db, reviewId);
    expect(snapshot.rules).toHaveLength(PROTOCOL.rules.length);
    expect(snapshot.directives).toHaveLength(PROTOCOL.directives.length);
  });

  it("refuses to be read before it is written", () => {
    // A review that ran without recording what it was judged against could
    // never be reproduced, so this is an error rather than an empty result.
    expect(hasReviewSnapshot(db, reviewId)).toBe(false);
    expect(() => readReviewSnapshot(db, reviewId)).toThrow(/no frozen ruleset/);
  });

  it("is written once, so a resume cannot overwrite it", () => {
    const { rulesetId } = save();
    writeReviewSnapshot(db, reviewId, rulesetId);
    const first = readReviewSnapshot(db, reviewId).rules.length;

    saveImportedRuleset(db, {
      name: "Example protocol",
      tier: "global",
      imported: { ...PROTOCOL, rules: PROTOCOL.rules.slice(0, 2) },
    });
    writeReviewSnapshot(db, reviewId, rulesetId);

    expect(readReviewSnapshot(db, reviewId).rules).toHaveLength(first);
  });
});
