# 04 UI and design

Status: RATIFIED 2026-07-30 at G0. The craft bar is
`AI-ANTIPATTERNS.md` (binding): every screen must contain at least one
decision a template could not have made. Nothing ships that reads as
AI-built.

## Not built yet

This document specifies the target. Verified against the code on 2026-08-03,
these parts of it do not exist yet. They stay here as requirements rather
than being edited away; the item in `plans/M4-FINISH-PLAN.md` that owns each
is named.

- Projects list: last fetch, review count, per-row fetch, and the live git
  output tail during a clone. U10.
- New review: choosing more than one ruleset at once. The picker is a
  single-select grouped by tier with rule counts; the freeze path reads
  plural snapshots already, but creation writes one, and composing two
  rulesets needs a rule-code collision refusal designed with it. Its own
  slice after U12 (2026-08-04 DEFERRED in DECISIONS.md).
- Run screen: S0 and S6 rows, per-stage duration and tokens, and the coverage
  panel counting hunks and sweeps down live. U6.
- Rulesets: editing a rule's text in place with markdown preview. Severity,
  toggles, sweep patterns, directive bodies and duplicate-to-tier are built;
  free-text rule editing is not. U12 records or builds it.
- Settings: the data directory display, the engine default, probe-all, and
  the danger zone. U10, U11.

## 1. Design language

- **Tone:** a focused reviewer's tool. Dense where data is dense (ledgers,
  findings), calm elsewhere. No marketing surfaces, no hero sections, no
  decorative illustration, no emoji.
- **Typography:** one UI face (system-adjacent grotesk) + one monospace for
  code, paths, hashes, branch names. Type scale defined in tokens; code is
  never rendered in the UI face.
- **Color:** neutral surface palette with one restrained accent. Within
  review content, severity is the only place strong color appears (CRITICAL
  red, WARNING amber, open-question blue), used consistently in badges,
  borders, and counts. Outside it, the good and critical tokens also mark a
  run's own state: a status chip, a clone that failed, a confirmation that
  landed (D-56, 2026-08-04). The rule that matters is that no finding's
  severity competes with chrome for the same colour on the same screen.
  Dark and light themes from day one via CSS variables; both are first-class
  and both are e2e-screenshotted.
- **Density and rhythm:** 4px spacing grid, tabular numerals for counts and
  tokens, fixed-width columns for hashes and dates. Tables scroll within
  their container; the page never scrolls horizontally.
- **Motion:** functional only (progress, state transitions), 150-200ms,
  none of it blocking. Live states (running review) use a steady pulse, not
  spinners scattered per widget.
- **States:** every screen designs empty, loading, error, and long-content
  states explicitly. Errors show the real message and the log path.
  First-run empty state teaches the flow (add project, pick branches,
  choose rules, run).

## 2. Navigation

Left rail: Projects, Reviews, Rulesets, Settings. Global status chip when a
review is running or paused (click through to the run). Keyboard-first:
review confirmation flow fully drivable by keys (j/k next/prev, c confirm,
d dismiss with reason, enter open file context).

## 3. Screens

### Projects

- List: name, origin URL, default branch, clone state, last fetch, review
  count. Row action: fetch now.
- Add project: URL field, clone progress with live git output tail,
  failure shows stderr verbatim. Uses machine git credentials as-is (SSH
  agent, credential helper); the app stores no secrets.
- Detail: branches (live list, filterable, ahead/behind vs default),
  reviews for this project, delete flows per 02 deletion rules, and
  dependency links: add/remove a linked project with its package name
  (e.g. @acme/shared-core), shown as a chip on the project card.

### New review (the setup flow)

One screen, four decisions, in order: from-branch (filterable picker),
into-branch (default: detected default branch), rulesets (grouped
global/tech/project, multi-select with rule counts and per-ruleset preview
drawer), model (dropdown listing the models this account probed available,
grouped by family, each showing its context window and the review profile it
will run; recommended models first; unavailable candidates disabled with the
probe error and age; a probe-now action sits in the picker). Engine mode and
a deliberate profile downgrade live in an advanced fold; default headless.
Primary action: Start review.
Pre-flight summary: commits pinned, merge base, files/hunks counts, sweep
hit count, composed prompt token estimate vs the model's context window,
the selected profile, and its estimated request count. Choosing a model
whose profile is weaker than `full-context` states plainly that the review
will run as more, smaller requests and why.

**Linked project section:** when the project has a dependency link (e.g.
app -> shared-core), an optional "Include <dependency>" toggle appears with
its own from/into pickers. If the dependency repo has a branch with the
same name as the selected from-branch, the toggle is pre-suggested with
that branch preselected (suggested, never auto-enabled). When enabled, the
pre-flight shows both repos' counts and the changed-exported-symbols count
from the dependency diff.

### Review run (live)

- Stage timeline (S0-S6) with per-stage status, duration, token usage.
- Coverage panel: files/hunks dispositioned counters climbing live, risk
  tags per file, chain files read.
- Activity feed: current stage's tool activity (file being read), errors.
- Usage meter: cumulative tokens and cost-equivalent.
- Controls: cancel; resume (paused/interrupted); retry failed stage.

### Confirmation (S7)

Two-pane: left, finding list grouped by severity with confirm/dismiss state
chips; right, the active finding: issue, comment, rule (expandable verbatim
rule text), mechanism, quoted code rendered inside real file context
(worktree lines, exact line numbers) plus the diff hunk. Confirm / dismiss
(reason required) / edit comment. Progress bar: n of m decided. Finishing
renders the report.

### Report

Rendered report (protocol output format), copy and export actions, footer
metadata (model, rulesets+versions, commits, usage, duration). Past reports
listed per project with merged badges; delete per 02 rules.

### Rulesets

- List by tier with rule counts and provenance.
- Ruleset detail: ordered rules (code, title, severity, tags, enabled
  toggle), process directives, edit in place with markdown preview;
  versioning bumps on edit (snapshots keep old reviews stable).
- Import: from markdown (REVIEW_PROTOCOL.md shape); shows the fidelity
  report (mapped headings, unmapped lines = import blocked). Export to
  markdown (round-trip clean).
- Duplicate-to-tier action (e.g. copy a project rule into global).

### Settings

Data directory (display + open in file manager), model probes and results,
stage timeout, concurrency, engine default, danger zone (delete all data,
two-step).

## 4. Accessibility

Full keyboard operability, visible focus, WCAG AA contrast in both themes
(checked in e2e via axe), prefers-reduced-motion honoured, hit targets

> = 40px. Screen-reader labels on all icon buttons.

## 5. Proof

Design gate before ship (workspace law: founder is the done-gatekeeper):
Playwright screenshots of every screen in both themes on a fixture project
land in `review/<session>-ui/` for the maintainer's judgment. The template test is
answered in writing per screen in the design review notes.
