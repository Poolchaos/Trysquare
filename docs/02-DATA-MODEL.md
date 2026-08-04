# 02 Data model

Status: RATIFIED 2026-07-30 at G0. SQLite via Drizzle;
migrations checked in from the first table. All ids are ULIDs (sortable),
all timestamps are ISO-8601 UTC strings. JSON columns are validated with zod
on read and write.

## Not built yet

This document specifies the target. Verified against the code on 2026-08-03,
these parts of it do not exist yet. They stay here as requirements rather
than being edited away; the item in `plans/M4-FINISH-PLAN.md` that owns each
is named.

- Editing a project name or default branch. Both are marked editable above
  and there is no route or screen for either. U10, D-51.
- Offering bulk deletion of a project reviews when a delete is refused. The
  refusal and its count are implemented; the remedy is not. U9.

## Tables

### projects

| Column        | Type        | Notes                               |
| ------------- | ----------- | ----------------------------------- |
| id            | text PK     |                                     |
| name          | text        | display name, editable              |
| gitUrl        | text unique | as entered                          |
| defaultBranch | text        | detected from origin/HEAD, editable |
| clonePath     | text        | absolute path to bare repo          |
| cloneStatus   | text        | pending, cloning, ready, failed     |
| cloneError    | text null   |                                     |
| lastFetchedAt | text null   |                                     |
| createdAt     | text        |                                     |

Branches are NOT stored; they are read live from git per request (list,
filter, ahead/behind counts). Stale branch caches are a bug class we opt out
of entirely.

### project_links

A project can declare dependency projects whose changes must sometimes be
reviewed together with it (e.g. an app consumes a shared-core package).

| Column              | Type      | Notes                                                                                      |
| ------------------- | --------- | ------------------------------------------------------------------------------------------ |
| id                  | text PK   |                                                                                            |
| projectId           | text FK   | the consumer (e.g. pos)                                                                    |
| dependencyProjectId | text FK   | the dependency (e.g. shared-core)                                                             |
| packageName         | text      | import specifier, e.g. @acme/shared-core, used to map imports to the dependency worktree |
| note                | text null |                                                                                            |

Links are directional (consumer -> dependency) and configured once on the
project. A dependency is itself a normal project (own clone, own reviews).

### rulesets

| Column               | Type      | Notes                                      |
| -------------------- | --------- | ------------------------------------------ |
| id                   | text PK   |                                            |
| name                 | text      |                                            |
| tier                 | text      | global, tech, project                      |
| description          | text      |                                            |
| sourceDoc            | text null | provenance, e.g. REVIEW_PROTOCOL.md import |
| createdAt, updatedAt | text      |                                            |

### rules

| Column           | Type      | Notes                                               |
| ---------------- | --------- | --------------------------------------------------- |
| id               | text PK   |                                                     |
| rulesetId        | text FK   |                                                     |
| code             | text      | protocol numbering, e.g. "5b", unique per ruleset   |
| title            | text      |                                                     |
| severity         | text      | CRITICAL, WARNING, NITPICK (ERROR maps to CRITICAL) |
| tags             | text JSON | tech tags, e.g. ["react","firestore"]               |
| ruleText         | text      | verbatim markdown                                   |
| violationExample | text null | verbatim fenced code                                |
| correctPattern   | text null | verbatim fenced code                                |
| detection        | text null | verbatim detection hints                            |
| notes            | text null | why-it-matters, real examples, exceptions           |
| sweepPatterns    | text JSON | regexes derived from the protocol sweep table       |
| enabled          | int bool  | per-rule toggle                                     |
| sortOrder        | int       | source order preserved                              |

### process_directives

Ruleset-scoped non-rule content composed into every review prompt.

| Column        | Type | Notes                                                                                          |
| ------------- | ---- | ---------------------------------------------------------------------------------------------- |
| id, rulesetId |      |                                                                                                |
| section       | text | prime_directive, procedure, scope, philosophy, severity_model, output_format, domain_knowledge |
| title         | text |                                                                                                |
| contentMd     | text | verbatim                                                                                       |
| sortOrder     | int  |                                                                                                |

### reviews

| Column                              | Type         | Notes                                      |
| ----------------------------------- | ------------ | ------------------------------------------ |
| id                                  | text PK      |                                            |
| projectId                           | text FK      |                                            |
| fromBranch, fromCommit              | text         | commit pinned at start                     |
| intoBranch, intoCommit              | text         |                                            |
| mergeBaseCommit                     | text         | diff base = merge-base(from, into)         |
| linkedProjectId                     | text FK null | dependency project included in this review |
| linkedFromBranch, linkedFromCommit  | text null    | pinned like the primary pair               |
| linkedIntoBranch, linkedIntoCommit  | text null    |                                            |
| linkedMergeBaseCommit               | text null    |                                            |
| model                               | text         | full model id, FK to models.id             |
| profileId                           | text         | review profile actually used (see 06)      |
| engineMode                          | text         | headless, interactive                      |
| status                              | text         | see state machine                          |
| currentStage                        | text null    |                                            |
| pausedReason                        | text null    | limit message etc.                         |
| usageInputTokens, usageOutputTokens | int          | summed across stages                       |
| costEquivalentUsd                   | real         | informational, from CLI results            |
| mergedDetectedAt                    | text null    | set when into-branch contains fromCommit   |
| createdAt, startedAt, completedAt   | text         |                                            |

