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
| RA-2 | Edit a rule's text. The rule's page opens its markdown in a text area; save parses the block with `importProtocol`, refuses anything that is not exactly one rule with every line kept, keeps the rule's place in the ruleset, and raises the version. Changing the code is allowed and refused if another rule has it. States: unchanged (save off), refused (the importer's words beside the field), saved. A preview of the text as rendered. | RA-1 | IN BUILD. The save is built, 2026-11-21 (D-267): `parseRuleBlock` (`lib/rulesets/rule-edit.ts`), `replaceRuleText` and `PUT /api/rulesets/[id]/rules/[code]`, which takes the markdown and the version it was read at. A rule keeps its place, its group's tags and its sweep patterns; a severity changed in the app stays unless the text's own severity line changed; a rule with sweep patterns keeps its code until RA-5. To build: the editor on the ruleset's page, with its states shot and graded. |
| RA-3 | Add a rule. "Add a rule" opens the same editor on a starting block that shows the protocol's shape (heading with a code, the rule, a violation, the correct pattern, detection, severity), each part a line the person replaces; nothing of it is saved until they do. The new rule goes to the end of its group, or of the ruleset. | RA-2 | TODO |
| RA-4 | Remove a rule. A control on the rule, asked once, saying that reviews already run keep it. Removing the last rule is allowed and the pre-flight already refuses a ruleset with none on (AE4). | RA-2 | TODO |
| RA-5 | The round trip held by a test: a ruleset edited, added to and removed from in the app exports (`exportProtocol`) to a document that imports back to the same rules with every line accounted for. The sweep table follows a rule whose patterns changed. | RA-2 to RA-4 | TODO |
| RA-6 | A new ruleset with no document: "New ruleset" asks a name and a tier and starts empty, so rules can be written in the app from nothing. | RA-3 | TODO |
| RA-7 | Records: README (what a person can change in the app), RUNBOOK, 02 (the ruleset's version), 04 (the rule's page), `PROJECT-STATE.md` Not built. | RA-1 to RA-6 | TODO |

## 3. What can go wrong, and what holds it

- An edit changes what a past review is read against. Held by the snapshot
  a review freezes; RA-2's test edits a rule and reads a finished review's
  report unchanged.
- An edit quietly weakens a rule: a line dropped, a severity lost. Held by
  the importer's line accounting, on every save.
- A sweep pattern that no longer compiles or never ends. Read in RA-2: a
  rule's patterns come from the document's sweep table, not from the
  rule's own block, so an edit of the block cannot change one, and the
  save keeps them as stored. A pattern is changed by importing the
  document until RA-5.
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
