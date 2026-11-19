# 06 Models and review profiles

Status: RATIFIED 2026-07-30 at G0. Supersedes the two-model assumption in
`01-ARCHITECTURE.md` section 7. Facts below were measured on the maintainer's
machine on 2026-07-30 with Claude Code 2.1.71; they are re-probed by the
app, never trusted from this document. Re-verified on 2026-10-22 against
the bundled 2.1.301 by reading its binary and running its commands that take no prompt,
not by probing: the probe table and the probe's cost in section 1 were not
measured again, since a probe spends usage (MVP 7.2).

Every part of this document is built but one. The item this section
listed on 2026-08-03, choosing the profile on the new-review screen,
shipped with U8 on 2026-08-04 as the Profile control in its advanced fold.
Not built: any helper that would give a `mechanical-only` model the
non-judgment work its row in section 3 allows it. Such a model is refused
for a review, and no other code asks for one.

## 1. Measured facts (evidence, 2026-07-30)

`claude auth status` returns JSON of the shape
`{"loggedIn":bool,"authMethod":string,"apiProvider":string,"subscriptionType":string}`.
Signed out, 2.1.301 prints `{"loggedIn":false,"authMethod":"none",...}` and
exits 1 (measured 2026-10-20 with an empty config directory), so the status
is read from stdout before the exit code. The app reads this when
someone opens Settings, which says above Models that a sign-in billing per
token makes a probe cost API usage, or presses Check the CLI there, or
saves a CLI path there; opens
the new-review screen, which says the same of a review before Start
(D-161); opens a review that can be started, whose page reads how it
bills before Start; asks to verify a finding again, as the dialog opens
and again on the server before the request is sent; or creates or starts
a review that runs headless,
which is refused with the reason when the CLI is not found, cannot run or
is signed out (MVP 6.2), and, when it bills per token or may, until the
page has said so: each page sends what it showed with Create and Start,
and one refused shows the notice for the next (review of D-161). `npm run
doctor` reads it too, once, and is the `predev` of `npm run dev`; `npm run
claude:auth` reads it to decide whether to sign in, and again after; and
the demos read it before a run with `--real` or `--model`. The
server itself never reads it at startup or on a timer.
Neither check is given a prompt, so they run as those screens open; D-31
keeps every call that spends to an explicit action. That they cost nothing
rests on that, not on a bill read, and it is not offline: measured on
2026-11-19 on 2.1.301, signed in on a subscription, `auth status` asked a
proxy for `api.anthropic.com:443` three times, each refused, and still
printed the status and exited 0, while `--version` asked for nothing
(D-244). What it asks there was not seen. The check asks `auth status` with
`--setting-sources ""`, as every review and probe runs, an interactive
review's printed commands included (D-174), so an apiKeyHelper or provider
it names is one a review uses (D-170), set by a managed policy (below).
Those commands run in the person's own terminal, though, with its whole
environment, which the check does not see: a key, a provider or any other
Claude Code variable set there applies to them, and each screen that
prints them says so whatever the check found (D-176). The check names the CLI's path and version and tells apart a CLI
not found, one that cannot run (with the real error: too old, not
executable, an answer that is not its status, no answer in time), signed
out, signed in some way that bills per token (a key, an `apiKeyHelper` or
another provider: a warning; reviews still run, D-92), signed in some way
that may (an `oauth_token`, which 2.1.301 reports both for a token
`claude setup-token` made and for a Console profile, an unknown method, or
none said: a warning that says "may"), and a subscription.
An API key, a paid provider's selector or key, another API's address,
another model, another thinking budget: none reaches a CLI the app starts,
so reviews draw on the subscription sign-in by default; what is left to
bill per token is how the CLI itself is signed in, and the app warns of it
(D-161, D-174). The app never reads, copies, or logs the credentials
themselves.

