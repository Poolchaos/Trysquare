# Runbook: install, start, first review

One page, for the person operating the app rather than building it. Every
command here was run or read from the code on 2026-08-03.

The rule that matters most is at the bottom of this section: **almost nothing
in this app spends model usage, and the few things that do are listed.** A
review is the expensive action. Everything else, including the whole demo with
`--fake`, is free.

## Prerequisites

- **Node 22 or newer.** `package.json` declares `>=22`, `.nvmrc` pins `22`.
  Proven on v22.22.1.
- **npm.** No version is declared. Proven on 11.17.0.
- **git on PATH.** The gate requires it, and the app shells out to it for
  every clone, fetch and worktree.
- **A Claude subscription, signed in**, but only for a real review. Everything
  else in this runbook works without it. `npm install` installs the Claude
  Code CLI the reviews run through (D-92); sign it in with
  `npm run claude -- auth login`. It shares the `~/.claude` sign-in of any
  other Claude Code on the machine. A different CLI, which must be 2.1.301
  or newer, is picked by the CLI path on Settings, or by
  `TRYSQUARE_CLAUDE_PATH`, which wins over it (D-152); Check the CLI on
  Settings says which CLI that is, its version and how it is signed in.
  `npm run claude` runs `TRYSQUARE_CLAUDE_PATH`'s CLI or the one installed
  with the app, never a path kept on Settings: sign that CLI in with its
  own `auth login`.
- **Chromium**, only if you intend to run `./verify.sh --e2e`:
  `npx playwright install chromium`.

## Install

```bash
npm install
./verify.sh
```

The second command is optional but recommended once: it is the project's
single gate, and if it does not exit 0 on a clean checkout, fix that before
trusting anything else. It runs lint, format check, typecheck, house style,
the private-material check, the nothing-hidden-from-git check, and the unit
tests. Add `--build --e2e` for the full gate, which is what CI runs.

## Start

```bash
npm run dev
```

Serves on <http://localhost:3000> and opens on the dashboard. `dev` and
`start` both bind to 127.0.0.1, so the app is unreachable from any other
machine; that is deliberate (MVP-PLAN WP 2.2), and there is no flag to undo
it short of editing `package.json`. For a
production server, `npm run build` first, then
`npm run start -- --port <n>`. Starting without building serves stale output
or fails, so build first.

Two environment variables control where things live:

| Variable | Default | What it does |
| --- | --- | --- |
| `TRYSQUARE_DATA` | `~/.local/share/trysquare` | Data root: `db.sqlite`, `projects/`, `runs/`, `exports/`. |
| `TRYSQUARE_CLAUDE_PATH` | the CLI path on Settings, then the CLI `npm install` put in `node_modules`, then `claude` on PATH | The binary reviews run through, winning over the path on Settings (D-152). On Windows, point it at `claude.exe` or an npm `claude.cmd`; a `.mjs` or `.js` runs under Node. |

Point `TRYSQUARE_DATA` at a scratch directory when you want a clean slate;
nothing else in the app needs resetting.

## See it work without spending anything

```bash
npm run demo:fixture -- --fake
```

This builds two throwaway git repositories with eleven defects planted in
them (measured 2026-08-04: "Built the fixture: 11 planted defect(s)") and two
files that are deliberately correct, runs the complete pipeline over them
with no model at all, and scores the result against the answer key. It
costs nothing and takes 1.5 seconds (measured 2026-08-04 on this machine:
three runs, 1.45s, 1.46s and 1.54s wall clock, of which the pipeline itself
reports 0.6s; the rest is npm and tsx starting up). It is the fastest way to
confirm an install is sound, and it is the evidence behind gate G1.

Drop `--fake` and the same demo runs against a real model on your
subscription, defaulting to Haiku as a cheap smoke test. That spends usage.

Both forms write their score and full event log into `review/<date>-fg2/`,
which is gitignored, so the evidence stays on your machine.

## Run a first review

Every step below is free until you press Start review.

1. **Add a project.** Projects screen, paste a git URL, Add project. The row
   appears immediately and the clone runs in the background; if git fails, its
   own error text is shown rather than a summary of it. Open the failed
   project and press Retry clone once the cause (network, credentials,
   access) is fixed; an address that was simply wrong is deleted and added
   again. Adding an address that is already a project is refused, with a
   link to that project. Local paths work:
   a `file:///path/to/repo` URL, or on Windows `C:\path\to\repo`, is a
   fast way to try this on something you already have. A network share
   (`\\host\share` or a `file://` URL with a host) is refused, because
   opening one sends your Windows credentials to that host.
