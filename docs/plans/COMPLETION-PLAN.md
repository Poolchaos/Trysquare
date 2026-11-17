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
| CP-1 | Audit F1, F2: next and eslint-config-next to 16.4.6 (D-231). `./verify.sh --e2e` exits 0 twice, each from a clean `.next`; CI green at the commit. | - | DONE 2026-11-17 (fe22a19, D-231): `./verify.sh --e2e` exited 0 twice, each from an empty `.next`, 1477 unit tests passing, 8 skipped, and 137 browser tests each time; `npm audit --omit=dev` reports 0. CI run 44078397131 at 9d15898, the push that carried it, passed on all three platforms. |
| CP-2 | Audit F4: a decision entry that the MVP's exit criteria 1, 4 and 5, row 7.4 and G1's row are met on Linux, the maintainer's machine now; `MVP-PLAN.md`, `GATES.md` and the README's Windows note brought to it. The Windows CI leg stays, as information. | - | DONE 2026-11-17 (1c5e239, D-232): the criteria, row 7.4, `GATES.md` and the README's requirements say Linux; `main` requires the Ubuntu and macOS checks. |
| CP-3 | The records: audit F6, F7, F8 and the grader's G1 to G4; the inbox entries filed under Retired while open; `npm run doctor` saying its remedy only on a failing line (F14, with a test). Then a fresh grader regrades Honest. | CP-1, CP-2 | PART 2026-11-17: the records and the doctor's line fixed (8f9cf07); a fresh grader regraded Honest C, the inherited findings closed bar part of F4, with ten new stale claims from its own sweep, fixed in 5bbe745. A third grader graded it C again: three material findings (private reporting switched off, now on; "no telemetry", now scoped, its cause CP-5b; a fourth thing that spends usage) and ten minor, fixed in the commit after. A fourth, at 1a43243, graded it C once more: one material finding in CP-5b's own wording (a second request Next makes, D-234), a paid command described as the wrong model, the latest paid run missing from the README and the gate ledger, and eleven minor, fixed in the commit after. A fifth, at b80615d, graded it C: the README said nothing reaches a third party while CP-5's S1 stood unfixed and unsaid outside this plan, now said in the README, `SECURITY.md` and Known issues; and eleven minor, fixed in the same commit. A sixth grade is owed, after S1 itself is fixed, and the gate at A. |
| CP-4 | Audit F10: the three CI actions pinned to commits; `.github/dependabot.yml` for npm and for the actions. Alerts and protection on `main` were turned on 2026-11-17. | - | DONE 2026-11-17, in the commit after CP-2's: checkout v5.1.0, setup-node v5.0.0 and upload-artifact v4.6.2 by commit, the workflow's permissions stated as read, and Dependabot for the actions alone, monthly. npm is answered from alerts by hand (D-231), so no npm entry. Pushed as 6f44125; CI run 44081122822 at 8f9cf07, the first to use the pins, passed on all three platforms. Dependabot opened three pull requests within minutes (checkout 7.0.1, setup-node 7.1.0, upload-artifact 7.0.2), so its updates are now grouped into one; the bumps themselves were merged the same day, CP-4b. |
| CP-4b | The actions' major bumps Dependabot proposed (pull requests 2 to 4, or the grouped one that replaces them): read each release's breaking changes against how `verify.yml` uses the action, merge only with Ubuntu and macOS green. | - | DONE 2026-11-17 (87450b4): pull request 5 moves checkout to 7.0.1, setup-node to 7.1.0 and upload-artifact to 7.0.2. Their breaking changes, read in each release's notes: checkout 6 keeps credentials in a separate file and 6.1 and 7 refuse a fork's pull request under `pull_request_target` and `workflow_run`, neither of which `verify.yml` uses; setup-node 6 limits automatic caching to npm, and the workflow asks for `cache: npm` itself; upload-artifact 6 runs on Node 24 and needs runner 2.327.1, which 5 prepared for, and 7 adds an opt-in the workflow does not use. Its run 44083440906 passed on all three platforms with each new action's step green and the three artifacts uploaded. Merged by squash on the maintainer's word of that day ("you can merge in this app"), a first attempt having been refused to the session by Claude Code's permission check; run 44114175435 at 87450b4, the first on `main` with them, passed on all three platforms. |
| CP-5 | The five security checklist lines the audit did not re-walk, read over b1b2fce to HEAD, D-227's markdown renderer among them; findings fixed or recorded. | CP-1 | DONE 2026-11-17, both findings fixed (S2 in 5fc0c1d, S1 in the commit that marks this row done): the eighteen files changed under `src/`, `scripts/` and the configuration from b1b2fce to 1a43243 read against the five lines. Clean: no credential stored or printed, the review stages untouched, the test workers and the session meter bounded, a document's own HTML shown as text and a `javascript:` link emptied. Two findings. S1: a protocol's markdown image is drawn as an `<img>` to whatever host it names (`src/components/markdown.tsx`, no `img` among its components; rendered and seen: `![x](https://example.com/p.png)` gives `<img src="https://example.com/p.png">`), so opening an imported ruleset could make the browser ask another host. Fixed: the renderer shows an image as "Image, not loaded", its words and its address, by two unit tests that failed first and a browser test that failed on the old renderer (the text absent) and on the new one imports a protocol with an image, opens its rule, and sees no request to another host, with axe clean and the page shot in both themes at desk and phone width. S2, minor: `rulesetRow` in `scripts/lib/doctor.ts` reported any database error as "no rulesets table yet". Fixed in the commit after this row's: only a missing table warns, and any other error fails with the file and SQLite's own words, by a test that failed first and by `npm run doctor` on a data folder whose database was a text file (FAIL, exit 1). |
| CP-5b | The README says the app sends no telemetry; Next.js records anonymous usage from `next dev` and `next build` unless `NEXT_TELEMETRY_DISABLED` is set (third grade of Honest, N2). Turn it off for every way the app starts and builds, on Linux and macOS, proven with `NEXT_TELEMETRY_DEBUG=1` printing no event; then the README and `SECURITY.md` say so without the exception. | - | DONE 2026-11-17 (1a43243, D-233): `next.config.ts` sets the variable as it is read. Proven by a preload that logs every `fetch` to another host, not by `NEXT_TELEMETRY_DEBUG`, which prints events whether telemetry is off or on: 16 attempts to post from `npm run build` and 8 from `npm run dev` before, none from either after, none from `npm run start` before or after. The same runs found Next's advisory lookup to the npm registry, now named in the README; turning it off is CG-6. Those runs had no browser on the page, and so missed a second lookup the fourth grade found; measured again with one, and both named (D-234). |
| CP-6 | Named test gaps: a test for the queued-before-the-ending race (`DECISIONS.md`, review round 16); a browser test that opens a process directive, with axe (the suspected defect in the inbox); the macOS shutdown anomaly read again when it recurs. The Windows CI stall is parked under CP-2's decision. | - | PART 2026-11-17: the directive's test is written and found the defect it suspected. Against the box as it was, a thirty-step directive had 282 px behind a scroll of its own and axe reported `scrollable-region-focusable`; the box now shows the directive whole, the test passes in both themes with axe clean, and the page is shot at desk and phone width (four shots, B each: the directive reads whole; its label still shows the section key as stored, an older fault now in the inbox). `./verify.sh --e2e` exits 0 with 1482 unit tests and 141 browser tests. Still owed: the race's test. The macOS anomaly has not recurred. |
| CP-7 | Fresh evidence for the verdicts, on Linux and the current engine: `npm run demo:fixture` and `npm run demo:design` with real models, scored against their keys, every proof read. The earlier runs' folders are on no machine the maintainer has. | CP-1, CG-1, CG-2 | TODO. CG-1 is taken (D-236): one run of each fixture, no more. CG-2 is open, so the evidence stays under `review/` with its scored result in `DECISIONS.md`. |
| CP-8 | The maintainer's verdicts: G1 on finding quality (`FG2-CHECKLIST.md`), WP-I and WP-J. Recorded in `GATES.md` and the plan rows the same day. | CP-7 | TODO (maintainer) |
| CP-9 | MVP 7.4: the maintainer's own review of a real branch with their protocol, and one stage by hand in Mode B from the printed command (owed by 3.7). The G2 verdict. | CP-8 | TODO (maintainer) |
| CP-10 | The open UX rows, one diff each: WP-G the completion moment; WP-K the queue at phone width; WP-L my branches; the ruleset page at phone width (`PROJECT-STATE.md`, Known issues). | CP-3 | TODO |
| CP-11 | G3's design half: the design notes written again against the screens as they are, every screen in both themes and at phone width, for the maintainer's acceptance. | CP-10 | TODO |
| CP-12 | What CG-5 puts in scope, each planned in its own plan file before it is built. | CG-5, CP-9 | TODO. CG-5 is taken (D-236): rules edited in the app, a project's ruleset read from its repository, a memory guard on a project's commands. Still behind CP-9. |
| CP-13 | Hygiene: merged local branches pruned; the backup branch that holds D-229's old commits removed. | CG-3 | PART 2026-11-17 (D-236): 415 local branches whose tips were already in `origin/main` deleted with `git branch -d`, their names and commits listed first in `review/2026-11-17-branches/` on the maintainer's machine. Five remain: `main`, the session's own, and three not merged (`backup/wp-g1-steps-before-rewrite`, `d180-standin-owner`, `mvp/4.23b-stream-backlog`), which wait for the maintainer to say nothing in them is wanted. |
| CP-14 | The maintainer's handover tooling installed on this machine from their configuration repository, so the session limit is enforced by hooks and not by a session remembering. Outside this repository. | CG-4 | TODO |
| CP-15 | A full regrade by a fresh grader. Done at A on all seven gates, or with each remaining risk accepted by the maintainer in writing. | all above | TODO |

