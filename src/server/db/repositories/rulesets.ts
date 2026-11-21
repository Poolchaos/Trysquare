/**
 * Ruleset persistence, and the frozen snapshot a review is judged against.
 *
 * The snapshot is the point of this module. A review records the exact rule
 * text it used at the moment it started, and reads only that afterwards, so
 * editing a rule tomorrow cannot change what yesterday's review was judged
 * against or what a resumed run sends. Without it, a resume would compose a
 * different prompt from the same review and quietly become a different
 * review.
 */

import { and, asc, eq, gt, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { newId, nowIso } from "@/lib/ids";
import {
  severitySchema,
  type RulesetTier,
  type Severity,
  directiveSectionSchema,
} from "@/lib/domain/enums";
import {
  exportProtocol,
  importProtocol,
  inferTags,
  parseSeverity,
  unclosedFenceLine,
} from "@/lib/rulesets/import";
import type { ImportedRule, ImportedRuleset, SourceSpan } from "@/lib/rulesets/model";
import type { Db } from "../client";
import { processDirectives, reviewRulesets, rules, rulesets } from "../schema";
import { parseJsonColumn, serialiseJsonColumn } from "./json";
import { SETTING_KEYS, readSetting, writeSetting } from "./settings";

export type RulesetRow = typeof rulesets.$inferSelect;

const stringArraySchema = z.array(z.string());

const snapshotSchema = z.object({
  name: z.string(),
  version: z.number(),
  directives: z.array(
    z.object({
      section: directiveSectionSchema,
      title: z.string(),
      contentMd: z.string(),
      raw: z.string(),
      startLine: z.number(),
      endLine: z.number(),
    }),
  ),
  rules: z.array(
    z.object({
      code: z.string(),
      title: z.string(),
      severity: severitySchema,
      tags: z.array(z.string()),
      ruleText: z.string(),
      violationExample: z.string().nullable(),
      correctPattern: z.string().nullable(),
      detection: z.string().nullable(),
      notes: z.string().nullable(),
      sweepPatterns: z.array(z.string()),
      group: z.string(),
      raw: z.string(),
      startLine: z.number(),
      endLine: z.number(),
    }),
  ),
});

export type RulesetSnapshot = z.infer<typeof snapshotSchema>;

function toSnapshot(name: string, version: number, ruleset: ImportedRuleset): RulesetSnapshot {
  return {
    name,
    version,
    directives: ruleset.directives.map((directive) => ({
      section: directive.section,
      title: directive.title,
      contentMd: directive.contentMd,
      raw: directive.raw,
      startLine: directive.startLine,
      endLine: directive.endLine,
    })),
    rules: ruleset.rules.map((rule) => ({ ...rule })),
  };
}

export interface SaveRulesetInput {
  name: string;
  tier: RulesetTier;
  sourceDoc?: string | null;
  description?: string;
  imported: ImportedRuleset;
}

/**
 * Stores an imported protocol, replacing whatever that ruleset held before.
 *
 * The version only moves when the content actually differs, so re-importing an
 * unchanged document does not make every past review look as though it was
 * judged against something older.
 */
export function saveImportedRuleset(
  db: Db,
  input: SaveRulesetInput,
): { rulesetId: string; version: number; changed: boolean } {
  const now = nowIso();
  const existing = findRulesetByName(db, input.name);
  if (existing && !differsFromStored(db, existing, input.imported)) {
    return { rulesetId: existing.id, version: existing.version, changed: false };
  }

  const rulesetId = existing?.id ?? newId();
  const version = existing ? existing.version + 1 : 1;

  db.transaction((tx) => {
    if (existing) {
      tx.update(rulesets)
        .set({
          version,
          tier: input.tier,
          sourceDoc: input.sourceDoc ?? null,
          description: input.description ?? existing.description,
          updatedAt: now,
        })
        .where(eq(rulesets.id, rulesetId))
        .run();
      // Replaced wholesale rather than merged: an import is the document's
      // current state, and a rule the document no longer contains must not
      // survive as a rule the review still applies.
      tx.delete(rules).where(eq(rules.rulesetId, rulesetId)).run();
      tx.delete(processDirectives).where(eq(processDirectives.rulesetId, rulesetId)).run();
    } else {
      tx.insert(rulesets)
        .values({
          id: rulesetId,
          name: input.name,
          tier: input.tier,
          description: input.description ?? "",
          sourceDoc: input.sourceDoc ?? null,
          version,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    input.imported.rules.forEach((rule, index) => {
      tx.insert(rules)
        .values({
          id: newId(),
          rulesetId,
          code: rule.code,
          title: rule.title,
          severity: rule.severity,
          tags: serialiseJsonColumn(rule.tags),
          ruleText: rule.ruleText,
          violationExample: rule.violationExample,
          correctPattern: rule.correctPattern,
          detection: rule.detection,
          notes: rule.notes,
          sweepPatterns: serialiseJsonColumn(rule.sweepPatterns),
          groupHeading: rule.group,
          rawMarkdown: rule.raw,
          sourceStartLine: rule.startLine,
          sourceEndLine: rule.endLine,
          enabled: true,
          sortOrder: index,
        })
        .run();
    });

    input.imported.directives.forEach((directive, index) => {
      tx.insert(processDirectives)
        .values({
          id: newId(),
          rulesetId,
          section: directive.section,
          title: directive.title,
          contentMd: directive.contentMd,
          rawMarkdown: directive.raw,
          sourceStartLine: directive.startLine,
          sourceEndLine: directive.endLine,
          sortOrder: index,
        })
        .run();
    });
  });

  return { rulesetId, version, changed: true };
}

/** Reads a ruleset back into the shape the composer and pipeline expect. */
/**
 * A ruleset as it was imported.
 *
 * Every rule by default, disabled ones included, because the export has to
 * reproduce the document that was imported. A review's frozen snapshot asks
 * for the enabled subset instead: that is the difference between the document
 * and the choice someone made about which parts of it to apply.
 */
export function loadRuleset(
  db: Db,
  rulesetId: string,
  options: { enabledOnly?: boolean } = {},
): ImportedRuleset {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new Error(`No ruleset with id "${rulesetId}".`);

  const ruleRows = db
    .select()
    .from(rules)
    .where(eq(rules.rulesetId, rulesetId))
    .orderBy(asc(rules.sortOrder))
    .all()
    .filter((rule) => (options.enabledOnly ? rule.enabled : true));

  const directiveRows = db
    .select()
    .from(processDirectives)
    .where(eq(processDirectives.rulesetId, rulesetId))
    .orderBy(asc(processDirectives.sortOrder))
    .all();

  return {
    title: row.name,
    rules: ruleRows.map((rule) => ({
      code: rule.code,
      title: rule.title,
      severity: severitySchema.parse(rule.severity),
      tags: parseJsonColumn("rules.tags", rule.tags, stringArraySchema),
      ruleText: rule.ruleText,
      violationExample: rule.violationExample,
      correctPattern: rule.correctPattern,
      detection: rule.detection,
      notes: rule.notes,
      sweepPatterns: parseJsonColumn("rules.sweep_patterns", rule.sweepPatterns, stringArraySchema),
      group: rule.groupHeading,
      raw: rule.rawMarkdown,
      startLine: rule.sourceStartLine,
      endLine: rule.sourceEndLine,
    })),
    directives: directiveRows.map((directive) => ({
      section: directiveSectionSchema.parse(directive.section),
      title: directive.title,
      contentMd: directive.contentMd,
      raw: directive.rawMarkdown,
      startLine: directive.sourceStartLine,
      endLine: directive.sourceEndLine,
    })),
  };
}

export class NoEnabledRulesError extends Error {
  constructor(readonly rulesetName: string) {
    super(
      `Ruleset "${rulesetName}" has no enabled rules, so a review using it would check nothing ` +
        "and report a clean result for the wrong reason.",
    );
    this.name = "NoEnabledRulesError";
  }
}

/**
 * The rules a review is judged against: those switched on, and never none.
 * A review's snapshot freezes this and the pre-flight sizes it, so what is
 * counted before Start is what the run is given.
 */
export function loadEnabledRuleset(db: Db, rulesetId: string): ImportedRuleset {
  const enabled = loadRuleset(db, rulesetId, { enabledOnly: true });
  if (enabled.rules.length === 0) throw new NoEnabledRulesError(enabled.title);
  return enabled;
}

export class RulesetNotFoundError extends Error {
  constructor(readonly rulesetId: string) {
    super(`Ruleset ${rulesetId} was not found.`);
    this.name = "RulesetNotFoundError";
  }
}

export class RuleNotFoundError extends Error {
  constructor(
    readonly rulesetName: string,
    readonly code: string,
  ) {
    super(`Ruleset "${rulesetName}" has no rule ${code}.`);
    this.name = "RuleNotFoundError";
  }
}

export class RulesetNameTakenError extends Error {
  constructor(readonly rulesetName: string) {
    super(
      `A ruleset called "${rulesetName}" already exists. Copying onto it would replace its ` +
        `rules and reset its version, so the copy needs a name of its own.`,
    );
    this.name = "RulesetNameTakenError";
  }
}

/**
 * Removes a ruleset. Its rules and directives go with it (ON DELETE CASCADE);
 * a review frozen with it keeps its own copy, which no longer holds the
 * ruleset in place (migration 0019, D-266).
 */
export function deleteRuleset(db: Db, rulesetId: string): void {
  db.delete(rulesets).where(eq(rulesets.id, rulesetId)).run();
  // A default left naming it was read back by the settings screen's API, and
  // writing that back would be refused (review round 15).
  if (readSetting(db, SETTING_KEYS.defaultRulesetId, z.string().nullable()) === rulesetId) {
    writeSetting(db, SETTING_KEYS.defaultRulesetId, null);
  }
}

/**
 * The stored ruleset an import of this document would replace: undefined for
 * a new name, and for a document that matches what is stored, which an import
 * leaves as it is. The import route asks before replacing, and asking about a
 * document that changes nothing warned of a loss that did not happen (D-136).
 */
export function rulesetAnImportWouldReplace(
  db: Db,
  name: string,
  imported: ImportedRuleset,
): RulesetRow | undefined {
  const existing = findRulesetByName(db, name);
  return existing && differsFromStored(db, existing, imported) ? existing : undefined;
}

function differsFromStored(db: Db, existing: RulesetRow, imported: ImportedRuleset): boolean {
  const stored = toSnapshot(existing.name, existing.version, loadRuleset(db, existing.id));
  const incoming = toSnapshot(existing.name, existing.version, imported);
  return serialiseJsonColumn(stored) !== serialiseJsonColumn(incoming);
}

/** The ruleset already stored under this name, if one is. */
export function findRulesetByName(db: Db, name: string): RulesetRow | undefined {
  return db.select().from(rulesets).where(eq(rulesets.name, name)).get();
}

/**
 * The ruleset new reviews start on, when one is chosen and still exists. A
 * deleted ruleset takes the default with it, but a database from before it
 * did can still name one gone, and that reads as none chosen (D-225).
 */
export function defaultRulesetId(db: Db): string | null {
  const chosen = readSetting(db, SETTING_KEYS.defaultRulesetId, z.string().nullable()) ?? null;
  if (chosen === null) return null;
  return db.select().from(rulesets).where(eq(rulesets.id, chosen)).get() ? chosen : null;
}

/** The ruleset row itself: its name, tier and version, not its rules. */
export function requireRuleset(db: Db, rulesetId: string): RulesetRow {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new RulesetNotFoundError(rulesetId);
  return row;
}

export function listRulesets(db: Db): RulesetRow[] {
  return db.select().from(rulesets).orderBy(asc(rulesets.name)).all();
}

/**
 * The list with each ruleset's rule count, for screens that group by tier.
 *
 * The count is of enabled rules, because it sits beside a picker deciding
 * what a review will be judged against, and a disabled rule will not be.
 */
export function listRulesetSummaries(db: Db): (RulesetRow & { ruleCount: number })[] {
  const counts = new Map<string, number>();
  for (const rule of db.select().from(rules).all()) {
    if (rule.enabled) counts.set(rule.rulesetId, (counts.get(rule.rulesetId) ?? 0) + 1);
  }
  return listRulesets(db).map((row) => ({ ...row, ruleCount: counts.get(row.id) ?? 0 }));
}

/**
 * Freezes a ruleset onto a review.
 *
 * Written once, at the review's first start. Everything the run composes
 * afterwards, including on resume, reads this and not the live tables.
 */
export function writeReviewSnapshot(db: Db, reviewId: string, rulesetId: string): void {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new Error(`No ruleset with id "${rulesetId}".`);

  // Only the enabled rules: the snapshot is what this review is judged
  // against, and a rule someone switched off is not part of that judgement.
  const enabled = loadEnabledRuleset(db, rulesetId);

  const snapshot = toSnapshot(row.name, row.version, enabled);
  db.insert(reviewRulesets)
    .values({
      reviewId,
      rulesetId,
      rulesetName: row.name,
      rulesetVersion: row.version,
      snapshotJson: serialiseJsonColumn(snapshot),
    })
    .onConflictDoNothing()
    .run();
}

/**
 * Switches one rule on or off, and moves the ruleset's version.
 *
 * The version moves because a review's frozen snapshot names it. Without the
 * bump, two different sets of rules would share a name and a number, and a
 * report saying "Example protocol version 3" would not identify what the
 * review was actually judged against.
 */
export function setRuleEnabled(
  db: Db,
  rulesetId: string,
  code: string,
  enabled: boolean,
): { version: number } {
  return patchRule(db, rulesetId, code, { enabled });
}

/**
 * Changes what one rule says or whether it applies.
 *
 * Severity moves through the same door as the toggle and pays the same
 * version bump: a WARNING promoted to CRITICAL is a different standard, and
 * a report naming "version 3" must identify exactly one standard. A patch
 * that changes nothing costs nothing.
 */
export function patchRule(
  db: Db,
  rulesetId: string,
  code: string,
  patch: { enabled?: boolean; severity?: Severity },
): { version: number } {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new RulesetNotFoundError(rulesetId);

  const rule = db
    .select()
    .from(rules)
    .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, code)))
    .get();
  if (!rule) throw new RuleNotFoundError(row.name, code);

  const change: Partial<typeof rules.$inferInsert> = {};
  if (patch.enabled !== undefined && patch.enabled !== rule.enabled) change.enabled = patch.enabled;
  if (patch.severity !== undefined && patch.severity !== rule.severity) {
    change.severity = patch.severity;
  }
  if (Object.keys(change).length === 0) return { version: row.version };

  const version = row.version + 1;
  db.transaction((tx) => {
    tx.update(rules)
      .set(change)
      .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, code)))
      .run();
    tx.update(rulesets)
      .set({ version, updatedAt: nowIso() })
      .where(eq(rulesets.id, rulesetId))
      .run();
  });
  return { version };
}

