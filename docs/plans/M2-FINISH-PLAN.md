# M2 finish plan: T8, T9, and the FG-2 demo, in implementation detail

Status: RATIFIED IMPLEMENTATION PLAN, written 2026-07-30 for the Opus driver.
This document turns execution-order items T8 and T9 plus the FG-2 deliverable
into commit-sized work items with the design decided in advance. The driver
works W1 to W8 in order, one commit each, `./verify.sh` green before every
commit, rows marked DONE here with the commit hash. Questions raised mid-item
follow the standing rule in `EXECUTION-ORDER.md` section 0: pick the
least-surprising option, log it PROPOSED in `../DECISIONS.md`, continue.

Verified starting state (2026-07-30): `stage_executions` and `review_rulesets`
are orphaned tables no code writes; there is no rulesets repository, no
instrumentation file, no way to set `currentStage` without a status
transition, and the stage-to-schema map is private to `engine-runner.ts`.

## 0. The design problem this plan settles: resume

`01-ARCHITECTURE.md` promises "completed stages are never re-run". The
pipeline today is one function that seeds the ledger and runs S1 to S6; run it
twice and it would duplicate ledger rows, re-pay for every completed stage,
and duplicate candidate findings. The plan makes resume exact and cheap with
three mechanisms, chosen so `runReviewPipeline` itself changes as little as
possible:

1. **Checkpointing at the runner boundary.** Every stage request is keyed by
   `(stage, sha256(prompt))`. Prompts are deterministic for a pinned review
   (same inventory, same batches, same numbering), so the key is stable
   across attempts. A wrapper around the engine runner consults
   `stage_executions` before delegating: a stored succeeded output for the
   key is replayed without spawning anything and without re-adding usage; a
   miss runs live. This works unchanged for batched S3, because each batch is
   its own request with its own prompt hash.
2. **Idempotent S0.** If ledger rows already exist for the review, seeding
   (recordChangedFiles, recordSweepHits) is skipped. The inventory is
   deterministic, so the existing rows are the same rows.
3. **Findings wiped on re-entry.** Candidates and their verdicts are derived
   entirely from stage outputs, which are checkpointed. On resume the service
   deletes all findings rows for the review and lets the pipeline recreate
   them by replaying the stored outputs. Hunk and sweep dispositions are
   idempotent set-operations and need no special handling. This avoids every
   duplicate-row hazard between the S3 apply step and the S5 apply step, and
   it is deterministic: the same stored outputs produce the same findings and
   the same verdicts, with the quotation check re-run against the same pinned
   worktree.

Chain sessions survive resume because the CLI persists sessions on disk: the
wrapper primes the engine runner with the sessionId of the most recent
succeeded chained-stage row, so a live S4 after replayed S1-S3 still resumes
the original conversation.

## 1. Work items

### W1. Schema and repository groundwork

Migration 0002 (append-only; databases exist now):

- `stage_executions`: add `prompt_hash` text not null default `""`, add
  `output_json` text null. New index on (`review_id`, `stage`,
  `prompt_hash`).

New repository `src/server/db/repositories/stage-executions.ts`:

- `recordAttempt(db, {reviewId, stage, promptHash, attempt, sessionId,
  status, usage, outputJson?, errorClass?, errorText?, logPath?})` inserting
  one row; timestamps startedAt/endedAt supplied by the caller.
- `latestSucceeded(db, reviewId, stage, promptHash)` returning the newest
  succeeded row with a non-null outputJson, or undefined.
- `latestChainedSession(db, reviewId)` returning the sessionId of the newest
  succeeded row whose stage is one of s1..s4, for priming resume.
- `listForReview(db, reviewId)` ordered by startedAt, for the SSE snapshot
  and the demo's timeline.

Additions to `reviews.ts`:

- `setCurrentStage(db, reviewId, stage | null)`: a plain column write that
  never touches status. Today the only path is through a transition, and a
  stage change mid-`running` is not a status change.