## 3. Decision gates (maintainer)

Each gate lists the options with a recommendation. None is assumed; a gate is
resolved only by an entry in `docs/DECISIONS.md`.

State on 2026-11-17, by D-236 (the maintainer: "follow your best
recommendations while I'm away"): CG-1, CG-3, CG-5 and CG-6 are taken at
the recommendation written below. CG-2 and CG-4 are open: each needs the
maintainer himself.

- **CG-1: spend for CP-7.** One run of each fixture on Opus 5.5 with Fable
  5.1 second. The last such runs cost $2.7884 and $2.4593 cost-equivalent on
  the subscription (D-202, D-200). Go, or judge on the decision log's
  summaries of the lost runs. Recommended: go; a verdict on evidence nobody
  can open is weaker than one run costs.
- **CG-2: where evidence lives.** `review/` is ignored by git and went with
  the last machine. (a) Stay as it is, and accept the loss again. (b) Keep
  each gate's scored result and findings in the maintainer's private
  storage, named in `GATES.md`. Recommended: (b).
- **CG-3: local branches.** 420 local on 2026-11-17, 3 of them unmerged. Delete the merged ones
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
  discussion); a viewer for a failed stage's transcript and the live output
  of a clone, both left over from `M4-FINISH-PLAN.md` U10. Which are in? Recommended: the first three, then the pipeline
  as its own plan; the rest stay out of v1.
- **CG-6: Next's advisory lookup.** On `npm run dev` outside CI, and on
  `npm run build` from a terminal or an AI agent, Next posts its own installed version to the npm
  registry to ask whether an advisory covers it (D-233). (a) Leave it on,
  named in the README: a person is told in the terminal when the installed
  Next has an advisory, and an AI session's build stops once (D-231). (b)
  `experimental.agentUpgrade: false`: that request is not made, and
  advisories are heard of from Dependabot's alerts alone. Recommended: (a);
  the request carries a version number and goes where `npm install`
  already goes. Either way `npm run dev` still reads the latest Next
  version from the registry when a browser connects, which no setting
  turns off (D-234).

## 4. Review cadence

A structured review pass after every 3-4 completed WPs and before anything
goes external. Findings numbered and fixed before new WPs start.
