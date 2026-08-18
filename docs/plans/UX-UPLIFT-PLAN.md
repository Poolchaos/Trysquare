# UX uplift plan: the audit, the research, and the work

Status: RATIFIED 2026-08-17, all gates answered same day (D-68, D-69). The
maintainer said the current design and UX are lacking and asked for an
audit, research, and a plan, with gamification considered. This document is
all three, and since ratification it also pins the visual direction: the
maintainer generated mocks from prompts across three rounds and picked from
pictures. The picked set is designated evidence at
`review/2026-08-17-ux-direction/` (local, like all review evidence).

**The ratified direction (build to this, not to adjectives).** Dark leads,
light derived, both photographed. Near-black blue-gray matte surfaces, thin
1px borders, one cyan-teal accent reserved for interactive elements and
progress, monospace for everything code-adjacent, large tabular numerals
for headline counts, glow budget of one live element per screen, severity
red/amber untouched as the strongest colors in review content. Per screen:
queue with line-referenced rows, a failure-mechanism strip under the code,
and honest cost/duration tiles; dense scoreboard with named per-rule yield
bars and local-history sparklines; typographic report with one bold summary
sentence and prose-first finding cards; mobile single-column queue with
bracketed Confirm/Dismiss. **Banned from shipping** (D-68 has the reasons):
predicted remediation cost or fix time, live critical-miss rates,
leaderboards, avatars or reviewer columns, confidence percentages,
apply-recommendation actions, search/notification/account chrome. The
standing test for any new widget: if the number is not measured from this
machine's own data, it does not render.

Method: every screen read from the live screenshot set
(`review/2026-08-17-e2e/`, produced by the browser suite the same morning),
a full parallel code inventory of every page, component, token file and the
schema, the FG-4 notes, `docs/04-UI-DESIGN.md` verified against the
implementation, and live-fetched research. Every finding carries evidence.

## 0. How to work this plan (non-negotiable)

Written for an AI driver to execute work package by work package. It plans;
it does not code. All `CLAUDE.md` rules apply, and four rails specific to
design work:

- **`docs/04-UI-DESIGN.md` is the spec.** A change that moves a screen away
  from 04 updates 04 in the same diff, with a DECISIONS entry when it
  reverses a recorded choice. Design drift with no paper trail is how the
  spec went stale the last time.
- **Every visual WP re-runs the proof.** `./verify.sh --build --e2e` green,
  axe stays green in both themes, and the screenshot set regenerates. A
  design change whose screenshot still shows the old design is not done.
- **The charter's tone rules bind gamification too.** No emoji, no
  decorative illustration, no marketing surfaces, reduced motion respected.
  Anything that reads as a toy fails `docs/AI-ANTIPATTERNS.md` on sight.
- **The severity-color law holds.** CRITICAL red and WARNING amber are
  reserved within review content; no new element competes with them on the
  same screen (04 section 1, D-56).

Definition of done per WP: one diff, gate green unpiped, screens re-shot,
stale docs fixed in the same diff, WP row marked DONE with the hash.

## 1. The audit

Severity here means "what it costs the person using the app".

### A. The failures that justify the maintainer's verdict

**F1. The confirmation screen buries its purpose.** In awaiting
confirmation, the queue sits below the stage timeline, the coverage panel
and the run notes: a full viewport of finished run detail before "0 of 9
decided" appears (`journey-confirmation.png`). The FG-4 notes flagged this
ordering as an open question and left it; the maintainer's verdict answers
it. The layout is also identical across running, awaiting and complete
states, though the person's job differs completely between them.

**F2. The report, the product's one artifact, is a raw text dump.** 04
specifies "Rendered report"; the implementation prints unrendered markdown
into a `<pre><code>` box capped at 32rem with its own scrollbar
(`src/app/reviews/[id]/page.tsx:760`). `src/lib/review/report.ts` builds a
structured document, summary line, completeness statement, severity groups,
dismissals with reasons, provenance footer, and the last step flattens all
of it to `text-xs` monospace. Severity has no color here, headings no
weight. This is the payoff of a five-minute run, with less hierarchy than
the queue the person just left. The same findings then repeat as cards
below the box, so the screen says everything twice and neither copy is
scannable. Export is markdown to disk (`export/route.ts:42`), nothing a
colleague can be handed whole.

