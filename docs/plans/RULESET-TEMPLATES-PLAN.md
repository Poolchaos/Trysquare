# Ruleset templates plan

Status: IN BUILD. RT-1a, RT-2a, RT-1b, RT-2b, RT-6a, RT-3a and RT-3b DONE
2026-11-21; RT-6's runs of the General and TypeScript templates are the
maintainer's to start, and RT-4 is next to build (D-273, D-274, D-276 to
D-280). Written
2026-11-20, for D-251's scope (CP-12): "best quality and world class
templates". Decided by the session; the maintainer
reverses what he does not want.

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done. A
session commits and pushes before it hands over (`SESSION-HANDOVER.md`).

Definition of done for every work package:

- One WP per diff; no batching. One template is one WP.
- `./verify.sh --e2e` exits 0, run unpiped, and every test a WP adds is
  first shown failing.
- Anything a person sees is shot and graded A to D (`05-TESTING.md`
  section 3b).
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.
- Nothing in a template is recalled: every rule cites the primary source
  it rests on, with the date it was read.

## 1. Goal and non-goals

**The problem.** A person who adds a project has no rules to review it
against until they write a protocol document and import it. The only one
that ships is `tests/fixtures/example-protocol.md`, a test fixture that
"doubles as a starter ruleset".

**Goal.** A new user picks a template on the Rulesets screen, gets a
ruleset good enough to start a real review from, and edits it from there
(`RULES-IN-APP-PLAN.md`).

**What a template is.** A protocol document in this repository, in the
shape the importer already reads, taken in through the same import and its
line accounting. No new format and no second path: a template that loses a
line fails a unit test before it fails a user.

**The bar for "good enough", each part checked by something that runs:**

1. Every rule has what the importer's shape gives a rule: the rule, a
   violation, the correct pattern, how to detect it, a severity. A test
   refuses a template rule missing one.
