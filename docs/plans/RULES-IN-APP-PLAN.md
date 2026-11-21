# Rules in the app plan

Status: DRAFT. Written 2026-11-20, for D-251's scope (CP-12): "use or add
config rules". Decided by the session; the maintainer reverses what he
does not want.

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done. A
session commits and pushes before it hands over (`SESSION-HANDOVER.md`).

Definition of done for every work package:

- One WP per diff; no batching.
- `./verify.sh --e2e` exits 0, run unpiped, and every test a WP adds is
  first shown failing.
- The real flow is driven in the browser, and every screen and state the
  WP touches is shot and graded A to D (`05-TESTING.md` section 3b).
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.

Work top to bottom through unblocked items without asking.

## 1. Goal and non-goals

**The problem.** A person's rules live in a document outside the app. To
change one word of one rule, add a rule or drop one, they edit that
document and import it again with replace; a ruleset is deleted only by
Settings' delete-everything (`idea-inbox.md`, 2026-11-03). In the app a
rule can only be switched off and have its severity changed.

**Goal.** In the app a person can add a rule, edit a rule's text, remove a
rule, and delete one ruleset, and what the model is given stays exactly
what the person wrote.

**What exists, read 2026-11-20.** A rule is stored with its parsed fields
and its verbatim markdown (`lib/rulesets/model.ts`: the raw markdown "is
what reaches the model"). `importProtocol` (`lib/rulesets/import.ts`)
parses a document and reports every line that reached no record, and the
import route refuses a document that loses a line.
`PATCH /api/rulesets/[id]/rules/[code]` changes `enabled` and `severity`
(`patchRule`), and a ruleset's version rises with a change. A review
freezes its rules as it starts (`writeReviewSnapshot`), so an edit never
reaches a review that has run. `deleteRuleset` and `duplicateRuleset`
exist in the repository; no route deleted one ruleset until RA-1.
`exportProtocol` writes a ruleset back out as a document.

**The design, in one paragraph.** A rule is edited as the markdown it is:
one text area holding the rule's own block, heading line and all. On save
the block goes through the importer's own parser as a one-rule document,
so the fields the app filters by (code, severity, tags, sweep patterns)
are read from the text exactly as an import reads them, and a block that
loses a line or parses to no rule, or to two, is refused with the
importer's words. No second parser and no form of separate fields: a form
would have to rebuild the markdown, and the rule the model is given would
then be the app's wording, not the person's (`model.ts`).

**Non-goals.** Editing process directives (they keep coming from the
document). Composing several rulesets per review. A ruleset read from a
project's repository (the inbox, 2026-11-03; D-236 put it in scope, and it
gets its own plan after this one). A rich-text editor.

**The seven gates, scaled down** (architecture standard; no dependency,
vendor, store or outside service is added). Platform fit: the importer,
the repository and the snapshot already there. Right-sized: four routes
and one editor. Failure modes: section 3. Secure: the text is rendered as
markdown already, an image never fetched (CP-5); the same renderer shows
the edit's preview. Operable: nothing new runs. Cost: none; a longer rule
costs tokens in every review that uses it, which the pre-flight's "Rules
and change" figure already shows. Evidence: the code lines above.

## 2. Work packages

