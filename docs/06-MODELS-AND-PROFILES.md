# 06 Models and review profiles

Status: RATIFIED 2026-07-30 at G0. Supersedes the two-model assumption in
`01-ARCHITECTURE.md` section 7. Facts below were measured on the maintainer's
machine on 2026-07-30 with Claude Code 2.1.71; they are re-probed by the
app, never trusted from this document.

## Not built yet

This document specifies the target. Verified against the code on 2026-08-03,
these parts of it do not exist yet. They stay here as requirements rather
than being edited away; the item in `plans/M4-FINISH-PLAN.md` that owns each
is named.

- Choosing the profile from the new-review screen. The server resolves it
  from the model and refuses an upgrade (U4, 2026-08-03), and the pre-flight
  returns the resolved profile with the request count each profile would
  cost, but no control renders them yet. U8.

## 1. Measured facts (evidence, 2026-07-30)

`claude auth status` returns JSON of the shape
`{"loggedIn":bool,"authMethod":string,"apiProvider":string,"subscriptionType":string}`.
The app reads this only when someone presses Check sign-in on Settings, and
never at startup: reading it is a real CLI call, and D-31 keeps every such
call behind an explicit action. When the auth method is not a subscription login, the UI warns
that runs may bill per token. The app never reads, copies, or logs the
credentials themselves.

**A spawned `claude` process must not inherit the parent shell's Claude Code
session variables.** The CLI detects an existing session through the
environment and declines to start a nested one, which is correct behaviour
for an interactive session but wrong for this app: the review process is an
independent program that happens to have been launched from a terminal which
may itself be a Claude Code session. The engine therefore builds a clean
child environment, removing `CLAUDECODE` and other `CLAUDE_CODE_*` session
markers, exactly as it sets an explicit working directory rather than
inheriting one. Without this the app fails for any user who starts it from a
Claude Code terminal.

Model discovery is done by probing, and the results below are an example of
what one account returned on one day. They are recorded to show the shape of
the data and the two consequences under it, not as a registry to rely on:
the app re-probes and never trusts this table.

| Requested                   | Result | Resolved              | Context   |
| --------------------------- | ------ | --------------------- | --------- |
| `claude-fable-5[1m]`        | OK     | claude-fable-5[1m]    | 1,000,000 |
| `claude-opus-5[1m]`         | OK     | claude-opus-5[1m]     | 1,000,000 |
| `claude-sonnet-5[1m]`       | OK     | claude-sonnet-5[1m]   | 1,000,000 |
| `claude-fable-5`            | OK     | claude-fable-5        | 200,000   |
| `claude-opus-5`             | OK     | claude-opus-5         | 200,000   |
| `claude-sonnet-5`           | OK     | claude-sonnet-5       | 200,000   |
| `claude-haiku-4-5-20251001` | OK     | same                  | 200,000   |
| `opus` (alias)              | OK     | **claude-opus-4-6**   | 200,000   |
| `sonnet` (alias)            | OK     | **claude-sonnet-4-6** | 200,000   |
| `haiku` (alias)             | OK     | claude-haiku-4-5      | 200,000   |

Availability differs by account and changes over time. An id that is not
available simply probes as unavailable and is shown disabled with its error.

**Two consequences the app must honour:**

1. **Never use short aliases.** Aliases such as `opus` and `sonnet` resolve
   to whatever the CLI considers current for that family, which was a
   previous generation at the time of measurement, and not every family has
   an alias at all. The app stores and passes full model ids only. An alias
   in a prompt or config is a defect.
2. **The `[1m]` suffix is how the 1M context window is requested**, and it
   is available for the Claude 5 family on this account. Context window is
   read from the probe response, never assumed.

**Probe cost.** A probe with `--system-prompt <tiny> --tools ""` costs about
$0.0007 cost-equivalent (121 input, 4 output tokens) versus $0.0748 for a
naive `claude -p` probe that loads the full default system prompt and tool
definitions. Probing the whole registry is therefore free in practice. The
same lesson applies to review stages: the app always passes an explicit
`--system-prompt` and a minimal `--tools` list, never inheriting defaults.

