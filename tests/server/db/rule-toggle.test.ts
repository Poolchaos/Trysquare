/**
 * Switching a rule off, and what that changes.
 *
 * The flag existed in the schema from the start and nothing read it, so these
 * tests are about making it load-bearing: the snapshot a review is judged
 * against drops the rule, the exported document keeps it, and a review frozen
 * before the toggle is untouched.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportProtocol, importProtocol } from "@/lib/rulesets/import";
import type { Db } from "@/server/db/client";
import {
  loadRuleset,
  readReviewSnapshot,
  requireRuleset,
  saveImportedRuleset,
  setRuleEnabled,
  writeReviewSnapshot,
} from "@/server/db/repositories/rulesets";
import { makeTestDb, seedProject, seedReview, type TestDb } from "./helpers";

const SOURCE = readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");
const PROTOCOL = importProtocol(SOURCE).ruleset;

let ctx: TestDb;
let db: Db;
let rulesetId: string;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  rulesetId = saveImportedRuleset(db, {
    name: "Example protocol",
    tier: "global",
    imported: PROTOCOL,
  }).rulesetId;
  reviewId = seedReview(db, seedProject(db).id).id;
});

afterEach(() => ctx.cleanup());

const firstCode = PROTOCOL.rules[0]!.code;

describe("switching a rule off", () => {
  it("moves the ruleset version, so two rule sets never share one", () => {
    // A review's snapshot names the version. Without the bump, a report saying
    // which version it used would not identify what it was judged against.
    const before = requireRuleset(db, rulesetId).version;
    const { version } = setRuleEnabled(db, rulesetId, firstCode, false);

    expect(version).toBe(before + 1);
    expect(requireRuleset(db, rulesetId).version).toBe(version);
  });

  it("does not move the version when nothing actually changed", () => {
    const before = requireRuleset(db, rulesetId).version;
    expect(setRuleEnabled(db, rulesetId, firstCode, true).version).toBe(before);
  });

  it("refuses a rule the ruleset does not have", () => {
    expect(() => setRuleEnabled(db, rulesetId, "no-such-rule", false)).toThrow(/no rule/);
  });
});

describe("what a review is judged against afterwards", () => {
  it("drops the disabled rule from the frozen snapshot", () => {
    setRuleEnabled(db, rulesetId, firstCode, false);
    writeReviewSnapshot(db, reviewId, rulesetId);

    const snapshot = readReviewSnapshot(db, reviewId);
    expect(snapshot.rules.some((rule) => rule.code === firstCode)).toBe(false);
    expect(snapshot.rules).toHaveLength(PROTOCOL.rules.length - 1);
  });

  it("leaves a review frozen before the toggle untouched", () => {
    // The whole point of freezing. Editing a ruleset tomorrow cannot change
    // what a review started today was judged against.
    writeReviewSnapshot(db, reviewId, rulesetId);
    setRuleEnabled(db, rulesetId, firstCode, false);

    const snapshot = readReviewSnapshot(db, reviewId);
    expect(snapshot.rules.some((rule) => rule.code === firstCode)).toBe(true);
  });

  it("refuses to freeze a ruleset with nothing switched on", () => {
    // A review judged against nothing comes back clean, and reads exactly like
    // a review that found nothing wrong.
    for (const rule of PROTOCOL.rules) setRuleEnabled(db, rulesetId, rule.code, false);
    expect(() => writeReviewSnapshot(db, reviewId, rulesetId)).toThrow(/no enabled rules/);
  });
});

describe("what the exported document contains", () => {
  it("keeps a disabled rule, because the document is the document", () => {
    // Switching a rule off is a choice this app made about applying it, not an
    // edit to what the author wrote.
    setRuleEnabled(db, rulesetId, firstCode, false);
    const exported = exportProtocol(loadRuleset(db, rulesetId));

    expect(exported).toBe(SOURCE);
    expect(importProtocol(exported).ruleset.rules.some((rule) => rule.code === firstCode)).toBe(
      true,
    );
  });

  it("hands the enabled subset only when it is asked for", () => {
    setRuleEnabled(db, rulesetId, firstCode, false);
    expect(loadRuleset(db, rulesetId).rules).toHaveLength(PROTOCOL.rules.length);
    expect(loadRuleset(db, rulesetId, { enabledOnly: true }).rules).toHaveLength(
      PROTOCOL.rules.length - 1,
    );
  });
});
