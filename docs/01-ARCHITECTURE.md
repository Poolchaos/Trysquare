# 01 Architecture

Status: DRAFT 2026-07-30, pending G0 ratification. Authority: where this doc
and `plans/APP-PLAN.md` disagree, this doc wins once ratified.

## 1. Overview

Local, single-user web app. One Node process serves the UI and runs review
jobs; review jobs spawn `claude` CLI subprocesses (subscription login) inside
read-only git worktrees. All state lives in SQLite plus a managed data
directory. No auth, no hosting, no telemetry.

## 2. Stack (RATIFIED 2026-07-30)

- Next.js (App Router) + TypeScript, strict mode
- SQLite via Drizzle ORM (better-sqlite3 driver), migrations checked in
- Tailwind CSS
- Vitest (unit/integration), Playwright (e2e)
- zod for every runtime boundary (CLI output, stage outputs, API payloads)
- Node child_process for git and claude; no other process spawning

Versions are pinned at WP-A and recorded in `PROJECT-STATE.md` once installed.

## 3. Runtime topology

- **Web/UI:** Next.js App Router pages + route handlers. Mutations go through
  route handlers (single-user, no auth middleware).
- **Job manager:** a server-side singleton (initialised from
  `instrumentation.ts`) that owns review jobs. One review = one job. Jobs run
  in-process (async orchestration), spawning subprocesses per stage. Max one
  running review at a time by default (configurable); others queue.
- **Progress:** job manager persists every state change to SQLite
  immediately; UI subscribes via one SSE endpoint per review
  (`/api/reviews/[id]/events`) with polling fallback.
- **Crash/restart:** on boot, any review in a running state is marked
  `interrupted`. Interrupted reviews are resumable: completed stages are
  never re-run; the interrupted stage restarts (or resumes its CLI session
  where a session id was persisted).

## 4. Directory layout (repo)

```
src/
  lib/            pure domain logic, no Next/DB/process imports
    git/          URL parsing, ref models, diff parsing, hunk inventory
    rulesets/     rule model, composition, protocol import/export
    review/       stage contracts, output schemas, ledger logic, report gen
  server/
    db/           drizzle schema, migrations, repositories (only DB access)
    engine/       EngineAdapter interface + headless/interactive impls,
                  claude CLI runner, model probing
    gitops/       clone/fetch/worktree/bundle execution (only git spawning)
    jobs/         job manager, stage orchestration, SSE hub
  app/            routes, pages, api handlers
  components/     UI components
tests/            unit + integration; fixtures under tests/fixtures
e2e/              Playwright specs + fake-engine harness
verify.sh
```

Layering laws:

- `lib/` is pure and fully unit-testable: no I/O, no imports from `server/`.
- All DB access goes through `server/db/repositories`. No inline queries in
  routes or components.
- Only `server/gitops` spawns git; only `server/engine` spawns claude.
- UI components never import from `server/`; they consume API payloads typed
  by shared zod schemas in `lib/`.

## 5. Data directory (user machine)

`$TRYSQUARE_DATA` if set, else `~/.local/share/trysquare/`:

```
db.sqlite
projects/<projectId>/repo.git       bare clone (no working tree to damage)
runs/<reviewId>/worktree/           detached read-only checkout of fromCommit
runs/<reviewId>/bundle/             precomputed review inputs (see 03)
runs/<reviewId>/logs/               subprocess transcripts per stage
exports/                            saved reports
```

Laws:

- Clones are bare; review checkouts are `git worktree add --detach` pinned to
  a commit hash, pruned when the review is deleted.
- **The app never writes inside a worktree.** Enforced by code review, by the
  engine's read-only tool allowlist, and by a unit test asserting the
  worktree is byte-identical (git status clean) after a pipeline run.
- Everything the AI must read that is not in the worktree (base-branch
  copies, diff, inventory) is materialised into `bundle/` by app code.

## 6. Engine adapter

```
interface ReviewEngine {
  startStage(req: StageRequest): AsyncIterable<EngineEvent>
  // EngineEvent: progress | tool-activity | output-chunk | result | error
}
```

- **HeadlessEngine (Mode A, default):** spawns
  `claude -p <prompt> --output-format stream-json --model <alias>` with cwd =
  worktree, a composed `--append-system-prompt`, and a read-only tool
  allowlist (Read, Grep, Glob only). Parses stream-json lines into events;
  the final result event carries session id, usage tokens, and
  cost-equivalent USD, all persisted per stage. Exact flag names are
  verified against `claude --help` on this machine at WP-E and recorded in
  `CLAUDE.md` commands, never guessed (workspace law).
- **InteractiveEngine (Mode B, fallback):** materialises the same prompt to
  `runs/<id>/bundle/stage-<n>-prompt.md`, prints the one-line launch command
  for a terminal session, and watches for the session's output contract file
  to appear. Kept behind the same interface so a policy change never touches
  the pipeline.
- Subprocess hygiene (workspace law, mirrors verify.sh doctrine): every
  spawn is timeout-guarded (stage-level timeout, configurable), stdout and
  stderr captured to `logs/`, exit status checked separately, and output
  scanned for a narrow error-marker list. A hang is a failure, not a wait.
- Rate-limit/limit-reached errors from the CLI pause the review in a
  `paused_limit` state with the CLI's message surfaced verbatim; resume is
  manual from the UI. Nothing is retried blindly.

## 7. Models

See `06-MODELS-AND-PROFILES.md` (authoritative): the app probes a candidate
registry to show the models this account can actually use, passes full model
ids only (short aliases resolve to the previous generation), and selects a
review profile from the model's capability tier. Two engine requirements
established there are load-bearing here: every spawn scrubs `CLAUDECODE`
from the child environment, and every spawn passes an explicit
`--system-prompt` and minimal `--tools` list rather than inheriting the
CLI's defaults.

## 8. Errors and observability

- Every stage failure stores: stage, exit code, error class (spawn, timeout,
  limit, invalid-output, git), stderr tail, and the log file path; the UI
  shows the real error, never a generic toast.
- Structured logs per review under `runs/<id>/logs/`; a debug view in the UI
  renders them read-only.
- Anomalous artifacts (invalid JSON from a stage, unexpected file in a
  worktree, ledger mismatch) fail the run; they are defects to root-cause,
  never warnings (workspace law).