2. **Import a ruleset.** Rulesets screen. Paste a markdown protocol document,
   give it a name and a tier, Import. The document becomes numbered rules and
   process directives. Rules must be headings at level three or deeper whose
   text starts with a number and a dot, like `### 1. Unawaited promise`. A
   document that yields no rules is refused outright, because a review judged
   against nothing comes back clean and looks exactly like a review that found
   nothing wrong. `tests/fixtures/example-protocol.md` is a working sample.
   Importing a different document under a name already in use asks first,
   because it replaces that ruleset's rules and undoes any rule switched off
   or re-graded since: Replace goes ahead, Keep it leaves the ruleset as it
   was. The same document again changes nothing and is not asked about.
3. **Set up the review.** Open the project, pick a branch, and press Review on
   its row, or go to New review. Choose the branch to compare against, the
   ruleset, the model, and the effort. The CLI's top effort tier is
   deliberately not offered and is refused by the server, on cost: the CLI
   prices it at up to 5.59 times high for every call, and a review makes many,
   unattended (D-125). Extra high is offered only for a model that runs it,
   and costs more than high (D-122, D-123). A model can only be
   chosen while a
   probe from the last day vouches for it; anything unprobed or stale shows a
   Probe button instead, and one press (a real but tiny paid call) unlocks it
   and shows its context window, profile, and probe age. Optionally say what
   the change was meant to do: that text is shown to the model as a claim to
   check, never as an instruction, and a change that does not do what it says
   is itself a finding. An Advanced fold offers a deliberate profile
   downgrade with the per-profile request counts beside it.
4. **Read the pre-flight.** It appears once the branches, ruleset and model
   are chosen, and costs nothing: the commits it would pin and when their refs
   were fetched, file and hunk counts, sweep hits, changed exported symbols,
   an estimated token count and the number of model requests. Two lines about
   the sweep are worth reading before you start. A pattern that is not a valid
   regular expression, which is how most people write `new Date(` or
   `console.log(`, is searched for as literal text and listed here saying so;
   nothing is wrong, but a pattern read as text matches different things from
   one read as a regex. A pattern that could not run at all is a refusal: fix
   it first, because the review will not finish on an incomplete sweep.
5. **Start the review.** This is the step that spends usage. The run screen
   shows which stages have finished, a live activity log, and a running tally
   of fresh input tokens, cached reads, output tokens and cost equivalent.
6. **Decide every finding.** When the run reaches awaiting confirmation, the
   findings become a queue grouped by severity, worst first. Keyboard: `j` and
   `k` to move, Shift+C to confirm (a bare `c` does nothing, D-132), `d` to
   jump to the dismissal reason, `e` to rewrite the comment before confirming (the engine's wording is kept beside
   yours), `Enter` to pull up the diff hunk and the real code around the
   citation, `g g` for the first finding and `G` for the last. The shortcuts
   are printed at the foot of the queue. Dismissing needs a written reason;
   confirming does not. The rule a finding names expands to the author's
   verbatim markdown from the ruleset the review was frozen with.
7. **Complete and export.** The Complete button unlocks only when every
   finding is decided, and the server refuses otherwise. Completing renders
   the report: what was found, what was examined, and what was dismissed and
   why. Copy it, or Export to write it under `exports/` in your data root,
   where it survives deleting the review.

## What spends model usage

Only three things, by deliberate design after an incident where a manual test
silently used the real CLI:

- Starting a review.
- Pressing Probe on the Settings screen, or a probe control in the model
  picker. Each probe is a real call, which is why nothing probes on a timer or
  at startup.
- `npm run demo:fixture` **without** `--fake`.

Checking sign-in on Settings runs the CLI's own auth status and spends
nothing. Pre-flight is git and arithmetic only. The entire test suite runs
against a fake CLI committed to the repository.

## Traps worth knowing

- **A queued review is normal.** One review runs at a time by default, because
  two share one usage limit. The queue lives in memory only, so a restart
  turns a waiting review back into a draft: open it, choose its ruleset and
  press Start review. A review whose start failed is a draft too. Raise the
  limit on Settings if you accept the sharing.
- **After a restart, a mid-flight review shows as interrupted.** Open it and
  press Resume. Do not pick a ruleset again: a resumed review carries the one
  it was frozen with, and stages already paid for replay for free.
- **A usage limit pauses rather than fails.** The review moves to paused and
  keeps everything it has done. Resume when the limit clears.
