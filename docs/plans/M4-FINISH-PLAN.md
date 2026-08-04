# M4 finish plan: from audited gaps to v1

Status: RATIFIED IMPLEMENTATION PLAN, written 2026-08-03 for the Opus driver.
This document turns the 2026-08-03 full audit into commit-sized work items
that finish the product: the M3 leftovers (T14, T15), the M4 items (T16 to
T19), and every defect and spec divergence the audit found in the shipped
slices. The driver works U1 to U12 in order, one commit each, `./verify.sh`
green before every commit, rows marked DONE here with the commit hash.
Questions raised mid-item follow the standing rule in `EXECUTION-ORDER.md`
section 0: pick the least-surprising option, log it PROPOSED in
`../DECISIONS.md`, continue. Founder gates are the only stops.

## Verified starting state (2026-08-03, audited against the live tree)

The audit ran five parallel passes (UI vs 04, tests vs 05, server vs 01/03/06,
data model vs 02, loose ends and records) plus a live `./verify.sh --build
--e2e`. Every claim below was verified by reading or running the code on this
date, not recalled. Working tree clean at commit 27d92d7.

**What genuinely works.** The app is usable end to end: project add and
clone, branch pick with re-fetch pinning, pre-flight, run with SSE, limit
pause and resume, checkpointed resume, confirmation with keyboard, complete,
report, export, ruleset import and toggle, merged detection, deletion. All 27
routes are consumed by the UI, migrations are append-only and match the
schema exactly, the architecture laws (read-only tools, CLAUDECODE scrub,
gitops/engine isolation, repository-only DB access, worktree-clean assertion)
all hold with test evidence. Both 2026-07-31 idea-inbox items (effort,
intent plus cached-token panel) are fully built. No stub markers, no empty
directories.

**P0: the gate is red on this machine.** `scripts/check-style.mjs:15`
derives its root from `new URL(..).pathname`, which percent-encodes the
space in this working directory's name, so the gate walks a nonexistent path,
finds no files, and exits 2 by its own misconfiguration guard. Every other
path derivation in the repo uses `fileURLToPath` and is fine. `./verify.sh`
therefore exits non-zero here (confirmed 2026-08-03; every other gate
including `--build --e2e` passed on the same run: 566 unit tests, 15 browser
tests). Until U1 lands, "verified" is unattainable on this machine, and CI
is green only because its checkout path has no space.

**Pipeline divergences from 03/06 (found by the server audit).**

- The deletion stage is hollow. `bundle/base/` is written
  (`src/server/gitops/bundle.ts:119-121`) and never read back: the service
  never passes `baseContents` (`src/server/review/service.ts:313-335`), so
  S4 reviews a deleted file from its minus lines instead of its contents.
  S4's `reviewedDeletions` answer (`src/lib/review/stage-schemas.ts:100-107`)
  is parsed and discarded, and `pipeline.ts:384` marks every ledger file
  reviewed unconditionally, which makes the `pendingFiles` invariant that
  `DECISIONS.md` (2026-07-30, WP-B) calls load-bearing vacuous.
- Review profiles are unreachable. The planner implements all four profiles
  correctly (`src/lib/rulesets/compose.ts:208-262`), but `models.profileId`
  is never mapped onto a review, the UI never sends a profile, and both
  creation and pre-flight default to `full-context`
  (`src/app/api/reviews/route.ts:33`). Every review ever run has been
  full-context; the per-profile quality gate 06 section 3 requires does not
  exist. `mechanical-only` is accepted at the API and then fails mid-run.
- The S6 AI summary (03 section on S6) is declared (`s6_audit` in enums,
  compose, stage-schemas) and never invoked; the report renders a
  deterministic summary instead. No decision entry covers this.
- S1 risk tags are persisted and never used to order later stages
  (03: "high-risk first"). Sweeps run on added lines only; the whole-file
  mode 03 mentions does not exist.
- `resetsAt` from a rate-limit event is captured
  (`src/server/engine/headless.ts:152-158`), re-emitted on the bus, and then
  dropped by every consumer: no column, no UI. A paused review shows no
  reset time.
- `failed` is terminal in the state machine while 03 specs a retry; a draft
  cannot be cancelled through the app although the machine allows it;
  `clone_status = "cloning"` is specced and never written, and clone status
  is the one state machine with no transition guard.
- `GET /api/reviews/[id]/context` is the single route parsing input without
  zod (`context/route.ts:32-34`). JSON columns are zod-validated on read but
  written by bare `JSON.stringify` (`repositories/json.ts:40-42`), which 02
  says does not happen.

