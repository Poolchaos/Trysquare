# Dashboard shell plan: the widget home, the top bar, and the rail's retirement

Status: RATIFIED PLAN, written 2026-08-18 for the Opus driver, executing the
maintainer's directive recorded as D-81: "I love a dashboard, with widgets,
instead of the left nav bar." Design language is fixed by D-68 (restrained
night instrument) and D-79 (the drafting board); this plan changes the
shell's information architecture, not its voice.

## 0. How to work this plan (non-negotiable)

Written for an AI driver to execute work package by work package. It plans;
it does not code. All `CLAUDE.md` rules apply, plus three constraints
specific to this moment:

- **M0 is a hard gate.** The maintainer's first real review may still be
  running inside the dev server process. `./verify.sh --build` and `--e2e`
  rebuild `.next`, which is that process's working directory, and editing
  anything under `src/server/` can invalidate the module graph holding the
  job manager that owns the run. Until M0's checks pass, no work package
  starts. Killing a paid run to take a screenshot is never the right trade.
- **Every WP here runs the full browser gate** (`./verify.sh --e2e`, which
  builds first). This is shell work; a unit-only gate proves nothing about
  it. Screenshots regenerate and axe passes in both themes on every WP.
- **The identity is settled; do not reopen it.** Drafting-board ground,
  machined panels, ruled gauges, mono display voice, severity-color law,
  honest numbers (a figure not measured from local data does not render).
  Widgets are new surfaces for existing truths, not new claims.

Definition of done per WP: one diff, gate green unpiped, screens re-shot,
stale docs fixed in the same diff, the WP row here marked DONE with the
hash, decisions recorded as they are made (PROPOSED entries below become
DECIDED entries in `DECISIONS.md` when built).

## 1. Verified current state (2026-08-18, against the live tree)

**The shell.** `src/app/layout.tsx` renders a flex row: `<Rail />` plus
`<main>`. The rail (`src/components/rail.tsx`) is a 13rem client component:
try-square mark + wordmark, four links with inline SVG icons and an
`aria-current` spine, an awaiting-decision count badge on Reviews, and a
bottom chip for a running or paused review. It polls
`/api/reviews/attention` every 4 seconds on every screen; that endpoint
(`src/app/api/reviews/attention/route.ts`) returns
`{ active: { id, status, fromBranch, projectName } | null, awaiting: number }`
with two indexed reads, and the chip follows `manager.isRunning`, not the
status column, because a row can say running while no process owns it.

**The home.** `/` is the scoreboard (`src/app/page.tsx`, D-75): four
`StatTile`s (spend + sparkline, completed, precision, invention rate), a
recent-reviews table with the awaiting row highlighted, and worst-first
rule yield with ruled gauge bars. It reads `/api/scoreboard`, backed by
`readScoreboard` (`src/server/db/repositories/scoreboard.ts`), which
returns spend, counts, the two rates (null until they have a denominator),
`awaiting` (a count only), `spendHistory`, `recent` (12 rows), and
`ruleYield`. Seven unit tests pin the arithmetic, including
dash-not-zero and killed-findings-counted.

**The scan theater** (D-80): while a review runs, the review page returns
`<ScanTheater>` full-screen (fixed, z-50, covers the rail), with stage
gauge, live feed, clock, cost, Cancel and Hide. Minimize is keyed to the
run's `startedAt`, so a new run reopens the theater.

**The e2e surface this plan disturbs, by line** (verified today):

- `e2e/failure-paths.spec.ts:141` "the rail says how many reviews are
  waiting on a person": `getByLabel(/awaiting your decision/)` plus a
  numeric text check. Survives if the top bar keeps the same `aria-label`;
  the test's *name* and comment still say rail and must follow the truth.
- `e2e/themes.spec.ts:51-52`: every screenshot test asserts
  `nav a[aria-current="page"]` has count exactly 1. The top bar must keep
  exactly one current link per screen, and the dashboard at `/` needs
  current-marking logic that does not use `startsWith` (every path starts
  with `/`; the rail's `startsWith` logic never had a home link to break
  on).
