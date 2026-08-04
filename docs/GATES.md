# Gate ledger

One gate active at a time. A gate passes only with recorded evidence and a
human verdict; a failed gate is a real result. Killing or pivoting at a gate
IS executing the plan. Update this file in the same session anything moves.

| Gate                 | What must be true to pass                                                                                                                          | Status  | Evidence                                                                                                                                                                                                                           | Date       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| G0: Brief and plan   | App brief received; scope, stack, and plan written to `docs/` and ratified by the maintainer; later gates defined.                                        | PASSED  | Brief (`00-BRIEF.md`), feasibility confirmed on the live account, decisions logged (`DECISIONS.md`), specs 01-05 and `plans/BUILD-PLAN.md` written, G1-G3 defined. Ratified by the maintainer 2026-07-30 ("you can get started on this"). | 2026-07-30 |
| G1: Working pipeline | M2 of `plans/BUILD-PLAN.md`: fake-engine review runs end to end; real-engine smoke on the seeded fixture; the maintainer verdict on pipeline and prompts. | AWAITING VERDICT | Fake-engine evidence complete and captured in `review/2026-07-31-fg2/`: 8 of 8 planted defects found, no findings in the two files that are deliberately correct, nothing discarded by the quotation check. 566 unit tests and 15 browser tests green under `./verify.sh --build --e2e`. The real-model smoke has deliberately NOT been run: it spends the maintainer's usage and is theirs to start. What to judge and how: `plans/FG2-CHECKLIST.md`. Added 2026-08-04, real-engine smoke run with the maintainer's go on subscription usage, evidence in `review/2026-08-04-fg2/`: haiku failed at S3 on coverage, a correct refusal (D-57); the first fable run failed at S3 on symbol path spelling, a real product bug fixed the same day (06cf1a7, D-58); two fable runs after the fix scored 8/8 with clean files clean, zero quote-check kills, zero open questions ($0.9616 in 293.3s, then $0.9985 in 275.7s with finding texts captured to `findings.json`). Observed for the verdict: S4 re-raises the deleted side of modifications, so 9 distinct findings arrive as 18 candidates (D-59). The verdict on finding quality remains the maintainer's. | 2026-07-31 |
| G2: Usable app       | M3: the maintainer drives a real review of their own branch with the imported protocol; verdict on findings quality and confirmation flow.                  | PENDING | -                                                                                                                                                                                                                                  | -          |
| G3: Ship v1          | M4: design judgment per 04 section 5; engine quality gate evidence accepted; full e2e green.                                                       | PENDING | -                                                                                                                                                                                                                                  | -          |

Notes:

- G1 is AWAITING VERDICT, not passed. The fake-engine half is done and its
  evidence is recorded; the half that judges whether findings are worth
  reading needs a real model, which costs the maintainer's usage. Nothing in
  this repository will mark this gate passed, and a run of the fake cannot.

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
