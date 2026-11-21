# 02 Data model

Status: RATIFIED 2026-07-30 at G0. SQLite via Drizzle;
migrations checked in from the first table. All ids are ULIDs (sortable),
all timestamps are ISO-8601 UTC strings. JSON columns are validated with zod
on read and write.

## Not built yet

Nothing, verified against the code on 2026-10-22. The two parts listed here
on 2026-08-03 are built: a project's name and default branch are edited from
its page through PATCH /api/projects/:id (D-51, MVP 7.1), and a refused
project delete offers to delete the reviews that block it (U9).

Brought level with `src/server/db/schema.ts` on 2026-11-17: twenty-five
columns added since this was written were missing from the tables below.

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
| createdAt           | text      |                                                                                            |

Links are directional (consumer -> dependency) and configured once on the
project. A dependency is itself a normal project (own clone, own reviews).

### project_checks

A project's own tests and e2e, which a review runs on a throwaway copy of
the branch once a person turns them on (proof-and-steps plan, WP-I; D-191,
D-192). No row means off.

| Column             | Type         | Notes                                                       |
| ------------------ | ------------ | ----------------------------------------------------------- |
| projectId          | text PK, FK  | cascades with the project                                   |
| enabled            | integer bool | on only with a test or an e2e command                       |
| installCommand     | text null    | one line, at most 1000 characters, run first                |
| testCommand        | text null    | one line; a failing run is a finding                        |
| e2eCommand         | text null    | one line; set together with screenshotDir                   |
| screenshotDir      | text null    | inside the repository: relative, no `..`                    |
| designStandardPath | text null    | inside the repository; null grades by the A to D scale only |
| updatedAt          | text         |                                                             |

The whole set is sent and checked at once (`lib/projects/checks.ts`), so a
stored set is always one that passed. Turned off, the commands are kept.

### check_findings

What a project's own checks found in a review (D-197): a failing install,
test or e2e command (kind `test`), or a screenshot graded C or D (kind
`design`, WP-I step 4). A finding's lifecycle without a file and a line,
kept apart so code findings, their ledger and their coverage checks never
meet a row with neither. Made again from the checks' result each time a
review prepares, as code findings are from the stages' answers.

| Column           | Type         | Notes                                                    |
| ---------------- | ------------ | -------------------------------------------------------- |
| id               | text PK      |                                                          |
| reviewId         | text FK      | cascades with the review                                 |
| kind             | text         | test, design                                             |
| step             | text null    | install, tests, e2e (a test)                             |
| command          | text null    | as it was run                                            |
| exitCode         | integer null | null when stopped                                        |
| timedOut         | integer bool | stopped at its time limit                                |
| logPath          | text null    | the command's whole output                               |
| screenshotPath   | text null    | a design grade's screenshot, its name under the review's checks/screenshots, never a path (round 8) |
| grade            | text null    | C or D (a design grade)                                  |
| severity         | text         | CRITICAL for a failing command                           |
| issue            | text         | e.g. "The tests fail on this branch."                    |
| evidence         | text         | the output's last lines, or what is off on the screen    |
| status           | text         | a finding's: a failing command is proven by the app      |
| verificationNote | text null    | e.g. "Exited with code 1, as the app ran it."            |
| dismissReason    | text null    |                                                          |
| dismissedFrom    | text null    |                                                          |
| createdAt        | text         |                                                          |
| decidedAt        | text null    |                                                          |

### rulesets

| Column               | Type      | Notes                                      |
| -------------------- | --------- | ------------------------------------------ |
| id                   | text PK   |                                            |
| name                 | text      |                                            |
| tier                 | text      | global, tech, project                      |
| description          | text      |                                            |
| sourceDoc            | text null | provenance, e.g. REVIEW_PROTOCOL.md import |
| version              | int       | moves when a rule's severity or switch changes, a rule's text is saved, a rule is added or removed, or an import replaces the rules; 1 for a ruleset started with no document |
| createdAt, updatedAt | text      |                                            |

### rules

| Column           | Type      | Notes                                               |
| ---------------- | --------- | --------------------------------------------------- |
| id               | text PK   |                                                     |
| rulesetId        | text FK   |                                                     |
| code             | text      | protocol numbering, e.g. "5b", unique per ruleset   |
| title            | text      |                                                     |
| severity         | text      | CRITICAL, WARNING, NITPICK (ERROR maps to CRITICAL) |
| tags             | text JSON | tech tags, e.g. ["react","database"]                |
| ruleText         | text      | verbatim markdown                                   |
| violationExample | text null | verbatim fenced code                                |
| correctPattern   | text null | verbatim fenced code                                |
| detection        | text null | verbatim detection hints                            |
| notes            | text null | why-it-matters, real examples, exceptions           |
| sweepPatterns    | text JSON | regexes derived from the protocol sweep table       |
| groupHeading     | text      | the section heading the rule sat under, which tags it |
| rawMarkdown      | text      | the rule as the author wrote it: what proves an import dropped nothing, and what an export writes |
| sourceStartLine, sourceEndLine | int | where in the document it came from |
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
| rawMarkdown   | text | verbatim source, kept for the reason a rule's is                                               |
| sourceStartLine, sourceEndLine | int | where in the document it came from                                            |
| sortOrder     | int  |                                                                                                |

