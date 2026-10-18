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

Trued up 2026-08-17: the U6 and U10 items previously listed here (run
screen stage rows, per-stage duration and tokens, projects last-fetch and
review count, settings data directory, probe-all, danger zone) all landed
and are gone from this list. The engine default setting is not owed: its
dead key was deliberately deleted (recorded 2026-08-04), and engine mode is
chosen per review in the advanced fold.

- Add project: the live git output tail while a clone runs. Failure stderr
  is shown verbatim; the running tail is not.
- New review: choosing more than one ruleset at once. Deferred by decision
  (2026-08-04 DEFERRED in DECISIONS.md); needs a rule-code collision
  refusal designed with it.
- Rulesets: editing a rule's text in place with markdown preview. Severity,
  toggles, sweep patterns, directive bodies and duplicate-to-tier are
  built; free-text rule editing is not.
- Settings: opening the data directory in a file manager (it is displayed).
- Of the 2026-08-17 UX audit, three items are still owed: the completion
  moment and queue momentum (WP-G), the queue's own phone layout with
  bracketed thumb-height actions (WP-K), and the my-branches filter with the
  identities behind it (WP-L). The rest of that audit is built, including the
  home dashboard, the awaiting-decision badge, the rendered report and its
  HTML export, and the shell at phone width;
  `plans/UX-UPLIFT-PLAN.md` carries the row-by-row state (D-68, D-69, D-81).

## 1. Design language

- **Tone:** a focused reviewer's tool. Dense where data is dense (ledgers,
  findings), calm elsewhere. No marketing surfaces, no hero sections, no
  decorative illustration, no emoji.
- **Typography:** one UI face (system-adjacent grotesk) + one monospace for
  code, paths, hashes, branch names. Type scale defined in tokens; code is
  never rendered in the UI face.
- **Color:** the restrained night instrument (D-68, 2026-08-17, chosen
  from generated mocks). Dark leads and light is derived; both stay
  first-class and both are e2e-screenshotted. Near-black blue-gray matte
  surfaces, thin 1px borders, one cyan-teal accent reserved for
  interactive elements and progress, and a glow budget of at most one live
  element per screen. Within review content, severity is the only place
  strong color appears (CRITICAL red, WARNING amber, open-question blue),
  used consistently in badges, borders, and counts. Outside it, the good
  and critical tokens also mark a run's own state: a status chip, a clone
  that failed, a confirmation that landed (D-56, 2026-08-04). The rule
  that matters is that no finding's severity competes with chrome for the
  same colour on the same screen; the rejected full-neon mock round is the
  standing proof of why.
- **Honest numbers:** a figure that is not measured from this machine's own
  data does not render. No predictions, no confidence percentages, no
  invented currencies (D-68 lists the banned widgets with reasons).
- **Responsive:** every screen lays out at phone width. Monitoring a run
  and deciding findings are first-class on a phone (single-column queue,
  thumb-height Confirm and Dismiss); setup flows stay desktop-first
  (D-69).
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

Top bar (D-81, replacing the left rail): the try-square mark and wordmark
linking home, then Dashboard, Projects, Reviews, Rulesets, Settings. The
current destination is marked by `aria-current` and an accent underline, and
exactly one is marked on every screen: the dashboard matches its path
exactly rather than by prefix, since every path begins with a slash. On the
right, a count badge linking to the reviews list when any review awaits a
decision, because the state that needs a human is the one navigation must
never hide, and a status chip while a review is running or paused, following
the job manager rather than the status column, since a row can say running
while no process owns it. At phone width the wordmark collapses to the mark
and icons drop before labels: a label without an icon still navigates, an
icon without a label guesses. Keyboard-first:
review confirmation flow fully drivable by keys (j/k next/prev, Shift+C confirm,
d dismiss with reason, enter open file context).

## 3. Screens

### Home (the dashboard)

The first screen, replacing the bare redirect to Projects. It is a fixed
composition of widgets (D-82), ordered so that what needs a person comes
before what merely happened: needs-you before history, live before archive.
Everything on it is measured, never estimated, and a rate with no
denominator renders as a dash rather than as zero, because zero percent
precision is a claim about findings somebody judged.

- **Stat tiles:** total spend, reviews completed, precision (confirmed vs
  dismissed) and invention rate (quote-check kills), in large tabular
  numerals, each with a sparkline from this machine's own history. A
  sparkline needs two points to be a line and draws nothing below that.
