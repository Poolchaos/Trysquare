# 05 Testing and proof

Status: RATIFIED 2026-07-30 at G0. Workspace law applies:
"verified" means `./verify.sh` exited 0; a red test is stop-the-line; fix
the bug, never the test.

## Not built yet

This document specifies the target. Verified against the code on 2026-08-03,
these parts of it do not exist yet. They stay here as requirements rather
than being edited away. An item of `plans/M4-FINISH-PLAN.md` named beside
one owned it while that plan ran; the plan is closed, and what is still
unbuilt is listed here and in `PROJECT-STATE.md`, Not built.

- Flow 3 of section 3 is now in a browser for the limit pause with resume
  and for cancel mid-stage; stage failure stays at the integration layer,
  and D-55 keeps restart recovery there. U12.

## 1. verify.sh (lands with the first code commit, WP-A)

Gates in order: lint (eslint), format check (prettier), typecheck
(tsc --noEmit), house style, no private material, nothing hidden from git,
no dead exports, unit+integration (vitest). Flags: `--build` adds
`next build`; `--e2e` adds Playwright against a production build. Mechanics
copied from the family pattern: `set -uo pipefail`, output captured, exit
status checked separately from the pipe, output grepped for a narrow error
marker list, per-step timeout, VERIFIED/FAILED summary naming what was not
proven (e.g. "no e2e"). Both failure branches are deliberately exercised
once at creation to prove the gate fires.

The marker scan reads the output from a temporary file, never through
`printf | grep -q` and never from a here-string. Under `pipefail` the pipe
form reported a pass whenever a marker sat early in output over about
100KB, because `grep -q` exits at the match and the writer dies of SIGPIPE
(MVP-PLAN WP 1.1, measured 2026-10-16). Git Bash 5.2.37 hangs writing a
here-string of 65,537 to 65,664 bytes, which held Windows CI run
39115191562 for 35 minutes (D-134, measured 2026-10-18). A grep status
other than 1 counts as a marker, and so does a write to the temporary file
that fails, so neither grep failing nor a short file can read as clean
(D-135). Every run starts with a self-check: a 300KB output with the
marker first, then last, then absent, and a 65,600-byte output with the
marker absent, then last. It runs in a child process limited to 60
seconds, so a scan that hangs fails the gate instead of hanging it: with the
here-string scan swapped back in, it failed at 60 seconds (D-135). The gate
fails unless all five read correctly. The check took about 0.3s on Windows
(three runs, 318 to 321 ms).

## 2. Unit and integration (vitest)

- `lib/git`: diff/hunk parsing against captured real-git outputs (renames,
  deletions, binary files, mode changes, empty diffs); inventory
  correctness is exhaustively fixtured since the ledger depends on it.
- `lib/rulesets`: protocol import fidelity (the permanent gate). The gate
  runs against `tests/fixtures/example-protocol.md`, a public sample
  protocol committed to this repo that exercises every structural feature of
  the importer: process-directive sections, numbered and lettered rules,
  violation and correct-pattern code fences, detection hints, severities, and
  a sweep table. It asserts zero unmapped lines and a clean round-trip
  export. **The gate must never depend on a private document**: a test whose
  input is gitignored makes `./verify.sh` unrunnable for every contributor
  and turns the single definition of "verified" into something only one
  machine can produce. Importing a real private protocol is an optional local
  check, run by pointing the same importer at a path given on the command
  line, never a committed test. Composition snapshot tests per stage.
- `lib/review`: ledger invariants, finding state machine, report renderer
  (including the no-em-dash lint), mechanical quote-match check (S5).
- `server/gitops` (integration, real git in tmp dirs): clone, fetch,
  worktree add/prune, bundle build, worktree-untouched assertion after a
  full pipeline run.
- `server/engine`: stream-json parsing from captured transcripts; error
  classes (timeout, limit, invalid output, spawn failure); the **fake
  claude binary** (a Node script handed to the engine by its path) that replays scripted
  stage outputs, so pipeline tests run hermetically with zero tokens.
- `server/db`: repository functions and state-machine transition
  enforcement against a throwaway SQLite file.

## 3. e2e (Playwright)

Runs against a real server + real git + **fake engine** (scripted stage
outputs), on a generated fixture project:

1. Add project (local fixture remote), clone, see branches.
2. Full review happy path: setup, run, watch stages, confirm one finding,
   dismiss one with reason, render and export report; assert report content
   matches confirmed findings exactly.
3. Failure paths: stage failure surfaces real error and a resume carries on (D-50); limit
   pause and resume; cancel; server-restart interruption resume.
4. Ruleset import UI shows fidelity report; edit bumps version; old review
   snapshot unchanged.
