# Gate ledger

One gate active at a time. A gate passes only with recorded evidence and a
human verdict; a failed gate is a real result. Killing or pivoting at a gate
IS executing the plan. Update this file in the same session anything moves.

| Gate                 | What must be true to pass                                                                                                                          | Status  | Evidence                                                                                                                                                                                                                           | Date       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| G0: Brief and plan   | App brief received; scope, stack, and plan written to `docs/` and ratified by the maintainer; later gates defined.                                        | PASSED  | Brief (`00-BRIEF.md`), feasibility confirmed on the live account, decisions logged (`DECISIONS.md`), specs 01-05 and `plans/BUILD-PLAN.md` written, G1-G3 defined. Ratified by the maintainer 2026-07-30 ("you can get started on this"). | 2026-07-30 |
| G1: Working pipeline | Re-scoped 2026-10-16 (D-86): the pipeline works on Linux, Windows and macOS (`plans/MVP-PLAN.md` exit criteria 1 to 3), and the maintainer gives the verdict on a fresh real-engine run of the 11-defect fixture on Windows (MVP WP 7.3). Originally: M2 of `plans/BUILD-PLAN.md`, fake-engine review end to end, real-engine smoke on the seeded fixture, the maintainer verdict on pipeline and prompts. | ACTIVE | Fake-engine evidence complete and captured in `review/2026-07-31-fg2/`: 8 of 8 planted defects found, no findings in the two files that are deliberately correct, nothing discarded by the quotation check. 566 unit tests and 15 browser tests green under `./verify.sh --build --e2e`. The real-model smoke has deliberately NOT been run: it spends the maintainer's usage and is theirs to start. What to judge and how: `plans/FG2-CHECKLIST.md`. Added 2026-08-04, real-engine smoke run with the maintainer's go on subscription usage, evidence in `review/2026-08-04-fg2/`: haiku failed at S3 on coverage, a correct refusal (D-57); the first fable run failed at S3 on symbol path spelling, a real product bug fixed the same day (06cf1a7, D-58); two fable runs after the fix scored 8/8 with clean files clean, zero quote-check kills, zero open questions ($0.9616 in 293.3s, then $0.9985 in 275.7s with finding texts captured to `findings.json`). Observed for the verdict: S4 re-raises the deleted side of modifications, so 9 distinct findings arrive as 18 candidates (D-59). The verdict on finding quality remains the maintainer's. Added 2026-10-22, MVP 7.3 on the maintainer's Windows 11 machine with their go (D-182, D-183): claude-fable-5[1m] on the 11-defect fixture at b0deb2f, 9/11 by the key with both misses found and cited where the change was made, 11 candidates all verified, no quote-check kills, clean files clean, $5.2976 in 280.0s; evidence in `review/2026-10-22-fg2/151004-claude-fable-5-1m/`. The verdict is the maintainer's. | 2026-07-31 |
| G2: Usable app       | M3: the maintainer drives a real review of their own branch with the imported protocol; verdict on findings quality and confirmation flow.                  | PENDING | -                                                                                                                                                                                                                                  | -          |
| G3: Ship v1          | Re-scoped 2026-10-16 (D-86): the public release, after the MVP. Originally M4: design judgment per 04 section 5; engine quality gate evidence accepted; full e2e green. | PENDING | The design half's evidence is assembled and waiting on a person, the rest is not. Argument: `review/2026-08-18-fg4/DESIGN-NOTES.md`, against `review/2026-08-18-e2e/` (every screen in both themes, axe green in both, the shell measured at 360px). It supersedes the 2026-08-04 set, which described a design that no longer exists. `./verify.sh --e2e` green 2026-08-18: 725 unit tests passing and 6 skipped across 47 files, 41 browser tests. Three UX rows are knowingly open and named in the notes rather than defended as done: WP-G, WP-K, WP-L. The engine-quality half depends on G1's verdict, which has not been given. | - |

Notes:

- G1 was re-scoped on 2026-10-16 (D-86) and is ACTIVE. The evidence below
  stays as the record of the Linux-era runs; the verdict is now given at MVP
  WP 7.3. Before that it was AWAITING VERDICT, not passed. The fake-engine half is done and its
  evidence is recorded; the half that judges whether findings are worth
  reading needs a real model, which costs the maintainer's usage. Nothing in
  this repository will mark this gate passed, and a run of the fake cannot.
  Added 2026-10-23, the proof-and-steps plan's WP-H on the maintainer's
  go: Opus 5.5 with Fable 5.1 the second verifier, all 11 planted defects
  raised, 8 proven by both, 3 open questions, 7/11 by the key, nothing in
  the clean files, $3.1545 in 344.4s; read in D-193, evidence in
  `review/2026-10-23-fg2/173944-claude-opus-5-5/`.

- Evidence under `review/` is gitignored and therefore exists only on the
  machine that produced it, currently the maintainer's. A reader cloning this
  repository will not find `review/2026-07-31-fg2/` and should reproduce it
  instead with `npm run demo:fixture -- --fake`, which is free and quick
  (timing in `docs/RUNBOOK.md`). The directory is ignored deliberately: an unanchored `review`
  pattern once hid the whole review engine from the repository, and the
  anchored replacement is what keeps that from recurring.

- The two external AI plans have not been received. When they arrive they are
  reviewed against the specs and folded in as spec amendments; they do not
  block the build (the maintainer's 2026-07-30 go-ahead).
- Later gates were defined 2026-07-30 with the build plan, not invented
  mid-flow.