export class RulesetChangedError extends Error {
  constructor(
    readonly version: number,
    readonly readVersion: number,
  ) {
    super(
      `This ruleset changed since you opened it: it is at version ${version}, and this edit ` +
        `was made from version ${readVersion}. Read it again before saving, so the other ` +
        `change is not undone.`,
    );
    this.name = "RulesetChangedError";
  }
}

export class RuleCodeTakenError extends Error {
  constructor(
    readonly rulesetName: string,
    readonly code: string,
  ) {
    super(
      `Ruleset "${rulesetName}" already has a rule ${code}. Give this one a code no other rule has.`,
    );
    this.name = "RuleCodeTakenError";
  }
}

export class RuleCodeHeldError extends Error {
  constructor(readonly code: string) {
    super(
      `Rule ${code} has sweep patterns, which the document's sweep table lists under its code. ` +
        `Its text can change here; its code cannot yet.`,
    );
    this.name = "RuleCodeHeldError";
  }
}

/**
 * Saves a rule's text as edited in the app (RA-2): `edited` is the block as
 * `parseRuleBlock` read it, alone.
 *
 * What the document around a rule gave it stays the rule's: its place, its
 * group's tags, and the sweep patterns the table lists under its code, which
 * is why a rule with patterns keeps its code until an export can carry the
 * table along. A severity changed in the app stays too, unless the text's
 * own severity line changed: the text of a promoted rule still says what it
 * was imported as, and an edit elsewhere in it would have demoted the rule.
 * The save carries the version it was made from, so two tabs cannot undo
 * each other without a word.
 */
