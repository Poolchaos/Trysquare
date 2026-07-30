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

## Standards

| Doc                                      | What it is                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| [AI-ANTIPATTERNS.md](AI-ANTIPATTERNS.md) | Catalog of AI tells. Binding on all surfaces: code, docs, copy, commits. |

## Plans

| Doc                                              | What it is                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [plans/APP-PLAN.md](plans/APP-PLAN.md)           | The app plan: feasibility verdict, architecture proposal, resolved questions. DRAFT.         |
| [plans/BUILD-PLAN.md](plans/BUILD-PLAN.md)       | Work packages WP-A..L for the Opus driver, milestones, founder gates, standing rails. DRAFT. |
| [plans/PLAN-TEMPLATE.md](plans/PLAN-TEMPLATE.md) | Template for multi-step plan docs (work packages, decision gates, done tracking).            |
| [plans/idea-inbox.md](plans/idea-inbox.md)       | One-line dated idea capture. Ideas are not expanded until the active gate passes.            |

## Specs

| Doc                                                    | What it is                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [00-BRIEF.md](00-BRIEF.md)                             | The app brief: local PR reviewer.                                                                                         |
| [01-ARCHITECTURE.md](01-ARCHITECTURE.md)               | System architecture: topology, layout, data dir, engine adapter, models, errors. DRAFT.                                   |
| [02-DATA-MODEL.md](02-DATA-MODEL.md)                   | SQLite schema, state machines, invariants, deletion rules. DRAFT.                                                         |
| [03-REVIEW-PIPELINE.md](03-REVIEW-PIPELINE.md)         | The engine spec: protocol steps mapped to deterministic code and bounded AI stages. DRAFT.                                |
| [04-UI-DESIGN.md](04-UI-DESIGN.md)                     | Design language, screens, states, accessibility, design proof gate. DRAFT.                                                |
| [05-TESTING.md](05-TESTING.md)                         | verify.sh spec, unit/e2e strategy, seeded-bug fixture gate. DRAFT.                                                        |
| [06-MODELS-AND-PROFILES.md](06-MODELS-AND-PROFILES.md) | Measured model availability, the probe mechanism, and model-dependent review profiles. DRAFT.                             |
| `docs/private/REVIEW_PROTOCOL.md` | The maintainer private reference protocol used to seed rulesets. Proprietary, gitignored, NOT part of the public repo. |

Where a spec and any other doc disagree, the spec wins; where a spec and
reality disagree, reality wins and both get fixed in the same session.

## Changelog

- 2026-07-30: Index created with workspace setup. No app brief yet.
- 2026-07-30: App brief captured as `00-BRIEF.md`; feasibility research on
  subscription-based review runs in progress.
- 2026-07-30: Feasibility confirmed; decisions logged; spec set 01-05 and
  `plans/BUILD-PLAN.md` drafted; gates G1-G3 defined. All DRAFT pending G0.