- **`./verify.sh --e2e` can fail on port 3100** after an interrupted Playwright
  run. Kill whatever holds the port. Reusing an existing server is refused on
  purpose: it would not have been started with the fake engine, which is
  exactly the mistake that once spent real usage.
- **A production build can rewrite `tsconfig.json`.** If the format gate then
  fails, run `npm run format` and re-run. Recorded in `PROJECT-STATE.md`.
- **`npm run dev` refusing to start over a file that plainly exists means the
  build cache is older than the file.** Seen 2026-08-04: dev exited 1 with
  "Could not parse module `[project]/src/instrumentation.ts`, file not found"
  while the file was present and committed. `.next/cache` was dated
  2026-07-30 10:25 and `src/instrumentation.ts` was created 2026-07-31 09:26,
  so Turbopack was resolving against a module graph built before the file
  existed. `rm -rf .next` fixes it permanently. Note what this is not: a
  production build followed by `npm run dev` was tried afterwards and starts
  cleanly, so sharing `.next` between the two is not the cause.
- **`npm run dev` started by an AI coding agent appends a block to
  `CLAUDE.md`.** Next 16.3 does this whenever its bundled
  `@vercel/detect-agent` finds an agent in the environment
  (`node_modules/next/dist/server/lib/app-info-log.js`), and there is no
  setting to turn it off. Revert it with `git checkout -- CLAUDE.md`; it is
  not committed (D-90), and the house-style gate refuses it anyway, because
  the block carries an em dash. A person running `npm run dev` in their own
  terminal is not detected and nothing is written.
- **A review that stops naming a path with a backslash or a drive letter**
  refused it on purpose (D-95). A file named like `a\b.ts` is legal on Linux
  and macOS, but joined onto a directory on Windows it reaches outside it,
  which is how a hostile branch once wrote outside the data directory. Rename
  the file in the branch, or review it some other way.
- **A review that stops because the diff and git's list of changed files
  disagree** was refused on purpose (D-108). The diff is taken with your git
  config overridden (external diff tools, textconv, prefixes, submodule
  display, the diff algorithm), then checked file by file against
  `git diff --name-only`. A mismatch means a setting still reshaped it, or a
  path the parser misreads: a file name ending in a space is one (plan row
  4.27). Run that `git diff` yourself in the project's clone to see which,
  and report it.
- **A second server on the same data directory exits within a second**,
  naming the process that holds it (4.18, D-118): a second server would mark
  the first one's running reviews interrupted. Stop the first, or set
  `TRYSQUARE_DATA` to another directory. The lock is released by the
  operating system when its server ends, however it ends, so there is never a
  stale lock to delete. Keep the data directory on a local disk: file locks on
  a network share are not to be trusted.
- **Port 3000 in use is not an error.** Dev falls back to 3001 and prints the
  URL it actually took. Read the line rather than assuming 3000.
- **A real protocol document usually needs one edit before it imports:
  numbered checklist items.** Any heading at level three or deeper that starts
  with a number and a dot is read as a rule, so a "1. Type Verification" step
  inside a checklist collides with rule 1 of the catalogue and the import is
  refused for a duplicate code. Drop the numbers from the checklist headings;
  they are process guidance the reviewer still reads as a directive, and they
  were never codes a finding could cite. Windows line endings need no edit:
  they are normalised on import (D-63).

## Where things are

| Path | What is there |
| --- | --- |
| `$TRYSQUARE_DATA/db.sqlite` | Projects, reviews, findings, rulesets, settings. |
| `$TRYSQUARE_DATA/server-lock.sqlite` | The lock the one server using this directory holds. |
| `$TRYSQUARE_DATA/server-lock.pid` | That server's process id, named when another is refused. |
| `$TRYSQUARE_DATA/server-lock.sqlite-journal` | SQLite's, beside the lock while it is held. One a crash left behind is harmless: the next server takes the lock over it. |
| `$TRYSQUARE_DATA/server.lock` | Only on a directory a build before D-118 used. Nothing reads it now; delete it. A server from such a build does not see this one's lock, nor this one its, so stop it before starting this one. |
| `$TRYSQUARE_DATA/projects/` | Bare clones. Never written to by a review. |
| `$TRYSQUARE_DATA/runs/<id>/` | One review's worktree, its checkout baseline, prompt bundle and stage logs. |
| `$TRYSQUARE_DATA/exports/` | Exported reports. Survive deleting the review. |
| `review/<date>-*/` | Gate evidence on this machine only. Gitignored. |

Deleting a review removes its worktree, bundle and logs, and keeps its
exports. Deleting a project is refused while any review still refers to it,
and tells you how many.
