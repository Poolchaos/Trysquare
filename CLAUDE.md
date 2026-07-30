# Trysquare - Operating Charter

Rules for all AI-driven work in this repository. What the app is and the laws
it is built under: section 8. Specs and ledgers live in `docs/`; start with
`docs/PROJECT-STATE.md`.

Meta-rule: every quality rule that CAN be an executable gate becomes one; prose
rules are the fallback, not the plan.

## 1. Gating rules (non-negotiable)

These apply to every response and every action.

- **Do not guess. Do not assume.** If information is missing, ambiguous, or
  outside your knowledge, say so and ask before proceeding.
- **Surface blocking questions first.** Before responding, identify whether any
  unanswered question could materially change the output. If so, raise it first
  and wait for the answer.
- **Never fabricate:** numbers, sources, availability claims, license terms.
  Live-fetch anything time-sensitive. A failed search is a reportable finding.
- **One feature at a time.** Do not start the next change until the current one
  is complete, proven, and (when asked) committed. Keep each diff small and
  reviewable. No batching of unrelated work.
- **Confirm the active gate first.** Read `docs/GATES.md`. If the task sits
  beyond the active gate, stop and say so. One gate active at a time; a gate
  passes only with recorded evidence, and a failed gate is a real result.
- **Treat every DECIDED item as settled.** Challenge only with new verified
  evidence, in writing, in `docs/DECISIONS.md`.
- **New ideas mid-task go to `docs/plans/idea-inbox.md`**, one line each,
  dated. Do not expand them until the active gate passes.
- **Prioritise correctness over speed.** A slower correct result beats a fast
  wrong one, always.
- **Self-review before delivering.** Re-read the work, verify every claim, fix
  what you find. Only surface an issue you cannot resolve.
- **No preamble, no methodology narration, no restating the question.** Deliver
  results directly.
- **The human is the done-gatekeeper.** AI self-attestation never flips a
  feature to done, and never passes a gate.

### What "proven" means here

A result is done only when demonstrated, not asserted.

- Claims about code are backed by reading or running the code, never by
  recollection or pattern-matching.
- Behavioural claims ("this works", "tests pass") are backed by actually
  running the command and showing its output.
- **No false positives.** A passing test that does not exercise the change does
  not count. Changing a test to make it pass, rather than fixing the underlying
  bug, is a defect, not a fix.
- For anything with a runtime surface, drive the real flow (or a test that
  does), not just typecheck. If that is not feasible, say why and what you did
  instead.
- **"Verified" has one meaning: `./verify.sh` exited 0.** The script is created
  with the first code commit and kept green thereafter.
- **An anomalous artifact is a defect until root-caused.** "Probably the
  harness" is not a conclusion.
- **Numbers or silence.** No performance, size, count, or timing claim ships in
  a commit message, doc, or reply without the measurement beside it (what was
  run, on what, and the result).
- **Re-verify recorded facts** (versions, paths, counts, doc claims) against
  the live code before relying on them. When record and reality disagree,
  reality wins and the record is fixed in the same change.

## 2. The per-change loop (mandatory, in order)

1. **Confirm the active gate** in `docs/GATES.md`.
2. **Analyse** the request: what is being asked and why.
3. **Investigate:** read the relevant code and docs and confirm how things
   actually behave. No assumptions.
4. **Plan the smallest correct change** for one feature.
5. **Audit the plan against the code.** If it misses something or creates a new
   problem, return to step 3.
6. **Implement**, honouring the architecture constraints in section 8.
7. **Prove it** (section 1). Capture the evidence.
8. **Audit the change.** If a gap is found, return to step 3.
9. **Commit** only when asked, with a clear message.
10. **Move to the next feature.**

**Review rounds are periodic, not exceptional.** After every 3-4 completed
changes, and always before anything goes external, a structured review pass
runs over the shipped diffs. Findings are numbered and fixed before new work
starts. The maintainer can trigger one at any time with "review".

## 3. Commands (the CI gate)

All proven on this machine 2026-07-30.

- `./verify.sh` - the single gate. Lint, format check, typecheck, house style,
  private-material leak check, unit tests. `--build` adds the production build; `--e2e` adds Playwright.
  "Verified" means this exited 0.
- `npm run dev` - dev server. `npm run start -- --port <n>` - production
  server (requires `npm run build` first).
- `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run format`,
  `npm run e2e`, `npm run db:generate` (drizzle-kit).

Never pipe a gate command into something that swallows its exit code
(`cmd | tail`). If you run a step by hand, use `set -o pipefail` and `&&`
chains.

`rg` is NOT a binary on this machine: it is a shell function from an editor
integration and does not exist in non-interactive scripts. Scripts and
application code use `grep` or Node, never `rg`. A tool that may be missing is
checked for explicitly, because a gate that silently finds nothing is worse
than no gate.

## 4. Context and cache discipline

- **CLAUDE.md files stay lean and stable.** They are loaded into every session,
  so frequent edits churn the cached context prefix and bloat every prompt.
  Edit them only for durable rule changes.
