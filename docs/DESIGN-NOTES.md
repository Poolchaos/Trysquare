# Design notes

The argument for the design half of G3, written against the screens as they
are at the commit that added this file (2026-11-22). It is for the
maintainer's acceptance: nothing here passes the gate, and the grades are
the builder's own, given by looking at each screenshot named.

This replaces `review/2026-08-18-fg4/DESIGN-NOTES.md`, which went with an
earlier machine (`GATES.md`, notes). It is kept in `docs/` so it cannot go
the same way (D-306).

## How to read it

- **The screenshots.** `./verify.sh --e2e` writes them to
  `review/<date>-e2e/` on the machine that runs it. That folder is ignored
  by git, so run the gate to get them. The whole-screen shots are named
  `light-<screen>.png`, `dark-<screen>.png` and `<theme>-<screen>-phone.png`
  (`e2e/themes.spec.ts`); a phone is 360 by 780 there, and 390 by 844 in the
  shots of single regions.
- **The data.** Every shot is of the browser suite's fixture: one project,
  `app`, its seeded branch, and the reviews the suite ran against the fake
  CLI. Seventeen reviews of one branch pair is the suite's doing, not a
  design.
- **The grades.** A to D as `05-TESTING.md` section 3b defines them. Only A
  and B pass. A grade is given only for a shot looked at on 2026-11-22;
  what was not looked at is listed at the end.
- **The template test** (`CLAUDE.md`, section 7): every surface holds at
  least one decision a template could not have made. It is answered per
  screen below.

## The design in a paragraph

A reviewer's instrument, dark first with light derived (D-68): one UI face,
one monospace for everything that is code, a path, a hash or a branch, and
one accent, teal, kept for where the person is and what they can do next.
Dense where the data is dense, and no surface that sells. Each screen says
what the app did and what it knows, in sentences, where a template would
put a label and a number.

## Screen by screen

### Dashboard (`/`)

What it is for: what the reviews have produced, and what is waiting on the
person.

What a template could not have decided: every figure is counted from this
machine's reviews and says its own denominator ("confirmed of the proven
findings decided", "by the quotation check, of findings raised"). Needs you
lists what goes on only when a person acts, oldest wait first (a running
interactive review and one a restart interrupted last, with no age), each
row saying what it waits for. Rule yield is sorted with the rules confirmed
least often first, because the question it answers is which rule costs
attention for nothing.

Grades: `light-dashboard` A, `dark-dashboard` A, `light-dashboard-phone` B.
On a phone Recent reviews shows its branch pair column alone; the other
five are reached by scrolling the table sideways, and nothing on the screen
says so.

### Projects (`/projects`) and a project's page

What they are for: adding a repository, and starting a review of one of its
branches.

What a template could not have decided: the list's one line under its
title, "Cloned read-only. Trysquare never writes to a project's code", is
the app's first law said where a repository is handed over. A project's
branches carry ahead, behind and the last commit's subject, with Review on
each, and Mine narrows them by the git emails that count as the person's.
Tests and design is off until turned on, and says what off means.

Grades: `light-projects` A, `dark-projects` A, `light-project-detail` A,
`dark-project-detail` A, `light-project-detail-phone` B. On a phone the
branch table scrolls sideways in its card, and seventeen review rows stand
between the branches and the project's settings.

### New review (`/reviews/new`)

What it is for: choosing the branch pair, the rules and the model, and
knowing what the run will be before it is started.

What a template could not have decided: only a model a fresh probe vouches
for can be chosen, and the card says what a probe costs and that it is
never made on a timer. The intent field says how its words are used: "Put
to the model as a claim to check against the code, not as instructions."
Beside Start: "Pressing it pins the commits."

Grades: `light-new-review` A, `light-new-review-phone` B. On a phone a long
branch name is cut beside its ahead and behind counts.

### A running review (the scan view)

What it is for: watching minutes of work without wondering whether it is
stuck.

What a template could not have decided: the five steps across the top are
in a person's words, each with its own count as it is reached, under a
stage named large with what it does. The tallies of proof fill while the
verifiers work. An interactive review's command stands in a "Your turn"
card above the feed for as long as it is waited on.

Grades, from the interactive review's shots (D-302, D-304):
`interactive-your-turn-focused-light` B, `-dark` B,
`interactive-feed-waiting-light` B, `-dark` B, `-phone` B,
`interactive-verification-stage-dark` B, `-phone` B. The feed under the
card is mostly empty while a stage waits.

