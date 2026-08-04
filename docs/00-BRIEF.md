# App brief: Trysquare

Status: RATIFIED 2026-07-30 at G0, captured that day from the maintainer's briefing.
Feasibility gate: the app is only built if reviews can run on the maintainer's Claude
Code subscription (Max tier) instead of pay-per-token API billing. Research in
progress; verdict goes to `DECISIONS.md`.

## Not built yet

This document specifies the target. Verified against the code on 2026-08-03,
these parts of it do not exist yet. They stay here as requirements rather
than being edited away; the item in `plans/M4-FINISH-PLAN.md` that owns each
is named.

- Tiers composing per review. A ruleset carries a tier, but a review uses
  exactly one ruleset: the start route takes a single id and the screen is a
  single-select. Composing several per review is unowned by any current work
  item and needs a decision before it is built.

## What it is

A local app that runs strict, protocol-driven AI code reviews of git branches.
Think "local PR reviewer": no hosting, no login, single user.

## Core flows

1. **Projects.** Add a project by git URL; the app clones it into a managed
   folder. The app NEVER modifies project code; clones are read-only review
   material.
2. **Review setup.** Select project, filter/select the branch to review,
   select the branch to compare against (default: the repo's main/master,
   auto-detected). Select the ruleset.
3. **Rulesets.** Configurable rules/standards to check violations against.
   Three tiers, composable per review:
   - Global rules: apply to any and all development.
   - Tech rulesets: per stack and its best practices (e.g. React, Firestore).
   - Project rulesets: app-specific rules and domain knowledge.
     Rulesets are shareable and reusable across projects. The reference shape
     for one is a review protocol document: process rules, then a numbered
     anti-pattern database (rule, violation example, correct pattern,
     detection hints, severity), then severity definitions and an output
     format. A public example lives at `tests/fixtures/example-protocol.md`.
     Not every project follows the same protocol, hence per-review ruleset
     selection.
4. **Review run.** Very strict process: treat code as written by a junior dev,
   trust nothing, inspect data flow, components, reusability, edge cases.
   Follow the protocol's execution procedure: change inventory, risk
   classification, comprehension pass, adversarial pass, deletion review,
   finding verification, self-audit.
5. **Linked reviews (added 2026-07-30).** Some apps split across two repos:
   a main app and a package it consumes (e.g. a web app and the shared-core npm
   package, mostly TS interfaces/typings). When a change set includes
   package changes, both repos' branch pairs are reviewed together as one
   review: combined ledger, and every changed exported type/signature in
   the package verified against its consumers in the main app. The package
   is not always part of a PR; including it is optional per review.
6. **Finding confirmation before final output.** Every finding is re-verified
   against the checked-out branch: is it a real issue, do file and line
   numbers match the actual file. The maintainer then reviews all findings in the UI
   to confirm or dismiss each before the final report is produced.

## Quality bar

- World class design and UI/UX. Nothing that reads as AI-built.
- Proper tests: unit and e2e. Proven working, not asserted.
- Local only; no auth system.

## Constraints

- Reviews must run on the Claude Code subscription (no API billing) or the
  app is not worth building; the fallback is continuing reviews in Claude
  Code chat in VSCode.
- Two other AIs are independently planning this app; their plans will be
  given to us for review before ratification.

## Open questions

Tracked in the planning doc; blocking ones are raised to the maintainer directly.