**Mode B does not exist.** 01 section 6 and T15 spec the interactive engine
(prompt materialised to `runs/<id>/bundle/stage-<n>-prompt.md`, a shown
command, an output watcher, then the identical pipeline). Nothing is built:
the enum and the `engine_mode` column exist, creation hardcodes
`"headless"`, and the `defaultEngineMode` settings key is dead.

**UI gaps against 04 / T12-T15 (the largest cluster).**

- Run screen (T13): stages hardcoded to s1-s5 (no S0, no S6), no per-stage
  duration or tokens (the data is in `stage_executions` and discarded by the
  page's own type), no coverage panel at all, no batch n of m, no limit
  banner with reset time, no retry, no log path in failures, persisted run
  notes never rendered (only the live SSE tail survives on screen).
- Confirmation (T14): `e` edit-comment is absent at every layer (no key, no
  control, no route field), `g g` is absent; the dismiss-reason input, the
  most-used input in the app, has no label; nothing is `aria-live`.
- Model picker (T12): `recommended`, `contextWindow`, `lastError`,
  `lastProbedAt` are fetched and never rendered; no probe-now in the picker;
  ordering ignores recommendation; a never-probed model is selectable while
  a stale one is disabled, inverting 06, and the helper with the correct
  rule (`listSelectable`, `models.ts:128`) is dead code.
- New review (T12): no advanced fold (engine mode, profile downgrade); the
  ruleset control is a single-select with no tier grouping or counts; merge
  base and selected profile are in the pre-flight payload and never shown;
  no branch-list freshness line or refresh on the fresh path.
- Rulesets (T15): the import fidelity report is computed
  (`src/lib/rulesets/import.ts:286-303`) and thrown away by the route;
  unmapped lines do not block import, contradicting 04, T15, and the
  route's own header comment; severity is not editable; sweep patterns show
  a count only; directive bodies are never shown; the list has no tier
  grouping, no rule counts; no duplicate-to-tier.
- Settings (T15): no data directory display, no probe-all, no default
  engine mode, no danger zone.
- Projects list: last-fetched, review count, fetch-now row action, and
  dependency chips are specced and absent; clone progress is a 1s poll with
  no output tail. Reviews list: no delete, no per-project grouping, no
  filter. Bulk-delete of a project's reviews (02: "UI offers bulk-delete
  first") does not exist, so a blocked project delete offers no remedy.
- States and chrome: the three detail screens hang on "Loading..." forever
  when a fetch fails (no error path sets state); there is no `error.tsx`,
  `not-found.tsx`, or `loading.tsx` anywhere; one browser title serves all
  nine routes; hit targets run 30-38px against 04's 40px floor; reduced
  motion covers only `.pulse`; there are no type or spacing tokens; green
  (`--color-good`) is a fifth strong colour doing status duty against 04's
  severity-only rule.

**Test and evidence gaps against 05 / T16-T18.**

- No axe checks exist anywhere; `@axe-core/playwright` is not installed.
  04 section 4 claims "checked in e2e via axe", which is false today.
- Of 05 section 3's five flows: failure paths (limit pause, resume, cancel,
  restart recovery) have no browser coverage (they are covered at the
  integration layer); the ruleset-import flow cannot assert a fidelity
  report because the product does not show one; the journey asserts two
  lines of report text rather than that the report equals the confirmed set.
- Screenshots cover 5 of 8 real screens; `/projects/[id]`, `/reviews/new`,
  `/rulesets/[id]` are never photographed, nor is the confirmation queue
  mid-decision. The evidence directory is named three different ways across
  04, M3-FINISH-PLAN, and EXECUTION-ORDER. CI produces screenshots and
  traces and uploads nothing, so a red CI run leaves no evidence.
- The linked quality gate covers one of the two seeded cross-repo defects in
  its dedicated assertion, and the fixed-variant branch (05: contract bugs
  fixed produce all-consumers-verified clears) does not exist.