### reviews

| Column                              | Type         | Notes                                      |
| ----------------------------------- | ------------ | ------------------------------------------ |
| id                                  | text PK      |                                            |
| projectId                           | text FK      |                                            |
| fromBranch, fromCommit              | text         | commit pinned when the review is created   |
| intoBranch, intoCommit              | text         |                                            |
| mergeBaseCommit                     | text         | diff base = merge-base(from, into)         |
| linkedProjectId                     | text FK null | dependency project included in this review |
| linkedFromBranch, linkedFromCommit  | text null    | pinned like the primary pair               |
| linkedIntoBranch, linkedIntoCommit  | text null    |                                            |
| linkedMergeBaseCommit               | text null    |                                            |
| intent                              | text null    | what the author says the change was meant to do |
| model                               | text         | full model id; a name in models.id, not a foreign key |
| profileId                           | text         | review profile actually used (see 06)      |
| effort                              | text         | reasoning effort, fixed at creation        |
| contextWindow                       | int null     | the window the review batches against, frozen with its ruleset |
| verifierModel                       | text null    | the second verifier, frozen at first run   |
| engineMode                          | text         | headless, interactive                      |
| status                              | text         | see state machine                          |
| currentStage                        | text null    |                                            |
| pausedReason                        | text null    | limit message etc.                         |
| pausedResetsAt                      | int null     | Unix seconds, when the limit resets, as the CLI reports it |
| usageInputTokens, usageOutputTokens | int          | summed across stages                       |
| usageCacheCreationTokens, usageCacheReadTokens | int | summed across stages                     |
| costEquivalentUsd                   | real         | informational, from CLI results            |
| runNotes                            | text JSON    | dated notes on how the run was carried out, append-only |
| mergedDetectedAt                    | text null    | set when into-branch contains fromCommit   |
| createdAt, startedAt, completedAt   | text         | startedAt is stamped on every entry into running (D-77); completedAt when the review is complete, failed or cancelled |
| runEndedAt                          | text null    | when the run stopped, whatever stopped it; startedAt to here is the duration every screen and the report give (D-248). Null while it runs and where nobody saw it stop |

Review status machine:
`draft -> running -> verifying -> awaiting_confirmation -> complete`,
with `paused_limit`, `interrupted`, `failed`, `cancelled` reachable from any
running state; `paused_limit/interrupted/failed -> running` on resume, a
failed review being resumed like a paused one (D-50). Transitions
are enforced in one repository function, unit-tested; no ad hoc writes.

### review_rulesets

(reviewId, rulesetId, rulesetName, rulesetVersion, snapshotJson).
snapshotJson freezes the composed ruleset content at start time so later
ruleset edits never change what a past review was judged against; the name
and version are kept beside it, so a report says which ruleset and version
that was. The row goes with its review. `rulesetId` is the id the ruleset
had and no key onto it (migration 0019, D-266): a ruleset deleted leaves
the copy with every review that ran with it. Start time is when the run
starts: a review waiting in line holds its ruleset's id and nothing of its
rules, so it runs with the ruleset as it stands when its turn comes
(D-270).

### stage_executions

| Column                                       | Type      | Notes                                                                              |
| -------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| id, reviewId                                 |           |                                                                                    |
| stage                                        | text      | one of the nine in `src/lib/domain/enums.ts`, s1_risk to s6_audit                   |
| attempt                                      | int       |                                                                                    |
| promptHash                                   | text      | identifies the request, so a resumed run finds the stored answer and replays it    |
| sessionId                                    | text null | CLI session id for resume                                                          |
| outputJson                                   | text null | the stage's validated answer, kept so a resume can replay it                       |
| cacheCreationTokens, cacheReadTokens         | int       | from result event                                                                  |
| status                                       | text      | succeeded or failed. The enum also carries running and cancelled; nothing writes them, because a row is written only once a stage settles |
| inputTokens, outputTokens, costEquivalentUsd |           | from result event                                                                  |
| errorClass, errorText, logPath               |           |                                                                                    |
| startedAt, endedAt                           | text      |                                                                                    |
| findingId                                    | text null | the one finding a verify-again asked about; such rows are not the stage's run       |

### ledger_files

| Column         | Type      | Notes                                                                    |
| -------------- | --------- | ------------------------------------------------------------------------ |
| id, reviewId   |           |                                                                          |
| repo           | text      | primary or linked                                                        |
| path           | text      | qualified by repository as the model sees it: `<slug>/<path>`            |
| changeType     | text      | added, modified, deleted, renamed                                        |
| oldPath        | text null | renames                                                                  |
| riskTags       | text JSON | from S1: money, auth, data_shape, destructive, concurrency, time, shared |
| chainFilesRead | text JSON | filled by S2                                                             |
| status         | text      | pending, reviewed                                                        |