- **Volatile facts live in `docs/`, not in CLAUDE.md.** Versions, state, audit
  findings, progress logs: put them in docs and link to them. Links are plain
  markdown links, never `@imports`, so a linked doc enters context only when
  actually opened.
- Do not paste large file contents into CLAUDE.md or into docs that get read
  every session. Summarise and link.

## 5. Index and cache (how the AI finds and keeps context)

The `docs/` directory is the persistent memory of this project. Read before
deriving; update in the same change that invalidates a record.

- `docs/README.md` - the map. One line per doc. Every new doc gets a line here
  in the same commit that creates it.
- `docs/PROJECT-STATE.md` - the cache. Current facts: stack, structure,
  commands, external services, what is built and what is not. **Start every
  planning task by reading this file.**
- `docs/DECISIONS.md` - the decision log. Dated, append-only. Any choice that
  would otherwise be re-litigated gets an entry with the reason and the
  alternatives rejected.
- `docs/GATES.md` - the gate ledger. One row per gate: status, evidence, date.
- `docs/AI-ANTIPATTERNS.md` - the craft bar. Binding on all surfaces: code,
  docs, copy, commits.

Rules:

- **Stale records are bugs.** If a change makes any doc wrong, fixing the doc
  is part of that change, not a follow-up.
- **Docs record conclusions, not narration.** State the fact, the reason, the
  date. Dates are absolute (YYYY-MM-DD).
- Plans for multi-step work live in `docs/plans/` as their own file (listed in
  the index), so a fresh session can resume from them. Plans plan; they do not
  code. Follow `docs/plans/PLAN-TEMPLATE.md`.
- **Keep `README.md` current** once it exists. No aspirational claims about
  code that does not exist yet.

## 6. Testing law

- **Test and proof integrity is law.** Every test passes cleanly. A test that
  only passes on retry is failing; fix the bug, not the test.
- **A red test is stop-the-line, no matter who wrote it.** The whole suite must
  be green, not just the tests touching your change. "Not my code" is not a
  reason to leave the suite broken.

## 7. Standards and Git

- **Nothing ships that reads as AI-built.** `docs/AI-ANTIPATTERNS.md` is the
  standard. The template test: every surface must contain at least one decision
  a template could not have made.
- **No redundant comments.** A comment must earn its place by adding what the
  code cannot show: a non-obvious constraint, a "why", an external reference,
  or a gotcha. Delete redundant comments you touch.
- **No em dashes anywhere.** Use periods, commas, or hyphens; convert any you
  touch.
- **No emojis** in code, commits, docs, or user-facing strings.
- **No authorship trailers in commits or PR bodies.** No `Co-Authored-By`, no
  "Generated with Claude Code" lines.
- **Stage by explicit file path.** Never `git add -A`, `git add .`,
  `git add -u`, or `git commit -a`.
- Commit or push only when asked. Branch off `main` for non-trivial work unless
  told otherwise.
- **Secrets never ship in the client.** `.gitignore` excludes `.env`, `*.key`,
  `*.pem` from the first commit.

## 8. Project context

A local, single-user web app that runs strict, protocol-driven AI code
reviews of git branches. It clones projects read-only, diffs a branch pair,
applies configurable rulesets, verifies every finding against the checked-out
file, and presents findings for human confirmation before the report. Brief:
`docs/00-BRIEF.md`. Specs: `docs/01-ARCHITECTURE.md` through
`docs/06-MODELS-AND-PROFILES.md`. Build order: `docs/plans/BUILD-PLAN.md`.

**Stack (RATIFIED, not relitigated without a decision-log entry):** Next.js
16 (App Router) + React 19 + TypeScript strict, SQLite via Drizzle with
better-sqlite3, Tailwind 4, Vitest, Playwright, zod at every runtime
boundary. Versions in `docs/PROJECT-STATE.md`.

**Architectural laws:**

- The app never writes inside a cloned project or a review worktree. Clones
  are bare; reviews use detached worktrees pinned to a commit.
- AI review stages get read-only tools only (Read, Grep, Glob). Widening
  that allowlist is a decision-log entry, never a convenience.
- Every spawned `claude` process has `CLAUDECODE` scrubbed from its
  environment (the CLI refuses to run nested) and passes an explicit
  `--system-prompt` plus minimal `--tools`.
- Full model ids only, never short aliases: `opus` and `sonnet` resolve to
  the previous generation.
- `lib/` is pure and I/O-free; only `server/gitops` spawns git; only
  `server/engine` spawns claude; all DB access goes through repositories.
- Coverage invariants (every hunk, sweep hit, and deletion dispositioned)
  are enforced by app code, never by trusting a prompt.

## 9. Fresh session ritual

1. Read this file.
2. Read `docs/PROJECT-STATE.md` (the cache).
3. Read `docs/GATES.md` for the active gate.
4. Read only the docs that gate needs, using `docs/README.md` as the map.
5. When a design question arises, the answer lives in `docs/`; cite the
   specific file. If it is not there, it is an open question (section 1).
6. When anything is decided, append it to `docs/DECISIONS.md` with a date, in
   the same session.
