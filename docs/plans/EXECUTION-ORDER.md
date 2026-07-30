# Execution order: remaining work to v1

Status: STANDING EXECUTION ORDER, written 2026-07-30 at the maintainer's
direction ("plan all the remaining work and best sequence so the driver does
not keep asking"). Same contract as the reference projects' work queues: the
driver works TOP TO BOTTOM through unblocked items without asking. Blocked
items are skipped until their input lands, never waited on. Founder gates are
the only places work stops for a human.

This document plans; it does not code. All `CLAUDE.md` rules apply on top:
one item per diff, `./verify.sh` green before every commit, prove before
done, mark items DONE here with the commit hash in the same session.

## 0. How the driver avoids asking

- **Every decision this plan could not settle is listed in section 5 with a
  recommended default.** When an unlisted question comes up mid-item, the
  driver picks the least-surprising option consistent with the specs, records
  it in `../DECISIONS.md` as `PROPOSED`, and continues. Questions never block
  work; only founder gates do.
- **Founder decisions are batched at the three gates** (section 4). Nothing
  is asked between gates.
- **Scope changes go to `idea-inbox.md`**, one line, and are not built.
- If reality contradicts this plan (an API does not behave as assumed, a
  dependency is missing), the driver fixes the plan in the same session,
  logs the correction in `../DECISIONS.md`, and continues down the list.

## 1. Where the build actually stands (verified 2026-07-30)

Done and pushed: scaffold and gates (WP-A), data layer (WP-B), git layer
(WP-C), ruleset domain (WP-D), engine (WP-E), and the pipeline core of WP-F:
sweeps, both-direction stage reconciliation, the byte-exact quotation check,
stranded-candidate handling, and the coverage audit, all mutation-tested
against a scripted stage runner. 272 tests, CI green.

Known gaps inside the built code, found by self-review and carried here so
they are fixed deliberately rather than rediscovered:

- G-1: `pipeline.ts` matches a sweep hit to its finding by path alone and
  falls back to an empty finding id when nothing matches. Must become
  nearest-finding-by-line, and a `finding` disposition with no matching
  candidate must fail reconciliation, not attach to `""`.
- G-2: The one-repair-round rule from `03-REVIEW-PIPELINE.md` is not
  implemented anywhere: a stage answer that fails schema validation throws
  immediately.
- G-3: Stage prompts carry no change content. The model has Read access to
  the worktree, but the diff, inventory, sweep-hit list, and pre-change
  copies live in the bundle directory outside its toolset. Content must be
  inlined into each stage's user prompt (decision D-7).
- G-4: `BatchPlan` (profiles) exists and is proven complete, but the
  pipeline runs S3 as exactly one call. Profile batching is not wired.
- G-5: No linked-review symbol dispositions in the pipeline, though the
  schema and the changed-symbol extraction both exist.
- G-6: The engine (`runStage`) and the pipeline (`StageRunner`) are not
  connected; nothing composes real prompts or extracts JSON from a result.
- G-7: No S0 service: nothing yet fetches, pins commits, creates worktrees,
  builds bundles, or asserts the worktree clean around a pipeline run.
- G-8: No job manager, no SSE, no resume/cancel/pause-on-limit wiring, no
  startup recovery call to `markOrphanedReviewsInterrupted`.

## 2. The order of work

Rationale for the sequence: finish the engine-to-pipeline spine first (T1-T5)
because every later surface depends on its shape; then the fixture and gate
(T6-T7) because FG-2 needs them and they are the regression net for all
prompt work; then the service/job layer (T8-T9) that the UI sits on; then UI
in usage order (T10-T15); then hardening and ship (T16-T19). Items marked
[parallel-safe] can be picked up out of order if a blocker appears.

### Milestone M2 remainder: a real review runs end to end

**T1. Stage prompt content and the real stage runner (fixes G-3, G-6).**
Build `src/server/review/content.ts`: pure functions rendering each stage's
user prompt from the bundle: S1 gets the inventory summary and per-file
stats; S2 gets the file list, diff, and instruction to read chains from the
worktree; S3 gets the diff hunks (numbered, with post-change line numbers),
the sweep-hit list, and the linked-symbol list when present; S4 gets each
deletion's pre-change contents from `bundle/base/`; S5 gets the candidate
findings as JSON (already the case). Then `src/server/review/engine-runner.ts`
implementing `StageRunner` over `runStage`: composes the system prompt via
`composeSystemPrompt` + `outputContractFor`, extracts the JSON object from
the result text (strip code fences if present, parse the first balanced
object), enforces `assertToolsAreReadOnly`, records per-stage usage. Session
strategy per `03`: S1-S4 resume one session; S5 always fresh.
Proof: unit tests with the fake CLI covering JSON extraction (bare object,
fenced object, prose around it, unparsable), session reuse across stages,
and fresh session at S5.

**T2. One repair round (fixes G-2).** In the engine runner, not the
pipeline: on schema-invalid output, send exactly one follow-up in the same
session naming the validation errors ("your output failed validation at:
..."), re-validate, then fail the stage with `invalid_output`. The repair
attempt is recorded as attempt 2 in `stage_executions`.
Proof: fake-CLI scenario that answers wrong then right passes; wrong twice
fails with the stage error carrying both attempts' errors.

**T3. Sweep-to-finding attachment and strictness (fixes G-1).** A sweep
disposition of `finding` must name a candidate that exists at that path,
chosen as the finding whose line range contains or is nearest the hit line;
if none exists, reconciliation fails with a message naming the hit. Remove
the empty-id fallback.
Proof: unit tests for containment, nearest-line tie-break (earlier line
wins), and the no-candidate failure.

**T4. Profile batching in the pipeline (fixes G-4).** S3 executes
`planRuleBatches` output: one stage call per batch (batch theme and files
named in the prompt), candidate findings and dispositions merged across
batches, reconciliation run once over the union, and the plan's `excluded`
list written to the run log and stored (new `review_notes` row or the stage
execution's errorText-style column; decision D-10). Context guard per `03`
section 4: estimate tokens (D-8) for the composed S2/S3 prompts; when an
estimate exceeds 80% of the model's probed context window, split that
stage's files greedily by size into groups under the budget, never dropping
content silently.
Proof: unit tests that a chunked plan produces N stage calls whose union
reconciles; an oversized synthetic change set splits and still reconciles;
excluded pairs surface in the result.

**T5. Linked-review dispositions (fixes G-5).** When the review has a
linked repo: S3's prompt includes the changed exported symbols from the
bundle; output is validated against `symbolDispositionSchema` merged into
the adversarial schema (one combined answer); app code enforces every
symbol dispositioned (same both-direction reconciliation), and
`all_consumers_verified` clears require at least one consumer file named.
Proof: unit tests with a scripted runner: undispositioned symbol fails;
invented symbol fails; a `finding` verdict creates a candidate in the
primary repo.

**T6. Seeded fixture repositories (WP-G part 1). [parallel-safe]**
`tests/fixtures/build-seeded-repos.mjs` builds, deterministically into a tmp
dir, two git repos per `05-TESTING.md`: `seeded-repo` (main + feature branch
with the canonical defects: id-vs-_id behind an index signature, deleted
await, swallowed error, float money sum, timezone boundary, weakened test
assertion, deleted guard clause, plus two clean hunks) and `seeded-core`
(renamed interface field with one unmigrated consumer in seeded-repo, plus a
changed default). Each defect is annotated in `seed-manifest.json` with
file, lines, rule code, expected severity. The example protocol's rules must
actually cover every seeded defect; extend `example-protocol.md` if a rule
is missing (its fidelity tests must keep passing).
Proof: a unit test builds both repos and asserts the manifests match the
diffs (each seeded line really is in the diff at the stated lines).

**T7. The engine quality gate, fake-engine edition (WP-G part 2).**
`tests/server/review/quality-gate.test.ts`: builds the fixture, runs the
full pipeline with a scripted runner derived from the manifest (the "ideal
reviewer"), and asserts: every manifest defect surfaces as a verified
finding with matching file and overlapping lines; the two clean hunks
produce no findings; coverage invariants hold; a deliberately hallucinated
extra finding dies at the quotation check. Also the linked variant over
seeded-core. This is the regression net every later prompt change runs
against.
Proof: the test itself; it joins `verify.sh`'s unit gate.

**T8. S0 review service and run lifecycle (fixes G-7).**
`src/server/review/service.ts`: given a draft review row, performs fetch,
commit pinning (already stored at creation; re-resolve and fail loudly if a
branch vanished), worktree add (single or dual layout via `repoSlug`),
bundle build, ruleset snapshot into `review_rulesets`, pipeline run with the
real runner, `assertWorktreeClean` after, and cleanup rules: worktree
removed on completion or deletion, bundle and logs kept until the review is
deleted (evidence). Wires `transitionReview` at each boundary and
`addReviewUsage` per stage.
Proof: integration test against real git fixture repos with the fake CLI
end to end: statuses walk draft -> running -> verifying ->
awaiting_confirmation; usage accumulates; worktree is gone afterwards;
`markOrphanedReviewsInterrupted` recovery test.

**T9. Job manager, SSE, pause and resume (fixes G-8).**
`src/server/jobs/manager.ts` singleton (created in `instrumentation.ts`):
one running review at a time (D-4), queue for the rest, an in-process event
bus per review (stage started/finished, tool activity, usage tick, limit
warning), every event persisted before emission. Cancel kills the
subprocess via the existing AbortSignal path. A `limit` StageFailedError
moves the review to `paused_limit` with the CLI's message and the
rate-limit `resetsAt` when present; resume re-enters at the failed stage
using the recorded sessionId. Server restart marks orphans interrupted;
interrupted reviews resume the same way. SSE route
`GET /api/reviews/[id]/events` streaming the bus with a 2s polling
fallback endpoint.
Proof: integration tests with fake-CLI scenarios: limit-reached pauses and
resume completes; cancel mid-stage cancels; kill-and-recover marks
interrupted and resumes; SSE endpoint replays current state then streams.

**FOUNDER GATE FG-2 (gate G1).** Deliverable for the gate:
`npm run demo:fixture` (a small tsx script) that builds the seeded fixture,
creates a review, and runs it with the REAL engine on
`claude-haiku-4-5-20251001` by default (cheap smoke) or a `--model` flag
for `claude-fable-5[1m]`, printing live stage progress and the outcome
table: seeded defects found/missed, killed-by-quote-check count, usage and
cost-equivalent. The driver runs the haiku smoke itself and captures the
output into `review/<date>-fg2/`; the maintainer judges pipeline behaviour
and prompt quality, runs the fable variant if desired, and rules on G1.
Work continues into M3 items while awaiting the verdict; only G2-gated
items block on it.

### Milestone M3: a usable app

**T10. HTTP layer and startup plumbing.** Route handlers under
`src/app/api/`: projects CRUD (+ clone kickoff and status, branch list,
links CRUD), reviews (create draft, start, get, list, events SSE, cancel,
resume, delete), findings (confirm, dismiss with reason), report
(rendered, export), rulesets (list, get, update rule enabled/severity,
import, export, version bump), models (list, probe one, probe all),
settings (get, set), auth status. All request/response shapes are zod
schemas in `src/lib/api/` shared with the UI. Startup (instrumentation):
open db, migrate, seed `DEFAULT_MODEL_CANDIDATES`, recover orphans, probe
stale models in the background (never blocking startup). `TRYSQUARE_CLAUDE_PATH`
env override honoured everywhere the CLI is spawned (needed for e2e; D-6).
Proof: route-level integration tests with a real temp data dir and fake
CLI; no UI yet.

**T11. Report renderer (WP-I part). [parallel-safe after T8]**
`src/lib/review/report.ts`: renders confirmed findings in the protocol's
output format: summary, completeness statement from the coverage report and
ledger totals (files, hunks, sweeps, chains read), findings grouped by
severity in the exact finding format, open questions section, footer with
model, profile, ruleset names and versions, commits, usage, duration.
No em dashes in output (unit-tested). Export writes
`exports/<project>-<fromBranch>-<date>.md` (slashes slugged).
Proof: snapshot tests from a seeded database; the no-em-dash and
NITPICK-handling (D-11) tests.

**T12. UI: shell, projects, and new review.** App shell per `04-UI-DESIGN`:
left rail (Projects, Reviews, Rulesets, Settings), global running-review
chip. Projects list + add-by-URL with live clone progress (SSE) and error
surfaced verbatim; project detail with live branch list (filter,
ahead/behind, subject), dependency links management, delete flows per the
two-step rules. New-review screen: from/into pickers defaulting to detected
default branch, ruleset multi-select grouped by tier with rule counts,
model dropdown from the probed registry (recommended first, unavailable
disabled with reason and probe age, probe-now button), linked-project
toggle with same-name branch suggestion, advanced fold (engine mode,
profile downgrade), pre-flight panel (commits pinned, merge base, file and
hunk counts, sweep hits, changed symbols, token estimate vs context window,
profile and estimated request count), Start button.
Proof: `./verify.sh --build` plus a driven dev-server session capturing
screenshots into `review/<date>-m3-ui/`; component logic (pickers,
pre-flight assembly) unit-tested.

**T13. UI: live run screen.** Stage timeline S0-S6 with per-stage status,
duration, tokens; coverage panel counting down pending hunks and sweeps
live; activity feed (current tool use, batch n of m); usage meter; limit
pause banner with reset time and Resume; Cancel; failure state showing the
real error and log path with retry.
Proof: e2e-style test against the dev server with the fake engine driving
a full run; screenshots captured.

**T14. UI: confirmation and report.** Two-pane confirmation per the spec:
list grouped by severity with decided-state chips, detail pane with issue,
comment, rule text (expandable), mechanism, quoted code inside real file
context read from the worktree, the diff hunk, and Confirm / Dismiss
(reason required) / edit-comment-then-confirm. Keyboard-first: j/k
navigate, c confirm, d dismiss (focuses reason field), enter opens file
context. Progress "n of m decided"; finishing renders the report screen
with copy and export. Review list/history per project with merged badges
(`isAncestor` checked on fetch and on open), delete flows.
Proof: e2e with fake engine: confirm one, dismiss one with reason, export;
exported file content asserted to match exactly the confirmed set.

**T15. UI: rulesets manager and settings; interactive engine mode.**
Rulesets: list by tier, detail with ordered rules (code, title, severity,
tags, enabled toggle, per-rule sweep patterns), directives view, import
screen showing the fidelity report (unmapped lines block the import),
export, version bump on edit with the snapshot note. Settings: data dir
display, model registry with probe results and probe-all, stage timeout,
concurrency, default engine mode, danger zone. Interactive Mode B, thin
implementation per `01`: materialise the composed prompt to
`runs/<id>/bundle/stage-<n>-prompt.md`, show the one-line command to run
it in a terminal, watch for `stage-<n>-output.json`, then continue the
pipeline identically (same schemas, same checks).
Proof: e2e for import-with-fidelity-report and a Mode B round trip driven
by the test writing the output file; unit tests for the watcher.

**FOUNDER GATE FG-3 (gate G2).** The maintainer imports their real
protocol locally (never committed), adds a real project, runs a real
review of one of their branches on Fable, and judges findings quality and
the confirmation flow. Driver prepares: a one-page runbook in the repo
wiki-style doc `docs/RUNBOOK.md` (install, start, first review), and sits
on standby for verdicts. G2 rules on findings quality.

### Milestone M4: world class and shipped

**T16. Design pass to the 04 bar (WP-K).** Tokens for type scale, spacing,
severity colours as the only strong colour; dark and light complete; every
screen's empty, loading, error, and long-content states; tabular numerals;
motion 150-200ms; focus states; reduced-motion. The template test answered
in writing per screen in `review/<date>-fg4/DESIGN-NOTES.md`.
Proof: screenshots of every screen in both themes into `review/<date>-fg4/`.

**T17. Accessibility and e2e suite (WP-L part 1).** Playwright: chromium
project (D-13), production build server with temp `TRYSQUARE_DATA` and fake
CLI via `TRYSQUARE_CLAUDE_PATH`; the five spec flows from `05-TESTING.md`
section 3 (add/clone, full review happy path, failure paths incl. limit
pause/resume/cancel/restart-recovery, ruleset import UI, both-theme
screenshots) plus axe checks on every screen (AA). CI updated to install
chromium and run `./verify.sh --build --e2e`.
Proof: `./verify.sh --build --e2e` green locally and in CI.

**T18. Real-engine proof and G1/G3 evidence (WP-L part 2).** Run the
seeded-fixture review with the real engine on Fable 1M; capture the full
outcome (defects found vs manifest, false-positive count, killed-by-quote
count, tokens, cost-equivalent, wall time) into `review/<date>-engine/`.
If seeded defects are missed, iterate prompts (content.ts wording only, not
checks) until the gate passes or the miss is understood and documented;
every prompt change re-runs T7's fake gate first.
Proof: the captured report; `GATES.md` G1 evidence row updated with
numbers.

**T19. Ship: README truth pass and docs close-out.** README status section
rewritten to describe what now works (with the same honesty rules), usage
section with real commands, screenshots; `PROJECT-STATE.md`, `BUILD-PLAN`
final DONE marks; `06-MODELS-AND-PROFILES` re-verified against the current
CLI version; CONTRIBUTING updated for e2e. Everything committed and pushed;
CI green.

**FOUNDER GATE FG-4 (gate G3).** Design judgment on the FG-4 screenshots,
acceptance of the engine-gate evidence, v1 verdict.

## 3. Dependency map (who waits for whom)

T1 -> T2 -> T3 -> T4 -> T5 -> T8 -> T9 -> T10 -> T12 -> T13 -> T14 -> T16
T6 independent; T7 needs T1-T6. T11 needs T8 (parallel with T9-T10).
T15 needs T10 (Mode B part needs T9). T17 needs T13-T15. T18 needs T7+T9.
T19 last. FG-2 after T9; FG-3 after T15; FG-4 after T18.

## 4. Founder gates (the only stops)

- FG-2 / G1 after T9: judge the fixture run and prompts. Blocks nothing
  except G2 sign-off; the driver continues into M3 while waiting.
- FG-3 / G2 after T15: judge a real review of the maintainer's own branch.
  Blocks T18's "iterate prompts" only if verdicts demand changes.
- FG-4 / G3 after T18-T19: design and ship verdict.

## 5. Pre-resolved decisions (the driver does not ask about these)

- D-1 Default port stays Next's 3000; e2e uses 3100 as already configured.
- D-2 Data dir default stays `~/.local/share/trysquare`; e2e and demo use a
  temp dir via `TRYSQUARE_DATA`.
- D-3 Stage timeout default 20 minutes per stage, setting
  `stageTimeoutMinutes`; probes keep their own shorter timeouts.
- D-4 Concurrency default 1 running review; others queue in creation order.
- D-5 Default model: last used; first run `claude-fable-5[1m]` when probed
  available, else the first available recommended candidate.
- D-6 `TRYSQUARE_CLAUDE_PATH` overrides the CLI binary everywhere (engine,
  probe, auth status); unset means `claude` on PATH.
- D-7 Stage inputs are inlined into user prompts from the bundle (diff,
  inventory, sweep hits, base copies). The model's tools stay Read/Grep/Glob
  in the worktree only; no `--add-dir`, no bundle access.
- D-8 Token estimate heuristic: ceil(chars/4) over system + user prompt,
  threshold 80% of the probed context window; greedy file-group splitting
  by prompt-chunk size, never dropping content.
- D-9 JSON extraction from a stage result: strip a single fenced block if
  present, else scan for the first balanced `{...}`; anything else is
  schema-invalid and triggers the repair round.
- D-10 Batch exclusions and per-run notes are stored on the review row as a
  JSON `runNotes` column (one migration; append-only array of dated notes)
  and shown on the run screen. Simpler than a new table; revisit only if
  notes outgrow it.
- D-11 The report includes every finding the human confirmed, NITPICKs
  included: a confirmed finding is a decision already made, and the
  imported protocol's own severity policy governs what the model raises,
  not what the human may keep.
- D-12 Findings' file context in the confirmation UI is read from the
  worktree while the review awaits confirmation; the worktree is therefore
  removed on `complete`/`cancelled`/`failed`, not at pipeline end. (Adjusts
  T8's cleanup rule; the audit trail of quoted code is already stored on
  the finding rows.)
- D-13 e2e runs chromium only. Cross-browser is not a v1 concern for a
  local single-user tool.
- D-14 UI components are hand-built on Tailwind tokens; no component
  library. The 04 bar ("nothing that reads as template output") is easier
  to hit from below than by fighting a kit's defaults.
- D-15 SSE first with a 2-second polling fallback endpoint; no websockets.
- D-16 Keyboard map for confirmation: j/k next/previous, c confirm, d
  dismiss (focus reason), e edit comment, enter toggle file context, g g /
  G list top/bottom. Shown in a footer hint bar.
- D-17 Report filename: `exports/<project-slug>--<from>--into--<to>--<UTC
  date>.md`, branch slashes replaced with `-`.
- D-18 The demo script's default model is haiku (cheap smoke of plumbing);
  judging PROMPT quality at FG-2 uses `--model claude-fable-5[1m]`
  explicitly, because haiku's findings do not represent the product.
- D-19 Merged detection runs on every fetch and on opening a review list;
  a merged pair shows the badge and cleanup affordance; nothing
  auto-deletes (existing decision restated for the driver).
- D-20 verify.sh stays the single gate; e2e joins it only behind `--e2e`
  (CI runs it; local default stays fast).

## 6. Progress table

| Item | Blocked on | Status |
| ---- | ---------- | ------ |
| T1   | -          | TODO   |
| T2   | T1         | TODO   |
| T3   | T1         | TODO   |
| T4   | T1         | TODO   |
| T5   | T4         | TODO   |
| T6   | -          | TODO   |
| T7   | T1-T6      | TODO   |
| T8   | T5         | TODO   |
| T9   | T8         | TODO   |
| FG-2 | T9 (+T7)   | GATE   |
| T10  | T9         | TODO   |
| T11  | T8         | TODO   |
| T12  | T10        | TODO   |
| T13  | T12        | TODO   |
| T14  | T13, T11   | TODO   |
| T15  | T10 (T9 for Mode B) | TODO |
| FG-3 | T15        | GATE   |
| T16  | T14, T15   | TODO   |
| T17  | T13-T16    | TODO   |
| T18  | T7, T9     | TODO   |
| T19  | T17, T18   | TODO   |
| FG-4 | T18, T19   | GATE   |
