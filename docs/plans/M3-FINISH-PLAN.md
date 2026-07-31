# M3 finish plan: the usable app, to commit level

Status: RATIFIED IMPLEMENTATION PLAN, written 2026-07-31 for the Opus driver.
This document turns the remainder of milestone M3 (execution-order items T10
to T17, plus the W8 leftovers from `M2-FINISH-PLAN.md`) into commit-sized
work items with the design decided in advance. The driver works V1 to V9 in
order, one commit each, `./verify.sh` green before every commit, rows marked
DONE here with the commit hash. Questions raised mid-item follow the standing
rule in `EXECUTION-ORDER.md` section 0: pick the least-surprising option, log
it PROPOSED in `../DECISIONS.md`, continue.

## Verified starting state (2026-07-31, checked against the live tree)

What exists: the full review engine (pipeline, checkpointing resume, service,
job manager, bus, SSE), the demo script, and a first UI pass (projects list,
new review, live review page, reviews list, rulesets import, settings
read-only) over a partial HTTP layer (projects, branches, reviews create and
start and cancel, rulesets list and import, models list, events).

Defects and gaps, each verified by reading or running the code, not recalled:

- `src/app/projects/[id]/` is an empty directory: the project name link on
  the projects list 404s.
- `buildStageArgs` supports `--max-budget-usd` and nothing ever sets it. No
  spend ceiling exists anywhere.
- On 2026-07-31 a manual UI test spent about 0.50 USD-equivalent because
  `TRYSQUARE_CLAUDE_PATH` did not reach the server process and the engine
  silently used the real CLI. Nothing surfaced which binary a run used.
- `removeReviewWorktrees` exists and nothing calls it on any terminal
  transition, so worktrees accumulate. D-12 requires removal on
  `complete`, `cancelled` and `failed` only, because the confirmation
  screen reads file context from the worktree while awaiting confirmation.
- Findings confirm and dismiss exist as repository functions
  (`confirmFinding`, `dismissFinding`, dismissal already refuses an empty
  reason) with no routes and no UI. There is no
  `awaiting_confirmation -> complete` path anywhere. The human gatekeeper,
  the product's core promise, is not yet drivable.
- No report renderer (`src/lib/review/report.ts` does not exist), no export.
- No pre-flight, no linked-project toggle on the new-review screen.
- `rules.enabled` exists in the schema, is written as `true` on import, and
  nothing reads it. No rulesets manager beyond import and list.
- `SETTING_KEYS` is referenced nowhere outside its declaration: no settings
  read or write path, no editor.
- `probeModel` and `readAuthStatus` are called only by the demo script.
  Models in the picker are all availability `unknown`.
- Merged detection (D-19): `mergedDetectedAt` column exists, nothing sets it.
- No review deletion route or UI; `deleteReviewEntirely` exists unused.
- `e2e/` contains nothing; `playwright.config.ts` exists. CI runs
  `./verify.sh --build`, without `--e2e`, which D-20 says CI must run.
- `src/app/api/projects/[id]/fetch/` is an empty directory.
- The review page accumulates its Activity lines in state without bound.

## 0. The two problems this plan settles

**Spend safety.** The incident above is the design input: nothing may spend
model usage except an explicit user action (starting a review, pressing a
probe button, running the demo without `--fake`), every run must say which
engine binary it used, and every stage call carries a budget ceiling. These
are V1 and they land before any more surface area does.

**The confirmation loop.** The app's founding requirement is that a human
confirms every finding before the report exists. That loop (confirm, dismiss
with reason, complete, report, export) is V2 and V5, and it fixes the
lifecycle consequence D-12 already decided: the worktree survives until the
human is done with it, and not a transition longer.

## 1. Work items

### V1. Spend safety and shipped-defect sweep

- Settings catalogue gains `stageMaxBudgetUsd`, default 15, meaning
  USD-equivalent per engine call. The service reads it
  (`readSettingOr(db, SETTING_KEYS.stageMaxBudgetUsd, z.number().nonnegative(), 15)`)
  and passes it to the engine runner, which passes `maxBudgetUsd` to
  `buildStageArgs` on both call sites (initial and repair). A value of 0
  disables the flag entirely. Tests: recorded argv contains
  `--max-budget-usd 15` by default; setting 0 omits the flag; mutation
  check: dropping the pass-through fails the argv test.
