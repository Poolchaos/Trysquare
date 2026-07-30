# 05 Testing and proof

Status: DRAFT 2026-07-30, pending G0 ratification. Workspace law applies:
"verified" means `./verify.sh` exited 0; a red test is stop-the-line; fix
the bug, never the test.

## 1. verify.sh (lands with the first code commit, WP-A)

Gates in order: lint (eslint), format check (prettier), typecheck
(tsc --noEmit), unit+integration (vitest). Flags: `--build` adds
`next build`; `--e2e` adds Playwright against a production build. Mechanics
copied from the family pattern: `set -uo pipefail`, output captured, exit
status checked separately from the pipe, output grepped for a narrow error
marker list, per-step timeout, VERIFIED/FAILED summary naming what was not
proven (e.g. "no e2e"). Both failure branches are deliberately exercised
once at creation to prove the gate fires.

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
  claude binary** (a Node script on PATH in tests) that replays scripted
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
3. Failure paths: stage failure surfaces real error and retry works; limit
   pause and resume; cancel; server-restart interruption resume.
4. Ruleset import UI shows fidelity report; edit bumps version; old review
   snapshot unchanged.
5. Both themes screenshotted per screen; axe accessibility checks pass.

## 4. The seeded-bug fixture (engine quality gate)

`tests/fixtures/seeded-repo/`: a small realistic TypeScript/React app with
a `main` and a `feature` branch. The feature branch seeds defects mapped to
protocol rules, at minimum: an id-vs-_id lookup mismatch behind an index
signature (the canonical bug), a deleted await, a swallowed error, a
floating-point money calc, a timezone boundary bug, a duplicated merge
helper, a weakened test assertion, a deleted guard clause, plus two clean
hunks that must NOT produce findings. `seed-manifest.json` records each
defect: file, lines, rule code, expected severity.

`tests/fixtures/seeded-core/`: a companion package repo consumed by
seeded-repo (the app/shared-core shape). Its feature branch seeds cross-repo
contract bugs: a renamed field on an exported interface with one consumer
in seeded-repo left unmigrated, and a changed default value no consumer
opted into. The linked-review gate asserts both are found, and that a
linked review of the same branches with the contract bugs fixed produces
all-consumers-verified clears instead.

Gate assertions (fake engine in CI; real engine manually pre-release):

- every manifest defect is reported or explicitly an open question;
- zero surviving findings whose quoted code fails the byte-match check;
- the two clean hunks produce no confirmed findings;
- coverage invariants hold (no pending hunks/sweeps).

The real-engine run's report and usage numbers are captured into
`review/<session>-engine/` as the proof artifact before any release claim.

## 5. Numbers or silence

Any claim about review runtime, token usage, or app performance ships with
its measurement (fixture, model, N, result) or is not made at all.