2. Every rule is one a model can prove from the code: it names something
   visible in a diff and the files around it. A rule of taste ("prefer
   clear names") is left out, since a finding under it cannot be proven
   and is spent tokens (D-251: no token spent that buys nothing).
3. Every sweep pattern compiles, matches its own rule's violation example
   and does not match its correct pattern. A test holds each.
4. Every rule cites its source in its notes, a primary one (the
   language's or framework's own documentation, a standard), with the date
   read. The words are written here, never copied; the source is linked.
5. Small. A template has at most fifteen rules: every rule is put to the
   model for every file its tags fit, and the pre-flight shows the size.
6. Proven on a model once per template: a fixture with one planted
   violation per rule and a clean look-alike beside each, scored against
   its key as the 11-defect fixture is (`05-TESTING.md` section 4). That
   run spends the maintainer's usage and is his to start; until it has
   run, the template's card says it has not been run against a model.

**The templates, in order.** Chosen for what the maintainer's own projects
are written in, most general first:

1. General: what any change is held to, whatever the language. Errors
   swallowed, input trusted at a boundary, a secret in code, a resource
   not released, a behaviour changed with no test, leftover debugging.
2. TypeScript: escapes from the type system (`any`, an unchecked cast, a
   non-null assertion on a value that can be null), a promise not awaited,
   a switch that is not exhaustive.
3. React: the rules of hooks, an effect's dependencies, state derived
   twice, keys, a control a keyboard cannot reach.
4. HTTP API and database: a query built from input, an endpoint that does
   not check who asks, an unvalidated body.
5. Firebase: security rules and reads that cost, from the current official
   documentation. Last, and only with the maintainer's word that he wants
   it shipped in a public repository.

**Non-goals.** A template per framework version. Rules for a language no
fixture can prove. Templates fetched from the network: they ship in the
repository and nothing is downloaded.

**The seven gates, scaled down** (architecture standard; no dependency,
vendor, store or outside service). Platform fit: the importer and the
import route. Right-sized: files and one list. Failure modes: section 3.
Secure: a template is rendered as an imported document is, an image never
fetched. Operable: nothing runs. Cost: tokens per review grow with rules,
bounded by the fifteen. Evidence: each rule's cited source.

## 2. Work packages

| WP   | Scope | Blocked on | Status |
| ---- | ----- | ---------- | ------ |
| RT-1a | The shelf, its server half (D-273). Template documents live in the repository's `templates/` folder, `<slug>.md` each, with `shelf.json` beside them saying what each is for, its version and the model run that proved it, if one has. The server reads the folder at run time and lists it; the tests of bar 1, 3 and 5 are one function the reader runs over every document, so a template that falls short is never listed. | - | DONE 2026-11-21, the commit after cf10ce4 (D-273). As built: `templateBarFailures` (`lib/rulesets/template-bar.ts`), `readShelf` (`server/rulesets/shelf.ts`) and `GET /api/ruleset-templates`. A shelf that is not whole answers with the reason: an index that cannot be read or is not in its shape, a template listed twice or with no document, a document the index does not list, a document under the bar. The shelf ships with no template, and a test names the templates it holds so one that reads as empty by mistake fails. A browser test asks the built server for the list: the folder is found under `npm run start`. Not as first written: the example protocol is not the first entry. Measured against the bar it falls short in 15 ways (eight rules with no correct pattern, two with no violation example, two with no detection, and three sweep patterns that match no line of their rule's violation example), and it stays the importer's fixture. |
| RT-1b | The shelf on the Rulesets screen: the templates listed with a name, what each is for, its rule count and whether it has been run against a model; "Use this template" imports it as a new ruleset the person owns, the template's name and version in its description. | RT-2a, so the screen is built and shot against a real template | DONE 2026-11-21, the commit after 1c10e84 (D-276), its shots graded in the commit. As built: the Rulesets form opens on A template, the first of three ways to start; each template is a choice showing its name, its rule count, what it is for and "Not yet run against a model." until a run is on record; Use this template makes the ruleset under the name given, or the template's, and opens its page, which says "Imported from the General template, version 1." `POST /api/ruleset-templates/[slug]/use` takes a tier and a name, refuses a name in use and answers a template not on the shelf with a 404. A shelf that cannot be read says so in the form, with Try again, and the other two ways stay open. |
| RT-2a | The General template, to the bar, on the shelf. | RT-1a | DONE 2026-11-21, the commit after a770477 (D-274). `templates/general.md`: twelve rules under six sections (failures, boundaries, resources, proof, leftovers, removals), each with its rule, a violation, the correct pattern, detection, a severity and the source it rests on, read that day: ten on CWE 5.0 entries, the two on tests on Google's review guide. Thirteen sweep patterns, each matching a line of its own rule's violation and none of its correct pattern. The bar's fourth part is checked too: a rule with no linked source and date read is under the bar (`templateBarFailures`). `tests/templates/general.test.ts` holds what the importer reads from it: eleven rules put to every file, the one on weakened tests to test files. Not run against a model, and its entry says so (`modelRun` none). |
| RT-2b | The General template's fixture: one planted violation per rule and a clean look-alike beside each, with a key, built as the seeded fixture is. | RT-2a | DONE 2026-11-21, the commit after d0fde6f (D-277). `tests/fixtures/build-general-fixture.mjs` builds a small storefront service whose feature branch breaks each of the twelve rules once and, beside each plant, makes a change of the same shape that is right, with the test that proves it: 35 files changed, 12 planted and 23 clean. The key is derived from the files as built. `tests/templates/general-fixture.test.ts` holds it without a model: a plant for every rule at the rule's severity, each keyed to a line the change adds (the removed guard to where it stood), nothing changed but plants and look-alikes, and the template's thirteen sweep patterns hitting the six plants whose rules have one and no other added line. Breaking the fixture on purpose failed it. Not built here: the command that reviews it (RT-6a). |
| RT-6a | The command that reviews a template's fixture end to end with the template as its ruleset and scores the run against the key, as `npm run demo:fixture` does the seeded one: on the fake engine in a test, on a real model with `--real`. | RT-2b | DONE 2026-11-21, the commit after 0eeb45d (D-278). `npm run demo:template -- general --fake` (and `--real`, or `--model <id>`): the fixture demo with `--template <name>`, which builds `tests/fixtures/build-<name>-fixture.mjs`, takes the template from the shelf as the ruleset and reviews one repository with no linked one. Run on the fake engine: 12/12 plants found, no finding in the 23 clean files, exit 0; the seeded demo run after the change: 11/11, exit 0. CI runs the fake form after the seeded one, in place of a test in the suite. A template not on the shelf, or with no fixture, is refused in words. |
| RT-3a | The TypeScript template, to the bar, on the shelf. | RT-2b | DONE 2026-11-21, the commit after 7486754 (D-279). `templates/typescript.md`: nine rules under three sections. Escapes from the type checker: an explicit `any`, an assertion on a value nothing checked, a non-null assertion on a value that can be null, the checker silenced by a comment. Promises: one left floating, an async function where nothing waits for it. Types the code does not check: a switch that does not cover its union, an indexed value taken as present, a type predicate that does not check what it claims. Each rests on a source read that day: the TypeScript handbook, the TSConfig reference and two release notes for six, typescript-eslint's rule pages for three. Nine sweep patterns, each borne out by its own rule's examples. `tests/templates/typescript.test.ts` holds what the importer reads: seven rules put to TypeScript files, the two on promises to JavaScript files too. Not run against a model. |
| RT-3b | The TypeScript template's fixture: one plant per rule and a clean look-alike beside each, with a key, as RT-2b built the General one's. | RT-3a | DONE 2026-11-21, the commit after 0ecbb58 (D-280). `tests/fixtures/build-typescript-fixture.mjs`: an orders service in strict TypeScript whose feature branch breaks each of the nine rules once beside a right change of the same shape with its test, 27 files changed, 9 planted and 18 clean. Both fixtures are now built by one helper (`template-fixture.mjs`) and held by one set of checks (`tests/templates/fixture-checks.ts`), and each key carries what its change says it is for, which the demo tells the review. Broken on purpose (a non-null assertion in a look-alike), its sweep check failed. `npm run demo:template -- typescript --fake`: 9/9 plants, nothing in the clean files; the General and seeded demos after the change: 12/12 and 11/11. CI runs the fake form. |
| RT-4 | The React template and its fixture. | RT-3b | TODO |
| RT-5 | The HTTP API and database template and its fixture. | RT-4 | TODO |
| RT-6 | The model runs: each template's fixture reviewed once on the recommended pair, scored against its key, the evidence committed under `docs/evidence/` (D-261). A rule the model misses or raises on the clean look-alike is rewritten and run again. | RT-6a and RT-2b to RT-5, the maintainer's go per run | TODO (maintainer starts each) |
| RT-7 | The Firebase template. | RT-6, the maintainer's word | TODO |
| RT-8 | Records: README (first steps start from a template), RUNBOOK, 04, `PROJECT-STATE.md`. | RT-1a to RT-5 | TODO |

