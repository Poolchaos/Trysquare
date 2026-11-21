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

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { newId, nowIso } from "@/lib/ids";
import {
  severitySchema,
  type RulesetTier,
  type Severity,
  directiveSectionSchema,
} from "@/lib/domain/enums";
import {
  importProtocol,
  parseSeverity,
  severityWord,
  unclosedFenceLine,
} from "@/lib/rulesets/import";
import type { ImportedDirective, ImportedRule, ImportedRuleset } from "@/lib/rulesets/model";
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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A block of a ruleset's document as stored: a rule's row, or a directive's with no code. */
interface StoredBlock {
  id: string;
  code: string | null;
  raw: string;
}

const isRuleBlock = (block: StoredBlock): block is StoredBlock & { code: string } =>
  block.code !== null;

/** A ruleset's rules and directives in the order its document holds them. */
function storedBlocks(db: Db, rulesetId: string): StoredBlock[] {
  const ruleRows = db
    .select({
      id: rules.id,
      code: rules.code,
      raw: rules.rawMarkdown,
      start: rules.sourceStartLine,
    })
    .from(rules)
    .where(eq(rules.rulesetId, rulesetId))
    .all();
  const directiveRows = db
    .select({
      id: processDirectives.id,
      raw: processDirectives.rawMarkdown,
      start: processDirectives.sourceStartLine,
    })
    .from(processDirectives)
    .where(eq(processDirectives.rulesetId, rulesetId))
    .all();
  return [...ruleRows, ...directiveRows.map((row) => ({ ...row, code: null }))]
    .sort((a, b) => a.start - b.start)
    .map(({ id, code, raw }) => ({ id, code, raw }));
}

/** What the importer read for each block, by its row's id, in the document's order. */
interface DocumentReading {
  rules: Map<string, ImportedRule>;
  directives: Map<string, ImportedDirective>;
}

/**
 * Reads a ruleset's document as a change made in the app leaves it: these
 * blocks in this order (RA-5, D-271).
 *
 * What the importer reads there is what gets stored, so an export always
 * reads back as what is stored: where each block stands, and each rule's
 * section, tags and sweep patterns, which a table row anywhere in the
 * document can give it. A document that does not read back as these blocks
 * is refused, and `what` names the change that was not made.
 */
function readDocument(name: string, blocks: readonly StoredBlock[], what: string): DocumentReading {
  const reading: DocumentReading = { rules: new Map(), directives: new Map() };
  // No block is an empty document, which the importer reads as one directive.
  if (blocks.length === 0) return reading;

  const { ruleset } = importProtocol(blocks.map((block) => block.raw).join("\n"));
  const read = [...ruleset.rules, ...ruleset.directives].sort((a, b) => a.startLine - b.startLine);
  const codeOf = (entry: ImportedRule | ImportedDirective) => ("code" in entry ? entry.code : null);
  const asStored =
    read.length === blocks.length &&
    read.every((entry, at) => entry.raw === blocks[at]!.raw && codeOf(entry) === blocks[at]!.code);
  if (!asStored) {
    const codes = (list: readonly (string | null)[]) =>
      list.filter((code) => code !== null).join(", ") || "none";
    throw new Error(
      `${what}: the ruleset's document would read back as ${read.length} blocks ` +
        `(rules ${codes(read.map(codeOf))}), where ${blocks.length} ` +
        `(rules ${codes(blocks.map((block) => block.code))}) are expected.`,
    );
  }

  read.forEach((entry, at) => {
    const { id } = blocks[at]!;
    if ("code" in entry) reading.rules.set(id, entry);
    else reading.directives.set(id, entry);
  });
  return reading;
}

/** Stores what the document gives every block: `readDocument`'s reading, whole. */
function storeReading(tx: Tx, reading: DocumentReading): void {
  [...reading.rules].forEach(([id, rule], sortOrder) => {
    tx.update(rules)
      .set({
        sourceStartLine: rule.startLine,
        sourceEndLine: rule.endLine,
        groupHeading: rule.group,
        tags: serialiseJsonColumn(rule.tags),
        sweepPatterns: serialiseJsonColumn(rule.sweepPatterns),
        sortOrder,
      })
      .where(eq(rules.id, id))
      .run();
  });
  for (const [id, directive] of reading.directives) {
    tx.update(processDirectives)
      .set({ sourceStartLine: directive.startLine, sourceEndLine: directive.endLine })
      .where(eq(processDirectives.id, id))
      .run();
  }
}