- `review/<date>-fg4/DESIGN-NOTES.md` (T16's template-test record) and
  `review/<date>-engine/` (T18) do not exist. `docs/RUNBOOK.md`, FG-3's
  precondition, does not exist.
- `verify.sh` does not require `git`, which three suites shell out to; the
  house-style gate does not cover root config files, `verify.sh` itself, or
  `review/`, where DESIGN-NOTES.md will be written.

**Found by U2's verification pass, 2026-08-03, and folded in.** These were not
in the original audit and they change scope:

- There is no `ReviewEngine` interface at all, so U11 must extract the seam
  before it can add Mode B. U11 is corrected below.
- The SSE polling fallback that D-15 decided on does not exist. The review
  page opens an EventSource and stops updating if it errors. Folded into U6,
  which owns that screen.
- Sweeps run over added lines only; 03 section 0.4 also asks for whole
  changed files where the protocol says so. Unowned, and recorded in 03 as
  unbuilt rather than silently dropped.
- The confirmation queue is one column, not the two-pane layout 04 specifies,
  and shows neither the verbatim rule text nor the diff hunk. Folded into U7,
  which was previously scoped to keys and labels only.
- The seeded fixture is missing the duplicated-merge-helper defect from 05
  section 4's minimum list. Folded into U12 with the other fixture work.
- `npm audit` is now clean (0 vulnerabilities across 586 dependencies,
  measured 2026-08-03), so the 2026-07-30 accepted risk is discharged rather
  than carried. PROJECT-STATE records the measurement.

**Records that are wrong today (stale records are bugs).**

- `README.md` says the pipeline is not built, one of twelve work packages is
  done, and the root page is a placeholder. All three are false.
- `docs/plans/BUILD-PLAN.md` marks WP-F through WP-L TODO; all but WP-K/L
  are built. This is the doc CONTRIBUTING sends newcomers to.
- All seven specs still carry "DRAFT, pending G0 ratification"; G0 passed
  2026-07-30 per `GATES.md`.
- 01 says Mode A uses `--append-system-prompt` (code correctly uses
  `--system-prompt`); 03 names `lib/review/compose.ts` (it is
  `lib/rulesets/compose.ts`) and says cancel keeps the worktree (D-33
  removes it); 02's settings list is stale in both directions and its
  "editable" project name has no route or UI (`renameProject` is fully dead
  code); `SETTING_KEYS` carries two dead keys the API refuses.
- Dead exports with zero production callers: `renameProject`,
  `listSelectable`, `listConfirmed`, `listAwaitingDecision`,
  `listPendingHunks`, `listReviewsForBranchPair`, `getFileRiskTags`.
  Write-only columns: `risk_tags`, both `clear_reason`s,
  `sweep_hits.finding_id`, `engine_mode`.
- `docs/README.md` changelog stopped 2026-07-30; both built inbox items are
  unretired; CLAUDE.md section 3 omits the nothing-hidden gate;
  `demo:fixture` appears in no onboarding doc; CONTRIBUTING never mentions
  `npx playwright install`; `GATES.md` cites G1 evidence at a gitignored
  path that exists only on this machine.

**Gate state.** G1 is AWAITING VERDICT; the fake half is done and captured,
the real smoke is deliberately the maintainer's to start
(`plans/FG2-CHECKLIST.md`). G2 and G3 are pending. T18's real-engine proof
spends usage and stays behind an explicit maintainer go.

## 0. The three problems this plan settles

**The gate must mean something again.** A red `./verify.sh` on the reference
machine, for a path-handling reason the charter itself warns about, is the
first fix, not one item among many. U1 lands before anything else.

**The pipeline must do what the specs claim.** Two of the product's
completeness promises (every deletion reviewed, work divided per profile)
are currently decorative. They become real or the specs are amended by
decision, never silently.

**The remaining surface is finished, then proven.** T14/T15 leftovers, the
T16 design pass, and the T17 suite land in dependency order, so FG-3 and
FG-4 each start with their evidence already captured.

## 1. Work items

### U1. Green gate, hardened gates. DONE 2026-08-03

- `check-style.mjs` resolves its root with `fileURLToPath`, proven by
  running from this space-containing checkout. The root is scanned by
  listing it rather than by naming files, so every config and `verify.sh`
  (via a new `.sh` extension) are covered. `review/` stays out until U10
  creates prose there, then joins.
- A declared target directory that is missing fails by name with exit 2.
- `verify.sh` `require_tool` gains `git`.
- Proof, captured 2026-08-03: the gate checked 0 files before and 180
  after, on the same tree. Three mutations were planted and each fired:
  an em dash in `postcss.config.mjs` (exit 1, newly covered root config),
  an em dash in `verify.sh` (exit 1, newly covered extension), and the
  script run from a root without `src` (exit 2, naming the target).
  `./verify.sh --build --e2e` then exited 0: "VERIFIED: all gates passed,
  including build and e2e", 566 unit tests and 15 browser tests green.

### U2. Records emergency pass

The lies that mislead a reader today, fixed before more code lands:
README status and usage sections rewritten to the truth (including
`npm run demo:fixture` and the env vars), BUILD-PLAN WP rows corrected,
spec headers flipped to RATIFIED 2026-07-30 per GATES.md, the 01/02/03/04
stale points from the audit corrected (each a one-line fix, with D-33 and
the `--system-prompt` reality winning), `docs/RUNBOOK.md` written (install,
start, first review, one page), inbox items retired with commit pointers,
docs/README changelog caught up, CLAUDE.md section 3 gains the
nothing-hidden gate in its gate list. GATES.md notes that `review/`
evidence is machine-local by design and names the machine.
Proof: reread against the live tree; no build needed.

### U3. The deletion stage made real. DONE 2026-08-03

Landed: `readBaseContents` in the bundle module feeds S4 the pre-change copy
of every deleted file; `reconcileDeletions` checks the stage's answer against
what it was shown in both directions; ledger files close on evidence; renames
join the deletion set. Proof: 4 new pipeline tests fail when the assertion is
neutered and pass when it is restored, 3 new bundle tests read a real deleted
file back out of a real bundle, 3 new content tests pin the prompt's wording
including the case where the copy is missing. `./verify.sh --build --e2e`
exited 0 with 578 unit tests and 15 browser tests.

Deferred to U12: the seeded fixture's own whole-file deletion, which needs a
deletion mechanism in the fixture builder and a new protocol rule. See the
DEFERRED entry in `../DECISIONS.md`.

Original scope:

- The service reads `bundle/base/<slug>/<path>` for every deleted file and
  passes `baseContents` into the pipeline; S4's prompt gets pre-change
  contents as 03 specs.
- S4's `reviewedDeletions` is reconciled both ways against the deletion list
  (same contract as every other stage: unaccounted-for fails, invented
  fails). File-level review marking follows actual dispositions; the
  unconditional mark at `pipeline.ts:384` is removed, making `pendingFiles`
  falsifiable again. A mutation test proves the invariant can fail.
- The seeded fixture gains a whole-file deletion defect so the gate
  exercises the path.
- Proof: quality gate green including the new case; a scripted run that
  skips a deletion fails with the file named.

### U4. Profiles wired end to end. DONE 2026-08-03 (server half)

Landed: `src/lib/review/profiles.ts` resolves a review's profile from the
model registry, refuses an upgrade and refuses `mechanical-only`; creation and
pre-flight both use it; the pre-flight returns the resolved profile, the
model's own profile, and the request count for every judging profile. The
quality gate runs the fixture under all three. The screen half (a control to
choose the downgrade, and rendering the resolved profile) belongs to U8, which
owns that form.

Original scope:

- Creation maps the chosen model's registry `profileId` onto the review;
  the API refuses `mechanical-only` for a review (D-46) and refuses a
  profile stronger than the model's registry entry; a weaker one is a
  deliberate downgrade (D-47).
- New-review advanced fold (see U8) shows the resolved profile and the
  downgrade control; pre-flight reports the profile it estimated with and
  the request count per 06.
- The quality gate runs the fixture under `chunked` and `decomposed` as
  well as `full-context`, asserting identical verified findings and clean
  coverage from the union (06: "the engine quality gate runs per profile").
- Proof: gate green three ways; creation with a sonnet-class model recorded
  as `decomposed` in the review row and the report footer.

### U5. Lifecycle and boundary truth. DONE 2026-08-03

Landed: the limit reset time is stored and shown; a failed review resumes
through checkpoint replay; the clone status machine is enforced and `cloning`
is written for the first time; JSON columns validate on write; the context
route parses its query with zod. Deferred: cancelling a draft or an
awaiting-confirmation review, which the state machine allows and the job
manager has no path for. It needs a manager change rather than a status one,
and nothing in the product offers the action today, so it moves to U6 with
the rest of the run-screen controls.

Also deferred: the scoped proof below says a fake-CLI limit scenario shows
the banner with its reset time in the browser journey. The scenario and the
persistence are proven by integration tests, and the banner itself only by
reading the code; driving a limit pause through a browser moves to U12 with
the other failure-path flows (D-55).

Original scope:

- `resetsAt` persisted onto the review at limit pause (migration 0008,
  nullable), shown in a dedicated pause banner with the reset time (D-53).
- Failed reviews become resumable: `failed -> running` joins the machine,
  re-entry through the existing checkpoint replay, UI Resume appears on
  failed with the recorded error beside it (D-50). 03's per-stage retry
  wording is amended to match.
- Cancel reaches drafts and awaiting-confirmation reviews through the
  manager (the machine already allows both).
- Clone status gains a transition guard in the projects repository and the
  background clone writes `cloning` before it starts.
- The context route parses `path` and `line` with zod;
  `serialiseJsonColumn` takes the same schema its reader uses and validates
  before writing (02's claim becomes true).
- Proof: route tests for each; a fake-CLI limit scenario shows the banner
  text with the reset time in the journey.

### U6. Run screen to the T13 bar. DONE 2026-08-03

Landed: coverage added to the job snapshot and rendered as a panel; timeline
covers S0 to S6 with per-attempt duration, fresh/cached/output tokens and
cost; failed stages show error class, text and transcript path; persisted run
notes rendered; D-15 polling fallback with a visible degraded state;
cancelling now covers every status the state machine allows. Proof: the
browser journey asserts the coverage panel, both deterministic stages and the
per-stage cost line; `./verify.sh --build --e2e` exited 0.

Remaining for U10: batch n of m in the activity feed, which needs the batch
event the manager does not yet emit.

Original scope:

- Stage timeline covers S0 to S6 (S0 prepare and the S6 audit shown from
  the pipeline's own boundaries), each row with status, duration, and
  fresh/cached/output tokens from `stage_executions`.
- Coverage panel: pending versus dispositioned hunks, sweeps, and files,
  counting down live from snapshot plus events; batch n of m in the
  activity feed; persisted run notes rendered under the timeline so a
  reload keeps history; failure state shows error class, message, and the
  transcript's `logPath` verbatim.
- Proof: e2e drive with the fake engine capturing the mid-run screen; the
  reload case asserted (notes survive refresh).

### Review round 1 (after U3-U6). DONE 2026-08-04

The charter's periodic round, run over the six uncommitted items by three
independent reviewers (server correctness, API and UI correctness, charter
and test integrity). Thirteen defects fixed, each with a test; two were
severe enough to have shipped a broken product. Full reasoning per finding is
in `docs/DECISIONS.md` under 2026-08-04.

- The two that mattered: a stage answer the pipeline rejected stayed
  checkpointed as succeeded, so every resume replayed it and failed
  identically forever; and deleting a project mid-clone escaped an unhandled
  rejection that ends the Node process.
- The pattern behind the first is now a stated rule: a check that can refuse
  a stored answer either runs before it is stored or strikes it.
- The rest: permanent polling after every finished run, a queued cancel that
  changed nothing, clones stranded by a restart, false missing-copy notes on
  deleted binaries, a fence collision in the deletion prompt, two untruthful
  profile messages, three timeline misreadings (every stage pulsing, two
  deterministic rows, a cancel painted as a fault), and two tests that
  promised more than they checked.
- Records corrected: the U4 commit-map row, the U5 banner proof that was
  deferred rather than delivered, and three unmeasured timing claims.

### U7. Confirmation to the T14 bar. DONE 2026-08-04

Landed: `edited_comment` (migration 0009) with the engine's wording kept on
the row; confirm route takes an optional replacement; the report and every
screen prefer the edit. The queue is two panes grouped by severity with the
verbatim rule text (new `/rules` route reading the frozen snapshot) and the
diff hunk (context route, from the bundle's patch) beside the cited lines.
Full D-16 key map with e and g g, labelled dismissal input, polite live
regions for the count and the active finding. Proof: repository, service and
API tests at each layer; the browser journey walks the keys, rewrites a
comment, and reads the exported file off the disk to find it verbatim;
`hunkForLine` is mutation-proved.

Original scope:

- Edit-comment lands at every layer: nullable `editedComment` column
  (migration with U5's, or its own), confirm route accepts an optional
  replacement comment, the report prefers it and keeps the engine's
  original on the row; UI `e` key and control per D-16; `g g` implemented.
- The dismiss-reason input gets a real label; decided/undecided counts and
  the selected card become `aria-live`/announced; the footer hint bar
  matches the full key map.
- Proof: e2e keyboard walk extended to e, g g, and an edited comment
  asserted verbatim in the exported report.

### U8. New review and model picker to the T12 bar. DONE 2026-08-04

Landed: the picker is rows, not options, selectable only while a fresh probe
vouches (the `listSelectable` rule, moved to `lib/models/availability` and
unit-tested); unknown and stale rows carry a Probe control, unavailable rows
their error verbatim; recommended families and models lead. Nothing is
preselected unprobed, so the journey now probes before it reviews, against a
fake that answers probes without consuming scripted answers. The advanced
fold shows engine mode as a statement, per-profile request counts, and a
downgrade select that feeds both pre-flight and creation. Ruleset select is
grouped by tier with enabled-rule counts (multi-select moved to U9, logged
PROPOSED); the branch list names its fetch moment with Refresh beside it;
the pre-flight shows the merge base. Proof: availability and ordering unit
tests; the journey probes, reads the metadata, walks the fold's downgrade
round trip, and starts the review.

Original scope:

- Advanced fold: engine mode (headless until U11 ships Mode B, then both)
  and the profile downgrade from U4.
- Model picker: recommended first with family grouping, each option showing
  context window, profile, probe age; unavailable disabled with `lastError`;
  stale treated as unknown per 06 by adopting `listSelectable`'s rule;
  probe-now in the picker.
- Ruleset control grouped by tier with rule counts; merge base and branch
  freshness (with refresh) rendered in pre-flight.
- Proof: component logic unit tests for ordering and disabling; screenshots.

### U9. Rulesets manager to the T15 bar. DONE 2026-08-04

Landed: the import route returns the fidelity numbers and the screen says
"All N lines accounted for" from the importer's own counts; the unmapped
block exists but cannot fire on a correct importer, which turned out to be a
property of the block partitioning rather than a gap (D-48 AMENDED, probed
three ways). Severity edits share `patchRule` with the toggle and bump the
version; sweep patterns expand per rule; directive bodies expand verbatim;
the list groups by tier with enabled-rule counts and provenance; duplicate-
to-tier copies the ruleset as used at version 1; a refused project delete
offers two-step bulk review deletion with the real count. Multi-ruleset
reviews deferred to their own slice over rule-code collisions. Proof: repo
and route tests for each; the journey asserts the fidelity sentence.

Original scope:

- Import returns and the screen renders the fidelity report; any unmapped
  non-blank line blocks the import with the lines listed (D-48), making the
  route's header comment true.
- Severity editable per rule (PATCH extends to `severity`, version bump
  identical to the enabled toggle); sweep patterns listed per rule;
  directive bodies expandable; list grouped by tier with rule counts and
  provenance; duplicate-to-tier action (copy with new tier, version 1).
- Project delete refusal offers bulk review deletion (02's promise),
  two-step, naming the count.
- Proof: fidelity-blocked import asserted in a route test and the e2e flow;
  snapshot filtering already proven stays green.

### U10. Design pass to the 04 bar (T16). MOSTLY DONE 2026-08-04

Landed: type-scale, spacing, hit-target and motion tokens; reduced motion
covering every animation and transition; `error.tsx` and `not-found.tsx`;
per-segment `metadata` titles with a template suffix; the 40px floor applied
at the component kit; D-56 settled and 04 amended; settings gained the data
directory, probe-all and a two-step danger zone (its refusal
mutation-proved); the projects list gained fetch freshness in words, review
counts, fetch-now and dependency chips; the reviews list gained delete and a
project filter keyed by id; `check-style` covers `review/`; the browser suite
photographs the three previously unphotographed screens plus the confirmation
queue mid-decision, and `review/2026-08-04-fg4/DESIGN-NOTES.md` answers the
template test per screen.

Reading those screenshots caught a defect no test would have: this fixture's
detected default branch is the branch under review, so "compare against"
opened on the same branch, which diffs nothing and reads like a clean review.
The branch under review is now excluded from the comparison list, asserted in
the journey.

Not done, and still owned by this item: the live git output tail during a
clone, project name and default-branch editing (D-51), the log viewer for a
failed stage's transcript, and batch n of m in the activity feed (which needs
an event the manager does not emit).

Original scope:

- Tokens for type scale and spacing in `globals.css`; every screen's
  loading, error, and long-content states (the three detail screens get
  real error paths; `error.tsx` and `not-found.tsx` added); per-page
  `metadata` titles; hit targets to 40px; reduced-motion covers all
  transitions; the status-green question settled by decision (D-56
  recommends amending 04: severity owns strong colour within review
  content, the good token may mark statuses) and applied consistently.
- Settings completes: data directory display, probe-all, danger zone.
  Projects list gains last-fetched, review count, fetch-now, dependency
  chips; reviews list gains delete and a project filter.
- `review/<UTC date>-fg4/DESIGN-NOTES.md` answers the template test per
  screen; both-theme screenshots of all screens including the three never
  photographed and the confirmation queue mid-decision land in the same
  directory. Evidence naming unified to `review/<UTC date>-<purpose>/` and
  04 corrected (D-49). check-style TARGETS gains `review/`.
- Proof: the screenshot set and notes exist; verify green.

### U11. Mode B, the interactive engine (T15 close-out). DONE 2026-08-04

Landed: `ReviewEngine` extracted as the seam 01 section 6 always described
(the headless runner now satisfies it unchanged); `createInteractiveEngine`
writes each stage's prompt into the review's bundle, prints the launch
command through the same event channel the activity feed reads, and waits for
the answer file, validating it against the stage schema before the pipeline
sees it; the engine is chosen from the review's frozen `engine_mode` column;
creation accepts it and the advanced fold offers it, with a run note
recording that usage stays at zero because the tokens are spent elsewhere.
Proof: eight unit tests over the exchange contract (including a mid-write
file, a cancel, and a timeout), plus a whole review run end to end from files
on disk with no CLI path configured.

Also settled: the `defaultEngineMode` and `defaultModel` settings keys are
still dead. They stay unread rather than becoming half-features; U12 either
deletes them or gives them a reader.

Original scope:

Corrected 2026-08-03: this item's original wording assumed a `ReviewEngine`
interface already existed to put a second implementation behind. It does not.
`src/server/engine/headless.ts` exposes `runStage(options): Promise<Outcome>`
directly, and 01 section 6 describes an interface that was never written. So
U11 extracts the seam first, then builds against it.

- Extract the engine seam from the one real caller (`engine-runner.ts`), so
  the pipeline depends on a contract rather than on the headless module.
- `InteractiveEngine` behind that seam:
  materialise the composed system and user prompt to
  `runs/<id>/bundle/stage-<n>-prompt.md`, surface the one-line command on
  the run screen, watch for `stage-<n>-output.json`, validate through the
  identical schemas and checks, continue the pipeline unchanged.
- Engine mode selectable in U8's advanced fold; `defaultEngineMode` becomes
  a real catalogued setting or is deleted with its dead sibling
  `defaultModel` (driver decides by which is smaller; a dead key is the
  worse option).
- Proof: unit tests for the watcher (answer, timeout, malformed output);
  an e2e round trip where the test writes the output file, per T15.

### U12. The suite and the truth pass (T17 + T19). PART DONE 2026-08-04

Landed: axe (WCAG 2 A and AA) over every screen in both themes plus the
completed review, which found three real violations on first run, all fixed
(the faint ink token in both themes, the WARNING severity badge at 3.75:1,
and six scrollable regions with no keyboard access); 04's accessibility claim
is now checked rather than asserted. CI uploads `review/`, `test-results/`
and `playwright-report/` on every run. PROJECT-STATE corrected to measured
counts (659 unit tests across 43 files, 27 browser tests, 32 routes, 10
migrations). The dead `defaultModel` and `defaultEngineMode` settings keys
are deleted.

Also landed: failure-path browser flows (a usage limit armed by file, its
banner with the reset time, resume to completion, and deleting a review from
the list), and the journey now asserts the exported report holds exactly the
confirmed set and nothing else.

Still open, and what a next session should pick up:

- Cancel mid-run through a browser. The limit pause and the delete are
  walked; a cancel is proven at the integration layer only.
- Fixture work: the four seeded-fixture gaps, now planned in detail against
  the live tree and adversarially verified, in
  [U12-FIXTURE-GAPS.md](U12-FIXTURE-GAPS.md). That document is the driver's
  working order for the rest of U12.
- The test-only half of the dead-export sweep (D-54): exports whose only
  consumer is their own test, each costing a test edit. Listed step by step in
  [U12-FIXTURE-GAPS.md](U12-FIXTURE-GAPS.md).

Closed since this list was written: the risk ordering that gives `risk_tags`
its reader (mutation-proved twice), the zero-consumer half of the dead-export
sweep, README screenshots, axe over both themes, and the failure-path browser
flows.

Original scope:

- axe (AA) via `@axe-core/playwright` on every screen in both themes;
  violations fixed in the same item.
- Failure-path browser flows: limit pause showing the banner, resume to
  completion, cancel mid-run. Restart recovery stays at the integration
  layer where it is already proven, recorded as a decision (D-55).
- The journey asserts the exported report equals the confirmed set exactly;
  the import flow asserts the fidelity report.
- Fixture: the fixed-variant branch where both contract bugs are repaired,
  asserted to produce all-consumers-verified clears; the dedicated
  cross-repo assertion covers both seeded defects; the
  duplicated-merge-helper defect from 05 section 4; and a whole-file deletion
  with a surviving caller, deferred here from U3, which needs a deletion
  mechanism in the fixture builder and a rule for it to violate.
- CI uploads `review/` and `test-results/` as artifacts on every run.
- Final records: PROJECT-STATE rewritten to current truth (counts, routes,
  migrations, settings), EXECUTION-ORDER and this plan's rows marked,
  CONTRIBUTING gains the playwright install step and the port-3100 and
  tsconfig traps, README gains screenshots. Dead exports without a consumer
  after U1-U11 are deleted (D-54); write-only columns either gain their
  reader here (risk ordering per 03 is the natural consumer of
  `risk_tags`; a decision entry settles it) or are removed by migration.
- Proof: `./verify.sh --build --e2e` green locally and in CI, artifacts
  visible on the CI run.

### U13. Real-engine proof (T18). MAINTAINER-GATED

Runs only on the maintainer's explicit go, because it spends usage. The
driver runs the haiku smoke and, on request, the fable run via
`npm run demo:fixture`, captures `review/<date>-engine/` (defects found
versus manifest, false positives, quote-check kills, tokens, cost, wall
time), and updates the G1 row. Prompt iteration, if the results demand it,
follows the standing rule: the fake gate first, the real model after.

## 2. Commit map

| U   | Contents                                                        | Blocked on | Status |
| --- | --------------------------------------------------------------- | ---------- | ------ |
| U1  | check-style path fix, TARGETS widening, require git              | -          | DONE (uncommitted 2026-08-03) |
| U2  | records emergency pass, RUNBOOK, spec headers                    | -          | DONE (uncommitted 2026-08-03) |
| U3  | deletion stage: base contents, reconciliation, evidence-based ledger | U1     | DONE (uncommitted 2026-08-03) |
| U4  | profile mapping, refusals, per-profile quality gate              | U1         | DONE (uncommitted 2026-08-03) |
| U5  | resetsAt, failed-resume, clone guard, zod at both boundaries      | U1         | DONE (uncommitted 2026-08-03) |
| U6  | run screen: S0-S6, per-stage cost, coverage panel, notes, errors, SSE fallback, cancel | U5 | DONE (uncommitted 2026-08-03) |
| U7  | confirmation: edit-comment, g g, labels, aria-live               | U5         | DONE (uncommitted 2026-08-04) |
| U8  | new review: advanced fold, picker truth, tier grouping           | U4         | DONE (uncommitted 2026-08-04) |
| U9  | rulesets: fidelity block, severity, directives, bulk delete      | U1         | DONE (uncommitted 2026-08-04) |
| U10 | design pass, states, tokens, settings/list completion, FG-4 notes | U6-U9      | TODO   |
| U11 | Mode B engine, engine-mode setting                               | U8         | TODO   |
| U12 | axe, failure e2e, fixed-variant fixture, CI artifacts, T19 docs  | U10, U11   | TODO   |
| U13 | real-engine proof and G1/G3 evidence                             | maintainer | GATE   |

Review round after U4, after U9, and after U12, per the charter.

## 3. Decisions fixed by this plan (append to DECISIONS.md as work lands)

- D-45 Gate scripts resolve filesystem paths with `fileURLToPath`, never
  `URL.pathname`. Reason: the 2026-08-03 red gate on a path containing a
  space.
- D-46 `mechanical-only` is refused at review creation. It plans zero
  judgment batches, so accepting it sells a review that cannot complete.
- D-47 A review's profile defaults from the model registry at creation;
  only deliberate downgrades below the model's profile are accepted.
- D-48 An import with unmapped non-blank lines is blocked, with the lines
  shown. A protocol partially discarded at import is the failure the
  fidelity gate exists to prevent.
- D-49 Evidence directories are `review/<UTC date>-<purpose>/`; 04's
  `-ui` naming is corrected to match.
- D-50 A failed review resumes through checkpoint replay
  (`failed -> running`) instead of 03's per-stage retry; paid-for stages
  replay free and the failed stage runs live.
- D-51 Projects gain PATCH for name and default branch, wiring the
  existing repository functions; 02's "editable" becomes true. (Folded
  into U10's list completion.)
- D-52 The report's summary and completeness statement stay deterministic,
  rendered from the reconciled ledger; the unused `s6_audit` stage
  declaration is removed and 03 amended. A model summarising its own
  coverage is the kind of claim this app exists to distrust.
- D-53 A limit pause records `resetsAt` when the CLI reports it and the UI
  shows it; a pause without a visible end reads as a hang.
- D-54 Exports with no production caller after this plan's items land are
  deleted in U12, not kept as latent surface.
- D-55 Restart recovery is proven at the integration layer; the browser
  suite covers limit pause, resume, and cancel. Playwright cannot restart
  its own webServer mid-test without giving up the fake-engine guarantee.
- D-56 Severity owns strong colour within review content; the good token
  may mark statuses (confirmed, merged, saved). 04 amended accordingly.
  FG-4's design judgment can overrule this.

## 4. Founder gates touched by this plan

- **FG-2 / G1 (open now).** Nothing here blocks the maintainer running
  `npm run demo:fixture` and ruling per `FG2-CHECKLIST.md`. U13 captures
  the evidence when told to.
- **FG-3 / G2 (after U9).** The runbook exists from U2; the usable-app
  surface is complete after U9. The maintainer imports their real protocol
  and reviews a real branch.
- **FG-4 / G3 (after U12, with U13 evidence).** Design judgment over the
  fg4 notes and screenshots, acceptance of the engine-gate numbers, v1
  verdict.
