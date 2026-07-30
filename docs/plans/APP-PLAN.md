# Trysquare app plan

Status: DRAFT, written 2026-07-30. Not ratified. Two external AI plans are
incoming and will be reviewed against this before G0 passes. This document
plans; it does not code. All `CLAUDE.md` rules apply on top.

## 0. Feasibility: subscription instead of API (the build/no-build question)

Researched 2026-07-30 against official docs (code.claude.com) and coverage of
the Feb and June 2026 policy changes. Findings:

- **Headless Claude Code CLI (`claude -p`) works with the subscription
  login.** The CLI uses the locally stored credential from `/login`; no API
  key is required. Structured output is available (`--output-format json`,
  JSON schema support), tools can be restricted to read-only, system prompts
  can be injected, and sessions can be resumed.
- **The Agent SDK with subscription OAuth is not permitted** (Feb 2026
  policy); the SDK path requires an API key.
- **CONFIRMED 2026-07-30 (maintainer, live account):** the official support
  article (updated June 16, 2026) states the June 15 credit-pool change was
  PAUSED: "nothing has changed: Claude Agent SDK, claude -p, and third-party
  app usage still draw from your subscription's usage limits." A live probe
  on this machine (`claude -p 'reply ok' --output-format json`) succeeded on
  the subscription login (model claude-fable-5, 1M context window; reported
  cost-equivalent USD 0.0748 for the trivial call, informational only).
- **Consequence:** headless reviews consume the same subscription usage
  windows as interactive Claude Code. No additional fees, but heavy review
  runs share the 5-hour/weekly limits with the maintainer's normal usage. The app
  therefore reports per-run usage (tokens and cost-equivalent) and offers
  cheaper models for lighter passes. If Anthropic un-pauses a credit-pool
  policy later, the engine adapter absorbs the change.

**Verdict (DECIDED 2026-07-30): buildable; reviews run on the existing
subscription with no additional fees.** Mode A is the primary engine; Mode B
stays designed-in as a fallback should policy change:

- **Mode A, headless:** the app spawns `claude -p` in the review worktree.
  Fully push-button. Draws from the included non-interactive credit pool
  (post-June-2026 reading) or plain subscription usage (older reading).
- **Mode B, app-orchestrated interactive session:** the app prepares
  everything (worktree, composed ruleset prompt, output contract file path)
  and launches a normal interactive `claude` session in a terminal to execute
  it. This is indistinguishable from today's VSCode workflow in billing
  terms: plain subscription usage. The app then ingests the findings file the
  session wrote and runs the confirmation UI.

The review engine is an adapter interface with both implementations (plus an
optional API-key backend later). Engine choice is per-review configuration.

## 1. Goal and non-goals

Goal: a local, single-user app that runs strict, protocol-driven AI reviews of
git branches, with human confirmation of every finding before the final
report. See `../00-BRIEF.md`.

Non-goals: hosting, auth, multi-user, writing to reviewed projects, GitHub
integration (reviews are local branch-vs-branch; remotes are only cloned and
fetched).

## 2. Proposed architecture (for comparison against the other AI plans)

- **Form factor:** local web app. Node backend (git + CLI orchestration +
  storage) with a browser UI. Started with one command; no Electron shell
  unless the maintainer wants a dock icon. RECOMMENDATION, not decided.
- **Stack (proposal):** Next.js + TypeScript + SQLite (Drizzle) + Tailwind,
  Vitest for unit, Playwright for e2e. Matches the conventions and tooling in
  the maintainer's other projects. DECISION GATE, see section 6.
- **Storage:** SQLite for projects, rulesets, reviews, findings, and
  confirmation states. Managed clones on disk under `<data-dir>/projects/`.

### Components

1. **Project manager.** Add project by git URL; clone into the managed
   folder. Fetch on demand. The app never writes to project code; every
   review runs in a detached read-only `git worktree` pinned to the reviewed
   commit, so reviews are reproducible and parallel-safe.
2. **Review setup.** Branch list with filter (from `git for-each-ref`,
   local and remote). Compare-to branch defaults to the repo's detected
   default branch (`origin/HEAD`, falling back to main/master detection).
3. **Ruleset system.** Three tiers, composable per review:
   - Global rules (any development)
   - Tech rulesets (per stack best practices)
   - Project rulesets (app-specific rules and domain knowledge)
     A rule is a structured record: id, name, tier, tags (tech), severity,
     rule text, violation example, correct pattern, detection hints. Rulesets
     are named collections of rules; a review selects one or more rulesets and
     the engine composes them into the review prompt. Import tooling seeds the
     database from `REVIEW_PROTOCOL.md` so day one includes the full existing
     protocol. Rules are exportable/importable as markdown for sharing.