export function replaceRuleText(
  db: Db,
  rulesetId: string,
  code: string,
  edited: ImportedRule,
  readVersion: number,
): { version: number; code: string } {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new RulesetNotFoundError(rulesetId);

  const rule = db
    .select()
    .from(rules)
    .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, code)))
    .get();
  if (!rule) throw new RuleNotFoundError(row.name, code);

  if (edited.raw === rule.rawMarkdown) return { version: row.version, code };
  if (readVersion !== row.version) throw new RulesetChangedError(row.version, readVersion);

  if (edited.code !== code) {
    const swept = parseJsonColumn("rules.sweep_patterns", rule.sweepPatterns, stringArraySchema);
    if (swept.length > 0) throw new RuleCodeHeldError(code);
    const other = db
      .select({ id: rules.id })
      .from(rules)
      .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, edited.code)))
      .get();
    if (other) throw new RuleCodeTakenError(row.name, edited.code);
  }

  const bodyOf = (raw: string) => raw.slice(raw.indexOf("\n") + 1);
  const saidBefore = parseSeverity(bodyOf(rule.rawMarkdown));
  const version = row.version + 1;
  db.transaction((tx) => {
    tx.update(rules)
      .set({
        code: edited.code,
        title: edited.title,
        ...(edited.severity === saidBefore ? {} : { severity: edited.severity }),
        tags: serialiseJsonColumn(inferTags(rule.groupHeading, edited.title)),
        ruleText: edited.ruleText,
        violationExample: edited.violationExample,
        correctPattern: edited.correctPattern,
        detection: edited.detection,
        notes: edited.notes,
        rawMarkdown: edited.raw,
        sourceEndLine: rule.sourceStartLine + edited.endLine - edited.startLine,
      })
      .where(eq(rules.id, rule.id))
      .run();
    tx.update(rulesets)
      .set({ version, updatedAt: nowIso() })
      .where(eq(rulesets.id, rulesetId))
      .run();
  });
  return { version, code: edited.code };
}