## 3. What can go wrong, and what holds it

- A template that reads well and finds nothing. Bar 6: a model run against
  planted violations, and the card saying so until it has run.
- A rule that fires on correct code, costing a person's attention on every
  review. The clean look-alike beside each planted violation, in the same
  run.
- A rule that states something the language's documentation does not.
  Bar 4, and a review pass over each template before it merges.
- A template a later version of the importer cannot read. Bar 1's test
  imports every file on the shelf on every gate.
- A user edits their copy and a later release changes the template. A
  ruleset made from a template is the person's own copy, with the
  template's name and version in its description; nothing updates it.

## 4. Decision gates

- **The Firebase template** ships only with the maintainer's word (RT-7).
- **Each model run** is his to start (RT-6).

Decided here by the session (D-251), each reversible: templates are
protocol documents in the repository; fifteen rules at most; the four
named first.

## 5. Review cadence

A structured review pass after RT-1b and after each template.

The pass after RT-1b and the General template ran on 2026-11-21 (review
round 20, in DECISIONS), over RT-1a, RT-2a, D-275, RT-1b, RT-2b and RT-6a.
Three findings, all in the records and fixed in one change: 04 still
listed templates as not built, the RUNBOOK's third step told a person to
paste into a form that now opens on a template, and README's account of
how a ruleset is made left the template out.
