import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportProtocol, importProtocol } from "@/lib/rulesets/import";
import type { Db } from "@/server/db/client";
import {
  hasReviewSnapshot,
  loadRuleset,
  readReviewSnapshot,
  saveImportedRuleset,
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
