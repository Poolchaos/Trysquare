/**
 * The database schema, implementing docs/02-DATA-MODEL.md.
 *
 * Conventions used throughout:
 * - Ids are ULIDs stored as text, so rows sort by creation time.
 * - Timestamps are ISO-8601 UTC strings, so string ordering is time ordering.
 * - Sets of values are stored as text and narrowed by the enums in
 *   `lib/domain`, not by SQLite check constraints, so that one definition
 *   serves the database, the API, and the UI.
 * - JSON columns are text and are parsed through zod at the repository
 *   boundary; nothing reads them raw.
 */

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  gitUrl: text("git_url").notNull().unique(),
  defaultBranch: text("default_branch").notNull(),
  clonePath: text("clone_path").notNull(),
  cloneStatus: text("clone_status").notNull(),
  cloneError: text("clone_error"),
  lastFetchedAt: text("last_fetched_at"),
  createdAt: text("created_at").notNull(),
});

/**
 * A consumer project declaring a dependency whose changes may need reviewing
 * alongside it, for example an app and a package it imports types from.
 */
export const projectLinks = sqliteTable(
  "project_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    dependencyProjectId: text("dependency_project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("project_links_project_idx").on(table.projectId)],
);

export const rulesets = sqliteTable("rulesets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull(),
  description: text("description").notNull().default(""),
  sourceDoc: text("source_doc"),
  /** Bumped on edit so a review's frozen snapshot can name what it used. */
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const rules = sqliteTable(
  "rules",
  {
    id: text("id").primaryKey(),
    rulesetId: text("ruleset_id")
      .notNull()
      .references(() => rulesets.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    severity: text("severity").notNull(),
    /** JSON string[] of technology tags, used to narrow prompts per file. */
    tags: text("tags").notNull().default("[]"),
    ruleText: text("rule_text").notNull(),
    violationExample: text("violation_example"),
    correctPattern: text("correct_pattern"),
    detection: text("detection"),
    notes: text("notes"),
    /** JSON string[] of regex sources run by the deterministic sweep. */
    sweepPatterns: text("sweep_patterns").notNull().default("[]"),
    /** The section heading the rule sat under, which is what tags it. */
    groupHeading: text("group_heading").notNull().default(""),
    /**
     * The rule's verbatim markdown, and where it came from.
     *
     * Kept because the parsed fields are a lossy view of what the author
     * wrote: this is what proves an import dropped nothing, and what an
     * export regenerates from.
     */
    rawMarkdown: text("raw_markdown").notNull().default(""),
    sourceStartLine: integer("source_start_line").notNull().default(0),
    sourceEndLine: integer("source_end_line").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("rules_ruleset_idx").on(table.rulesetId),
    // Unique, not merely indexed: a rule code identifies a rule within its
    // ruleset, so a duplicate would make findings.ruleCode ambiguous and would
    // run that rule's sweep patterns twice. Being unique also gives the
    // protocol importer a valid ON CONFLICT target for idempotent re-imports.
    uniqueIndex("rules_ruleset_code_idx").on(table.rulesetId, table.code),
  ],
);

/** Protocol content that is not a rule but must reach the prompt verbatim. */
export const processDirectives = sqliteTable(
  "process_directives",
  {
    id: text("id").primaryKey(),
    rulesetId: text("ruleset_id")
      .notNull()
      .references(() => rulesets.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull(),
    /** Verbatim source, for the same reason the rules keep theirs. */
    rawMarkdown: text("raw_markdown").notNull().default(""),
    sourceStartLine: integer("source_start_line").notNull().default(0),
    sourceEndLine: integer("source_end_line").notNull().default(0),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [index("process_directives_ruleset_idx").on(table.rulesetId)],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    fromBranch: text("from_branch").notNull(),
    fromCommit: text("from_commit").notNull(),
    intoBranch: text("into_branch").notNull(),
    intoCommit: text("into_commit").notNull(),
    mergeBaseCommit: text("merge_base_commit").notNull(),

    /** Set only for a linked review spanning a dependency repository. */
    linkedProjectId: text("linked_project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    linkedFromBranch: text("linked_from_branch"),
    linkedFromCommit: text("linked_from_commit"),
    linkedIntoBranch: text("linked_into_branch"),
    linkedIntoCommit: text("linked_into_commit"),
    linkedMergeBaseCommit: text("linked_merge_base_commit"),

    /** What the author says the change was meant to do. Optional, free text. */ intent:
      text("intent"),

    model: text("model").notNull(),
    profileId: text("profile_id").notNull(),
    engineMode: text("engine_mode").notNull(),
    /** Reasoning effort, fixed at creation so a resume cannot change it. */
    effort: text("effort").notNull().default("high"),
    /**
     * The context window this review batches against, frozen with its ruleset.
     * Null means it was decided to be unknown, not that it is undecided.
     */
    contextWindow: integer("context_window"),

    status: text("status").notNull(),
    currentStage: text("current_stage"),
    pausedReason: text("paused_reason"),
    // Unix seconds, as the CLI reports it. A pause with no end in sight reads
    // as a hang, so the reset time is kept beside the reason it paused.
    pausedResetsAt: integer("paused_resets_at"),

    usageInputTokens: integer("usage_input_tokens").notNull().default(0),
    usageCacheCreationTokens: integer("usage_cache_creation_tokens").notNull().default(0),
    usageCacheReadTokens: integer("usage_cache_read_tokens").notNull().default(0),
    usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
    /** Informational only: what the same work would have cost at API rates. */
    costEquivalentUsd: real("cost_equivalent_usd").notNull().default(0),

    /**
     * Dated notes about how the run was carried out: batch splits, rule/file
     * pairs a narrowing profile excluded, oversized prompts. Append-only JSON
     * array. Narrowing is only legitimate when it is visible, and this is
     * where it becomes visible.
     */
    runNotes: text("run_notes").notNull().default("[]"),
    mergedDetectedAt: text("merged_detected_at"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("reviews_project_idx").on(table.projectId),
    // Anticipates history grouped by branch pair. No query uses it yet; kept
    // because dropping it is a migration against a live database for no gain.
    index("reviews_branch_pair_idx").on(table.projectId, table.fromBranch, table.intoBranch),
    index("reviews_status_idx").on(table.status),
  ],
);

/**
 * The composed ruleset content frozen at review start. Editing a ruleset later
 * must never change what a past review was judged against.
 */
export const reviewRulesets = sqliteTable(
  "review_rulesets",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    rulesetId: text("ruleset_id")
      .notNull()
      .references(() => rulesets.id, { onDelete: "restrict" }),
    rulesetName: text("ruleset_name").notNull(),
    rulesetVersion: integer("ruleset_version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.reviewId, table.rulesetId] })],
);

export const stageExecutions = sqliteTable(
  "stage_executions",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    attempt: integer("attempt").notNull().default(1),
    /**
     * Hash of the prompt this attempt answered.
     *
     * A pinned review composes the same prompt every time, so this identifies
     * the request rather than the occasion. A resumed run finds the stored
     * answer by it and replays instead of paying for the stage again.
     */
    promptHash: text("prompt_hash").notNull().default(""),
    /** CLI session id, kept so an interrupted stage can resume rather than restart. */
    sessionId: text("session_id"),
    status: text("status").notNull(),
    /** The stage's validated answer, kept so a resume can replay it. */
    outputJson: text("output_json"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costEquivalentUsd: real("cost_equivalent_usd").notNull().default(0),
    errorClass: text("error_class"),
    errorText: text("error_text"),
    logPath: text("log_path"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
  },
  (table) => [
    index("stage_executions_review_idx").on(table.reviewId, table.stage),
    index("stage_executions_replay_idx").on(table.reviewId, table.stage, table.promptHash),
  ],
);

export const ledgerFiles = sqliteTable(
  "ledger_files",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    path: text("path").notNull(),
    changeType: text("change_type").notNull(),
    oldPath: text("old_path"),
    riskTags: text("risk_tags").notNull().default("[]"),
    chainFilesRead: text("chain_files_read").notNull().default("[]"),
    status: text("status").notNull().default("pending"),
  },
  (table) => [index("ledger_files_review_idx").on(table.reviewId)],
);

export const ledgerHunks = sqliteTable(
  "ledger_hunks",
  {
    id: text("id").primaryKey(),
    ledgerFileId: text("ledger_file_id")
      .notNull()
      .references(() => ledgerFiles.id, { onDelete: "cascade" }),
    hunkIndex: integer("hunk_index").notNull(),
    oldStart: integer("old_start").notNull(),
    oldLines: integer("old_lines").notNull(),
    newStart: integer("new_start").notNull(),
    newLines: integer("new_lines").notNull(),
    status: text("status").notNull().default("pending"),
    clearReason: text("clear_reason"),
  },
  (table) => [index("ledger_hunks_file_idx").on(table.ledgerFileId)],
);

export const sweepHits = sqliteTable(
  "sweep_hits",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    ruleCode: text("rule_code").notNull(),
    pattern: text("pattern").notNull(),
    repo: text("repo").notNull(),
    path: text("path").notNull(),
    line: integer("line").notNull(),
    excerpt: text("excerpt").notNull(),
    disposition: text("disposition").notNull().default("pending"),
    clearReason: text("clear_reason"),
    findingId: text("finding_id"),
  },
  (table) => [index("sweep_hits_review_idx").on(table.reviewId, table.disposition)],
);

export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    filePath: text("file_path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    /**
     * The lines as the finding was raised, before verification corrected
     * them. Coverage is counted against these (D-102): the hunks a finding
     * accounted for were decided when it was raised. Null on rows from
     * before the column, which fall back to the current lines.
     */
    raisedLineStart: integer("raised_line_start"),
    raisedLineEnd: integer("raised_line_end"),
    /** The verifier's, once verified; the finder's is kept in raisedSeverity (PG-3, D-185). */
    severity: text("severity").notNull(),
    /** The severity the finding was raised with. Null on rows from before the column. */
    raisedSeverity: text("raised_severity"),
    ruleCode: text("rule_code"),
    issue: text("issue").notNull(),
    comment: text("comment").notNull(),
    /**
     * What a person wrote in place of the engine's comment, if they rewrote
     * it while confirming. The engine's own words stay in `comment`: the
     * report is for the reader, but what the model actually said is the
     * measurement of whether the prompts are any good.
     */
    editedComment: text("edited_comment"),
    /** The traced path from input to wrong output. Internal, shown in the UI. */
    mechanism: text("mechanism").notNull(),
    /** Quoted at verification time and byte-compared against the file. */
    quotedCode: text("quoted_code").notNull().default(""),
    /**
     * The verifier's proof as JSON: the trigger, the evidence path, every step
     * of it checked against the code, and where it searched for a guard
     * (proof-and-steps plan, WP-C). Null before verification and on rows from
     * before the column.
     */
    proofJson: text("proof_json"),
    status: text("status").notNull().default("candidate"),
    verificationNote: text("verification_note"),
    /**
     * Set when killed: `verification` for a refutation, `quote_check` for the
     * program's own checks (KillKind). Rows killed before the column were
     * classified by the note the pipeline wrote, unchanged since its first
     * commit (migration 0011).
     */
    killedBy: text("killed_by"),
    dismissReason: text("dismiss_reason"),
    /**
     * The status a dismissed finding had: `open_question` is a finding left
     * out unproven, which the report keeps apart from the ones a person
     * rejected (D-190). Null on rows dismissed before the column.
     */
    dismissedFrom: text("dismissed_from"),
    createdAt: text("created_at").notNull(),
    verifiedAt: text("verified_at"),
    decidedAt: text("decided_at"),
  },
  (table) => [index("findings_review_idx").on(table.reviewId, table.status)],
);

/** Probed, never assumed. See docs/06-MODELS-AND-PROFILES.md. */
export const models = sqliteTable("models", {
  /** The full model id passed to the CLI. Short aliases are never stored. */
  id: text("id").primaryKey(),
  resolvedId: text("resolved_id"),
  family: text("family").notNull(),
  displayName: text("display_name").notNull(),
  /** null means never probed, which is shown as unknown rather than assumed good. */
  available: integer("available", { mode: "boolean" }),
  contextWindow: integer("context_window"),
  profileId: text("profile_id").notNull(),
  recommended: integer("recommended", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  lastProbedAt: text("last_probed_at"),
  lastError: text("last_error"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  reviews: many(reviews),
  links: many(projectLinks),
}));

export const projectLinksRelations = relations(projectLinks, ({ one }) => ({
  project: one(projects, {
    fields: [projectLinks.projectId],
    references: [projects.id],
    relationName: "consumer",
  }),
  dependency: one(projects, {
    fields: [projectLinks.dependencyProjectId],
    references: [projects.id],
    relationName: "dependency",
  }),
}));

export const rulesetsRelations = relations(rulesets, ({ many }) => ({
  rules: many(rules),
  directives: many(processDirectives),
}));

export const rulesRelations = relations(rules, ({ one }) => ({
  ruleset: one(rulesets, { fields: [rules.rulesetId], references: [rulesets.id] }),
}));

export const processDirectivesRelations = relations(processDirectives, ({ one }) => ({
  ruleset: one(rulesets, { fields: [processDirectives.rulesetId], references: [rulesets.id] }),
}));

export const reviewsRelations = relations(reviews, ({ one, many }) => ({
  project: one(projects, { fields: [reviews.projectId], references: [projects.id] }),
  stages: many(stageExecutions),
  ledgerFiles: many(ledgerFiles),
  sweepHits: many(sweepHits),
  findings: many(findings),
  rulesets: many(reviewRulesets),
}));

export const ledgerFilesRelations = relations(ledgerFiles, ({ one, many }) => ({
  review: one(reviews, { fields: [ledgerFiles.reviewId], references: [reviews.id] }),
  hunks: many(ledgerHunks),
}));

export const ledgerHunksRelations = relations(ledgerHunks, ({ one }) => ({
  file: one(ledgerFiles, { fields: [ledgerHunks.ledgerFileId], references: [ledgerFiles.id] }),
}));

export const findingsRelations = relations(findings, ({ one }) => ({
  review: one(reviews, { fields: [findings.reviewId], references: [reviews.id] }),
}));