- `deleteFindingsForReview` belongs to findings, not reviews: add
  `deleteAllForReview(db, reviewId)` to `findings.ts` (used only by the
  resume path; the comment must say so, because deleting findings anywhere
  else would violate the human-gatekeeper rule).

New repository `src/server/db/repositories/rulesets.ts` (minimal, enough for
T8 and the snapshot FK; the full manager UI is T15):

- `saveImportedRuleset(db, imported: ImportedRuleset, meta: {name, tier,
  sourceDoc}) -> {rulesetId, version}`: upsert by name; on content change
  bump `version`; replace rules and directives rows inside one transaction
  (`db.transaction`), preserving rule `sortOrder` from the import and the
  unique (rulesetId, code) constraint.
- `loadRuleset(db, rulesetId) -> ImportedRuleset`: inverse mapping, used by
  the snapshot writer and later by T10.
- `writeReviewSnapshot(db, reviewId, rulesetId)`: composes the frozen JSON
  (directives + rules verbatim fields) into `review_rulesets` with the
  ruleset name and version. `readReviewSnapshot(db, reviewId)` parses it
  back into `{directives, rules}` through zod. Resume reads the snapshot and
  never re-imports, which is what makes "editing a ruleset never changes a
  past review" true.

Export `stageSchemaFor(stage)` from `src/lib/review/stage-schemas.ts` and
make `engine-runner.ts` consume it, deleting its private map. The service
needs the same map to build output contracts, and two copies would drift.

Tests: repository round-trips; saveImportedRuleset bumps version only on
content change; snapshot read-back equals what was written; a second
`recordAttempt` for the same key increments attempt numbering via
`latestSucceeded` semantics (assert replay picks the newest).

### W2. Fake CLI: scripted pipelines and injected failures

The service tests and the demo's `--fake` mode need the fake to answer a
whole pipeline, not one call, and to fail on demand at a chosen point.

Extend `tests/fixtures/fake-claude.mjs` with one new scenario, `script`:

- `FAKE_CLAUDE_DIR`: a directory containing `001.json`, `002.json`, ... The
  Nth invocation (counter file in `FAKE_CLAUDE_COUNTER`, already supported)
  emits `resultEvent({result: contents of the Nth file})`. Missing file:
  exit 2 with a message naming the call number, so an unexpected extra call
  fails loudly instead of hanging.
- `FAKE_CLAUDE_FAIL_AT=<n>`: on call n, print the usage-limit message to
  stderr and exit 1 (the `limit-reached` behaviour), without consuming the
  file. The next call after a resume gets file n. This is what drives the
  pause/resume tests deterministically.

New shared helper `tests/helpers/ideal-answers.ts`: extract the
manifest-driven reviewer logic from `quality-gate.test.ts` into
`buildIdealStageOutputs({files, manifest, worktreeRoot, protocol})`
returning the ordered stage outputs (s1, s2, s3, s4, s5) as plain objects,
plus `writeAnswersDir(dir, outputs)` that materialises them as numbered JSON
files for the fake. The quality gate keeps its in-process runner but builds
its answers through the same helper, so the two cannot drift. The s5 output
needs candidate ids it cannot know in advance; the helper emits verdicts
keyed by (path, lineStart) and a small adapter maps them to findingIds at
runtime for the in-process runner, while the file-based fake path uses the
service test's knowledge that verification prompts embed candidates as JSON:
for the scripted fake, s5's file contains verdicts with a `findingId` of
`"BY_LINE"` and the service-side test asserts on outcomes, not ids. Keep
this adapter inside the helper with a comment; it is test plumbing, not
product behaviour.

Tests: a script-mode smoke (three calls, three files, counter advances);
fail-at emits the limit error exactly once and then continues the sequence.

### W3. The checkpointing runner

New `src/server/review/checkpointing-runner.ts`:

- `createCheckpointingRunner({db, reviewId, inner: ReviewEngine['run'],
  onLiveAttempt}) -> StageRunner`.