export class RuleFenceOpenError extends Error {
  constructor(readonly code: string) {
    super(
      `Rule ${code} leaves a code fence open, so a rule put after it would read as code in the ` +
        `ruleset's document. Close the fence in rule ${code}'s text first.`,
    );
    this.name = "RuleFenceOpenError";
  }
}

/**
 * Adds a rule written in the app (RA-3): `added` is the block as
 * `parseNewRuleBlock` read it, alone.
 *
 * It goes into the ruleset's document after the rule named, or after the
 * last rule, and is read there by the importer: the section it sits under,
 * the tags that gives it and the sweep patterns the table lists under its
 * code are the document's, as an import of the exported document would have
 * them. Every block after it moves down by its lines, so the export keeps
 * its order and its line numbers. The document must read back as the rules
 * stored with this one among them, or nothing is saved.
 */
export function addRule(
  db: Db,
  rulesetId: string,
  added: ImportedRule,
  after: string | undefined,
  readVersion: number,
): { version: number; code: string } {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new RulesetNotFoundError(rulesetId);
  if (readVersion !== row.version) throw new RulesetChangedError(row.version, readVersion);

  const stored = loadRuleset(db, rulesetId);
  const anchor =
    after === undefined ? stored.rules.at(-1) : stored.rules.find((rule) => rule.code === after);
  if (after !== undefined && !anchor) throw new RuleNotFoundError(row.name, after);
  if (stored.rules.some((rule) => rule.code === added.code)) {
    throw new RuleCodeTakenError(row.name, added.code);
  }
  if (anchor && unclosedFenceLine(anchor.raw) !== null) throw new RuleFenceOpenError(anchor.code);

  // Where the block after the anchor starts, or past everything.
  const blocks = [...stored.rules, ...stored.directives].sort((a, b) => a.startLine - b.startLine);
  const next = anchor ? blocks[blocks.indexOf(anchor) + 1] : undefined;
  const at = next?.startLine ?? Math.max(0, ...blocks.map((block) => block.endLine)) + 1;
  const lines = added.raw.split("\n").length;
  const moved = <Block extends SourceSpan>(block: Block): Block =>
    block.startLine >= at
      ? { ...block, startLine: block.startLine + lines, endLine: block.endLine + lines }
      : block;

  const index = anchor ? stored.rules.indexOf(anchor) + 1 : 0;
  const withAdded = [
    ...stored.rules.slice(0, index).map(moved),
    { ...added, startLine: at, endLine: at + lines - 1 },
    ...stored.rules.slice(index).map(moved),
  ];
  const read = importProtocol(
    exportProtocol({
      title: stored.title,
      rules: withAdded,
      directives: stored.directives.map(moved),
    }),
  );
  const placed = read.ruleset.rules[index];
  const codes = (list: readonly ImportedRule[]) => list.map((rule) => rule.code).join(", ");
  if (
    placed?.raw !== added.raw ||
    codes(read.ruleset.rules) !== codes(withAdded) ||
    read.ruleset.directives.length !== stored.directives.length ||
    read.coverage.unmapped.some((entry) => entry.text.trim() !== "")
  ) {
    throw new Error(
      `Rule ${added.code} was not added to "${row.name}": with it in place the ruleset's ` +
        `document reads back as rules ${codes(read.ruleset.rules) || "none"}, where ` +
        `${codes(withAdded)} are expected.`,
    );
  }

  const anchorRow = anchor
    ? db
        .select({ sortOrder: rules.sortOrder })
        .from(rules)
        .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, anchor.code)))
        .get()
    : undefined;
  const sortOrder = anchorRow ? anchorRow.sortOrder + 1 : 0;
  const version = row.version + 1;
  db.transaction((tx) => {
    tx.update(rules)
      .set({
        sourceStartLine: sql`${rules.sourceStartLine} + ${lines}`,
        sourceEndLine: sql`${rules.sourceEndLine} + ${lines}`,
      })
      .where(and(eq(rules.rulesetId, rulesetId), gte(rules.sourceStartLine, at)))
      .run();
    tx.update(processDirectives)
      .set({
        sourceStartLine: sql`${processDirectives.sourceStartLine} + ${lines}`,
        sourceEndLine: sql`${processDirectives.sourceEndLine} + ${lines}`,
      })
      .where(
        and(eq(processDirectives.rulesetId, rulesetId), gte(processDirectives.sourceStartLine, at)),
      )
      .run();
    tx.update(rules)
      .set({ sortOrder: sql`${rules.sortOrder} + 1` })
      .where(and(eq(rules.rulesetId, rulesetId), gte(rules.sortOrder, sortOrder)))
      .run();
    tx.insert(rules)
      .values({
        id: newId(),
        rulesetId,
        code: added.code,
        title: added.title,
        severity: added.severity,
        tags: serialiseJsonColumn(placed.tags),
        ruleText: added.ruleText,
        violationExample: added.violationExample,
        correctPattern: added.correctPattern,
        detection: added.detection,
        notes: added.notes,
        sweepPatterns: serialiseJsonColumn(placed.sweepPatterns),
        groupHeading: placed.group,
        rawMarkdown: added.raw,
        sourceStartLine: at,
        sourceEndLine: at + lines - 1,
        enabled: true,
        sortOrder,
      })
      .run();
    tx.update(rulesets)
      .set({ version, updatedAt: nowIso() })
      .where(eq(rulesets.id, rulesetId))
      .run();
  });
  return { version, code: added.code };
}

