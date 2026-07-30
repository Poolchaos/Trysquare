# Gate ledger

One gate active at a time. A gate passes only with recorded evidence and a
human verdict; a failed gate is a real result. Killing or pivoting at a gate
IS executing the plan. Update this file in the same session anything moves.

| Gate                 | What must be true to pass                                                                                                                          | Status  | Evidence                                                                                                                                                                                                                           | Date       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| G0: Brief and plan   | App brief received; scope, stack, and plan written to `docs/` and ratified by the maintainer; later gates defined.                                        | PASSED  | Brief (`00-BRIEF.md`), feasibility confirmed on the live account, decisions logged (`DECISIONS.md`), specs 01-05 and `plans/BUILD-PLAN.md` written, G1-G3 defined. Ratified by the maintainer 2026-07-30 ("you can get started on this"). | 2026-07-30 |
| G1: Working pipeline | M2 of `plans/BUILD-PLAN.md`: fake-engine review runs end to end; real-engine smoke on the seeded fixture; the maintainer verdict on pipeline and prompts. | ACTIVE  | Build started 2026-07-30 at WP-A.                                                                                                                                                                                                  | 2026-07-30 |
| G2: Usable app       | M3: the maintainer drives a real review of their own branch with the imported protocol; verdict on findings quality and confirmation flow.                  | PENDING | -                                                                                                                                                                                                                                  | -          |
| G3: Ship v1          | M4: design judgment per 04 section 5; engine quality gate evidence accepted; full e2e green.                                                       | PENDING | -                                                                                                                                                                                                                                  | -          |

Notes:

- The two external AI plans have not been received. When they arrive they are
  reviewed against the specs and folded in as spec amendments; they do not
  block the build (the maintainer's 2026-07-30 go-ahead).
- Later gates were defined 2026-07-30 with the build plan, not invented
  mid-flow.