Review status machine:
`draft -> running -> verifying -> awaiting_confirmation -> complete`,
with `paused_limit`, `interrupted`, `failed`, `cancelled` reachable from any
running state; `paused_limit/interrupted -> running` on resume. Transitions
are enforced in one repository function, unit-tested; no ad hoc writes.

### review_rulesets

(reviewId, rulesetId, snapshotJson). snapshotJson freezes the composed
ruleset content at start time so later ruleset edits never change what a
past review was judged against.

### stage_executions

| Column                                       | Type      | Notes                                                                              |
| -------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| id, reviewId                                 |           |                                                                                    |
| stage                                        | text      | s1_risk, s2_comprehension, s3_adversarial, s4_deletions, s5_verification, s6_audit |
| attempt                                      | int       |                                                                                    |
| sessionId                                    | text null | CLI session id for resume                                                          |
| status                                       | text      | succeeded or failed. The enum also carries running and cancelled; nothing writes them, because a row is written only once a stage settles |
| inputTokens, outputTokens, costEquivalentUsd |           | from result event                                                                  |
| errorClass, errorText, logPath               |           |                                                                                    |
| startedAt, endedAt                           | text      |                                                                                    |

### ledger_files

| Column         | Type      | Notes                                                                    |
| -------------- | --------- | ------------------------------------------------------------------------ |
| id, reviewId   |           |                                                                          |
| repo           | text      | primary or linked                                                        |
| path           | text      | repo-relative within that repo                                           |
| changeType     | text      | added, modified, deleted, renamed                                        |
| oldPath        | text null | renames                                                                  |
| riskTags       | text JSON | from S1: money, auth, data_shape, destructive, concurrency, time, shared |
| chainFilesRead | text JSON | filled by S2                                                             |
| status         | text      | pending, reviewed                                                        |

### ledger_hunks

(id, ledgerFileId, hunkIndex, oldStart, oldLines, newStart, newLines,
status: pending, cleared, has_findings; clearReason text null).
Invariant: a review cannot leave `verifying` while any hunk is pending. The
invariant is checked in code (S6) and by unit test, not by prompt trust.

### sweep_hits

(id, reviewId, ruleCode, pattern, path, line, excerpt, disposition:
pending, cleared, finding; clearReason, findingId null). Same invariant:
no pending sweep hits past S6.

### findings

| Column                           | Type      | Notes                                                            |
| -------------------------------- | --------- | ---------------------------------------------------------------- |
| id, reviewId                     |           |                                                                  |
| repo                             | text      | primary or linked                                                |
| filePath                         | text      | repo-relative within that repo, from the checked-out branch      |
| lineStart, lineEnd               | int       | verified against worktree file in S5                             |
| severity                         | text      |                                                                  |
| ruleCode                         | text null | which rule it violates, if rule-based                            |
| issue                            | text      | one-line statement                                               |
| comment                          | text      | protocol finding format, <= 4 sentences                          |
| editedComment                    | text null | the person's rewrite at confirm time; the report prefers it       |
| mechanism                        | text      | traced input -> wrong output path (internal, shown in UI)        |
| quotedCode                       | text      | exact lines quoted at verification time                          |
| status                           | text      | candidate, verified, killed, open_question, confirmed, dismissed |
| verificationNote                 | text null | S5 outcome detail                                                |
| dismissReason                    | text null | the user's reason, kept for history                               |
| createdAt, verifiedAt, decidedAt | text      |                                                                  |

Finding status machine:
`candidate -> verified | killed | open_question` (S5, fresh session);
`verified -> confirmed | dismissed` (the maintainer only, S7 UI);
`open_question -> confirmed | dismissed` (surfaced to the maintainer as questions).
Killed findings are kept (hidden by default) for engine-quality metrics.

### models

Candidate registry, probed not assumed (see 06).
(id PK = full model id as passed to `--model`, e.g. `claude-fable-5[1m]`;
resolvedId text null = id reported back by the probe; family text;
displayName; available int bool null = unknown; contextWindow int null;
profileId text = full-context, chunked, decomposed, mechanical-only;
recommended int bool; lastProbedAt text null; lastError text null)

Short aliases (`opus`, `sonnet`) are never stored or passed: they resolve to
the previous model generation. A unit test asserts no registry row and no
composed command uses an alias form.

### settings

(key PK, value JSON): maxConcurrentReviews, stageTimeoutMinutes,
stageMaxBudgetUsd. Those three are the whole catalogue; any other key is
refused by name. A data-directory display, a default model and a default
engine mode are designed but not built (U10, U11).

## Deletion rules

Deleting a review deletes its worktree, bundle, logs, and rows (cascade).
Deleting a project requires zero reviews (UI offers bulk-delete first) and
then removes the bare clone. Both are two-step confirmed in the UI, never
cascading silently from a single click.
