# Project state

The live cache. Current facts only; if a change makes a line here wrong,
fixing it is part of that change. Dates are absolute (YYYY-MM-DD).

Last verified: 2026-07-30

## Status

- Gate G0 (brief and plan) PASSED 2026-07-30. Gate G1 (working pipeline) is
  ACTIVE. Build order: `plans/BUILD-PLAN.md`.
- WP-A (scaffold and gates) complete and verified 2026-07-30, not yet
  committed (commits happen only when the maintainer asks).
- Next up: WP-D (ruleset domain) and WP-E (engine) are unblocked. WP-F
  (pipeline) needs both.
- The two external AI plans have not arrived. They fold in as spec
  amendments when they do; they do not block the build.

## Stack (installed and proven 2026-07-30)

Node 22.22.1, npm 11.17.0, git 2.43.0, Claude Code 2.1.71 on Linux.

next ^16.2.12, react ^19.2.8, typescript ^6.0.3, drizzle-orm ^0.45.2,
drizzle-kit ^0.31.10, better-sqlite3 ^13.0.2 (native binding verified
working), zod ^4.4.3, tailwindcss ^4.3.3, vitest ^4.1.10,
@playwright/test ^1.62.0 (browsers NOT yet installed), eslint ^9.39.5,
prettier ^3.9.6, ulid ^3.0.2.

TypeScript runs strict plus `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`.

## Commands

See `CLAUDE.md` section 3. `./verify.sh` is the single gate and passes as of
2026-07-30, including `--build`. Its failure branches are proven, not
assumed: non-zero exit, error marker printed while exiting 0, step timeout,
and house-style violations (em dash and emoji) each fail the gate; a clean
tree passes. `--e2e` has never run: there are no e2e specs yet and no
Playwright browsers installed.

## Structure

- `CLAUDE.md` - charter. `docs/` - specs, ledgers, plans.
- `src/lib/` - pure domain logic: `paths.ts`, `ids.ts`, `domain/enums.ts`,
  `domain/state-machines.ts` (review and finding state machines).
- `src/server/db/` - schema (14 tables), client, migrations, and
  repositories for projects, reviews, ledger, findings, models, settings.
- `src/lib/git/` - pure git logic: diff parsing, URL validation, changed
  exported symbols.
- `src/server/gitops/` - the only code that spawns git: clone, fetch, refs,
  worktrees, bundle builder.
- `drizzle/` - the committed initial migration.
- `src/app/` - Next App Router (placeholder page only).
- `src/server/`, `src/components/` - not created yet.
- `scripts/check-style.mjs` - house-style gate.
- `tests/` - unit tests. `e2e/` - not created yet.
- `verify.sh` - the gate.

Runtime layout the app will create on disk is specced in
`01-ARCHITECTURE.md` section 5 and implemented by `src/lib/paths.ts`.

## Known issues

- 9 high npm advisories remain, all the same `brace-expansion` DoS reached
  through minimatch 3.x inside eslint and eslint-config-next's plugins. No
  compatible patched version exists; forcing the patched 5.0.8 breaks eslint
  (verified). Lint-time dev dependency only. Reasoning and re-check trigger
  in `DECISIONS.md` (2026-07-30 ACCEPTED RISK).
- Next's build rewrites `tsconfig.json` (sets `jsx: react-jsx`, adds
  `.next/dev/types`). Run prettier on it after a build or the format gate
  fails on the next run.

## External services

None. Reviews run through the local `claude` CLI on the maintainer's Max
subscription; see `06-MODELS-AND-PROFILES.md`.