/**
 * Removes a rule from its ruleset and from the ruleset's document (RA-4).
 *
 * The blocks after it move up to where it started, so the export keeps its
 * order. That is the rule's own line count in a document whose line numbers
 * are true, and it holds the order in one where they are not: a rule saved
 * longer than it was imported ends past where the next block starts (RA-5),
 * and moved up by its lines the blocks after it would land above the blocks
 * before it. A review already started keeps the rule in its own copy.
 */
export function removeRule(
  db: Db,
  rulesetId: string,
  code: string,
  readVersion: number,
): { version: number } {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new RulesetNotFoundError(rulesetId);

  const rule = db
    .select()
    .from(rules)
    .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, code)))
    .get();
  if (!rule) throw new RuleNotFoundError(row.name, code);
  if (readVersion !== row.version) throw new RulesetChangedError(row.version, readVersion);

  const stored = loadRuleset(db, rulesetId);
  const next = [...stored.rules, ...stored.directives]
    .map((block) => block.startLine)
    .filter((start) => start > rule.sourceStartLine)
    .reduce((first, start) => Math.min(first, start), Infinity);
  const up = Number.isFinite(next) ? next - rule.sourceStartLine : 0;

  const version = row.version + 1;
  db.transaction((tx) => {
    tx.delete(rules).where(eq(rules.id, rule.id)).run();
    tx.update(rules)
      .set({
        sourceStartLine: sql`${rules.sourceStartLine} - ${up}`,
        sourceEndLine: sql`${rules.sourceEndLine} - ${up}`,
      })
      .where(and(eq(rules.rulesetId, rulesetId), gt(rules.sourceStartLine, rule.sourceStartLine)))
      .run();
    tx.update(processDirectives)
      .set({
        sourceStartLine: sql`${processDirectives.sourceStartLine} - ${up}`,
        sourceEndLine: sql`${processDirectives.sourceEndLine} - ${up}`,
      })
      .where(
        and(
          eq(processDirectives.rulesetId, rulesetId),
          gt(processDirectives.sourceStartLine, rule.sourceStartLine),
        ),
      )
      .run();
    tx.update(rulesets)
      .set({ version, updatedAt: nowIso() })
      .where(eq(rulesets.id, rulesetId))
      .run();
  });
  return { version };
}