### ledger_hunks

(id, ledgerFileId, hunkIndex, oldStart, oldLines, newStart, newLines,
status: pending, cleared, has_findings; clearReason text null). A
has_findings hunk keeps a clearReason when another request of a divided
stage cleared it (D-102).
Invariant: a review cannot leave `verifying` while any hunk is pending. The
invariant is checked in code (S6) and by unit test, not by prompt trust.

### sweep_hits

(id, reviewId, ruleCode, pattern, repo, path, line, excerpt, disposition:
pending, cleared, finding; clearReason, findingId null). The path is
qualified by repository, `<slug>/<path>`, as a ledger file's is. Same
invariant: no pending sweep hits past S6.

### findings

| Column                           | Type      | Notes                                                            |
| -------------------------------- | --------- | ---------------------------------------------------------------- |
| id, reviewId                     |           |                                                                  |
| repo                             | text      | primary or linked                                                |
| filePath                         | text      | qualified by repository, `<slug>/<path>`, from the checked-out branch |
| lineStart, lineEnd               | int       | verified against worktree file in S5                             |
| raisedLineStart, raisedLineEnd   | int null  | as raised, before S5 corrected them; coverage counts these (D-102) |
| severity                         | text      | the verifier's once verified (PG-3, D-185)                       |
| raisedSeverity                   | text null | the finder's, kept beside it; null on rows from before 0012      |
| ruleCode                         | text null | which rule it violates, if rule-based                            |
| issue                            | text      | one-line statement                                               |
| comment                          | text      | protocol finding format, <= 4 sentences                          |
| editedComment                    | text null | the person's rewrite at confirm time; the report prefers it       |
| mechanism                        | text      | traced input -> wrong output path (internal, shown in UI)        |
| quotedCode                       | text      | exact lines quoted at verification time                          |
| proofJson                        | text null | the verifier's proof, every step checked (WP-C, D-189)           |
| secondProofJson                  | text null | the second verifier's proof, which agreed (WP-E)                 |
| status                           | text      | candidate, verified, killed, open_question, confirmed, dismissed |
| verificationNote                 | text null | S5 outcome detail                                                |
| killedBy                         | text null | when killed: verification (refuted) or quote_check (D-126)       |
| dismissReason                    | text null | the user's reason, kept for history                               |
| dismissedFrom                    | text null | status when dismissed; open_question is left out unproven (D-190) |
| createdAt, verifiedAt, decidedAt | text      |                                                                  |

Finding status machine:
`candidate -> verified | killed | open_question` (S5, fresh session);
`verified -> confirmed | dismissed` (the maintainer only, S7 UI);
`open_question -> dismissed | verified | killed` (unproven, so never confirmed:
PG-2 (a), D-185; verified again, it can be proven, refuted by the
verifier, or killed by the quotation check failing a proof the verifier
gave, WP-D2).
Killed findings are kept for engine-quality metrics, and listed with their
reasons under the review's run detail (D-97).

### models

Candidate registry, probed not assumed (see 06).
(id PK = full model id as passed to `--model`, e.g. `claude-fable-5[1m]`;
resolvedId text null = id reported back by the probe; family text;
displayName; available int bool null = unknown; contextWindow int null;
profileId text = full-context, chunked, decomposed, mechanical-only;
recommended int bool; sortOrder int; lastProbedAt text null; lastError text
null)

Short aliases (`opus`, `sonnet`) are never stored or passed: an alias is
whatever the CLI calls current for its family, which was the previous
generation when measured on 2.1.71 and is unmeasured on 2.1.301 (06
section 1, D-177). A unit test asserts no registry row and no
composed command uses an alias form.

### settings

(key PK, value JSON, updatedAt): maxConcurrentReviews, stageTimeoutMinutes,
stageMaxBudgetUsd, claudePath and defaultRulesetId (a ruleset's id or null;
one that is not there is refused, deleting a ruleset clears a default
that named it, and one gone from a database older than that reads as none,
D-225), and identities (a list of the git emails that count as the
person's; empty, the default, means `user.email` of their global git
config, read when needed and never stored, D-243).
Those are the whole catalogue; any other key is refused by name. A new
review starts on the model last used, with no setting for it
(`src/lib/models/availability.ts`); the `defaultModel` key was deleted on
purpose (`plans/M4-FINISH-PLAN.md`). The data directory is shown on
Settings without being a setting, and a default engine mode is no longer
owed (`04-UI-DESIGN.md`, Not built yet).

## Deletion rules

Deleting a review deletes its worktree, bundle, logs, and rows (cascade).
Deleting a project requires zero reviews (UI offers bulk-delete first) and
then removes the bare clone. Both are two-step confirmed in the UI, never
cascading silently from a single click.