/**
 * Saves a rule's text as edited in the app (RA-2): `edited` is the block as
 * `parseRuleBlock` read it, alone.
 *
 * The rule keeps its place, and what the document around it gives it is read
 * there again (`readDocument`): its section's tags, and the sweep patterns
 * that rows list under its code. A code is held while the rule would lose a
 * pattern under the new one, which it does unless the rows naming it are in
 * its own text and change with it. A severity changed in the app stays,
 * unless the text states one anew: the text of a promoted rule still says
 * what it was imported as, and an edit elsewhere in it would have demoted
 * the rule. The save carries the version it was made from, so two tabs
 * cannot undo each other without a word.
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

  const renamed = edited.code !== code;
  if (renamed) {
    const other = db
      .select({ id: rules.id })
      .from(rules)
      .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, edited.code)))
      .get();
    if (other) throw new RuleCodeTakenError(row.name, edited.code);
  }

  const reading = readDocument(
    row.name,
    storedBlocks(db, rulesetId).map((block) =>
      block.id === rule.id ? { id: rule.id, code: edited.code, raw: edited.raw } : block,
    ),
    `Rule ${code} was not saved in "${row.name}"`,
  );
  const swept = parseJsonColumn("rules.sweep_patterns", rule.sweepPatterns, stringArraySchema);
  const kept = reading.rules.get(rule.id)!.sweepPatterns;
  if (renamed && swept.some((pattern) => !kept.includes(pattern))) {
    throw new RuleCodeHeldError(code);
  }

  // The text states a severity anew when its line reads as another one, or
  // is written in or reworded: a line that says what the text was taken to
  // say without one is still the person's word over the picker's.
  const bodyOf = (raw: string) => raw.slice(raw.indexOf("\n") + 1);
  const before = bodyOf(rule.rawMarkdown);
  const word = severityWord(bodyOf(edited.raw));
  const statedAnew =
    edited.severity !== parseSeverity(before) || (word !== null && word !== severityWord(before));
  const version = row.version + 1;
  db.transaction((tx) => {
    tx.update(rules)
      .set({
        code: edited.code,
        title: edited.title,
        ...(statedAnew ? { severity: edited.severity } : {}),
        ruleText: edited.ruleText,
        violationExample: edited.violationExample,
        correctPattern: edited.correctPattern,
        detection: edited.detection,
        notes: edited.notes,
        rawMarkdown: edited.raw,
      })
      .where(eq(rules.id, rule.id))
      .run();
    storeReading(tx, reading);
    tx.update(rulesets)
      .set({ version, updatedAt: nowIso() })
      .where(eq(rulesets.id, rulesetId))
      .run();
  });
  return { version, code: edited.code };
}

export class RuleFenceOpenError extends Error {
  /** The rule that leaves the fence open, or null where the document ends on a directive that does. */
  constructor(readonly code: string | null) {
    super(
      code === null
        ? "The ruleset's document ends on a code fence left open, so a rule put after it would " +
            "read as code. Close the fence in the document and import it again."
        : `Rule ${code} leaves a code fence open, so a rule put after it would read as code in ` +
            `the ruleset's document. Close the fence in rule ${code}'s text first.`,
    );
    this.name = "RuleFenceOpenError";
  }
}

/**
 * Adds a rule written in the app (RA-3): `added` is the block as
 * `parseNewRuleBlock` read it, alone.
 *
 * It goes into the ruleset's document after the rule named, or after the
 * last rule, and is read there by the importer (`readDocument`): the section
 * it sits under, the tags that gives it and the sweep patterns rows list
 * under its code are the document's, as an import of the exported document
 * would have them.
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

  const blocks = storedBlocks(db, rulesetId);
  const ruleBlocks = blocks.filter(isRuleBlock);
  const anchor =
    after === undefined ? ruleBlocks.at(-1) : ruleBlocks.find((block) => block.code === after);
  if (after !== undefined && !anchor) throw new RuleNotFoundError(row.name, after);
  if (ruleBlocks.some((block) => block.code === added.code)) {
    throw new RuleCodeTakenError(row.name, added.code);
  }

  // After the anchor, or past everything in a ruleset with no rule.
  const at = anchor ? blocks.indexOf(anchor) + 1 : blocks.length;
  const preceding = blocks[at - 1];
  if (preceding && unclosedFenceLine(preceding.raw) !== null) {
    throw new RuleFenceOpenError(preceding.code);
  }

  const id = newId();
  const reading = readDocument(
    row.name,
    [...blocks.slice(0, at), { id, code: added.code, raw: added.raw }, ...blocks.slice(at)],
    `Rule ${added.code} was not added to "${row.name}"`,
  );

  const version = row.version + 1;
  db.transaction((tx) => {
    // Its place, section, tags and sweep patterns are the reading's, stored
    // with every other block's below.
    tx.insert(rules)
      .values({
        id,
        rulesetId,
        code: added.code,
        title: added.title,
        severity: added.severity,
        ruleText: added.ruleText,
        violationExample: added.violationExample,
        correctPattern: added.correctPattern,
        detection: added.detection,
        notes: added.notes,
        rawMarkdown: added.raw,
        enabled: true,
        sortOrder: 0,
      })
      .run();
    storeReading(tx, reading);
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
 * The blocks after it move up, and a sweep pattern a row in its text gave
 * another rule goes with the row (`readDocument`). A review already started
 * keeps the rule in its own copy.
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
    .select({ id: rules.id })
    .from(rules)
    .where(and(eq(rules.rulesetId, rulesetId), eq(rules.code, code)))
    .get();
  if (!rule) throw new RuleNotFoundError(row.name, code);
  if (readVersion !== row.version) throw new RulesetChangedError(row.version, readVersion);

  const reading = readDocument(
    row.name,
    storedBlocks(db, rulesetId).filter((block) => block.id !== rule.id),
    `Rule ${code} was not removed from "${row.name}"`,
  );

  const version = row.version + 1;
  db.transaction((tx) => {
    tx.delete(rules).where(eq(rules.id, rule.id)).run();
    storeReading(tx, reading);
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