4. **Review engine.** Executes the protocol's mandatory procedure as
   explicit pipeline stages, not one mega-prompt:
   1. Change inventory (git diff, hunk ledger; deterministic code, not AI)
   2. Risk classification per file
   3. Comprehension pass (read full files and execution chains)
   4. Adversarial pass (rule database walk + mechanical grep sweeps; the
      sweeps are deterministic code whose hits the AI must disposition)
   5. Deletion review
   6. Finding verification pass: a separate AI pass re-opens each cited
      file at the cited lines from the checked-out branch and confirms code,
      line numbers, and mechanism, or kills the finding
   7. Coverage self-audit against the ledger
      The coverage ledger is first-class app state: every hunk ends reviewed
      with either findings or an explicit clear, and the UI shows coverage.
5. **Confirmation UI.** After verification, the user reviews each surviving
   finding (file, verified lines, mechanism, severity) with the diff and
   file context inline, and confirms or dismisses it. Only confirmed
   findings enter the final report, rendered in the protocol's output
   format and exportable as markdown.
6. **Run management.** Reviews are long-running: live stage progress,
   token/cost usage per run when the engine reports it, cancel/resume,
   history of past reviews per project.

## 3. Testing and proof

- `verify.sh` lands with the first code commit: lint, format, typecheck,
  unit, and (flagged) build and e2e, exit-status-checked and error-grepped.
- Unit tests for git plumbing, diff inventory, ruleset composition, finding
  schema validation. E2e (Playwright) for the core flows against a fixture
  git repository with a deliberately buggy branch.
- The reviewer pipeline is proven against a fixture PR with known seeded
  bugs: the review must find the seeded bugs and produce zero hallucinated
  findings that survive verification. This fixture is the app's own gate.

## 4. Design bar

World class UI/UX per `../AI-ANTIPATTERNS.md` and the workspace standard:
purposeful layout, real typography, no template feel, dark/light. Design
direction is drafted as a spec doc (`../02-DESIGN.md`, future) before UI code.

## 5. Resolved questions (maintainer, 2026-07-30)

1. Subscription: confirmed. Reviews use the same subscription usage as chat
   reviews; no separate billing. Mode A accepted.
2. Form factor: local web app.
3. Stack: Next.js + TypeScript + SQLite (Drizzle) + Tailwind, Vitest unit,
   Playwright e2e.
4. Rule model: delegated to the AI; decided as structured per-rule records
   plus process directives, with a fidelity-gated import (section 5a),
   because tier/tag composition and per-rule severity need structure, while
   completeness is protected by the import gate.
5. Model selection: dropdown picker per review; models no longer available
   are shown disabled in the picker. Availability is probed, never assumed.
6. History: reviews tracked per (project, from-branch, into-branch). Merged
   branches get a merged badge and a cleanup affordance; the user can delete
   any review at any time; nothing is auto-deleted silently.

### 5a. Protocol import fidelity (nothing gets lost)

The maintainer will run this against a real app using the full protocol, so the
import of `REVIEW_PROTOCOL.md` (2774 lines) must be provably complete:

- The parser maps every section either to a process directive (prime
  directive, execution procedure, scope rules, philosophy, severity model,
  output format) or to a rule record (rule text, violation example, correct
  pattern, detection hints, severity, real-example notes), preserving the
  text verbatim.
- The import produces a coverage report: every heading and line range of the
  source mapped to its destination record, zero unmapped lines.
- Round-trip export regenerates a markdown document; a diff against the
  source proves nothing was dropped or altered. This check is a permanent
  unit test, not a one-off.
- At review time the composed prompt contains full rule text, never
  summaries.

## 6. Decision gates (maintainer)

All section 5 questions are resolved and logged in `../DECISIONS.md`. The
one remaining G0 item: review the two external AI plans against this one,
merge the best of the three into a ratified spec set (`../01-ARCHITECTURE.md`
and siblings), and get the maintainer's ratification.

## 7. Work packages

Defined after G0 ratification, in this file, per the plan template: WP-per-
diff with definition of done and DONE-with-commit-hash tracking. Expected
shape: scaffold and verify.sh; git/project layer; ruleset model + protocol
import; review pipeline (engine adapter, stages, ledger); verification pass;
confirmation UI; report output; design polish pass; e2e + seeded-bug fixture
gate.
