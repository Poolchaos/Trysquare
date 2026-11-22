# Rulesets together plan

Status: BUILT 2026-11-22, RS-1 to RS-5, both review passes run (section
5). Written 2026-11-21, for what D-251 asks of templates: "use
or add config rules" from "templates" worth starting from. Decided by the
session (D-288); the maintainer reverses what he does not want.

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done. A
session commits and pushes before it hands over (`SESSION-HANDOVER.md`).

Definition of done for every work package:

- One WP per diff; no batching.
- `./verify.sh --e2e` exits 0, run unpiped, and every test a WP adds is
  first shown failing.
- Anything a person sees is shot and graded A to D (`05-TESTING.md`
  section 3b).
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.

Work top to bottom through unblocked items without asking.

## 1. Goal and non-goals

**The problem.** A review is judged against exactly one ruleset. The four
templates on the shelf are each for one thing (any change, TypeScript,
React, an HTTP API and its store), so a person reviewing a TypeScript
change picks the General template or the TypeScript one and goes without
the other. The same holds for a company's own protocol and a template.
The brief lists "Tiers composing per review" as unowned and needing a
decision (`00-BRIEF.md`), and it was deferred on 2026-08-04 for want of a
design for colliding rule codes (DECISIONS, "DEFERRED ... multi-ruleset
reviews").

**Goal.** A review is judged against one or more rulesets chosen when it
is set up. A finding names one rule, no rule is asked twice, and the
report says which rulesets and versions the review ran with.

**What exists, read 2026-11-21.**

- A review's frozen rules are rows of `review_rulesets`, keyed by review
  and ruleset (`src/server/db/schema.ts`), so several rows for one review
  can be stored today. `readReviewSnapshot` already joins every row's
  rules and directives, in the rulesets' name order
  (`src/server/db/repositories/rulesets.ts`).
- Everything that writes or chooses takes one: `writeReviewSnapshot` one
  ruleset id, the start route one optional `rulesetId`
  (`src/app/api/reviews/[id]/start/route.ts`), the pre-flight one
  (`src/app/api/reviews/preflight/route.ts`), the service's start one
  (`src/server/review/service.ts`), the job manager's line one per waiting
  review, held in memory (`src/server/jobs/manager.ts`), and the
  new-review screen a single select.
- `readReviewSnapshotMeta` answered with the first row by name, so a
  report named one ruleset. It answers with every row since RS-2a.
- A rule's code is unique within its ruleset (`rules_ruleset_code_idx`)
  and nowhere else: all four templates number their rules from 1. A
  finding holds the bare code (`findings.ruleCode`), a sweep hit is keyed
  by it, and coverage is keyed by code and file (`pairKey`,
  `src/lib/rulesets/compose.ts`).

**The design, in one paragraph.** The rulesets of one review must not
share a rule code, and a set that does is refused before anything is
written, naming the codes and the rulesets they are in. Codes are not
qualified by their ruleset: a qualified code changes what the model is
shown and every key built on a code, to serve a case a refusal handles.
So that the shelf composes, the templates' codes are made disjoint: the
General template keeps 1 to 12, TypeScript takes 21 to 29, React 31 to 38,
and HTTP API and database 41 to 48. A person's own protocol that shares a
code with a ruleset beside it is told which, and renumbers one of them in
its document.

**Non-goals.** Codes qualified by ruleset. A tier that picks rulesets by
itself. Merging two rulesets into one stored ruleset. Finding that two
rulesets hold the same rule under different codes: it is asked twice, and
the pre-flight's size is where that cost shows.

**The seven gates, scaled down** (architecture standard; no dependency,
vendor, store or outside service is added). Platform fit: the snapshot
table and its reader already hold several. Right-sized: a list where one
id was, and one refusal. Failure modes: section 3. Secure: nothing new is
read or sent. Operable: nothing new runs. Cost: more rules per request,
shown by the pre-flight before Start. Evidence: the code lines above.

## 2. Work packages

| WP   | Scope | Blocked on | Status |
| ---- | ----- | ---------- | ------ |
| RS-1 | The templates' codes made disjoint: TypeScript 21 to 29, React 31 to 38, HTTP API and database 41 to 48, in each document's headings and sweep rows and in its fixture's key; each template's version raised; a test that no two templates on the shelf share a code. | - | DONE 2026-11-21, a6054b9 (D-289) |
| RS-2a | The snapshot's meta, the report (markdown and HTML) and the report on the review's page name every ruleset frozen onto the review, each with its version. Built first, so that no commit holds a review that ran with two and a report that names one. | RS-1 | DONE 2026-11-21, 43266c9 (D-290) |
| RS-2b | The server takes a set: the start route and the service accept `rulesetIds`, one or more, the single `rulesetId` still read; a set whose codes collide is refused with a 409 that names each shared code and the rulesets it is in, before any row is written; one snapshot row per ruleset. Built with it, since the type it changes is the one the line holds: a review waiting in line holds its set, and a ruleset in any waiting set is not deleted. | RS-2a | DONE 2026-11-21, 59c7496 (D-291) |
| RS-3a | The pre-flight sizes the set, read as a run's snapshot is read, and refuses the same collision in the same words. | RS-2b | DONE 2026-11-21, 46685fb (D-292) |
| RS-3b | The model is given each ruleset's directives under that ruleset's name (section 3), when the review has more than one: they were given one after another, unnamed. Proven by a run on two rulesets with the fake engine, the system prompt its first stage was sent read back; the demo script takes one ruleset, so no demo on two exists yet. | RS-3a | DONE 2026-11-21, d1fc787 (D-293) |
| RS-4a | New review: the Rules picker is a list of the rulesets by tier, each one ticked or not, the default ticked; the collision said under it with Start off, known from the rule numbers the rulesets list now carries; none ticked said the same way. Split from RS-4 by the session: the draft's Start sits in the review page's header and wants its own layout. The review's page and the report name the rulesets since RS-2a. | RS-3b | DONE 2026-11-22, 15a0295 (D-294) |
| RS-4b | A draft's own Start, on the review's page: the same list, the collision and none ticked said the same way, Start off. | RS-4a | DONE 2026-11-22, 8e1fa66 (D-295) |
| RS-5 | Records: README (How it works), RUNBOOK, 00-BRIEF's unowned line, 02, 03, 04, `PROJECT-STATE.md`. A review pass over RS-1 to RS-4b. | RS-4b | Records DONE 2026-11-22: README, RUNBOOK, 00-BRIEF, 04 and `PROJECT-STATE.md` with RS-4a and RS-4b, 02 and 03 after them. The review pass: DONE 2026-11-22, round 25 in DECISIONS, over RS-4a and RS-4b, which round 24 did not read; four findings, fixed. |

## 3. What can go wrong, and what holds it

- A finding that names a code two rulesets hold. Held by the refusal:
  no review starts on such a set, at the route, at the pre-flight and for
  a review waiting in line.
- One rule's sweep run twice. A sweep is keyed by its rule's code, so
  with codes distinct no pattern is another rule's. Sweep rows are read
  per document at import, so a row in one ruleset gives no pattern to a
  rule of another.
- A resumed review reading a different set. It reads its own snapshot
  rows, as today; nothing chosen later reaches it.
- A report that names one ruleset of three. RS-2a changed the meta to
  all of them, and a test reads a report of a review on two.
- Each ruleset's directives given side by side, some saying the same (two
  severity tables). They are given as written, each under its own
  ruleset's name. The cost is tokens, which the pre-flight shows; trimming
  a directive would be the app rewording what the model is given.
- A ruleset deleted, or emptied of rules, while a review that will start
  on it waits. The delete is refused for any ruleset in a waiting set; a
  set with one ruleset that has no rule switched on is refused as one is
  today (`NoEnabledRulesError`), naming it.
- A person's protocol numbered from 1 beside the General template. The
  refusal names the shared codes; the protocol is renumbered in its
  document and imported again, since a code that sweep rows name is held
  in the app (D-271).

## 4. Decision gates

None waits on the maintainer. Decided here by the session (D-251, D-288),
each reversible: a collision is refused and codes are not qualified; the
templates' codes are made disjoint so they compose.

## 5. Review cadence

A structured review pass after RS-2 and after RS-4b. Run: round 24 over
RS-1 to RS-3b (2026-11-21) and round 25 over RS-4a and RS-4b
(2026-11-22), both in DECISIONS.
