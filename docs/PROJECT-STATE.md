# Project state

The live cache. Current facts only; if a change makes a line here wrong,
fixing it is part of that change. Dates are absolute (YYYY-MM-DD).

Last verified: 2026-10-22, against the code at 89901b5 (MVP 7.2).

## Status

- 2026-10-22: the MVP (`plans/MVP-PLAN.md`) is built but for what spends
  usage: every row of phases 1 to 7.1 is DONE except 4.2, a measurement
  that spends, and 3.7's hand-drive of Mode B, folded into 7.4. Left are
  this records pass (7.2), then 4.2, a fresh real run of the fixture on
  Windows for the G1 verdict (7.3) and the maintainer's own review (7.4),
  each waiting for the maintainer's go on spend. `./verify.sh --build
  --e2e` exits 0 on the maintainer's Windows 11 machine at 89901b5, with
  1171 unit tests passing, 8 skipped, and 99 browser tests, and CI passes
  it on `ubuntu-latest`, `windows-latest` and `macos-latest` at every
  push (run 39766201111 at 89901b5). Real models have run on Linux only.
- 2026-10-16: two audits on the maintainer's Windows 11 machine found the
  app did not install, test or run there (`plans/AUDIT-2026-10-16.md`
  section 2). The same day MVP phases 1 to 3 made it green there and on all
  three platforms in CI: `./verify.sh --build --e2e` exits 0 on the
  maintainer's Windows 11 machine, and CI run 38954795087 at 268d918 passed
  it on `ubuntu-latest`, `windows-latest` and `macos-latest` (808 unit
  tests, 6 skipped, 41 browser tests each), with the fake demo after it. No
  real model has run on Windows or macOS. The work to the MVP is
  `plans/MVP-PLAN.md` (D-85), with G1 re-scoped to cover Linux, Windows and
  macOS (D-86).
- Gate G0 (brief and plan) PASSED 2026-07-30. Gate G1 (working pipeline) is
  ACTIVE. Its Linux evidence is the 2026-08-04 real-engine smoke runs (haiku
  refusal D-57, the symbol-path fix D-58, two clean fable runs at 8/8): see
  `plans/FG2-CHECKLIST.md` and `review/2026-08-04-fg2/`, a directory git
  ignores and which this Windows machine does not hold. Re-scoped on 2026-10-16
  (D-86), it also needs the fresh Windows run of MVP 7.3. The verdict is
  the maintainer's, and nothing in this repository marks it passed.
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
  2026-08-04 all twelve build-plan work packages are DONE.
- The 2026-08-17 UX audit and the 2026-08-18 dashboard shell (D-68, D-69,
  D-79, D-81) reshaped the surface: a top bar in place of the left rail, a
  widget dashboard at `/`, a full-screen scan theater, a queue-first review
  screen and a rendered report. `plans/UX-UPLIFT-PLAN.md` and
  `plans/DASHBOARD-SHELL-PLAN.md` carry the row-by-row state; three rows are
  open (WP-G completion moment, WP-K queue phone layout, WP-L my branches),
  outside the MVP (its non-goals). The FG-4 design acceptance is now part of
  G3, the public release after the MVP (D-86); its argument is
  `review/2026-08-18-fg4/DESIGN-NOTES.md`.
- The two external AI plans never arrived. They fold in as spec amendments if
  they do; they did not block the build.

## Stack (installed and proven on each machine on the date given)

Linux, 2026-07-31: Node 22.22.1, npm 11.17.0, git 2.43.0, Claude Code 2.1.71.
Windows 11, 2026-10-22: Node 22.17.0, npm 10.9.2, git 2.50.0.windows.1,
Claude Code 2.1.301 (the bundled CLI, D-92). Review stages now refuse a CLI
below 2.1.301 (D-91), so the Linux line's CLI would be refused today.

next ^16.3.8 (2026-10-16), react ^19.2.8, typescript ^6.0.3, drizzle-orm ^0.45.2,
drizzle-kit ^0.31.10, better-sqlite3 ^12.11.1 (D-87, 2026-10-16), zod ^4.4.3, tailwindcss ^4.3.3,
vitest ^4.1.12, @playwright/test ^1.62.0 (chromium installed), eslint ^9.39.5,
prettier ^3.9.6, ulid ^3.0.2, @anthropic-ai/claude-code 2.1.301 (exact).

TypeScript runs strict plus `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`.

## Commands

See `CLAUDE.md` section 3, whose commands were last re-proven on this
Windows 11 machine on 2026-10-22: `./verify.sh`, with `--build` and
`--e2e`, `npm run dev`, `npm run start`, `npm test`, `npm run typecheck`,
`npm run lint`, `npm run format`, `npm run e2e` and `npm run
db:generate`. `./verify.sh` is the single gate. At 89901b5 it passes
with `--e2e` on Windows 11, 1171 unit tests passing and 8 skipped, plus
99 browser tests (the journey, the failure paths, the theme and
screenshot pass, the phone-width pass, and axe over every screen in both
themes; the shutdown pass runs on Linux and macOS only). `--e2e` implies `--build` since 2026-08-18, because Playwright serves
the last build and without it the browser gate can pass against output that
predates the change under test (D-70). CI runs `./verify.sh --build --e2e`
and then the fake demo on Ubuntu, Windows and macOS (MVP WP 3.6); the local
default leaves build and e2e off so it stays fast.

`npm run demo:fixture -- --fake` reviews the seeded fixture end to end with no
model and no money, scoring the result against the fixture's manifest.

## Environment

- `TRYSQUARE_DATA` - the data root, default `~/.local/share/trysquare`. Holds
  `db.sqlite`, `projects/`, `runs/` and `exports/`.
- `TRYSQUARE_CLAUDE_PATH` - the binary reviews run through. Unset, it is the
  CLI path kept on Settings (the `claudePath` setting, read as each run
  starts and each check runs, D-152), then the
  Claude Code CLI installed as a dependency (`@anthropic-ai/claude-code`
  2.1.301, D-92), then `claude` on PATH. Every run records which one it used
  as a run note. Resolved by
  `src/server/engine/cli.ts`: a bare name is looked up on PATH (PATHEXT order
  on Windows), a `.js`/`.mjs` runs under Node, and on Windows an npm `.cmd`
  shim is read for the program it launches; anything else that cannot be
  started without a shell is refused by name.

## Settings

Stored in the `settings` table, edited on the settings screen. Only these keys
are accepted; anything else is refused by name.

- `maxConcurrentReviews` (default 1). Two reviews share one usage limit.
- `stageTimeoutMinutes` (default 20).
- `stageMaxBudgetUsd` (default 15). A ceiling on any single model call; zero
  removes the ceiling.
- `claudePath` (default empty). The CLI reviews run through, which
  `TRYSQUARE_CLAUDE_PATH` wins over (D-152).

## Structure

- `CLAUDE.md` - charter. `docs/` - specs, ledgers, plans.
- `src/lib/` - pure and I/O free: paths, ids, domain enums and state machines,
  git diff and URL parsing, a branch pair kept apart, changed exported
  symbols, mechanical sweeps, the quotation check, stage schemas, budget
  arithmetic, ruleset import with a fidelity gate, prompt composition, batch
  planning, the report renderer, the request guard, and matching an error by
  the name its class sets.
- `src/server/db/` - schema (14 tables), client, migrations 0000 to 0011, and
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
- `src/server/projects/` - cloning a project in the background.
- `src/server/runtime.ts` - the one door to the database and the job
  manager; `data-dir-lock.ts` - one server per data directory;
  `cli-path.ts` and `cli-readiness.ts` - which CLI reviews use and whether
  it can run one; `real-path.ts` - a path resolved through its links.
- `src/server/api/` - one response shape for every route.
- `src/proxy.ts` - the request guard in front of every route (MVP WP 2.3).
- `src/app/api/` - 35 route handlers. `src/app/` - 9 screens, plus a root
  error boundary, a not-found page, and a metadata layout per segment.
- `src/components/` - the shared UI vocabulary, the top bar, and the
  confirmation queue.
- `scripts/` - the house-style gate, the leak gate, the nothing-hidden gate,
  the dead-export gate, the fixture demo, and `claude.ts`, which `npm run
  claude` runs to sign in the CLI reviews use (MVP 6.3).
- `tests/fixtures/example-protocol.md` - the public sample protocol the
  fidelity gate runs against.
- `tests/fixtures/fake-claude.mjs` - stand-in CLI, so tests are hermetic and
  cost nothing.
- `tests/` - unit and integration tests. `e2e/` - the browser journey, the
  failure paths, the theme and screenshot pass with the axe accessibility
  pass, and the shutdown pass.
  `drizzle/` - twelve committed migrations.
- `verify.sh` - the gate.

Runtime layout on disk is specced in `01-ARCHITECTURE.md` section 5 and
implemented by `src/lib/paths.ts`.

## Screens

`/` (the dashboard), `/projects`, `/projects/[id]`, `/reviews`,
`/reviews/new`, `/reviews/[id]`, `/rulesets`, `/rulesets/[id]`, `/settings`.
The root was a redirect to projects until 2026-08-17 and is a screen of its
own now (D-75, D-81).

## Known issues

- One Turbopack build warning remains, traced to the engine's per-review log
  paths, which cannot be static. It affects only the standalone output
  manifest, which this app does not use. Adopting `output: "standalone"`
  voids that acceptance; the re-check trigger is in `DECISIONS.md`.
- `npm audit --omit=dev` reports 0 vulnerabilities (2026-10-16, after MVP
  WP 2.1 moved next from 16.2.12 to 16.3.8, which carried a critical
  "Unauthenticated Remote Code Execution on windows-hosted servers"). The
  full audit reports 5 high, all one dev-only chain through
  eslint-config-next to `braces`, which has no fixed release; accepted in
  D-89 with its re-check trigger.
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
- More than one ruleset per review, so tiers compose: designed, not built.
- Emailing a report (`plans/idea-inbox.md`).
- Any authentication. This is a local, single-user tool by design.

## External services

None. Reviews run through the local Claude Code CLI, installed with the app
(D-92), on the claude.ai subscription sign-in it shares with the editor's
Claude Code, by default: API keys and paid providers in the server's
environment are kept from it, a sign-in that bills per token, or may, is
said on Settings and before Start, and a review on one starts only once
its page has said so (D-161, D-162). The CLI gets only what it needs to
run and the sign-in (D-174); a managed Claude Code policy, which no flag
keeps out, is said where one is found (D-175); see
`06-MODELS-AND-PROFILES.md`.
The CLI is Anthropic's, "All rights reserved. Use is subject to the Legal
Agreements" at
<https://code.claude.com/docs/en/legal-and-compliance>, and each user
downloads it from npm under those terms.