The card as rebuilt on 2026-11-23 (D-315), from that day's shots:
`interactive-your-turn-closed-light` B, `-dark` B, `-phone` B: the stage
by its name, one command in its box with the card's one outlined Copy,
the other shell's a line to open. `interactive-your-turn-open-light` B,
`-dark` B, `-phone` B: both commands open and a refused copy said beside
the path; on a phone the refusal wraps under the path's label and its
Copy stands alone on the next line. `interactive-your-turn-focused-phone-light`
B, `-dark` B. Short of A: the path's Copy is on its label's line at the
far edge, a card's width from the path it copies at desk width.
A headless review's scan view was not looked at for these notes.

### Confirmation (a review awaiting its decisions)

What it is for: deciding each finding, with the proof in sight.

What a template could not have decided: a finding is shown with the code it
quotes as the checked-out file has it, the failure mechanism, what it was
proven from, which guards were searched, and which two models proved it.
Confirm is offered only for a finding proven by both. Dismiss takes a
reason first. The count above the list is what is left to decide.

Grades: `dark-queue` A, `light-queue-phone` B, `dark-queue-phone` B. On a
phone the list's paths and titles are cut to fit beside their severity.

### A completed review and its report

What it is for: the record of what was found, how it was proven, and what
was examined.

What a template could not have decided: "How the findings were proven" is
a funnel from raised to proven by both, and each of the five steps says
what it did in this review and how many requests it took. The report opens
on "What was examined": every changed file and hunk accounted for, said as
the app's count, and the files read outside the change said as the model's
own account. A screen the project's e2e saved is shown with its grade, what
is off, and whether the second grader agreed.

Grades: `light-review` A, `dark-review` A (the top 1500px and the report's
findings), `light-review-phone` B, `dark-review-phone` B (its first two
thirds). On a phone a long code quote is cut at its card's edge and scrolls
in its box with nothing to say so, and one long file path runs to the
card's border. The report says "file(s)" and "hunk(s)".

### Reviews (`/reviews`)

What it is for: finding a review again.

What a template could not have decided: a row leads with what state the
review is in, and Delete says under the list what it removes, the review's
run folder, and what it leaves, an exported report.

Grades: `light-reviews` B, `dark-reviews` B: each row's figures sit as a
ragged cluster at its right, not in columns. `light-reviews-phone` was D
when these notes began: in a row with few figures the branch pair was cut
to "featur...". Fixed in the commit that adds this file, where the row's
link takes the phone's width and the figures go under it; the shot after
the fix is graded in D-306.

### Rulesets (`/rulesets`) and a ruleset's page

What they are for: what a review is judged against.

What a template could not have decided: a new ruleset starts from a
template, a document or nothing, and each template says "Not yet run
against a model" for as long as that is true. A ruleset's page says what
switching a rule off does, that a changed severity moves the version, and
what the exported document leaves out.

Grades: `light-rulesets` A, `dark-rulesets` A, `light-rulesets-phone` B,
`light-ruleset-detail` B, `dark-ruleset-detail` B,
`light-ruleset-rule-open-phone` B. Each rule shows its severity twice, as a
badge and in the picker beside it. On a phone a long rule title drops under
its number.

### Settings (`/settings`)

What it is for: how a run behaves, which CLI runs it, and where things are
kept.

What a template could not have decided: each setting says its consequence
("Two share one usage limit and make each other slower"). The CLI card says
how the sign-in is billed. "Where results are sent" says no mail account is
set up and nothing is sent. The danger zone names what it deletes and what
it keeps.

Grades: `light-settings` A, `dark-settings` A, `dark-settings-phone` B. On
a phone the model rows break differently by the length of a model's name.

## Across every screen

- At 360px the top bar's navigation scrolls sideways and its last label is
  cut under the "awaiting" count. Known, and left as designed (D-239).
- Both themes hold: no dark shot looked at lost a border, a label or a
  state that its light twin had.
- axe finds no violation of WCAG 2 A or AA on the dashboard, Projects,
  Reviews, Rulesets and Settings in
  either theme (`e2e/themes.spec.ts`), and on each region the other browser
  tests scan.

## Not looked at for these notes

`dark-new-review`, `light-queue`, the lower two thirds of `light-review`
and `dark-review` beyond the report's findings, the last third of
`dark-review-phone`, `light-projects-phone`, `light-settings-phone`, and
the dark phone shots of the dashboard, the reviews list, the rulesets list,
a project's page, the projects list, a new review and a ruleset's page. A
headless review's scan view. The screens of a rule being added, edited or
removed, which the browser tests shoot region by region.

## For the maintainer

Accepting the design is yours. The shots to judge are the ones named above;
the weak points are said under each screen and are in
`plans/idea-inbox.md` where they are not fixed.