- Engine transparency: at the start of every run the service appends a run
  note naming the engine binary (`options.claudePath ?? TRYSQUARE_CLAUDE_PATH
  ?? "claude on PATH"`), the model and the effort. The note reaches the
  review page through the existing note event and snapshot. Test: the
  service test asserts the note names the fake CLI path.
- Probing policy: no automatic probes, ever. `manager.init` keeps
  registering candidates and never probes them. Probing happens only from a
  button (V6 settings, V4 picker hint). Recorded as a decision with the
  incident as the reason.
- Worktree cleanup per D-12: after the service settles `cancelled` or
  `failed`, call `removeReviewWorktrees` best-effort (a failure appends a
  run note, never masks the outcome). `complete` does the same in V2. Not
  on `paused_limit`, `interrupted` or `awaiting_confirmation`. Tests:
  cancelled run's worktree directory is gone and its bundle remains; a
  paused run's worktree remains.
- Remove the dead `/projects/[id]` link (plain text until V3 builds the
  page). Delete nothing else.
- Cap the review page's stored Activity lines at 200.

### V2. The confirmation flow (T13 core)

Routes:

- `POST /api/findings/[id]/confirm` -> `confirmFinding`, returns the
  updated finding.
- `POST /api/findings/[id]/dismiss` with `{reason: string}` (zod `min(1)`;
  the repository refuses an empty reason anyway), returns the finding.
- `POST /api/reviews/[id]/complete`: requires status
  `awaiting_confirmation` and zero findings still in `verified` or
  `open_question`; otherwise 409 with the undecided count in the message.
  On success: transition to `complete`, `removeReviewWorktrees`, return the
  snapshot.
- `GET /api/reviews/[id]/context?path=...&line=...`: 20 lines either side
  of the cited line, read from the worktree, with line numbers. Guards: the
  path must be the `filePath` of one of this review's findings (no
  arbitrary reads), and the review must be `awaiting_confirmation` (the
  only status whose worktree is guaranteed present, D-12). 404 with a plain
  message otherwise.

UI, on the review page when status is `awaiting_confirmation`:

- The findings list becomes the confirmation queue. One card is selected;
  keyboard per D-16: `j`/`k` next and previous, `c` confirm, `d` dismiss
  (focuses the reason input), `enter` toggles file context, `g g` and `G`
  top and bottom. Keys are ignored while the reason input has focus except
  Escape. A footer hint bar lists the keys.
- Each card: Confirm button, Dismiss with an inline reason input (submit
  disabled until non-empty), and an expandable context block fetched from
  the context route with the cited lines marked.
- Decided cards collapse to one row with a confirmed or dismissed badge and
  the dismissal reason.
- Header: "N of M decided". A primary "Complete review" button enables at
  M of M and calls the complete route.

Tests: route tests for confirm, dismiss (empty reason refused), complete
(refuses with undecided count; removes worktrees; keeps bundle), context
(refuses a path that is not a finding's, refuses when not awaiting
confirmation); an API-level walk of the whole loop over the seeded fixture:
run with the fake, confirm some, dismiss one with a reason, complete, assert
`complete` status and finding statuses.

### V3. Project detail, links, delete, fetch-now

Page `/projects/[id]` (restores the V1-removed link):

- Header: name, origin URL, clone state, last fetched, fetch-now button.
- Branches: the branches endpoint rendered as a filterable table (name,
  ahead/behind against the default branch, subject, committed date), each
  row with a "Review" action linking `/reviews/new?projectId=...&fromBranch=...`
  (the new-review screen reads the prefill).
- Reviews: this project's reviews, linking to their pages.
- Dependencies: existing links as chips (name + packageName), remove
  action, and an add form (select over other `ready` projects, package name
  input). Errors from `linkDependency` shown verbatim.
- Delete: two-step inline confirm. Refused with the count when reviews
  reference the project (`ProjectHasReviewsError` -> 409); on success the
  route also removes the clone directory (`removeRepo`), because the row
  and the clone must not outlive each other in either direction.

Routes: `POST /api/projects/[id]/fetch` (fills the empty directory:
`fetchAll` + `recordFetch`, returns `lastFetchedAt`, git errors verbatim),
`POST /api/projects/[id]/links`, `DELETE /api/projects/[id]/links/[linkId]`,
`DELETE /api/projects/[id]`.

