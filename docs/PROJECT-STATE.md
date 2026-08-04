# Project state

The live cache. Current facts only; if a change makes a line here wrong,
fixing it is part of that change. Dates are absolute (YYYY-MM-DD).

Last verified: 2026-08-03

## Status

- Gate G0 (brief and plan) PASSED 2026-07-30. Gate G1 (working pipeline) is
  ACTIVE with all evidence captured, including the 2026-08-04 real-engine
  smoke runs (haiku refusal D-57, the symbol-path fix D-58, two clean fable
  runs at 8/8): see `plans/FG2-CHECKLIST.md` and `review/2026-08-04-fg2/`.
  The verdict is the maintainer's, and nothing in this repository marks it
  passed.
- The app is usable end to end. A person can add a project from a git URL, see
  its branches, set up a review with a pre-flight estimate, watch it run,
  decide every finding, complete it, and export a report.
- Milestone M2 is finished: `plans/M2-FINISH-PLAN.md` items W1-W8 are DONE,
  including checkpointed resume, the job manager, SSE, and the demo script.
- Milestone M3 is finished: `plans/M3-FINISH-PLAN.md` items V1-V9 are DONE.
- A full audit on 2026-08-03 found the gate red on this machine, two pipeline
  promises that were decorative rather than enforced, and a records set two
  milestones behind the code. The verified gap inventory and the remaining
  work to v1 are in `plans/M4-FINISH-PLAN.md` (items U1 to U13). As of
  2026-08-04 all twelve build-plan work packages are DONE; what remains is
  the two maintainer judgments, the G1 verdict and the FG-4 design
  acceptance.
- The two external AI plans never arrived. They fold in as spec amendments if
  they do; they did not block the build.

## Stack (installed and proven 2026-07-31)

Node 22.22.1, npm 11.17.0, git 2.43.0, Claude Code 2.1.71 on Linux.

next ^16.2.12, react ^19.2.8, typescript ^6.0.3, drizzle-orm ^0.45.2,
drizzle-kit ^0.31.10, better-sqlite3 ^13.0.2, zod ^4.4.3, tailwindcss ^4.3.3,
vitest ^4.1.10, @playwright/test ^1.62.0 (chromium installed), eslint ^9.39.5,
prettier ^3.9.6, ulid ^3.0.2.

TypeScript runs strict plus `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`.

## Commands

See `CLAUDE.md` section 3. `./verify.sh` is the single gate. As of 2026-08-04
it passes with `--build --e2e`: 681 unit tests passing and 6 skipped across 45
files, plus 30 browser tests (the journey, the failure paths, the theme and
screenshot pass, and axe over every screen in both themes). CI runs `./verify.sh --build --e2e`;
the local default leaves both off so it stays fast.

`npm run demo:fixture -- --fake` reviews the seeded fixture end to end with no
model and no money, scoring the result against the fixture's manifest.

## Environment

- `TRYSQUARE_DATA` - the data root, default `~/.local/share/trysquare`. Holds
  `db.sqlite`, `projects/`, `runs/` and `exports/`.
- `TRYSQUARE_CLAUDE_PATH` - the binary reviews run through, default `claude`
  on PATH. Every run records which one it used as a run note.

## Settings

Stored in the `settings` table, edited on the settings screen. Only these keys
are accepted; anything else is refused by name.

- `maxConcurrentReviews` (default 1). Two reviews share one usage limit.
- `stageTimeoutMinutes` (default 20).
- `stageMaxBudgetUsd` (default 15). A ceiling on any single model call; zero
  removes the ceiling.

## Structure

- `CLAUDE.md` - charter. `docs/` - specs, ledgers, plans.
- `src/lib/` - pure and I/O free: paths, ids, domain enums and state machines,
  git diff and URL parsing, changed exported symbols, mechanical sweeps, the
  quotation check, stage schemas, budget arithmetic, ruleset import with a
  fidelity gate, prompt composition, batch planning, and the report renderer.
- `src/server/db/` - schema (14 tables), client, migrations 0000 to 0009, and
  repositories for projects, reviews, ledger, findings, models, rulesets,
  settings and stage executions.
- `src/server/gitops/` - the only code that spawns git.
- `src/server/engine/` - the only code that spawns claude, plus the
  `ReviewEngine` seam and the interactive (Mode B) engine, which spawns
  nothing and exchanges prompt and answer files with a person's own session.
- `src/server/review/` - the pipeline, the engine runner, the checkpointing
  runner that makes a resumed stage free, the service that runs a review from
  a row, merged detection, and the report assembler.
- `src/server/jobs/` - the event bus, the job manager, and the SSE stream.
- `src/server/api/` - one response shape for every route.
- `src/app/api/` - 32 route handlers. `src/app/` - 9 screens, plus a root
  error boundary, a not-found page, and a metadata layout per segment.
- `src/components/` - the shared UI vocabulary, the left rail, and the
  confirmation queue.
- `scripts/` - the house-style gate, the leak gate, the nothing-hidden gate,
  and the fixture demo.
- `tests/fixtures/example-protocol.md` - the public sample protocol the
  fidelity gate runs against.
- `tests/fixtures/fake-claude.mjs` - stand-in CLI, so tests are hermetic and
  cost nothing.
- `tests/` - unit and integration tests. `e2e/` - the browser journey, the
  theme and screenshot pass, and the axe accessibility pass.
  `drizzle/` - ten committed migrations.
- `verify.sh` - the gate.

Runtime layout on disk is specced in `01-ARCHITECTURE.md` section 5 and
implemented by `src/lib/paths.ts`.

## Screens

`/projects`, `/projects/[id]`, `/reviews`, `/reviews/new`, `/reviews/[id]`,
`/rulesets`, `/rulesets/[id]`, `/settings`. The root redirects to projects.

## Known issues

- One Turbopack build warning remains, traced to the engine's per-review log
  paths, which cannot be static. It affects only the standalone output
  manifest, which this app does not use. Adopting `output: "standalone"`
  voids that acceptance; the re-check trigger is in `DECISIONS.md`.
- The 9 high npm advisories accepted on 2026-07-30 are gone. Re-checked
  2026-08-03: `npm audit` reports 0 vulnerabilities across 586 dependencies
  (28 production, 520 dev, 187 optional). The accepted risk is discharged; its
  re-check trigger has fired and needs no further action.
- Next's build rewrites `tsconfig.json` (sets `jsx: react-jsx`, adds
  `.next/dev/types`). Run prettier on it after a build or the format gate
  fails on the next run.
- An interrupted Playwright run can leave its server holding port 3100, and
  the next `--e2e` then fails saying the port is in use. Reusing an existing
  server is deliberately not allowed, because it would run the journey
  against a server started without the fake engine.

## Not built

- More than one dependency per review: the model and the screens take a
  single linked project.
- Emailing a report (`plans/idea-inbox.md`).
- Any authentication. This is a local, single-user tool by design.

## External services

None. Reviews run through the local `claude` CLI on the maintainer's Max
subscription; see `06-MODELS-AND-PROFILES.md`.