**A spawned `claude` process must not inherit the parent shell's Claude Code
session variables.** A review is an independent program that may have been
launched from a terminal which is itself a Claude Code session, and must not
run as that session's child: the CLI reads `CLAUDECODE` and
`CLAUDE_CODE_CHILD_SESSION` as meaning it is one and looks for credentials
elsewhere. What the app configures wins over the machine's own Claude
configuration (D-174), so the environment a CLI the app starts gets is
closed: only what it needs to run (system paths, home and app-data
directories, temp, locale, proxy and certificate settings, where Windows
finds Git Bash) and the sign-in (`CLAUDE_CONFIG_DIR`,
`CLAUDE_CODE_OAUTH_TOKEN`), whatever their case, exactly as it sets an
explicit working directory rather than inheriting one. It was a list of what
to keep out, a session's markers (D-120), the settings that outrank the
`--effort` every stage passes (D-121, D-124), the keys and paid providers
(D-161), which let every variable it did not name through. No settings file
is read at all, a person's included, for the same reason (D-124). Older
CLIs refused to start at all under `CLAUDECODE`; 2.1.301 does not.

**A managed policy is the one tier no flag keeps out.** The bundled 2.1.301
binary adds it to whatever `--setting-sources` allows, as 2.1.306 does, so every review runs under
one, and with no settings read and the provider variables kept from the
CLI, it is the only place an `apiKeyHelper` or another provider a check
names can come from. The app looks for one, read-only, where that binary
does: a `managed-settings.json` and the `.json` files of a
`managed-settings.d` beside it, in `C:\Program Files\ClaudeCode`,
`/Library/Application Support/ClaudeCode` or `/etc/claude-code`, and on
Windows the `Settings` value under `HKLM` and `HKCU`
`\SOFTWARE\Policies\ClaudeCode`, asked of `reg.exe` as the CLI asks it. One
found is said on Settings and before a review starts; Settings also names
any place it could not look. Not looked for: a macOS MDM profile, whose
reader the Windows binary does not carry, and a policy an organisation's
account delivers (D-174, D-175).

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