/**
 * Copies a ruleset into another tier as its own version 1.
 *
 * Through export and re-import rather than row copying, so the duplicate is
 * exactly what a person pasting the exported document would get, and the two
 * cannot drift in what a copy means. Disabled rules come along disabled: the
 * copy is of the ruleset as it stands, not of the original document.
 */
export function duplicateRuleset(
  db: Db,
  rulesetId: string,
  target: { tier: RulesetTier; name: string },
): { rulesetId: string; version: number } {
  // Refused rather than merged. `saveImportedRuleset` is keyed by name and
  // replaces what it finds, so duplicating onto an existing name would hand
  // back that ruleset's id, overwrite whatever had been edited into it, and
  // reset its version to 1 while a past review still names a later one.
  const taken = db.select().from(rulesets).where(eq(rulesets.name, target.name)).get();
  if (taken) throw new RulesetNameTakenError(target.name);

  const source = loadRuleset(db, rulesetId);
  const disabled = new Set(
    db
      .select()
      .from(rules)
      .where(and(eq(rules.rulesetId, rulesetId), eq(rules.enabled, false)))
      .all()
      .map((rule) => rule.code),
  );

  const saved = saveImportedRuleset(db, {
    name: target.name,
    tier: target.tier,
    imported: source,
  });
  for (const code of disabled) setRuleEnabled(db, saved.rulesetId, code, false);
  // Reported as 1 whatever the toggles above did to it: the copy is a new
  // standard, and its history starts here.
  db.update(rulesets).set({ version: 1 }).where(eq(rulesets.id, saved.rulesetId)).run();
  return { rulesetId: saved.rulesetId, version: 1 };
}

