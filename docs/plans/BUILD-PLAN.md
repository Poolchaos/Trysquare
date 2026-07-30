# Build plan (for the Opus driver)

Status: DRAFT 2026-07-30, executable only after G0 passes. Written for an AI
driver (Opus in Claude Code) to execute work package by work package, from
scaffold to ship.

## 0. How to work this plan (non-negotiable)

This document plans; it does not code. All `CLAUDE.md` rules apply on top,
in particular: one WP at a time, prove before done, commit only when asked,
no em dashes, no emojis, no authorship trailers, stage by explicit path.

Definition of done for every WP:

- One WP per branch/diff; no batching. Sequencing below is binding.
- `./verify.sh` exits 0, run unpiped. `--build` for anything touching
  routes/build; `--e2e` for anything touching UI or pipeline flow.
- The real flow is driven at runtime (dev server or e2e), not just
  typechecked; evidence captured (output, screenshot into `review/`).
- Specs (docs/01..05) and `PROJECT-STATE.md` updated in the same diff when
  the WP changes what they record. Stale records are bugs.
- The WP row below is marked DONE with the commit hash, in the same session.
- Open decisions are asked or the WP is scoped so the decision is not needed
  yet. Do not guess. Founder gates (FG) are batched at the milestones below,
  never asked mid-flow.
- Review round after every 3-4 completed WPs (workspace law).

Work top to bottom through unblocked items; skip blocked, never wait.

## 1. Work packages

| WP   | Scope                                                                                                                                                                                                                                                                                  | Blocked on | Status |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| WP-A | Scaffold + gates: Next.js/TS/Tailwind/Drizzle/Vitest/Playwright pinned; layout per 01 section 4; verify.sh with both failure branches proven; CLAUDE.md section 3+8 filled with proven commands and ratified stack                                                                     | G0         | DONE (uncommitted 2026-07-30; verify.sh green incl. --build, four failure branches proven, app serves HTTP 200) |
| WP-B | Data layer: full 02 schema, migrations, repositories, state-machine enforcement + tests                                                                                                                                                                                                | WP-A | DONE (2026-07-30; 73 tests, adversarial review found 8 defects, all fixed) |
| WP-C | Git layer: URL validation, bare clone, fetch, live branch listing, merge-base, worktree lifecycle (single and linked dual-worktree layout), bundle builder incl. links.json and changed-exported-symbols extraction, diff/hunk inventory parser + exhaustive fixtures                  | WP-A | DONE (2026-07-30; diff parser fixtured against real git, worktree read-only proof) |
| WP-D | Ruleset domain: rule/directive model, composition function with snapshot tests, protocol importer + fidelity gate (permanent test), markdown export round-trip                                                                                                                         | WP-B | DONE (2026-07-30; import fidelity gate byte-exact, mutation-proven) |
| WP-E | Engine: EngineAdapter, headless claude runner (CLAUDECODE-scrubbed env, explicit --system-prompt and --tools, full model ids), stream-json parsing, error classes, timeout guard, limit pause, model registry + cheap probing + auth status check per 06; fake claude binary for tests | WP-A | DONE (2026-07-30; prompt-injection isolation proven against the real CLI) |
| WP-F | Pipeline: S0 prepare + sweeps, S1-S6 orchestration per 03 incl. the linked-review addendum (symbol dispositions enforced), ledger invariants, session strategy, S5 mechanical quote-match, job manager + SSE + resume/cancel/interrupt                                                 | WP-B,C,D,E | TODO   |
| WP-G | Seeded fixture repos (seeded-repo + seeded-core companion) + manifests + engine quality gate incl. linked-review gate wired into e2e (fake engine) per 05 section 4                                                                                                                    | WP-F       | TODO   |
| WP-H | UI: projects + add/clone + detail incl. dependency links; new-review setup with pre-flight and linked-project section; live run screen                                                                                                                                                 | WP-F       | TODO   |
| WP-I | UI: confirmation flow (keyboard-first) + report render/export; merged-branch badge + deletion flows                                                                                                                                                                                    | WP-H       | TODO   |
| WP-J | UI: rulesets manager (list/detail/edit/version, import with fidelity report, export); settings                                                                                                                                                                                         | WP-D,WP-H  | TODO   |
| WP-K | Design pass to the 04 bar: tokens, themes, states, a11y (axe green), screenshots of every screen both themes into `review/`                                                                                                                                                            | WP-I,WP-J  | TODO   |
| WP-L | Full e2e suite per 05 section 3; real-engine proof run on the seeded fixture with captured report + usage; README (accurate, no aspiration)                                                                                                                                            | WP-G,WP-K  | TODO   |

## 2. Milestones and founder gates

- **M1 Foundation** = WP-A..E. FG-1: none (report only).
- **M2 Working pipeline** = WP-F,G. FG-2: the maintainer watches a fake-engine
  review run end to end and a real-engine smoke on the fixture; verdict on
  pipeline behaviour and prompt quality. Gate G1 in GATES.md.
- **M3 Usable app** = WP-H..J. FG-3: the maintainer drives a real review of one of
  their own branches with the imported protocol; verdict on findings quality
  and confirmation flow. Gate G2.
- **M4 Ship** = WP-K,L. FG-4: design judgment per 04 section 5 + acceptance
  of the engine quality gate evidence. Gate G3 = v1 done.

Every milestone ends runnable; no milestone is "infrastructure done".

## 3. Standing rails (every WP, no exceptions)

- The app never writes inside clones/worktrees; the worktree-clean test
  stays green forever.
- Tool allowlist for AI stages stays read-only; widening it is a
  decision-log entry, never a convenience.
- Prompt or composition changes re-run the engine quality gate before DONE.
- Proven commands land in CLAUDE.md the session they are proven; guessed
  commands never land anywhere.
- Token/cost figures in any doc or reply come from captured result events.

## 4. Risks and mitigations

- CLI flag/behaviour drift across Claude Code versions: flags verified at
  WP-E and pinned in CLAUDE.md; engine adapter isolates all CLI knowledge;
  probe failures surface in the model picker instead of mid-review.
- Subscription policy changes: Mode B (interactive) is specced in 01 and
  kept working via e2e of the prompt-materialisation path.
- Context overflow on huge diffs: batching rule in 03 section 4; pre-flight
  token estimate warns before start.
- Prompt-quality regressions: the seeded-fixture gate is the regression
  net; prompt edits without a gate run cannot be marked DONE.