- `e2e/themes.spec.ts:193` first-Tab focus test: passes on any visibly
  focused element; the top bar's first link inherits the global
  `:focus-visible` outline. Verify, do not assume.
- `e2e/themes.spec.ts:205` horizontal-scroll check covers the new bar on
  every screen.
- Screenshot compositions all change (rail gone). They are regenerated per
  run, not goldens, so nothing to migrate; the FG-4 evidence set is simply
  re-shot at M6.
- `journey.spec.ts:47,67` and `themes.spec.ts:75` click a link named "app".
  Journey does it unscoped but from `/projects`, where no widget exists;
  the projects widget on `/` must not break these because they never run on
  `/`. If M3 adds a project named link to the dashboard, the widget's link
  must still be unambiguous on its own page.
- `README.md` embeds `docs/images/confirmation-queue.png` and
  `run-screen-dark.png`, both showing the rail. Stale the moment M1 lands;
  M6 refreshes them from the new e2e output in the same repo state.

**What is deliberately not in scope.** Multi-ruleset composition (still
deferred); WP-L my-branches (unchanged, in `UX-UPLIFT-PLAN.md`); any
user-arrangeable widget persistence (see gate 2).

## 2. The target, precisely

### The top bar

One `<header>` with a `<nav>`, full width, `h-12`, sunken ground with the
bottom hairline (the chrome voice PageHeader already speaks). Left to
right:

1. The try-square mark + `Trysquare` wordmark, linking to `/`.
2. Nav links: **Dashboard, Projects, Reviews, Rulesets, Settings**.
   Dashboard is a real item, not the wordmark's job, because the themes
   suite requires exactly one `aria-current` on every screen including `/`.
   Current-marking: exact match for `/`, prefix match for the rest. Active
   style: accent text + a 2px bottom border in accent (the rail's spine,
   rotated); inactive: muted, hover raises. Icons stay (16px inline SVG,
   same paths as the rail's).
3. Right: the awaiting badge (same `aria-label`, same
   `question`-tone pill, now beside the Reviews link or at the bar's right,
   driver's call, but it must remain a *link* to the reviews list filtered
   to awaiting) and the live-scan chip: pulsing dot + "Reviewing
   {project} {branch}", linking to the review; paused shows "Paused". The
   chip keeps following the manager over the status column.
4. The 4-second poll of `/api/reviews/attention` moves from the rail into
   the bar unchanged.

At phone width (WP-K applies to the bar from day one): the wordmark
collapses to the mark, labels stay (five short words fit 360px with icons
dropped; drop icons before labels, never labels before icons).

`main` becomes a plain column under the bar; the drafting-board ground now
runs edge to edge, which it never could beside a raised rail.

### The dashboard

`/` becomes a widget grid. v1 is a **fixed composition** (gate 2): no
drag, no per-user layout, no persistence. Order and spans:

| Widget | Content | Data | Empty state |
| --- | --- | --- | --- |
| Stat tiles (row, 4-up) | as today | `/api/scoreboard` | as today |
| Needs you | Every review awaiting a decision: branch pair mono, project, confirmed-of-total, age; each row links straight to its queue | new `awaitingReviews` on the scoreboard read (the count exists; the rows do not) | "Nothing is waiting on you." and nothing else; this widget earns its space only when it has work |
| Live scan | When a review runs: mini ruled gauge of the seven stages, current stage name, elapsed, cost so far, one action "Open scan view" into the theater. When none: hidden entirely, not an empty box | extended `/api/reviews/attention` (add `currentStage`, `startedAt`, `costEquivalentUsd`) | hidden |
| Recent reviews (wide) | as today | as today | as today |
| Rule yield | as today | as today | as today |
| Projects | Each project: name, last review's outcome (status chip + confirmed-of-total + when), and a Review-a-branch link. This closes the WP-I leftover the plan moved here | new `projects` on the scoreboard read: per-project latest review join | teaching copy pointing at Add project |

Widget chrome: `Card` with the machined edge, uppercase mono micro-label
(`NEEDS YOU`, `LIVE SCAN`, `RULE YIELD`...), the D-79 voice throughout.
Every figure measured; every rate with no denominator is a dash; the live
widget's clock ticks only while something runs (the scoreboard page gains
the same run-gated 1s tick the review page has).

Grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-4`, tiles spanning 1, Needs
you and Live scan 2 each, Recent 3, Rule yield 1, Projects 2. The driver
may tune spans against real content; what is fixed is the order: needs-you
before history, live before archive.

### What retires

`src/components/rail.tsx` is deleted, not stranded. Its badge and chip
logic move to the bar; nothing else in it survives. The dead-export gate
habit applies: no orphaned helpers left behind.

## 3. Work packages

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| M0 | Preconditions | - | DONE 2026-08-18. The run was not in flight: the dev server was down and no engine process existed, so the row saying `running` was orphaned. Baseline green at 720 tests. |
| M1 | The shell swap | M0 | DONE 2026-08-18 (d4cafd9) |
| M2 | Data for the widgets | M0 | DONE 2026-08-18 (21b6c22) |
| M3 | The dashboard | M1, M2 | DONE 2026-08-18 (this commit) |
| M4 | Live wiring and the batch event | M3 | DONE 2026-08-18. The widget's gauge, clock and deep link landed with M3; this closed D-71's runner half. |
| M5 | Responsive: the bar and every widget at 360px, the WP-K rules applied to the new shell (monitor and decide first-class; setup desktop-first) | M3 | TODO |
| M6 | Evidence and records: both themes re-shot, FG-4 evidence refreshed, README's two embedded images regenerated, 04 home section finalized, PROPOSED entries below recorded DECIDED, rows closed here and in `UX-UPLIFT-PLAN.md` | M1-M5 | TODO |

Sequencing: M1 and M2 are independent after M0 and may land in either
order; M3 needs both. M4 touches `src/server/engine`/`jobs` and is the one
package with pipeline blast radius: its emit must be proven with the fake
CLI (a scripted run asserting the event arrives once per request, not
duplicated on resume) before any real run sees it. M5 before M6 so the
screenshots capture the responsive truth.

Estimated shape: M1 and M3 are the heavy two; M2 and M6 small; M4 and M5
medium.

## 4. Decisions (PROPOSED here, DECIDED when built)

1. **Dashboard is a nav item, wordmark also links home.** Required by the
   one-aria-current invariant; also honest, since the dashboard is now a
   destination, not an absence of one.
2. **Fixed widget composition in v1.** User-arrangeable widgets mean
   persistence, drag-drop, and a settings surface, none of which the
   directive asked for. If the maintainer wants arrangement later it is
   its own plan; nothing in this layout forecloses it.
3. **The Live scan widget hides when nothing runs.** An empty "live" panel
   is a dashboard lying about having something to watch. Hidden, the
   Needs-you widget takes its row.
4. **The attention endpoint stays the rail-cadence endpoint** (now
   bar-cadence): two reads, no joins, every 4 seconds. The dashboard's
   richer data loads once per visit from `/api/scoreboard`; only the bar
   chip and badge poll.
5. **The rail's file is deleted in M1**, not kept as a fallback. Two
   shells is a design decision nobody made; git history is the fallback.

## 5. Records

- 04 section 2 (Navigation) is rewritten in M1's diff; the Home section
  in M3's; the FG-4 proof paths already point at `review/<date>-e2e/`.
- `UX-UPLIFT-PLAN.md`: WP-M and WP-N rows point here now; they close when
  M6 does. WP-K closes with M5 for the shell surfaces; the queue's phone
  layout stays with the original row.
- D-71's open half (the runner-side batch event) closes with M4 and is
  said so in its DECIDED entry.
- Every WP that changes what a screen shows re-shoots; M6 is the sweep,
  not the only photographer.

## 6. Review cadence

A structured pass after M3 (the shell and dashboard cluster, the
verdict-driving half) and another at M6 before the records commit, each
recorded in `DECISIONS.md` with numbered findings. FG-4 is then judged by
the maintainer against the re-shot set, which now includes the dashboard
and the theater: the two screens their own directives produced.