- **Needs you:** every review awaiting a decision, oldest wait first, each
  row carrying its branch pair, project, confirmed-of-total and age, and
  linking straight into that queue. The count in the bar says there is work;
  this says where it is. Empty, it says so in one line and takes no more
  room than that.
- **Live scan:** while a review runs, its stage gauge, current stage,
  elapsed, spend so far, and a way into the scan theater. When nothing runs
  it is absent, not empty: a panel labelled live with nothing in it is the
  dashboard claiming to have something to watch.
- **Recent reviews:** branch pair, model, findings count, cost, duration and
  status chip, with any review awaiting a decision highlighted.
- **Rule yield:** each rule with the share of its findings that survived to
  confirmation, worst first, because a rule that only ever produces
  dismissals is costing review attention for nothing.
- **Projects:** each project with its last review's outcome and a way to
  review a branch. Projects are matched to their reviews by id, never by
  name: two remotes can end in the same repository name.

First run shows the teaching empty state (add a project, pick branches,
choose rules, run).

### Projects

- List: name, origin URL, default branch, clone state, last fetch, review
  count. Row action: fetch now.
- Add project: URL field, clone progress with live git output tail,
  failure shows stderr verbatim. Uses machine git credentials as-is (SSH
  agent, credential helper); the app stores no secrets. An address that is
  already a project is refused with a link to it. A failed clone opens like
  any project: its page shows git's error and offers Retry clone, which
  removes what git left and clones again.
- Detail: branches (live list, filterable, ahead/behind vs default, and a
  Mine filter matching the tip commit author against the identities in
  settings),
  reviews for this project, delete flows per 02 deletion rules, and
  dependency links: add/remove a linked project with its package name
  (e.g. @acme/shared-core), shown as a chip on the project card.

### New review (the setup flow)

One screen, four decisions, in order: from-branch (filterable picker with the same Mine filter as the project detail),
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
- Controls: cancel, which asks first and says when it failed (5.1); start,
  for a draft, with its ruleset chosen there (5.11); resume
  (paused/interrupted); retry failed stage.

### Confirmation (S7)

Two-pane: left, finding list grouped by severity with confirm/dismiss state
chips, every row naming its file path and line beside the title, because a
reviewer's first orientation question is "where am I" and the list must
answer it without a click (D-68 amendment); right, the active finding, its
code panel headed by the filename: issue, comment, rule (expandable verbatim
rule text), mechanism, quoted code rendered inside real file context
(worktree lines, exact line numbers) plus the diff hunk. Confirm / dismiss
(reason required) / edit comment. Progress bar: n of m decided. Finishing
renders the report.

### Report

Rendered report (protocol output format), typeset in-app rather than shown
as raw markdown: title, one bold summary sentence, prose-first finding
cards grouped by severity with the code excerpt subordinate, and a
provenance footer (model, rulesets+versions, commits, usage, duration).
Copy and export actions; export writes the markdown and a self-contained
single-file HTML beside it, so a report can be handed to a colleague whole
(D-69). Past reports
listed per project with merged badges; delete per 02 rules.

### Rulesets

- List by tier with rule counts and provenance.
- Ruleset detail: ordered rules (code, title, severity, tags, enabled
  toggle), process directives, edit in place with markdown preview;
  versioning bumps on edit (snapshots keep old reviews stable).
- Import: from markdown (REVIEW_PROTOCOL.md shape); shows the fidelity
  report (mapped headings, unmapped lines = import blocked). A different
  document under a name already in use is asked about (Replace / Keep it),
  since the import replaces its rules and undoes its edits; the same
  document is not. Export to markdown (round-trip clean).
- Duplicate-to-tier action (e.g. copy a project rule into global).

### Settings

Data directory (display + open in file manager), model probes and results,
stage timeout, concurrency, review identities (the git emails that count
as mine, seeded from git config, for the Mine filters and the scoreboard's
author column), danger zone (delete all data, two-step).

## 4. Accessibility

Full keyboard operability, visible focus, WCAG AA contrast in both themes
(checked in e2e via axe), prefers-reduced-motion honoured, hit targets

> = 40px. Screen-reader labels on all icon buttons.

## 5. Proof

Design gate before ship (workspace law: founder is the done-gatekeeper):
Playwright screenshots of every screen in both themes on a fixture project
land in `review/<date>-e2e/` on every suite run, with the design review
notes in `review/<date>-fg4/`, for the maintainer's judgment. The template test is
answered in writing per screen in the design review notes.