**F3. The app's most actionable state has no global affordance.** The
rail's live chip matches only running and paused reviews
(`src/components/rail.tsx:40-42`); a review sitting in awaiting
confirmation, the one state that needs a human, is invisible everywhere
except the reviews list. There is no "N awaiting your decision" badge, and
the rail polls the entire review list every 4 seconds on every screen
forever to power the one chip it does show (`rail.tsx:48`).

### B. Waiting, feedback, and state failures

**F4. A five-minute run's only live signal is a raw engine-text tail.**
Three semantically distinct event classes, lifecycle, model output, run
notes, are collapsed into one string array distinguished by two-space
indent and a `note:` prefix (`reviews/[id]/page.tsx:282-285`), rendered as
40 monospace lines in a sidebar. Stage names print as internal ids
(`s3_adversarial started`) though human labels already exist in the STAGES
table on the same page. No elapsed time, no stage n of 7, no percent, no
estimate; per-stage duration appears only after a stage ends. The one
`role="progressbar"` in the whole app is the confirmation counter. The
honest fix is cheap: `stage_executions` stores started/ended for every
stage of every past review, so "usually ~3m on this machine" is a local
median, not an invention; batch n of m is not emitted by the manager (FG-4
notes flag it).

**F5. Completion is an anticlimax.** Deciding the last finding enables a
button; pressing it swaps the queue for the report box with no
acknowledgement of what just happened. `reviews.startedAt` and
`completedAt` exist and are never read anywhere, so total duration is never
computed, let alone shown (inventory, schema cross-check).

**F6. Four screens can hang on "Loading..." forever.** Project detail,
review detail, ruleset detail have no error path on their initial fetch: a
failed load is indistinguishable from a slow one, permanently. Rulesets and
settings render `null` while loading (half the screen simply absent). There
is no `loading.tsx` anywhere; four screens render a headerless "Loading..."
that shifts the page when chrome arrives.