| WP   | Scope | Blocked on | Status |
| ---- | ----- | ---------- | ------ |
| RA-1 | Delete one ruleset: a route over `deleteRuleset`, a control on the ruleset's page that says what goes (the rules, never a review that used them: its snapshot stays) and asks once. Refused while it is the default ruleset or a review in flight has not yet frozen it, each in words. | - | DONE 2026-11-21, 687191c (D-266). As built: the default is deleted too, the page saying first that new reviews then start with none chosen; refused only while a review in line is to start on it. A review that ran with it keeps its copy, which took migration 0019: the snapshot held its ruleset in place by a key. Shots graded in the commit. |
| RA-2 | Edit a rule's text. The rule's page opens its markdown in a text area; save parses the block with `importProtocol`, refuses anything that is not exactly one rule with every line kept, keeps the rule's place in the ruleset, and raises the version. Changing the code is allowed and refused if another rule has it. States: unchanged (save off), refused (the importer's words beside the field), saved. A preview of the text as rendered. | RA-1 | DONE 2026-11-21 (D-267), the save in a8bd216 and the editor in the commit after it, its shots graded there. The save: `parseRuleBlock` (`lib/rulesets/rule-edit.ts`), `replaceRuleText` and `PUT /api/rulesets/[id]/rules/[code]`, which takes the markdown and the version it was read at. A rule keeps its place, its group's tags and its sweep patterns; a severity changed in the app stays unless the text's own severity line changed; a rule with sweep patterns keeps its code until RA-5. The editor: Edit text on an opened rule, one field, the text as it will read under it. A refusal for a version since replaced left the person to reload the page by hand, losing what they typed; built in review round 18 (section 5). |
| RA-3 | Add a rule. "Add a rule" opens the same editor on a starting block that shows the protocol's shape (heading with a code, the rule, a violation, the correct pattern, detection, severity), each part a line the person replaces; nothing of it is saved until they do. The new rule goes to the end of its group, or of the ruleset. | RA-2 | DONE 2026-11-21, c534d24 (D-268), its shots graded there. As built: `POST /api/rulesets/[id]/rules` takes the markdown, the version it was written at and the rule it follows; `addRule` puts the block into the ruleset's document there, moves every later block down by its lines, and reads the document back with the importer, taking the rule's section, tags and sweep patterns from that reading and saving nothing unless the other rules read back as stored. The screen picks the section (the last one unless another is chosen) and sends that section's last rule. A block still holding a line of the starting text is refused by that line (`parseNewRuleBlock`). A ruleset with no rule takes one too, which RA-6 needs. Not built: the rules table says nothing while a ruleset has no rule, a state no screen reaches until RA-4. |
| RA-4 | Remove a rule. A control on the rule, asked once, saying that reviews already run keep it. Removing the last rule is allowed and the pre-flight already refuses a ruleset with none on (AE4). | RA-2 | DONE 2026-11-21, 1b4fb08 (D-269), its shots graded there. Found on the way and fixed in 25d34b3: a switched-off rule's row, drawn at 55% opacity, fell under AA contrast in both themes. As built: `DELETE /api/rulesets/[id]/rules/[code]?version=N` and `removeRule`: the rule goes, the blocks after it move up to where it started, the version rises. The screen: Remove rule beside Edit text in an opened rule, asked once with what a removal is against switching the rule off, the focus on Keep it; a note where the rule was; a page behind the ruleset is refused, reads it again and says so. A ruleset left with no rule says a review will not start on it, and a rule is added to it from there, the state RA-3 built and no screen reached. |
| RA-5 | The round trip held by a test: a ruleset edited, added to and removed from in the app exports (`exportProtocol`) to a document that imports back to the same rules with every line accounted for. The sweep table follows a rule whose patterns changed. | RA-2 to RA-4 | DONE 2026-11-21 (D-271). As built: a save, an add and a removal each read the ruleset's document back with the importer and store that reading (`readDocument`): where every block stands, and each rule's section, tags and sweep patterns. Measured before it: a rule saved three lines longer left the export differing from what was stored. `tests/server/api/rule-round-trip.test.ts` holds the round trip through a rule saved longer, one saved shorter, an add, a removal and a save after them, and a ruleset whose line numbers an earlier save left untrue is put right by its next change. Settled, not built as first written: a table row in a rule's text is a sweep row for the rule it names, as an import reads it (round 18's sixth finding), so stored and exported agree; a rule's code stays held while a row outside its own text names it, and a removed rule's rows stay in the sweep table, since the table is a directive and directives are not edited in the app. No screen changed. |
| RA-5b | The ruleset's page says when a save, an add or a removal moved another rule's sweep patterns (D-271): the answer names the rules and their patterns, and the note the page already shows says it. The held code's refusal says how a code is changed, where it says "cannot yet". Shot and graded. | RA-5 | TODO |
| RA-6 | A new ruleset with no document: "New ruleset" asks a name and a tier and starts empty, so rules can be written in the app from nothing. | RA-3 | TODO. To hold here: a ruleset with no block exports an empty document, which the importer reads as one directive, so its export does not read back as what is stored (`readDocument` reads no block as nothing). |
| RA-7 | Records: README (what a person can change in the app), RUNBOOK, 02 (the ruleset's version), 04 (the rule's page), `PROJECT-STATE.md` Not built. | RA-1 to RA-6 | TODO |