export function hasReviewSnapshot(db: Db, reviewId: string): boolean {
  return (
    db.select().from(reviewRulesets).where(eq(reviewRulesets.reviewId, reviewId)).all().length > 0
  );
}

/**
 * What this review is judged against, whatever the rules say today.
 *
 * Several rulesets can be frozen onto one review, so their rules and
 * directives are concatenated in a stable order.
 */
/**
 * What the review was judged against, by name and version.
 *
 * The report names these so a reader can tell which edition of a ruleset
 * produced the findings, without having to parse the frozen snapshot itself.
 */
export function readReviewSnapshotMeta(
  db: Db,
  reviewId: string,
): { rulesetName: string; rulesetVersion: number } {
  const row = db
    .select()
    .from(reviewRulesets)
    .where(eq(reviewRulesets.reviewId, reviewId))
    .orderBy(asc(reviewRulesets.rulesetName))
    .get();

  if (!row) {
    throw new Error(
      `Review "${reviewId}" has no frozen ruleset, so there is nothing to report it against.`,
    );
  }
  return { rulesetName: row.rulesetName, rulesetVersion: row.rulesetVersion };
}

export function readReviewSnapshot(db: Db, reviewId: string): ImportedRuleset {
  const rows = db
    .select()
    .from(reviewRulesets)
    .where(eq(reviewRulesets.reviewId, reviewId))
    .orderBy(asc(reviewRulesets.rulesetName))
    .all();

  if (rows.length === 0) {
    throw new Error(
      `Review "${reviewId}" has no frozen ruleset. A review must record what it was judged ` +
        `against before it runs, or a later edit would silently change it.`,
    );
  }

  const snapshots = rows.map((row) =>
    parseJsonColumn(`review_rulesets.snapshot_json`, row.snapshotJson, snapshotSchema),
  );

  return {
    title: snapshots.map((snapshot) => snapshot.name).join(" + "),
    rules: snapshots.flatMap((snapshot) =>
      snapshot.rules.map((rule) => ({ ...rule, severity: rule.severity })),
    ),
    directives: snapshots.flatMap((snapshot) => snapshot.directives),
  };
}