**F7. Empty and warning states are inconsistent where they matter.** The
branch list's "No branch matches that filter" also fires when the
repository genuinely has no branches, telling the user to fix a filter they
never typed (`projects/[id]/page.tsx:187`). The new-review branch filter's
empty state bypasses the shared Empty component. The stale-refs notice
renders in error red though it is informational. Against that, the app also
contains the best empty states I have seen in a small tool ("No findings:
every hunk was accounted for and nothing survived verification"; "Every
review is still here; only this filter is hiding them"), so the bar is
already set in-house; it is unevenly met.

### C. History that keeps no score

**F8. The reviews list is a log, not a record.** Rows carry status, branch
pair, timestamp, Delete (`light-reviews.png`). The API returns full rows;
the client interface keeps 5 fields and discards cost, tokens, model,
effort, duration (`reviews/page.tsx:17-26`). No status filter, no
grouping, no search; the project filter renders only when more than one
project exists. A three-hour review that confirmed 12 criticals weighs the
same as a cancelled one.

**F9. The database keeps score and the UI never says it.** The inventory's
full list is long; the load-bearing items: total spend, spend per project,
cost per confirmed finding: never computed. `findings.status === "killed"`,
the engine's measured invention rate, is actively filtered out of every
screen (`reviews/[id]/page.tsx:331`, `confirmation.tsx:79`).
`findings.ruleCode` is never grouped, so a ruleset's rules cannot be judged
by yield. `editedComment`, which the schema itself annotates as "the
measurement of whether the prompts are any good", is a per-finding marker
and never a count. Risk tags from S1 are never surfaced at all. The
manager even computes finding counts into its snapshot and the API route
overwrites them with the raw array (`api/reviews/[id]/route.ts:19`). A
user with 50 reviews cannot answer "how much have I spent", "which rules
ever fire", or "is this model getting better", though each is one GROUP BY
away. Section 3 builds on this.

**F10. Status states are visually interchangeable.** AWAITING CONFIRMATION
wears the same chip family as COMPLETE. The one distinction the list must
make at a glance is the one it does not make.

### D. Navigation and identity

**F11. The two terminal screens of the primary flow dead-end.** The review
detail screen never names or links its project (its snapshot type omits
`projectName`); there are no breadcrumbs anywhere; the report panel offers
nothing onward after export. Home is a bare redirect to Projects: no
dashboard, no "what happened recently", and the first thing a new user
sees is a list of repositories they have not added yet.

**F12. The token system is declared and unspoken.** The design pass
defined a five-step type scale, a spacing scale and motion tokens in
`globals.css`; grep finds zero references to any of them. Components use
raw Tailwind: 96 uses of `text-xs`, 72 of `text-sm`, hardcoded
`duration-200`, one-off sizes below the smallest defined step. The color
tokens, by contrast, are airtight (zero hardcoded colors anywhere, full
OKLCH dark theme). The vocabulary exists; the screens do not speak it.
This is the "proper design" half of the maintainer's complaint in one
finding: the surface is near-unstyled because the system that would style
it is unused.

**F13. Small real defects riding along.** "N rules on" renders with a
dangling "on" when a ruleset has no source document
(`rulesets/page.tsx:173-175`). The per-stage token line omits cache-write
though the review-level panel now shows it. Copy-report gives no
confirmation. `SystemInfo.running` is fetched and never rendered. Raw
checkboxes and bare buttons in two screens bypass the hit-target token.

### E. Stale records found by this audit

**F14.** 04's "Not built yet" list still names U6/U10-owned gaps that
landed weeks ago; the FG-4 notes claim contrast is "checked by nothing"
when axe has been green in both themes since U12. WP-A fixes records
before any pixels move.

## 2. The research

Live-fetched 2026-08-17.

**Gamification in software engineering has real but narrow evidence.**
Controlled studies found gamified peer code review improved review quality
and engagement; a 45-developer survey found 73% considered badges helpful
for adopting practices. The same literature documents distortion: teams
chasing badges shifted their output toward the badged activity, and the
systematic mappings call the field preliminary. The recurring design
recommendation is Self-Determination Theory: competence, autonomy,
relatedness; intrinsic over extrinsic.

- [Impact of Gamification on Code review process (ACM ISEC)](https://dl.acm.org/doi/10.1145/3021460.3021474)
- [Gamification improves the quality of student peer code review](https://www.researchgate.net/publication/363885163_Gamification_improves_the_quality_of_student_peer_code_review)
- [Does Gamification Work in the Software Development Process? (HCI Games Group)](https://medium.com/gameful-design/does-gamification-work-in-the-software-development-process-76780e49e545)
- [Gamification in software engineering: systematic mapping (arXiv)](https://arxiv.org/pdf/2011.07115)
- [Engaging Developers in Exploratory Unit Testing through Gamification (arXiv)](https://arxiv.org/html/2408.04918v1)

**Waiting UX: visible work beats spinners.** The labor-illusion research
shows people value results more when the work is visible; current AI-app
guidance is to show the current step, what is done, what comes next, and
an estimate. Trysquare's run screen already shows real work, a rare honest
instance of the pattern; it under-communicates position and duration (F4).

- [Slow AI: Designing User Control for Long Tasks (UX Tigers)](https://www.uxtigers.com/post/slow-ai)
- [Designing Better Loading and Progress UX (Smart Interface Design Patterns)](https://smart-interface-design-patterns.com/articles/designing-better-loading-progress-ux/)
- [The Labor Illusion (Fast Company)](https://www.fastcompany.com/3061519/the-ux-secret-that-will-ruin-apps-for-you)
- [Loading UI/UX Patterns for AI Applications (Telerik)](https://www.telerik.com/blogs/loading-ui-ux-patterns-ai-applications)

**Review-tool UX converges on the reviewer's queue as the first-class
surface** (Reviewable's progress tracking, Graphite's in-context review
companion) and on keeping review context unsiloed. F1 and F3 are the
distance between Trysquare and that bar.

- [Best AI pull request reviewers in 2025 (Graphite)](https://graphite.com/guides/best-ai-pull-request-reviewers-2025)
- [Code Review Tools Compared (CodePulse)](https://codepulsehq.com/guides/code-review-platforms-comparison)

## 3. Gamification, the honest version

The charter forbids most of what gamification is usually made of: no
emoji, nothing toy-like, numbers or silence. The research warns that
invented currencies distort behaviour. Both point the same way:

**Game elements may only surface measurements the product already makes.
Nothing is invented to be won.**

In value order:

- **The scoreboard that already exists (F9).** Per model and per ruleset,
  across reviews: precision (confirmed vs dismissed), invention rate
  (quote-check kills, today actively hidden), cost and duration medians,
  findings per severity, total and per-project spend. For protocol
  authors, rule yield: which of their 51 rules have ever produced a
  confirmed finding and which only ever produce dismissals. This is
  competence feedback for the person and the instrument panel for prompt
  work, and it is the gamification a truth-telling tool is allowed.
- **Momentum in the queue (with F1's layout).** The decided-of-total
  progress that exists, plus remaining-by-severity in the queue rail, with
  the keyboard as the mastery loop (already strong: j/k/c/d/e/g g).
- **The completion moment (F5).** When the last finding is decided: one
  summary card, decided n, confirmed, dismissed, killed, cost and duration
  against this machine's median, with export right there. A quiet beat, no
  confetti, reduced-motion safe.
- **The honest wait (F4).** Stage position, batch n of m, "usually takes"
  from local history. Labor honesty, not labor illusion.

**Explicitly rejected, overridable at gate 2:** streaks (single-user local
tool; time pressure is misaligned with careful review); badges and levels
(invented currency, the documented distortion); cross-person leaderboards
(single-user by architectural law); decision-speed metrics (rewarding fast
confirms is rewarding rubber-stamping, the exact failure the product
exists to prevent).

## 4. Decision gates (maintainer)

All answered 2026-08-17 by the maintainer, on the recommendations (D-69):

1. **Queue-first, state-dependent review screen (F1).** Awaiting
   confirmation leads with the queue, run detail collapses to a summary
   strip; complete leads with the report. Recommendation: yes. This
   decides the FG-4 open question.
2. **Gamification tier.** (a) measurements only; (b) a plus momentum,
   completion moment, honest wait (recommended); (c) b plus
   streaks/badges (recommended against, section 3).
3. **Identity scope (F12).** (a) make the screens speak the token system
   that already exists: type scale, spacing, motion, chip system
   (recommended, and it is adoption work, not invention); (b) a plus a
   proper mark; (c) full rebrand (not recommended).
4. **Rendered report + single-file HTML export (F2).** In-app rendering
   and an export a colleague can be handed whole; local file, no service,
   consistent with the privacy stance. Recommendation: yes.
5. **Home becomes the scoreboard.** Replace the bare redirect with the
   F9/section-3 dashboard: recent reviews, awaiting-your-decision, spend
   and outcome aggregates, teaching empty state on first run.
   Recommendation: yes, as WP-F's deliverable. (04 currently specs no home
   at all, so this is an addition, not a reversal.)
6. **Multi-ruleset composition** stays deferred (2026-08-04 DECISIONS)
   unless pulled forward; product scope, not polish.

## 5. Work packages

| WP   | Scope | Blocked on | Status |
| ---- | ----- | ---------- | ------ |
| WP-A | Records: 04's not-built list and design language brought to the ratified direction, FG-4 notes' stale claims (F14), gate answers recorded | - | DONE 2026-08-17 |
| WP-B | Queue-first review screen to the picked mock (queue-final.png, the denser variant): state-dependent composition, file path and line visible on every row with a filename header on the code panel (D-68 amendment), failure-mechanism strip, honest cost/duration tiles, queue rail with progress and severity remaining, status-chip differentiation, project link and breadcrumb (F1, F10, part of F11) | - | DONE 2026-08-17 (0cadb08, b0a31e8, 6f633eb) |
| WP-C | Report to the picked mock: rendered in-app with the typographic hierarchy, single-file HTML export beside the markdown, de-duplicate report vs finding cards, copy confirmation (F2, part of F13) | - | DONE 2026-08-17 (f2a38a4, f296cb1; D-73, D-74) |
| WP-D | The honest wait: three event classes rendered distinctly with human stage labels, elapsed and per-stage time, batch n of m emitted from the manager, "usually takes" from stage_executions history (F4) | - | DONE 2026-08-17 (79e6f78, 31a5bd4, and the batch planning below). The runner-side event that turns batchNumber into a live line is the one piece left; the counts now reach it on the request. |
| WP-E | States that fail honestly: error paths for every initial fetch, loading.tsx per route, headerless-loading fix, empty-state consistency incl. the zero-branch case (F6, F7) | - | DONE 2026-08-17 (68ea549 and the empty-state commit below). No loading.tsx was added: the three screens that needed one now keep their header and say why they are waiting, which is what the route file would have provided. |
| WP-F | The scoreboard as home, to the picked dense mock (D-75) | - | DONE 2026-08-17. The snapshot-counts overwrite and the branch-author column are not done: the first is invisible now that the list computes its own tallies, and the second waits on WP-L's identities. |
| WP-G | The completion moment and queue momentum; total-duration computed from startedAt/completedAt (F5) | WP-B | TODO |
| WP-H | Speak the token system, retuned to the ratified palette: adopt the declared type, spacing and motion scales across screens, retire one-off values, chips; both themes re-shot (F12) | - | DONE 2026-08-17 (palette, type scale, dead spacing tokens deleted, motion wired; D-72). The remaining one-off values (two badge sizes, a few max-heights) are left where they are: each is a deliberate exception rather than drift. |
| WP-I | History with outcomes: reviews list rows carry counts/cost/duration/model with status filter; project rows carry last outcome (F8) | - | DONE 2026-08-17. Project rows still carry no last outcome; that reads better beside the scoreboard's own aggregates and moves to WP-F. |
| WP-J | Rail and ergonomics: awaiting-decision badge in the rail, poll only what the chip needs, fold unprobed models on new review, selected states, small fixes from F13 | - | DONE 2026-08-17 (ffac6dd and the ergonomics commit below). The per-stage cache-write line from F13 is left for WP-H, which is where the stage rows get rebuilt. |
| WP-K | Responsive monitor-and-decide: every screen lays out at phone width; the queue becomes the picked single-column mobile mock with bracketed thumb-height Confirm/Dismiss; run monitoring readable on a phone; setup flows stay desktop-first (D-69) | WP-B | TODO |
| WP-L | My branches: settings holds the identities (seeded from git config), branch lists and the new-review picker gain a Mine filter matching tip-commit author email, scoreboard's author column uses the same identity (D-69) | - | TODO |

| WP-M | The dashboard-first shell (D-81): navigation to a slim top bar, the rail retired, home as composable widgets seeded from the scoreboard | full browser gate free (no run in flight) | TODO |
| WP-N | Scan theater follow-through: batch n of m as a live line once the manager emits it, per-file read ticker, and the browser-gate screenshots of the theater itself | WP-M or gate free | TODO |

Sequencing intent: WP-B first, it is the proof screen the direction was
ratified on. Then WP-C and WP-F, the other two heavies. WP-D, E, I, J, L
interleave freely. WP-G after WP-B; WP-K after WP-B because the mobile
queue derives from the desktop one. WP-H last, so the identity pass
photographs finished screens. WP-B, C, F are the heavy three; J and L
small; the rest medium.

## 6. Review cadence

A structured pass after WP-B+C (the verdict-driving failures), and another
after WP-F+G+H (the scoreboard and identity cluster), each recorded in
DECISIONS with numbered findings. FG-4 is then re-judged by the maintainer
against the new screenshot set; the existing FG-4 notes describe the
pre-uplift design and stop being the argument.
