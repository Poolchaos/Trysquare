# Completion plan

Status: DRAFT. Written 2026-11-17, from the audit of that day
(`AUDIT-2026-11-17.md`) and the maintainer's answers to it: "You will be
driving this to completion in full. design to functionality to automation."

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done. A
session commits and pushes before it hands over (`SESSION-HANDOVER.md`).

Definition of done for every work package:

- One WP per diff; no batching.
- `./verify.sh` exits 0, run unpiped; with `--e2e` for anything a build or
  a browser can see, and every test a WP adds first shown failing.
- The real flow is driven at runtime, not just typechecked. Anything a
  person sees is shot and graded A to D (`05-TESTING.md` section 3b).
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.
- Open decisions are asked, or the WP is scoped so the decision is not needed
  yet. Do not guess.

Work top to bottom through unblocked items without asking; skip blocked items
until their input lands, never wait on them. Anything that calls a model
spends the maintainer's usage and needs their go, given per WP.

## 1. Goal and non-goals

**Goal.** The audit regrades A on all seven gates; the MVP exits
(`MVP-PLAN.md` section 1, as CP-2 re-scopes it); G1, G2 and G3 each hold a
verdict from the maintainer; and what CG-5 puts in scope is built.

**Non-goals.** Windows: no Windows-only proof is asked of new work, and no
effort goes into Windows-only failures, until the maintainer says otherwise
(2026-11-17: "no need to cater for it for now", "we might cater for it in
the future"). Its CI leg keeps running and is not a required check. No
verdict is given by an AI: a gate passes on the maintainer's word alone.

## 2. Work packages

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| CP-1 | Audit F1, F2: next and eslint-config-next to 16.4.6 (D-231). `./verify.sh --e2e` exits 0 twice, each from a clean `.next`; CI green at the commit. | - | DONE 2026-11-17 (fe22a19, D-231): `./verify.sh --e2e` exited 0 twice, each from an empty `.next`, 1477 unit tests passing, 8 skipped, and 137 browser tests each time; `npm audit --omit=dev` reports 0. CI for it is CP-2's push. |
| CP-2 | Audit F4: a decision entry that the MVP's exit criteria 1, 4 and 5, row 7.4 and G1's row are met on Linux, the maintainer's machine now; `MVP-PLAN.md`, `GATES.md` and the README's Windows note brought to it. The Windows CI leg stays, as information. | - | DONE 2026-11-17 (D-232): the criteria, row 7.4, `GATES.md` and the README's requirements say Linux; `main` requires the Ubuntu and macOS checks. |
| CP-3 | The records: audit F6, F7, F8 and the grader's G1 to G4; the inbox entries filed under Retired while open; `npm run doctor` saying its remedy only on a failing line (F14, with a test). Then a fresh grader regrades Honest. | CP-1, CP-2 | TODO |
| CP-4 | Audit F10: the three CI actions pinned to commits; `.github/dependabot.yml` for npm and for the actions. Alerts and protection on `main` were turned on 2026-11-17. | - | TODO |
| CP-5 | The five security checklist lines the audit did not re-walk, read over b1b2fce to HEAD, D-227's markdown renderer among them; findings fixed or recorded. | CP-1 | TODO |
| CP-6 | Named test gaps: a test for the queued-before-the-ending race (`DECISIONS.md`, review round 16); a browser test that opens a process directive, with axe (the suspected defect in the inbox); the macOS shutdown anomaly read again when it recurs. The Windows CI stall is parked under CP-2's decision. | - | TODO |
| CP-7 | Fresh evidence for the verdicts, on Linux and the current engine: `npm run demo:fixture` and `npm run demo:design` with real models, scored against their keys, every proof read. The earlier runs' folders are on no machine the maintainer has. | CP-1, CG-1, CG-2 | TODO |
| CP-8 | The maintainer's verdicts: G1 on finding quality (`FG2-CHECKLIST.md`), WP-I and WP-J. Recorded in `GATES.md` and the plan rows the same day. | CP-7 | TODO (maintainer) |
| CP-9 | MVP 7.4: the maintainer's own review of a real branch with their protocol, and one stage by hand in Mode B from the printed command (owed by 3.7). The G2 verdict. | CP-8 | TODO (maintainer) |
| CP-10 | The open UX rows, one diff each: WP-G the completion moment; WP-K the queue at phone width; WP-L my branches; the ruleset page at phone width (`PROJECT-STATE.md`, Known issues). | CP-3 | TODO |
| CP-11 | G3's design half: the design notes written again against the screens as they are, every screen in both themes and at phone width, for the maintainer's acceptance. | CP-10 | TODO |
| CP-12 | What CG-5 puts in scope, each planned in its own plan file before it is built. | CG-5, CP-9 | TODO |
| CP-13 | Hygiene: merged local branches pruned; the backup branch that holds D-229's old commits removed. | CG-3 | TODO |
| CP-14 | The maintainer's handover tooling installed on this machine from their configuration repository, so the session limit is enforced by hooks and not by a session remembering. Outside this repository. | CG-4 | TODO |
| CP-15 | A full regrade by a fresh grader. Done at A on all seven gates, or with each remaining risk accepted by the maintainer in writing. | all above | TODO |

## 3. Decision gates (maintainer)

Each gate lists the options with a recommendation. None is assumed; a gate is
resolved only by an entry in `docs/DECISIONS.md`.

- **CG-1: spend for CP-7.** One run of each fixture on Opus 5.5 with Fable
  5.1 second. The last such runs cost $3.1545 and $2.4593 cost-equivalent on
  the subscription (D-193, D-200). Go, or judge on the decision log's
  summaries of the lost runs. Recommended: go; a verdict on evidence nobody
  can open is weaker than one run costs.
- **CG-2: where evidence lives.** `review/` is ignored by git and went with
  the last machine. (a) Stay as it is, and accept the loss again. (b) Keep
  each gate's scored result and findings in the maintainer's private
  storage, named in `GATES.md`. Recommended: (b).
- **CG-3: local branches.** 419 local, 3 unmerged. Delete the merged ones
  and the D-229 backup? Recommended: yes for merged; the backup once the
  maintainer confirms nothing in it is wanted.
- **CG-4: the handover hooks.** Install the maintainer's own tooling here,
  which changes their global settings and has not been run on a second
  machine, or stay with the meter a session runs by hand. Recommended:
  install, as a task of its own with the maintainer present.
- **CG-5: what "functionality to automation" covers.** Not built today:
  rules added, edited and removed in the app (asked 2026-11-03); a project's
  ruleset read from its own repository (chosen 2026-11-03); a memory guard on
  a project's own commands; more than one ruleset or dependency per review;
  emailing a report; reviews in a GitHub pipeline (`README.md`, Options under
  discussion). Which are in? Recommended: the first three, then the pipeline
  as its own plan; the rest stay out of v1.

## 4. Review cadence

A structured review pass after every 3-4 completed WPs and before anything
goes external. Findings numbered and fixed before new WPs start.