5. Both themes screenshotted per screen; axe accessibility checks pass.

## 3b. Proof for anything a person sees

Binding on every change to a screen, whoever makes it (the maintainer's rule,
set 2026-10-23, recorded here 2026-11-03 so it travels with the repository).

1. **Driven in the browser.** An e2e test drives each screen and each state
   the change touches (open, closed, empty, failed, and so on) and saves a
   screenshot of each, in the light and dark projects, at desktop width and
   at 360px for phone. `e2e/themes.spec.ts` runs in both theme projects and
   shows the pattern: `photograph()`, `settled()` before axe, and
   `setViewportSize` for phone. Screenshots land in `review/<date>-e2e/`.
2. **Measured, not only pictured.** What a picture hides is asserted: axe
   finds nothing at WCAG 2.1 AA, the page does not scroll sideways, and text
   meant to be read sits inside the screen.
3. **Graded by looking.** Each screenshot is opened and graded against
   `04-UI-DESIGN.md`:
   - A: ready to ship, nothing to change.
   - B: ready to ship, minor polish noted that no user would trip on.
   - C: works but visibly off: alignment, spacing, overflow, contrast,
     hierarchy or copy.
   - D: broken or misleading: clipped, overlapping, unreadable, the wrong
     state or the wrong data.
4. **Only A and B pass.** A C or D is fixed and photographed again before
   the work counts as done.
5. **Recorded with the change.** Each grade, with one line of why, goes in
   the commit message or the PR body, with the folder the screenshots are in.

A width or state the maintainer has deferred as a logged bug (Known issues in
`PROJECT-STATE.md`) is still photographed and graded, and its grade names the
bug. It does not block the change; only the maintainer defers one.

## 4. The seeded-bug fixture (engine quality gate)

Neither repository below is kept in this one: `tests/fixtures/build-seeded-repos.mjs`
builds both, with `seed-manifest.json`, into a directory its caller names.

`seeded-repo/`: a small realistic TypeScript/React app with
a `main` and a `feature` branch. The feature branch seeds defects mapped to
protocol rules, at minimum: an id-vs-_id lookup mismatch behind an index
signature (the canonical bug), a deleted await, a swallowed error, a
floating-point money calc, a timezone boundary bug, a duplicated merge
helper, a weakened test assertion, a deleted guard clause, plus two clean
hunks that must NOT produce findings. `seed-manifest.json` records each
defect: file, lines, rule code, expected severity.

`seeded-core/`: a companion package repo consumed by
seeded-repo (the app/shared-core shape). Its feature branch seeds cross-repo
contract bugs: a renamed field on an exported interface with one consumer
in seeded-repo left unmigrated, and a changed default value no consumer
opted into. The linked-review gate asserts both are found, and that a
linked review of the same branches with the contract bugs fixed produces
all-consumers-verified clears instead.

Gate assertions (fake engine in CI; real engine manually pre-release):

- every manifest defect is reported or explicitly an open question;
- zero surviving findings whose quoted code fails the quotation check;
- the two clean hunks produce no confirmed findings;
- coverage invariants hold (no pending hunks/sweeps).

The real-engine run's report and usage numbers are captured into
`review/<date>-fg2/<time>-<model>/` as the proof artifact before any release claim.

## 4b. The design fixture (WP-I step 6)

`tests/fixtures/build-design-fixture.mjs` builds a small storefront whose
`feature/checkout-screens` branch adds four screens beside main's two,
with a design standard (`DESIGN.md`) and its own e2e (`e2e/shoot.mjs`),
which photographs every page at 1280 and 390 pixels wide: twelve
screenshots, two grading requests. Three carry a planted defect: the
checkout table, 640 pixels wide, runs off a phone; the receipt's order line
is light grey on white; the profile's button label is cut off by its box.
The key, `design-manifest.json`, names the defect each screenshot shows, or
none. `tests/server/projectrun/design-fixture.test.ts` runs that e2e as the
app runs a project's and measures every page in Chromium at the key's
width (sideways scroll, text contrast under 4.5:1, text cut off by a box
that hides its overflow), and holds the key to exactly what it measures.
The e2e is handed the path of a Playwright install, the fixture having
none of its own. `scripts/lib/design-demo.ts` reviews it end to end with
its checks on and scores each screenshot against the key (found, missed,
a clean screen failed by both graders, or by one);
`tests/scripts/design-demo.test.ts` runs that on the fake engine, and
`npm run demo:design -- --real` runs it on a real model (WP-J).

## 5. Numbers or silence

Any claim about review runtime, token usage, or app performance ships with
its measurement (fixture, model, N, result) or is not made at all.