## 3. What can go wrong, and what holds it

- An edit changes what a past review is read against. Held by the snapshot
  a review freezes; RA-2's test edits a rule and reads a finished review's
  report unchanged.
- An edit quietly weakens a rule: a line dropped, a severity lost. Held by
  the importer's line accounting, on every save.
- A sweep pattern that no longer compiles or never ends. A rule's patterns
  come from the table rows that name its code, read from the whole
  document after every change (RA-5, D-271), so a row written into a
  rule's text can give one, as it can in an imported document. One that
  does not compile runs as the text it is, and the run says so
  (`lib/review/sweep.ts`); one that never ends is not guarded against, in
  the app or in an import.
- A change that moves another rule's sweep patterns without a word: a row
  in rule 4's text that names rule 5, or rule 4 removed with it. Stored
  and exported agree (RA-5); the page saying so is RA-5b.
- A rule that loses its sweeps by a change of code. Held: the code is
  refused while a row outside the rule's own text names it
  (`RuleCodeHeldError`, D-271).
- A code fence opened in a rule and never closed. Read alone the block is
  one rule; in the ruleset's document every heading after it reads as
  code, and the example protocol with one such rule exported and read back
  as 3 rules of 15 (measured 2026-11-21, RA-2 as first built). Refused at
  the save by the line that opens it (`unclosedFenceLine`,
  `lib/rulesets/import.ts`). An import still takes one in a document's
  last block, where nothing follows it, so a rule is not added after such
  a rule until its fence is closed (`RuleFenceOpenError`, RA-3).
- A new rule that lands somewhere the document does not say. Held by
  reading the document back with the rule in place: its section, tags and
  sweep patterns are that reading's, and an export of the ruleset imports
  back as what is stored, line numbers too (`tests/server/api/rule-add.test.ts`).
- The starting text saved as a rule and put to a model. Refused while any
  line of it is left.
- A change that leaves the export unlike what is stored: line numbers a
  save did not move, an order a removal changed. Every change reads the
  document back and stores the reading, and one that would not read back
  as its blocks saves nothing (`tests/server/api/rule-round-trip.test.ts`,
  `tests/server/api/rule-remove.test.ts`).
- A rule removed from a page that is behind the ruleset. The removal
  carries the version the page read, a stale one is refused, and the page
  reads the ruleset again before it is asked a second time.
- Two rules with one code. Refused by name, as an import refuses it
  (`DuplicateRuleCodeError`).
- A ruleset deleted under a review about to start. RA-1's refusal.
- An edit lost: two tabs save the same rule. The save carries the version
  it read, and a stale one is refused with "this ruleset changed since you
  opened it".

## 4. Decision gates

None waits on the maintainer. Decided here by the session (D-251), each
reversible: a rule is edited as markdown, not as a form; directives are
not editable in the app in this plan.

## 5. Review cadence

A structured review pass after RA-4 and after RA-7.

The pass after RA-4 ran on 2026-11-21 (review round 18, in DECISIONS). Two
of its six findings are fixed: a review in line storing its copy of the
rules over the ruleset (D-270), and a severity line written into a rule's
text. Three were on the ruleset's page, fixed the same day in one change,
shot and graded (the commit after the round's record):

- A rule saved as its heading alone shows the heading as its text when
  opened (`GET /api/rulesets/[id]`, the `text` of a rule whose markdown has
  no line break).
- A save or an add refused for a version since replaced
  (`RulesetChangedError`) left the text unsaveable without a reload,
  which lost it. The page now reads the ruleset again, keeps the text as
  typed and says so, as a removal does; a save says when the rule's own
  text was changed meanwhile, since saving then replaces that change.
- The section a new rule goes to stayed chosen after its last rule was
  removed (`NewRule`), run in the browser test before it was fixed: the
  page went on naming the section and its tags.

The sixth was settled with RA-5 (D-271, its row).
