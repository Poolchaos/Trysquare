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

import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { newId, nowIso } from "@/lib/ids";
import { severitySchema, type RulesetTier, directiveSectionSchema } from "@/lib/domain/enums";
import type { ImportedRuleset } from "@/lib/rulesets/model";
import type { Db } from "../client";
import { processDirectives, reviewRulesets, rules, rulesets } from "../schema";
import { parseJsonColumn, serialiseJsonColumn } from "./json";

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
  const existing = db.select().from(rulesets).where(eq(rulesets.name, input.name)).get();

  const incoming = serialiseJsonColumn(
    toSnapshot(input.name, existing?.version ?? 1, input.imported),
  );

  if (existing) {
    const current = serialiseJsonColumn(
      toSnapshot(existing.name, existing.version, loadRuleset(db, existing.id)),
    );
    if (current === incoming) {
      return { rulesetId: existing.id, version: existing.version, changed: false };
    }
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
export function loadRuleset(db: Db, rulesetId: string): ImportedRuleset {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get();
  if (!row) throw new Error(`No ruleset with id "${rulesetId}".`);

  const ruleRows = db
    .select()
    .from(rules)
    .where(eq(rules.rulesetId, rulesetId))
    .orderBy(asc(rules.sortOrder))
    .all();

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

export function listRulesets(db: Db): RulesetRow[] {
  return db.select().from(rulesets).orderBy(asc(rulesets.name)).all();
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

  const snapshot = toSnapshot(row.name, row.version, loadRuleset(db, rulesetId));
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
