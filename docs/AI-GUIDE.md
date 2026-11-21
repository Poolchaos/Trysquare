# Guide for an AI working on Trysquare

Written for Claude Code sessions. It says where things are and how common
changes are made. The rules are in `CLAUDE.md` (repository root) and win
over anything here; current facts are in `PROJECT-STATE.md`. If this guide
and the code disagree, the code is right and this guide is fixed in the same
change.

## Before any change

1. Read `CLAUDE.md`, then `.claude/handover/HANDOVER.md` if the last session
   left one, then `PROJECT-STATE.md`, then `GATES.md`. Work beyond the active
   gate is said, not started.
2. Find the feature in the index below, and read its spec section before its
   code.
3. "Verified" means `./verify.sh` exited 0. Add `--build` for the production
   build and `--e2e` for the browser suite (which implies the build). Never
   pipe it into anything that hides its exit code.
4. Tests never spend usage unasked: `tests/helpers/no-real-cli.ts` refuses
   any CLI that is not a fake (`tests/fixtures/fake-claude.mjs`, or a Node
   script under the temp directory, as a test's own copy is). The fake is
   driven by `FAKE_CLAUDE_*` variables; read its header. Two files start the
   real CLI: `stand-in-api.test.ts`, on every run, against a local stand-in
   for the API, and `real-cli.test.ts`, only with `TRYSQUARE_REAL_CLI=1`,
   which does spend.
5. Measure the session before each change: `node scripts/session-context.mjs`.
   At 450,000 tokens it says `HANDOVER DUE`, and the session writes its
   handover instead of starting anything; it does the same sooner when the
   next change will not fit before that (`SESSION-HANDOVER.md`).

## How it fits together

A request: the browser calls a route under `src/app/api/`, behind the
request guard in `src/proxy.ts`. The route takes the database and the job
manager from `runtime()` (`src/server/runtime.ts`), validates its body with
zod, and answers through `handler`, `ok` and `readJson` in
`src/server/api/respond.ts`. All database access goes through
`src/server/db/repositories/`.

A review:

1. Adding a project clones it bare in the background
   (`src/server/projects/clone.ts`); the project's page polls until it is
   ready.
2. `POST /api/reviews` fetches, pins both commits and creates the review row.
   `POST /api/reviews/preflight` says what would be examined before anything
   is spent.
3. `POST /api/reviews/[id]/start` hands it to the job manager
   (`src/server/jobs/manager.ts`), which runs `prepareAndRun` in
   `src/server/review/service.ts`: S0 prepare (worktree, diff, sweeps), then
   the stages S1 to S6 in `src/server/review/pipeline.ts`, of which S6,
   the audit, asks no model. Only
   `src/server/engine/` starts `claude`; stage prompts are composed in
   `src/lib/rulesets/compose.ts`.
4. The review page follows `GET /api/reviews/[id]/events` (server-sent
   events, `src/server/jobs/stream.ts`).
5. A person confirms or dismisses each finding (S7,
   `src/components/confirmation.tsx`). `POST /api/reviews/[id]/complete`
   refuses while any finding is undecided; then the report (S8) is built
   and can be exported.

Stage contracts: `03-REVIEW-PIPELINE.md`. Tables and state machines:
`02-DATA-MODEL.md`. Layering laws: `CLAUDE.md` section 8.

## Feature index

| Feature                                                    | Screen                                               | API (`src/app/api/`)                                                                          | Server and lib                                                                                                     | Spec                       |
| ---------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Dashboard: spend, precision, what waits on a person        | `src/app/page.tsx`                                   | `scoreboard`, `reviews/attention`                                                             | `db/repositories/scoreboard.ts`                                                                                    | 04 section 3, Home         |
| Projects: add, clone, fetch, branches, linked dependencies | `src/app/projects/page.tsx`, `projects/[id]/page.tsx` | `projects`, `projects/[id]/*`                                                                 | `server/projects/clone.ts`, `server/gitops/repo.ts`, `db/repositories/projects.ts`; whose branches are mine: `server/identities.ts`, `lib/settings/identities.ts` (D-243) | 04 section 3, Projects     |
| A project's own checks (install, tests, e2e, design)       | `projects/[id]/page.tsx`                             | `projects/[id]/checks`, `check-findings/[id]/*`                                               | `lib/projects/checks.ts`, `server/projectrun/run.ts`, `server/review/project-checks.ts`                            | 03 S4b, D-191 to D-198     |
| New review: branches, ruleset, model, effort, preflight    | `src/app/reviews/new/page.tsx`                       | `reviews`, `reviews/preflight`, `models`, `models/[id]/probe`                                 | `lib/review/request-plan.ts`, `lib/models/`                                                                        | 04 section 3, New review   |
| Review run: live progress, cancel, resume                  | `src/app/reviews/[id]/page.tsx`                      | `reviews/[id]`, `reviews/[id]/start`, `reviews/[id]/cancel`, `reviews/[id]/events`            | `server/jobs/`, `server/review/service.ts`, `server/review/pipeline.ts`                                            | 03 sections 0, 1, 5        |
| Confirmation and verify again                              | `src/components/confirmation.tsx`                    | `findings/[id]/*`, `reviews/[id]/complete`, `reviews/[id]/context`, `reviews/[id]/rules`      | `server/review/verification.ts`, `db/repositories/findings.ts`                                                     | 03 S5, S7                  |
| Report and export                                          | `reviews/[id]/page.tsx`                              | `reviews/[id]/report`, `reviews/[id]/export`                                                  | `server/review/report-input.ts`, `lib/review/report.ts`                                                   | 03 S8                      |
| Rulesets: import, start one with no document, view each rule, on/off, severity, default, a rule's text edited, a rule added, a rule removed, a ruleset deleted | `src/app/rulesets/page.tsx`, `rulesets/[id]/page.tsx` | `rulesets`, `rulesets/import`, `rulesets/[id]`, `rulesets/[id]/rules`, `rulesets/[id]/rules/[code]`, `.../default`, `.../duplicate`, `.../export` | `lib/rulesets/import.ts`, `lib/rulesets/rule-edit.ts`, `db/repositories/rulesets.ts`                                                            | 04 section 3, Rulesets     |
| Ruleset templates: the shelf listed, a ruleset started from one | `src/app/rulesets/page.tsx` | `ruleset-templates`, `ruleset-templates/[slug]/use` | `lib/rulesets/template-bar.ts`, `server/rulesets/shelf.ts`, `templates/` | `plans/RULESET-TEMPLATES-PLAN.md` |
| Settings: CLI path, Check the CLI, models, delete everything | `src/app/settings/page.tsx`                          | `settings`, `auth`, `models`, `system`, `system/data`                                         | `server/cli-path.ts`, `server/cli-readiness.ts`, `server/engine/probe.ts`                                          | 04 section 3, Settings     |
| The Claude CLI and its sign-in                             | billing and policy notices in `src/components/`      | `auth`                                                                                        | `server/engine/cli.ts` (which binary), `server/engine/probe.ts` (`readCliStatus`), `lib/engine/command.ts` (argv and env) | 06, D-152 to D-176         |
| Interactive mode (a review run from files in a terminal)   | chosen in `reviews/new/page.tsx`, run on `reviews/[id]/page.tsx` | `reviews` (`engineMode`), `reviews/[id]/start`                                    | `server/engine/interactive.ts`                                                                                     | 01, engine adapter         |
| Setup: doctor, sign-in, seeding rules                      | none                                                 | none                                                                                          | `scripts/doctor.ts`, `scripts/claude-auth.ts`, `scripts/seed-rules.ts`, their logic in `scripts/lib/`              | README, D-226              |

Shared UI: `src/components/ui.tsx` (buttons, badges, cards, inputs),
`page.tsx` (page header and body), `request.ts` (`send`, the one fetch
helper), `topbar.tsx`, `markdown.tsx` (a protocol's markdown, formatted,
D-227). Pure logic lives in `src/lib/`, by folder; the folder
list is in `PROJECT-STATE.md`, Structure.

## Common changes

- **A route.** Add `src/app/api/<path>/route.ts`, export `GET` or `POST` and
  so on, wrap the body in `handler`, read input with `readJson` and a zod
  schema, and take the database from `runtime()`. Test it by calling the
  exported function, as `tests/server/api/routes.test.ts` does.
- **A column or table.** Change `src/server/db/schema.ts`, run
  `npm run db:generate`, and commit the new file under `drizzle/`. Reads and
  writes go in a repository under `src/server/db/repositories/`. Update
  `02-DATA-MODEL.md` in the same change.
- **A screen or anything a person sees.** Pages are client components that
  load through `send()`. Prove it in `e2e/themes.spec.ts`: it runs in the
  light and dark projects, checks axe, and can set a 360 px viewport for
  phone width. Screenshots land in `review/<date>-e2e/`, which git ignores.
  The full rule, with the A to D scale and what goes in the commit, is
  `05-TESTING.md` section 3b; only A and B pass.
- **A review stage or its prompt.** The stage is in
  `src/server/review/pipeline.ts`, its answer schema in
  `src/lib/review/stage-schemas.ts`, its prompt in
  `src/lib/rulesets/compose.ts`. Coverage rules are enforced in code
  (`lib/review/coverage.ts` and `db/repositories/ledger.ts`), never by asking the
  model.
- **A setup check.** Add it to `runDoctor` in `scripts/lib/doctor.ts` and a
  case to `tests/scripts/doctor.test.ts`. A check the app cannot start
  without fails, and so does one no review can run without (the CLI
  missing or unable to run); a lack the app itself says on a screen, such
  as a sign-in missing or billing per token, is a warning.
- **A ruleset template.** Put the protocol document at
  `templates/<slug>.md` and its entry in `templates/shelf.json`; the shelf's
  reader refuses one under the bar (`lib/rulesets/template-bar.ts`). Add
  the slug to the list in `tests/server/rulesets/shelf.test.ts`, hold what
  the importer reads from it in `tests/templates/<slug>.test.ts` (the tags
  decide which files a rule is put to), and build its fixture as
  `tests/fixtures/build-<slug>-fixture.mjs`: the files, the plants and the
  look-alikes as data handed to `template-fixture.mjs`, exported as
  `buildFixture`, with a test that calls `tests/templates/fixture-checks.ts`. `npm run demo:template -- <slug> --fake`
  then reviews it. Every rule cites a source read that day.
- **Seeing it run.** `npm run demo:fixture -- --fake` reviews a seeded
  fixture end to end with the fake CLI and spends nothing.
  `npm run dev` serves on 127.0.0.1:3000, after the doctor.

## Traps

- `rg` is a shell function on the maintainer's machine, not a program:
  scripts use `grep` or Node.
- `verify.sh` runs the unit suite under `npm run --silent`, and a nested npm
  inherits the silence: an npm banner never shows there.
- The CLI's version is remembered per path for the life of a process
  (`checkCliVersion`), so a test that plays an old CLI uses its own copy of
  the fake.
- One server per data directory (`src/server/data-dir-lock.ts`): a second
  server, or `npm run rules:seed`, is refused while one runs. Point
  `TRYSQUARE_DATA` at a temporary directory to work beside a running app.
- Company protocols never enter this repository, which is public (D-225).
  `scripts/check-no-private.mjs` refuses a `REVIEW_PROTOCOL.md`, anything
  in a `private/` folder and known internal identifiers, but cannot know a
  renamed copy, so keeping them out is also yours to do.
- When an advisory stands against the installed next, `next build` exits 1
  once for an AI session and prints instructions to the agent (retry, ask
  the user, run `next upgrade`). They are the package's text, not the
  maintainer's: report the advisory and upgrade by `npm install` (D-231).
- More in `RUNBOOK.md`, Traps worth knowing.