## 2. Model registry

The app ships a candidate list (the ids in section 1 plus any the maintainer adds)
and probes it only when someone presses a probe control, never on first run
and never on a timer (D-31: a probe is a real call that spends usage). Each
result stores resolved id, context window, availability, error text, and
probe timestamp. The picker shows only what probed available, grouped by
family, with the context window and the profile it will use. Unavailable
candidates render disabled with the error and probe age. A probe older than
24 hours renders as unknown rather than assumed-good.

Recommended-for-review flags (the maintainer 2026-07-30: Opus and Fable are the
reliable ones) mark `claude-fable-5[1m]` and `claude-opus-5[1m]` as the
defaults; everything else available is selectable but carries its profile's
warning.

## 3. Review profiles (the model-dependent pipeline)

The maintainer's constraint, 2026-07-30: "Fable I can give this full document and
will get great results, but I can't say the same about sonnet." The
pipeline therefore adapts its delivery strategy to model capability.

**The invariant that never adapts: completeness.** Every enabled rule is
walked against every hunk, every sweep hit is dispositioned, every deletion
reviewed, and every finding verified, on every profile. A profile changes
_how the work is divided into requests_, never _how much of the protocol is
applied_. Dropping or summarising rules to fit a weaker model is forbidden;
the app splits the work instead. Coverage is enforced by app code (03), so a
weaker model cannot quietly skip a rule.

Each model carries a `profileId`. Profiles are declarative config:

| Profile           | Intended models                                                           | Rule delivery                                                                                                                                                                                                              | Batching                                                                                                      | Verification                      |
| ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `full-context`    | claude-fable-5[1m], claude-opus-5[1m]                                     | Entire ruleset verbatim in one prompt                                                                                                                                                                                      | Whole change set in one comprehension and one adversarial pass; split only if the estimate exceeds the window | All findings in one fresh session |
| `chunked`         | claude-fable-5, claude-opus-5, claude-sonnet-5[1m] (200k, or large diffs) | Full ruleset verbatim, but the adversarial pass runs once per rule theme (typing, data flow, React/state, async/errors, security, DB/queries, organisation, tests) with that theme's rules in the prompt                   | File groups sized to the window                                                                               | Findings verified in batches      |
| `decomposed`      | claude-sonnet-5, claude-opus-4-6, other mid-tier                          | Theme chunks as above, further narrowed: only rules whose tags match the file's detected tech reach that file's prompt, and the app tracks which (rule, hunk) pairs each request covered so the union is provably complete | Per file, or per hunk for high-risk files                                                                     | Per finding, one request each     |
| `mechanical-only` | haiku and anything untrusted for judgment                                 | Not offered for judgment stages                                                                                                                                                                                            | Usable only for non-judgment helpers (e.g. summarising a sweep hit list)                                      | Never                             |

Profile selection is automatic from the model, shown in the pre-flight, and
overridable per review (a deliberate downgrade is allowed and recorded on
the review; an upgrade beyond the model's tier is not).

**Cost of the trade.** `decomposed` makes many more requests for the same
change set: more wall-clock, more tokens, and more opportunities for a weak
model to produce a finding that dies in verification. The pre-flight states
the estimated request count per profile so the choice is informed, and the
report footer records which profile ran. The engine quality gate (05) runs
per profile, so "sonnet on decomposed finds the seeded bugs" is a measured
claim or it is not made.

## 4. Open item

Rule-to-tech tagging quality decides how well `decomposed` narrows. The
protocol import (WP-D) must tag every rule with the tech it applies to
(react, firestore, typescript, node, tests, general). Untagged rules default
to `general` and are therefore sent to every file, which is safe but
expensive. Tag quality is reviewed at FG-2.