Tests: fetch updates `lastFetchedAt`; delete refused while reviews exist and
removes the clone directory when allowed; link add validates through the
repository's own errors; prefill read by the new-review screen (component
logic test).

### V4. Pre-flight and the linked toggle (T12 remainder)

Route `POST /api/reviews/preflight` with the same body shape as review
creation minus effort and intent. It is read-only and free: git only, no
model calls, no rows written. Sequence: fetch both sides, resolve the pins,
diff and parse in memory, then return:

- Pinned commits with branch subjects and the fetch time (D-27 visibility:
  the screen shows exactly what would be reviewed and how fresh the refs
  are).
- File and hunk counts per side; changed exported symbols for the linked
  side.
- Sweep hit count from `runSweeps` with the chosen ruleset's rules, plus
  any sweep problems verbatim.
- Token estimate: `estimateTokens` over the composed adversarial system
  prompt and full prompt, against the model's registry `contextWindow` when
  its probe is current, with `null` otherwise and a plain sentence in the
  UI ("window unknown until this model is probed; the review will run
  unsplit").
- Estimated request count: `planRuleBatches(...).batches.length`, split
  further with `splitToFit` only when a window is known.

UI: the panel renders automatically once from-branch, into-branch, ruleset
and model are all chosen, with a refresh action. Creation still re-fetches
and re-pins (D-27); the panel says "pins are retaken when the review
starts" so the numbers are advisory, the start is authoritative.

Linked toggle: when the project has dependency links, one toggle per link
("Include shared-core (@acme/shared-core)"), never auto-enabled. When the
dependency has a branch with the same name as the chosen from-branch, that
branch is preselected and tagged "suggested". Enabling adds the dependency's
from and into pickers (branches endpoint for the dependency project) and
extends the pre-flight body.

Tests: preflight route against the seeded fixture (file count matches the
parsed diff, sweep hits non-zero, linked symbols include `Prefs`, estimate
positive); the same-name suggestion as a pure helper test; creation with
`linked` already covered.

### V5. Report renderer and export (T11)

`src/lib/review/report.ts`, pure. A server assembler
(`buildReportInput(db, reviewId)`) gathers: review row and project names,
confirmed findings (all of them, NITPICKs included, D-11), dismissed
findings with reasons, `coverageReport` totals, ledger chain-files-read
count, snapshot ruleset name and version, usage including cached tokens,
wall time from `createdAt` to `completedAt`.

Format is the app's fixed rendering of the example protocol's "Finding
Format" and "Review Output" sections: summary line; a completeness statement
("reviewed N files, M hunks, K sweep hits, all dispositioned; C chain files
read") so the reader can tell nothing-wrong from nothing-looked-at; findings
grouped by severity, most severe first, each with file:line, rule code,
issue, comment, mechanism and the byte-checked quotation; open questions;
an appendix of dismissed findings with their reasons (the human record);
footer with model, effort, profile, ruleset name and version, pinned
commits (both sides when linked), usage, wall time. A protocol's own prose
format section is not parsed: rendering arbitrary prose instructions is not
tractable and would make the report depend on prompt-shaped text. No em
dashes in output (unit-tested), no emojis.

Routes: `GET /api/reviews/[id]/report` -> `{markdown}` (requires status
`complete`); `POST /api/reviews/[id]/export` writes
`exports/<project-slug>--<from>--into--<to>--<UTC date>.md` per D-17
(slashes in branch names become hyphens), returns `{path, markdown}`.
Exports live outside the run directory on purpose: deleting a review keeps
the reports it produced.

UI: when complete, a Report section renders the markdown in a monospace
block with Copy and Export actions, the export answering with the written
path.

Tests: snapshot-style tests from a seeded database with volatile fields
(ids, dates, paths) normalised; the no-em-dash test; export filename shape;
report route refuses a review that is not complete.

### V6. Lifecycle polish and settings (T9/T10 remainder)

- Resume: the review page shows a Resume button on `paused_limit` and
  `interrupted` (POST start; the snapshot exists so no ruleset is needed),
  with the recorded `pausedReason` beside it.
- Queued visibility: list rows and the review page show a queued badge from
  the snapshot; cancel on a queued review dequeues it (already true; the UI
  says so).
- Merged detection (D-19): a `setMergedDetected` repository write; on
  `GET /api/reviews` and `GET /api/reviews/[id]`, for reviews with
  `mergedDetectedAt` null in statuses `awaiting_confirmation`, `complete`,
  `paused_limit` or `interrupted`, run `isAncestor(fromCommit, intoBranch)`
  against the project clone and set the column when true. UI: a "merged"
  badge and the sentence "this branch has merged; the review can be
  deleted". Nothing auto-deletes.
- Deletion: `DELETE /api/reviews/[id]` -> `deleteReviewEntirely` (409 while
  running or verifying). Two-step inline confirm on the review page.
- Settings editor: `GET /api/settings` and `PUT /api/settings` accepting
  only catalogued keys, each validated by its own zod schema
  (`stageTimeoutMinutes` positive int, `maxConcurrentReviews` positive int,
  `stageMaxBudgetUsd` nonnegative number). The settings page gains a small
  form for the three, plus an auth card with a "Check" button calling
  `readAuthStatus` (runs `claude auth status` locally, no tokens) showing
  subscription versus API-key state, with a plain warning when an API key
  would be billed.
- Models: a probe button per model row and "probe all" (each an explicit
  click, V1's policy), updating availability, window and probe age.

Tests: merged detection with a fixture where the branch genuinely merged;
delete refused while active; settings PUT rejects an uncatalogued key and a
negative timeout; resume walk already covered at service level, route test
confirms the wiring.

### V7. Rulesets manager slice (T15)

- `GET /api/rulesets/[id]`: the row, its rules (parsed fields plus
  `enabled`), directive count.
- `PATCH /api/rulesets/[id]/rules/[code]` with `{enabled: boolean}`: flips
  the flag and bumps the ruleset version, because a review's frozen
  snapshot names the version and a silent toggle would make two different
  rule sets share a name.
- `writeReviewSnapshot` stores only enabled rules from this item on. The
  frozen-snapshot property is already tested; add: disable a rule, start a
  new review, the composed prompt (recorded argv) lacks that rule's text
  and the sweep skips its patterns; a review frozen before the toggle is
  unaffected.
- `GET /api/rulesets/[id]/export`: `exportProtocol`, byte-exact (the
  verbatim markdown is stored), served as a download. Export always emits
  the full document including disabled rules: the document is the document;
  enabling is a per-app choice layered on it.
- UI: `/rulesets/[id]` with the rule table (code, title, severity, tags,
  sweep pattern count, enabled toggle), directives collapsed, export
  action. The new-review ruleset select links here as the preview (a link,
  not the drawer docs/04 sketched: at one ruleset screen of this size a
  drawer duplicates a page that already exists; recorded as a decision).

### V8. E2e, screenshots, design audit, CI (T16/T17 slice)

- Playwright, against a production build: `webServer` runs
  `npm run build && npm run start` on a spare port with `TRYSQUARE_DATA`
  pointed at a temp directory and `TRYSQUARE_CLAUDE_PATH` at the fake CLI,
  script-mode answers built in global setup from the seeded fixture through
  `tests/helpers` (Playwright executes TypeScript directly).
- One journey spec: empty projects state, add the fixture by `file://` URL,
  clone completes, project detail, import the example protocol, new review
  with intent and visible pre-flight, start, live page reaches
  `awaiting_confirmation`, keyboard-confirm the findings (one dismissed
  with a reason), complete, report visible, export answers with a path.
  Assertions on real text, not screenshot diffing.
- Screenshots of every screen in both themes (two Playwright projects with
  `colorScheme` light and dark) into `review/<UTC date>-e2e/`, which is
  gitignored evidence per repo convention.
- Design audit, executed and fixed in the same item: loading, empty, error
  and long-content states on every screen; focus order and visible focus;
  `aria-current` on the rail; reduced-motion honoured; wide content scrolls
  inside its container, the page never horizontally; copy pass against
  `AI-ANTIPATTERNS.md`; per-page titles.
- CI: the workflow becomes `./verify.sh --build --e2e` with a
  `npx playwright install --with-deps chromium` step (D-20 says CI runs
  e2e; local default stays fast).

### V9. Records, gate evidence, FG-2 (the former W8)

- `docs/PROJECT-STATE.md` rewritten to the current truth: stack and
  versions, directory layout, routes, screens, env vars (`TRYSQUARE_DATA`,
  `TRYSQUARE_CLAUDE_PATH`), settings catalogue, migrations 0000 to 0007
  plus any added since, test counts, commands. Stale records are bugs.
- `docs/README.md` indexes this plan and the FG-2 checklist.
  `EXECUTION-ORDER.md` progress table updated to match reality.
- `docs/plans/FG2-CHECKLIST.md`: what the maintainer judges (defects found
  and missed against the manifest, false positives in the clean files,
  quote-check kills, the S3 log read for prompt quality, cost-equivalent
  and wall time) and where the evidence lives (`review/<date>-fg2/`).
- FG-2 evidence: the `--fake` run is captured free. The real haiku smoke is
  run only after the maintainer says go, and the fable run is the
  maintainer's own; both append their score directories. `docs/GATES.md`
  gains the G1 row with evidence links, verdict left to the human.

## 2. Commit map

| V  | Contents                                                     | Depends on | Status |
| -- | ------------------------------------------------------------ | ---------- | ------ |
| V1 | budget cap, engine note, no-auto-probe, worktree cleanup, 404 unlink, activity cap | -          | DONE   |
| V2 | confirm/dismiss/complete/context routes, confirmation UI, keyboard map | V1         | DONE   |
| V3 | project detail page, fetch-now, links CRUD, project delete    | V1         | DONE   |
| V4 | preflight route and panel, linked toggle with suggestion      | V3         | DONE   |
| V5 | report renderer, report/export routes, report UI              | V2         | DONE   |
| V6 | resume/queued/merged/delete UI, settings editor, probe buttons | V2         |        |
| V7 | rulesets detail, enable toggle, snapshot filter, export       | V1         |        |
| V8 | e2e journey, theme screenshots, design audit, CI --e2e        | V2-V7      |        |
| V9 | PROJECT-STATE, indexes, FG-2 checklist and evidence, G1 row   | V8         |        |

## 3. Decisions fixed by this plan (append to DECISIONS.md as work lands)

- D-30 Every engine call carries `--max-budget-usd` from the
  `stageMaxBudgetUsd` setting, default 15 USD-equivalent; 0 disables. A
  runaway stage is bounded even when nothing else goes wrong.
- D-31 Nothing spends model usage without an explicit user action: starting
  a review, pressing a probe button, or running the demo without `--fake`.
  No automatic probing at startup or anywhere else. Reason: the 2026-07-31
  incident where a manual test silently used the real CLI and spent about
  0.50 USD-equivalent.
- D-32 Every run records which engine binary it used as a run note, so a
  fake-versus-real mixup is visible in the UI and the evidence, not
  discovered from token counts.
- D-33 Worktrees are removed on `complete`, `cancelled` and `failed` only,
  implemented in the service (cancelled, failed) and the complete route
  (complete). The confirmation screen reads file context from the worktree,
  so `awaiting_confirmation` keeps it (D-12 as implemented).
- D-34 Dismissing a finding requires a reason; confirming does not. The
  reason is the record of why something was judged not a problem.
- D-35 A review completes only when every finding is decided. The complete
  route refuses otherwise, with the undecided count. The human gatekeeper
  is enforced by the server, not by UI state.
- D-36 The file-context endpoint serves only paths that belong to the
  review's findings, and only while the review awaits confirmation.
- D-37 Pre-flight is free and read-only: git only, no model calls, nothing
  written. Its pins are advisory; creation re-fetches and re-pins (D-27).
- D-38 The report is the app's fixed rendering of the protocol's finding
  format. A protocol's prose format section is not parsed. Confirmed
  NITPICKs are included (D-11); dismissed findings appear in an appendix
  with their reasons.
- D-39 Exports live outside the run directory and survive review deletion.
  Filename per D-17.
- D-40 Toggling a rule's enabled flag bumps the ruleset version, snapshots
  store only enabled rules, and export always emits the full document
  including disabled rules.
- D-41 Merged detection runs on review list and review open, sets
  `mergedDetectedAt` once, and shows a badge with a delete affordance.
  Nothing auto-deletes (D-19 as implemented).
- D-42 E2e drives a production build through the fake CLI, screenshots both
  themes into `review/<date>-e2e/`, and CI runs `./verify.sh --build
  --e2e`.
- D-43 The settings API accepts only catalogued keys, each validated by its
  own schema. An unknown key is a 400, not a silent write.
- D-44 The new-review preview for a ruleset is a link to the ruleset page,
  not a drawer: at this size a drawer duplicates a page that already
  exists.
