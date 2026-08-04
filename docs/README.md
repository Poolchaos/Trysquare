# Doc index

The map of every project document, so nothing gets lost or duplicated. Rules:
before writing a new doc, check this index for an existing home; when adding,
moving, or retiring a doc, update this index in the same change. Repo-level
operating rules live in `CLAUDE.md` (repo root).

Read order for a fresh session: `CLAUDE.md` (root), then `PROJECT-STATE.md`,
then `GATES.md`, then only what the active gate needs.

## Ledgers and state

| Doc                                  | What it is                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [PROJECT-STATE.md](PROJECT-STATE.md) | The cache. Current facts: stack, structure, commands, what is built. Start every planning task here. |
| [DECISIONS.md](DECISIONS.md)         | Decision log. Dated, append-only. Settled items are not relitigated without a new entry.             |
| [GATES.md](GATES.md)                 | Gate ledger. One row per gate: status, evidence, date. One gate active at a time.                    |

## Operating

| Doc                        | What it is                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------- |
| [RUNBOOK.md](RUNBOOK.md)   | Install, start, and run a first review. Says which actions spend model usage. |

## Standards

| Doc                                      | What it is                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| [AI-ANTIPATTERNS.md](AI-ANTIPATTERNS.md) | Catalog of AI tells. Binding on all surfaces: code, docs, copy, commits. |

## Plans

| Doc                                              | What it is                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [plans/APP-PLAN.md](plans/APP-PLAN.md)           | The app plan: feasibility verdict, architecture proposal, resolved questions. DRAFT.         |
| [plans/BUILD-PLAN.md](plans/BUILD-PLAN.md)       | Work packages WP-A..L, milestones, founder gates, standing rails. |
| [plans/EXECUTION-ORDER.md](plans/EXECUTION-ORDER.md) | STANDING EXECUTION ORDER: remaining work T1-T19, dependencies, founder gates, pre-resolved decisions D-1..D-20. |
| [plans/M2-FINISH-PLAN.md](plans/M2-FINISH-PLAN.md) | Implementation plan for T8, T9 and the FG-2 demo: commit map W1-W8, the resume design, decisions D-21..D-26. |
| [plans/FG2-CHECKLIST.md](plans/FG2-CHECKLIST.md) | What the maintainer judges at founder gate FG-2, where the evidence lives, and what each verdict means. |
| [plans/M3-FINISH-PLAN.md](plans/M3-FINISH-PLAN.md) | Implementation plan for the usable app (T10-T17 remainder plus W8 leftovers): commit map V1-V9, spend-safety and confirmation-loop design, decisions D-30..D-44. |
| [plans/M4-FINISH-PLAN.md](plans/M4-FINISH-PLAN.md) | The v1 close-out plan from the 2026-08-03 full audit: verified gap inventory, commit map U1-U13, decisions D-45..D-56. |
| [plans/U12-FIXTURE-GAPS.md](plans/U12-FIXTURE-GAPS.md) | The four seeded-fixture defects still owed, planned against the live tree and adversarially verified. The driver's working order for the rest of U12. |
| [plans/PLAN-TEMPLATE.md](plans/PLAN-TEMPLATE.md) | Template for multi-step plan docs (work packages, decision gates, done tracking).            |
| [plans/idea-inbox.md](plans/idea-inbox.md)       | One-line dated idea capture. Ideas are not expanded until the active gate passes.            |

## Specs

| Doc                                                    | What it is                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [00-BRIEF.md](00-BRIEF.md)                             | The app brief: local PR reviewer.                                                                                         |
| [01-ARCHITECTURE.md](01-ARCHITECTURE.md)               | System architecture: topology, layout, data dir, engine adapter, models, errors. RATIFIED 2026-07-30.                                   |
| [02-DATA-MODEL.md](02-DATA-MODEL.md)                   | SQLite schema, state machines, invariants, deletion rules. RATIFIED 2026-07-30.                                                         |
| [03-REVIEW-PIPELINE.md](03-REVIEW-PIPELINE.md)         | The engine spec: protocol steps mapped to deterministic code and bounded AI stages. RATIFIED 2026-07-30.                                |
| [04-UI-DESIGN.md](04-UI-DESIGN.md)                     | Design language, screens, states, accessibility, design proof gate. RATIFIED 2026-07-30.                                                |
| [05-TESTING.md](05-TESTING.md)                         | verify.sh spec, unit/e2e strategy, seeded-bug fixture gate. RATIFIED 2026-07-30.                                                        |
| [06-MODELS-AND-PROFILES.md](06-MODELS-AND-PROFILES.md) | Measured model availability, the probe mechanism, and model-dependent review profiles. RATIFIED 2026-07-30.                             |
| `docs/private/REVIEW_PROTOCOL.md` | The maintainer private reference protocol used to seed rulesets. Proprietary, gitignored, NOT part of the public repo. |

Where a spec and any other doc disagree, the spec wins; where a spec and
reality disagree, reality wins and both get fixed in the same session.

## Changelog

- 2026-07-30: Index created with workspace setup. No app brief yet.
- 2026-07-30: App brief captured as `00-BRIEF.md`; feasibility research on
  subscription-based review runs in progress.
- 2026-07-30: Feasibility confirmed; decisions logged; spec set 01-05 and
  `plans/BUILD-PLAN.md` drafted; gates G1-G3 defined. All DRAFT pending G0.
- 2026-07-30: `plans/EXECUTION-ORDER.md` added: the standing order for all
  remaining work with pre-resolved decisions, so the driver does not ask
  between founder gates.
- 2026-07-30: `plans/M2-FINISH-PLAN.md` added (commit b7ad7c2): T8, T9 and the
  FG-2 demo planned to commit level.
- 2026-07-31: `plans/M3-FINISH-PLAN.md` added (commit 060f969): the rest of
  the usable app planned to commit level.
- 2026-07-31: `plans/FG2-CHECKLIST.md` added (commit 27d92d7): what the
  maintainer judges at FG-2 and where the evidence lives.
- 2026-08-03: `plans/M4-FINISH-PLAN.md` and `RUNBOOK.md` added: the full-audit
  gap inventory with the v1 close-out order, and the operator runbook FG-3
  needs. The three entries above were backfilled in the same pass, having been
  added without changelog lines at the time.
- 2026-08-03: specs 00 to 06 relabelled from DRAFT to RATIFIED. They record
  ratification at G0 on 2026-07-30 (`GATES.md`); only the headers were stale.
- 2026-08-04: `plans/U12-FIXTURE-GAPS.md` added: the remaining seeded-fixture
  work, split out of M4-FINISH-PLAN once it was planned in detail.