The table is 2.1.71's. The bundled 2.1.301's own model catalog names
`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5` and
`claude-haiku-5-5` as each family's latest, read from its binary on
2026-10-22. The first three were probed on 2026-10-23 and each answered
with a 1,000,000-token window, with or without the `[1m]` suffix, which
Fable 5.1 drops; they are candidates now (D-184). What an alias resolves
to on 2.1.301 is unmeasured (D-177).

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
system prompt (a stage's by `--system-prompt-file`) and a minimal `--tools`
list, never inheriting defaults.

## 2. Model registry

The app ships a candidate list (the ids in section 1 plus any the maintainer adds)
and probes it only when someone presses a probe control, never on first run
and never on a timer (D-31: a probe is a real call that spends usage). Each
result stores resolved id, context window, availability, error text, and
probe timestamp. The picker lets only what probed available be chosen, and
shows it grouped by family, with the context window and the profile it will
use; the rest are a press away, each with a probe control. Unavailable
candidates render disabled with the error, and on Settings with the probe
age too. A probe older than
24 hours renders as unknown rather than assumed-good.

Recommended-for-review flags (the maintainer 2026-07-30: Opus and Fable are the
reliable ones; 2026-10-22: Opus 5.5 recommended, D-184) mark `claude-opus-5-5`,
first and so the default, and `claude-fable-5-1`; everything else available is
selectable but carries its profile's warning. Haiku is no longer offered: it
was mechanical-only and could never run a review, and its row is removed at
start. A candidate's description is taken again at every start, its probe
result kept.

### Effort

The CLI accepts low, medium, high, xhigh and max (2.1.301). This app offers
the first four and refuses max (2026-08-04). xhigh is offered only on a model
that runs it: on a fixed list of older models (claude-3, Opus and Sonnet 4.0
to 4.6, Haiku 4.5) the CLI sends it as high or as no effort, without saying
so, and a review there would record an effort it never had (D-122, corrected
by D-123). max is refused on cost: the CLI's own index prices it at up to
5.59 times high per call, and a review already fans out across up to eight
stages that call a model (every stage but the audit) and as many batches as the profile calls for, unattended. It was first refused as
the tier that spawns workflows; in 2.1.301 that is ultracode, a separate
setting no review reads (D-124, D-125). It stays in the enum so reviews
created before the rule still parse; it is simply never selectable and is
refused at the API for every model.

### The second verifier

Every finding the first verifier proves is proven again on the other strong
family (PG-1 (a), D-185): an Opus review by claude-fable-5-1, any other by
claude-opus-5-5 (`lib/models/pairing.ts`), frozen on the review when it
first runs. A review, headless or Mode B, is refused at create and at Start,
and a verify-again before its first paid call, 409 SecondVerifierUnavailable,
while that model has no probe vouching for it now; the new-review screen
keeps Start off with a Probe button for it beside the reason (WP-E1, review
round 3). Both paired models probed at
1M on 2026-10-23 (D-188).

## 3. Review profiles (the model-dependent pipeline)

The maintainer's constraint, 2026-07-30: "Fable I can give this full document and
will get great results, but I can't say the same about sonnet." The
pipeline therefore adapts its delivery strategy to model capability.

**The invariant that never adapts: completeness.** Every pairing of an
enabled rule and a changed file is either checked or recorded as
deliberately excluded (DECISIONS, 2026-07-30, WP-D, correcting this
section's first wording, "every rule against every hunk"); every hunk and
sweep hit is dispositioned, every deletion reviewed, and every finding
verified, on every profile. Only `decomposed` excludes: a rule is not sent
for a file whose path suggests none of the rule's themes, and the plan
names each such pair with its reason. What the review keeps of them is
their count, in the pre-flight and in a note on the run, and in that note
the first twenty by name. `full-context` and `chunked` change only _how
the work is divided into requests_. Summarising a rule to fit a weaker
model is forbidden; the app splits the work instead. The planned requests
are checked by app code before one is sent
(`assertBatchesCoverEverything`, 03), so no pair is left out of the plan
unnamed.

Each model carries a `profileId`. Profiles are declarative config:

| Profile           | Intended models                                                           | Rule delivery                                                                                                                                                                                                              | Batching                                                                                                      | Verification                      |
| ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `full-context`    | claude-opus-5-5, claude-fable-5-1, claude-fable-5[1m], claude-opus-5[1m]  | Entire ruleset verbatim in one prompt                                                                                                                                                                                      | Whole change set in one comprehension and one adversarial pass; split only if the estimate exceeds the window | All findings in one fresh session, then the proven ones in another (S5b) |
| `chunked`         | claude-sonnet-5-5, claude-fable-5, claude-opus-5, claude-sonnet-5[1m]     | Full ruleset verbatim, but the adversarial pass runs once per rule theme (typescript, react, async, database, security, numeric, testing, organisation, general) with that theme's rules in the prompt                   | File groups sized to the window                                                                               | As full-context                   |
| `decomposed`      | claude-sonnet-5, other mid-tier                                           | Theme chunks as above, further narrowed: only the themes a file's path suggests reach that file's prompt, and the plan names each (rule, file) pair left out, with its reason; the run keeps their count and the first twenty | Per file                                                                                                      | As full-context                   |
| `mechanical-only` | anything untrusted for judgment; Haiku is retired (D-184)                 | Not offered for judgment stages                                                                                                                                                                                            | Meant for non-judgment helpers (e.g. summarising a sweep hit list); none is built                                      | Never                             |

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
protocol import (WP-D) tags every rule from the heading it sits under and
its title (react, typescript, database, async, security, testing, numeric,
organisation). A rule with none of those is `general` and is therefore
sent to every file, which is safe but expensive. Tag quality is reviewed at FG-2.
