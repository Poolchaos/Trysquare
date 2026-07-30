# Plan template

Copy this file to `docs/plans/<topic>-PLAN.md`, list it in `docs/README.md` in
the same commit, and fill every section. Delete this instruction block.

---

# <Topic> plan

Status: DRAFT | RATIFIED | DONE. Written YYYY-MM-DD.

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done, commit
only when asked.

Definition of done for every work package:

- One WP per branch/diff; no batching.
- `./verify.sh` exits 0, run unpiped.
- The real flow is driven at runtime, not just typechecked.
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.
- Open decisions are asked, or the WP is scoped so the decision is not needed
  yet. Do not guess.

Work top to bottom through unblocked items without asking; skip blocked items
until their input lands, never wait on them.

## 1. Goal and non-goals

## 2. Work packages

| WP   | Scope | Blocked on | Status |
| ---- | ----- | ---------- | ------ |
| WP-A | ...   | -          | TODO   |

## 3. Decision gates (maintainer)

Each gate lists the options with a recommendation. None is assumed; a gate is
resolved only by an entry in `docs/DECISIONS.md`.

## 4. Review cadence

A structured review pass after every 3-4 completed WPs and before anything
goes external. Findings numbered and fixed before new WPs start.
