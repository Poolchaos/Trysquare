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
- **The Claude Code CLI, signed in**, but only for a real review. Everything
  else in this runbook works without it. Trysquare drives whatever `claude`
  binary is on your PATH, under the credentials it already holds.
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

Serves on <http://localhost:3000> and opens on the projects screen. For a
production server, `npm run build` first, then
`npm run start -- --port <n>`. Starting without building serves stale output
or fails, so build first.

Two environment variables control where things live:

| Variable | Default | What it does |
| --- | --- | --- |
| `TRYSQUARE_DATA` | `~/.local/share/trysquare` | Data root: `db.sqlite`, `projects/`, `runs/`, `exports/`. |
| `TRYSQUARE_CLAUDE_PATH` | `claude` on PATH | The binary reviews run through. |

Point `TRYSQUARE_DATA` at a scratch directory when you want a clean slate;
nothing else in the app needs resetting.

## See it work without spending anything

```bash
npm run demo:fixture -- --fake
```

This builds two throwaway git repositories with eight defects planted in them
and two files that are deliberately correct, runs the complete pipeline over
them with no model at all, and scores the result against the answer key. It
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
   own error text is shown rather than a summary of it. Local paths work:
   a `file:///path/to/repo` URL is a fast way to try this on something you
   already have.
2. **Import a ruleset.** Rulesets screen. Paste a markdown protocol document,
   give it a name and a tier, Import. The document becomes numbered rules and
   process directives. Rules must be headings at level three or deeper whose
   text starts with a number and a dot, like `### 1. Unawaited promise`. A
   document that yields no rules is refused outright, because a review judged
   against nothing comes back clean and looks exactly like a review that found
   nothing wrong. `tests/fixtures/example-protocol.md` is a working sample.
3. **Set up the review.** Open the project, pick a branch, and press Review on
   its row, or go to New review. Choose the branch to compare against, the
   ruleset, the model, and the effort. A model can only be chosen while a
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
   an estimated token count and the number of model requests. If it reports
   sweep patterns that could not run, fix those first, because the review will
   refuse to finish with an incomplete sweep.
5. **Start the review.** This is the step that spends usage. The run screen
   shows which stages have finished, a live activity log, and a running tally
   of fresh input tokens, cached reads, output tokens and cost equivalent.
6. **Decide every finding.** When the run reaches awaiting confirmation, the
   findings become a queue grouped by severity, worst first. Keyboard: `j` and
   `k` to move, `c` to confirm, `d` to jump to the dismissal reason, `e` to
   rewrite the comment before confirming (the engine's wording is kept beside
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
  turns a waiting review back into a draft. Raise the limit on Settings if you
  accept the sharing.
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

## Where things are

| Path | What is there |
| --- | --- |
| `$TRYSQUARE_DATA/db.sqlite` | Projects, reviews, findings, rulesets, settings. |
| `$TRYSQUARE_DATA/projects/` | Bare clones. Never written to by a review. |
| `$TRYSQUARE_DATA/runs/<id>/` | One review's worktree, prompt bundle and stage logs. |
| `$TRYSQUARE_DATA/exports/` | Exported reports. Survive deleting the review. |
| `review/<date>-*/` | Gate evidence on this machine only. Gitignored. |

Deleting a review removes its worktree, bundle and logs, and keeps its
exports. Deleting a project is refused while any review still refers to it,
and tells you how many.