- On each request: compute `promptHash = sha256(stage + "\n" + prompt)`
  (node:crypto). Look up `latestSucceeded`; on hit, return
  `{output: JSON.parse(outputJson), sessionId, usage: undefined}` and do NOT
  call `onLiveAttempt`; replays are free and must not inflate usage.
- On miss: `startedAt = now`, delegate to `inner`. The engine runner reports
  per-attempt usage through its existing `onStageComplete`; the wrapper is
  the single writer of rows. On success: one row per reported attempt, the
  final one `succeeded` with `outputJson` and the response usage, earlier
  ones `failed` with errorClass `invalid_output` (they were the repair
  round's rejected attempts). On thrown `StageFailedError` or
  `StageOutputUnreadableError`: rows for reported attempts, final row
  `failed` with the error's class, message, and logPath. Rethrow.
- Resume priming: before the first live chained-stage call, if the engine
  runner has no chain session, pass `resumeSessionId` from
  `latestChainedSession`. Concretely: the wrapper sets
  `request.resumeSessionId ??= latestChainedSession(...)` for s1..s4
  requests. The engine runner already prefers an explicit resumeSessionId.

Tests (fake CLI, json-result and script scenarios): a second identical
request replays without invoking the fake (counter file proves no spawn);
usage recorded once; a changed prompt is a miss; failed attempts leave rows
with the right classes; after simulating a restart (new wrapper over the
same db), a chained stage resumes with the recorded sessionId (assert via
FAKE_CLAUDE_RECORD argv).

### W4. The review service

New `src/server/review/service.ts`. One exported entry point and two
lifecycle helpers; everything else private.

`prepareAndRun(db, reviewId, options)` where options carries
`{claudePath?, signal?, onEvent?, onStageLifecycle?}`:

1. Load the review; require status `draft`, `paused_limit`, or
   `interrupted`. Transition to `running` (setCurrentStage null) via the
   state machine; `paused_limit/interrupted -> running` is already legal.
2. Resolve projects (primary, linked if `linkedProjectId`). Fetch both bare
   clones (`fetchAll`), writing `lastFetchedAt`. This fetch keeps the pinned
   commits reachable after a prune or a restart; it deliberately does not
   re-pin (D-28). Re-resolve every pinned commit with `resolveCommit`; a
   commit that no longer resolves fails the run with a message naming it.
   Nothing re-pins: the review describes the commits it was created with.
   Freshness is guaranteed one step earlier instead, at creation, where the
   draft pins from refs fetched moments before (D-27); that is the only
   place a tip may move, and T10 owns it.
3. Slugs: `repoSlug(project.name)` for each side; if equal, suffix the
   linked one with `-dep` (deterministic, recorded in a run note).
4. Ensure worktrees: for each side, if `worktreeRepoDir` is missing,
   `addWorktree(clone, dir, pinnedCommit)`. Present-but-wrong-commit
   (checked with `worktreeCommit`) is removed and re-added; a worktree is
   disposable, the pin is not.
5. Ensure bundle: rebuild with `buildBundle` if `inventory.json` is absent.
   Deterministic, so rebuild-if-missing is safe. Read `links.json` package
   name from the project_links row each time rather than trusting the file.
6. Ruleset: if `review_rulesets` has no row for this review, the caller must
   have supplied `options.ruleset: {imported, name, tier, sourceDoc}`; save
   it (W1) and write the snapshot. Then, always, `readReviewSnapshot` and
   use ONLY the snapshot from here on.
7. Resume hygiene: `deleteAllForReview(findings)` (section 0.3), then run.
8. Build the engine runner (model from the review row, timeout =
   `stageTimeoutMinutes` setting, default 20 minutes; claudePath from
   `options.claudePath ?? process.env.TRYSQUARE_CLAUDE_PATH`; logsDir under
   the run dir; onEvent forwarded). Wrap with the checkpointing runner.
   `contextWindow` comes from the models registry row for the review's model
   when its availability is current; otherwise undefined, and the pipeline's
   no-window behaviour applies.
9. `systemPromptFor(stage, batch)`: `composeSystemPrompt` with the
   snapshot's directives, `batch?.rules ?? snapshot.rules`,
   `includeFullRules: stage === "s3_adversarial"`, and
   `outputContractFor(stageSchemaFor(stage))`.
10. Stage lifecycle: the wrapper's live-attempt callback drives
    `setCurrentStage` and, when the stage is `s5_verification`, the
    `running -> verifying` transition (only if still `running`: a replayed
    s5 during resume may mean the review is already `verifying`).
    `onStageLifecycle` is also forwarded to the caller for the bus.
11. Run `runReviewPipeline`. On success: `assertWorktreeClean` on every
    worktree, append a run note summarising the result counts, transition
    `verifying -> awaiting_confirmation`, return the PipelineResult.
12. Failure mapping, in one catch: errorClass `limit` -> transition to
    `paused_limit` with pausedReason = the error message plus the reset time
    when the engine surfaced one; `cancelled` -> `cancelled`; everything
    else -> `failed` with a run note carrying message and logPath. Usage
    already accumulated per live attempt via `addReviewUsage` in the
    wrapper's row writer. Rethrow nothing; return a discriminated outcome
    `{kind: "completed" | "paused" | "cancelled" | "failed", ...}` so the
    manager does not parse exceptions.

`removeReviewArtifacts(db, reviewId)`: remove worktrees through
`removeWorktree` (both sides), then `rm` the run directory. Called on the
terminal transitions (complete, cancelled, failed) per D-12, and by delete.

`deleteReviewEntirely(db, reviewId)`: artifacts, then `deleteReview` row
cascade. Refuses while status is running/verifying (cancel first).

Tests (real git fixtures via build-seeded-repos, fake CLI in script mode,
temp TRYSQUARE_DATA): the nine scenarios listed in EXECUTION-ORDER T8/T9
proofs, of which W4 covers: happy path status walk with stage rows and
usage; pinned-commit-missing failure; worktree recreated at the pin;
worktree-dirty failure; snapshot governs resume (edit the ruleset rows after
start, resume, assert the prompt still carries the old text via
FAKE_CLAUDE_RECORD of a live stage).

### W5. Pause, resume, and determinism proofs

First, the defect W4 found and recorded: a resumed review re-asks the
verification stage, because candidates are recreated with fresh ids and the
verification prompt embeds them, so its prompt hash moves. Fix it by keying
the verification contract on place in the code (path and line range) rather
than on a candidate id, which is the shape the fake CLI and the ideal-answers
helper already use, and which removes the dependency on id stability
altogether. The existing test that records the current behaviour flips to
asserting that every stage replays and that a fully resumed run makes no
model call at all.

Service-level tests that exercise section 0 end to end, all with
`FAKE_CLAUDE_FAIL_AT`:

- Limit at S3: run -> `paused_limit`, pausedReason contains the CLI's
  message. Resume: completes; the counter file proves the number of live
  calls after resume equals the remaining stages only; `usageInputTokens`
  equals the sum over live attempts with no double count (fake reports fixed
  usage per call, so the expected total is computable exactly).
- Limit at S5: candidates existed before the pause; resume wipes and
  recreates them; final finding set (path, line, status) equals a
  straight-through run's set, field for field.
- Interrupted: force the row to `running` via transitions, call
  `markOrphanedReviewsInterrupted` (as instrumentation will), resume,
  complete.
- Cancel: signal aborts a `hang` scenario; status `cancelled`; artifacts
  removed per D-12.

### W6. The job manager and the event bus

New `src/server/jobs/bus.ts`: a per-review event emitter with types
`{kind: "status", status, pausedReason?} | {kind: "stage", stage, phase:
"started" | "replayed" | "finished" | "failed", attempt?, usage?} |
{kind: "engine", stage, event: "tool-use" | "text", detail} |
{kind: "rate-limit", status, resetsAt?} | {kind: "note", note} |
{kind: "done", outcome}`. Durable facts (status, stage rows, notes, usage)
are persisted by the service and wrapper BEFORE the bus emits them; the bus
carries no state a restart would need.

New `src/server/jobs/manager.ts`:

- Singleton stored under a `globalThis` symbol so Next dev hot reload does
  not spawn a second manager (`const KEY = Symbol.for("trysquare.jobs")`).
- `init({db, dataDir})`: run migrations, `markOrphanedReviewsInterrupted`,
  seed `DEFAULT_MODEL_CANDIDATES` (registerCandidate is conflict-free), and
  kick a background non-blocking probe of stale models. Called from
  `src/instrumentation.ts` (`register()`), which is the file Next runs once
  per server start.
- `start(reviewId, options?)`: if a review is running, enqueue (in-memory
  FIFO; on restart the queue is empty and drafts stay drafts, which is
  acceptable for a local single-user tool and recorded as such); else mark
  active, create an AbortController, subscribe the service callbacks to the
  bus, run `prepareAndRun` on a floating promise with a final `.then` that
  releases the slot and starts the next queued review. Concurrency cap from
  `maxConcurrentReviews` setting, default 1.
- `cancel(reviewId)`: abort the controller; the service maps it to
  `cancelled`.
- `resume(reviewId)`: same as start; the service validates the status.
- `subscribe(reviewId, listener) -> unsubscribe`; `snapshot(reviewId)`
  assembling review row + stage executions + run notes + finding counts for
  the SSE hello and the polling fallback.

SSE route `src/app/api/reviews/[id]/events/route.ts`:

- `GET` returns a `ReadableStream` with `Content-Type: text/event-stream`.
  First frame: `event: snapshot` with `manager.snapshot()`. Then bus events
  as `event: update`. A comment-line heartbeat every 15 seconds keeps
  proxies from closing the stream. `request.signal` abort unsubscribes.
  Runs in the Node runtime (`export const runtime = "nodejs"`).

Tests: manager queue order with two reviews (fake, fast scripts); cancel
mid-run; init recovers orphans; bus receives status/stage/done events in
order and after the rows exist (subscribe, then read db inside the listener
and assert the row is already there); SSE handler invoked directly with a
Request whose signal is aborted mid-stream stops cleanly, and its first
frame parses as the snapshot.

### W7. The FG-2 demo script

New `scripts/demo-fixture.ts`, npm script `"demo:fixture": "tsx
scripts/demo-fixture.ts"`.

Step zero of this work item, before anything else: prove tsx resolves the
`@/` alias by running a one-line script importing `@/lib/ids`. If it does
not, the fallback (decided now, not asked later) is a dedicated
`tsconfig.scripts.json` with the same paths compiled by `tsc` to
`dist-scripts/` and run with plain node; the npm script changes, nothing
else does.

Flags: `--model <id>` (default `claude-haiku-4-5-20251001` per D-18),
`--fake` (route through the fake CLI in script mode with ideal answers, so
the whole demo is provable free), `--keep` (do not delete the temp data
dir).

Sequence:

1. Temp `TRYSQUARE_DATA`; open db; `manager.init`.
2. Build seeded repos (tmp); create both projects with `cloneBare` from the
   local fixture paths (file URLs are accepted by the validator); link the
   dependency with packageName `@acme/shared-core`.
3. Import `tests/fixtures/example-protocol.md`, save as ruleset
   ("Example protocol", tier global).
4. Unless `--fake`: probe the chosen model; abort with a clear message if
   unavailable or indeterminate, printing the probe error. Record the
   context window.
5. Create the linked review (pinned commits from the clones, model,
   profile from the model's registry row or `full-context` for fable/1m).
6. Subscribe to the bus and render live: one line per stage
   (started/replayed/finished, duration, tokens), tool-use lines indented,
   rate-limit warnings loud, run notes as they land.
7. `manager.start` and await the outcome.
8. Outcome table, computed against the manifest: for each defect, FOUND
   (verified finding at the file with line within 2) or MISSED; false
   positives (verified findings in clean files); killed-by-quote-check
   count; open questions; total tokens, cost-equivalent, wall time.
9. Write the table and the full event log to `review/<UTC date>-fg2/`
   (gitignored directory, per repo convention).
10. Exit code: 0 if the pipeline completed (whatever the model found), 1 on
    pause/cancel/failure. Finding quality is FG-2's human judgement, not an
    exit code, and the haiku default is a plumbing smoke, not a quality
    claim (D-18).

Proof for the commit: `npm run demo:fixture -- --fake` output captured in
the commit message showing 8/8 found with the ideal answers; a real haiku
run captured into `review/` by the driver.

### W8. Records and gate prep

Update `PROJECT-STATE.md`, mark T8/T9 DONE in `EXECUTION-ORDER.md` with
hashes, append the decisions below to `DECISIONS.md`, update `GATES.md` G1
row evidence with the fake-run numbers, and write the FG-2 checklist for the
maintainer at the top of the demo output directory:

- Run `npm run demo:fixture` (haiku smoke; a few cents equivalent).
- Run `npm run demo:fixture -- --model "claude-fable-5[1m]"` for the
  quality look. Judge: defects found, wording of findings, false-positive
  rate, cost, wall time.
- Verdict on G1 in `GATES.md`: pass, or name what must change. Prompt
  wording changes go through T18's rule: fake gate first, then re-run.

## 2. Commit map

| W  | Contents                                                    | Depends on | Status |
| -- | ----------------------------------------------------------- | ---------- | ------ |
| W1 | migrations 0002-0003, stage-executions and rulesets repositories, setCurrentStage, deleteAllForReview, stageSchemaFor export | -          | DONE   |
| W2 | fake CLI script mode and FAIL_AT, ideal-answers helper, quality-gate refactor onto it | -          | DONE   |
| W3 | checkpointing runner and its tests                          | W1, W2     | DONE   |
| W4 | review service, artifact lifecycle, its tests               | W1, W2, W3 | DONE   |
| W5 | pause/resume/cancel determinism tests                       | W4         | DONE   |
| W6 | bus, manager, instrumentation, SSE route, tests             | W4         | DONE   |
| W7 | demo script, tsx alias proof, npm script                    | W2, W6     | DONE   |
| W8 | docs, gate evidence, FG-2 checklist                         | W7         |        |

## 3. Decisions fixed by this plan (append to DECISIONS.md as work lands)

- D-21 Resume replays checkpointed stage outputs keyed by
  `(stage, sha256(prompt))` from `stage_executions.output_json`; replayed
  stages add no usage. Findings are wiped and deterministically recreated on
  re-entry, because every finding is derived from checkpointed outputs and
  wiping avoids all duplicate-row hazards without touching the pipeline.
- D-22 The checkpointing wrapper is the only writer of `stage_executions`
  rows; the engine runner only reports attempts. One writer, no drift.
- D-23 The ruleset snapshot is written at first start and is the only thing
  a resume reads; the live ruleset tables are never consulted mid-review.
- D-24 The in-memory start queue does not survive a restart: drafts stay
  drafts and are restarted by the user. A durable queue is not worth its
  complexity for a local single-user tool; revisit only if FG-3 shows
  otherwise.
- D-25 The manager singleton lives on a `globalThis` symbol so Next dev hot
  reload cannot create two managers with two queues.
- D-26 The demo's exit code reflects pipeline completion, never finding
  quality. Quality is the founder gate's judgement, made on the fable run.

## 4. Risks, named

- tsx alias resolution is unproven for scripts (an earlier attempt failed in
  /tmp). W7 step zero proves it or falls back to compiled scripts; neither
  outcome blocks anything else.
- Session resume across a real process restart is assumed to work because
  the CLI persists sessions; W3's test proves the argv, and the first real
  FG-2 run proves the behaviour. If the CLI declines a stale session, the
  engine falls back to a fresh one (the runner already treats
  resumeSessionId as optional); the cost is a re-derived context, not a
  wrong result.
- The demo's haiku default may produce a weak review. That is expected and
  stated in its output header; it is a plumbing smoke (D-18, D-26).
