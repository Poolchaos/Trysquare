# Proof and steps plan

Status: IN BUILD since 2026-10-23 (D-186: built now, G1 judged on WP-H's
run). Written 2026-10-22 and decided by the maintainer the same day (D-184).

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done, commit
only when asked.

Definition of done for every work package:

- One WP per branch/diff; no batching.
- `./verify.sh --e2e` exits 0, run unpiped, and every test a WP adds was
  first shown failing on the code before it.
- The real flow is driven at runtime, not just typechecked.
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.
- Open decisions are asked, or the WP is scoped so the decision is not
  needed yet. Do not guess.

Work top to bottom through unblocked items without asking; skip blocked
items until their input lands, never wait on them. Anything that calls a
model spends the maintainer's usage and needs their go, given per WP below.

## 1. Goal and non-goals

The maintainer, 2026-10-22: "I want to ensure the AI is 100% confident in
findings and should be proven a real issue", with Opus 5.5 recommended, the
other models offered with a plain word about accuracy, no Haiku, and the
review shown as a step-by-step visualisation.

No software makes a model 100% right. What this plan makes true is that a
finding reaches the report only with proof the app itself checked: a code
path from trigger to failure, every step of it quoted and matched against
the checkout, judged by two independent verifiers on different models, and
then confirmed by a person. A finding that cannot carry that is never
reported as proven.

Goals:

1. The 5.5 family offered, Opus 5.5 the recommended default, every model's
   way of dividing the work and its accuracy risk said in the picker.
2. Proof a finding must carry, checked by the app, before it can be
   confirmed into the report.
3. A second, independent verifier on a different strong model.
4. The run shown as five steps a person reads, with live counts.
5. The design of what a branch builds checked too (the maintainer,
   2026-10-23, D-191): the project's own tests and e2e run on a throwaway
   copy of the branch, each screenshot graded A to D, and a failing test
   or a C or D a finding like any other, proven and confirmed.

Non-goals: new splitting modes (the profiles stay as they are, D-184
item 3); an AI stage executing anything (the read-only law in `CLAUDE.md`
section 8 stands: in WP-I the app runs the project's own commands, and a
model only reads what they produced); a model the app has not probed.

## 2. What exists (read 2026-10-22, the evidence for each claim)

- Profiles already divide the work by window: full-context sends the whole
  ruleset in one pass (Fable and Opus at [1m]); chunked sends one pass per
  rule theme over all files (200k Fable and Opus, Sonnet [1m]); decomposed
  sends each file only the themes that match it (Sonnet 200k). S5 verifies
  every candidate on every profile. `src/lib/rulesets/compose.ts:208-263`,
  `docs/06-MODELS-AND-PROFILES.md` section 3.
- Shipped candidates are code (`src/server/engine/probe.ts:349-408`); none
  of the 5.5 family; Haiku is registered mechanical-only and refused for a
  review (`src/lib/review/profiles.ts:59-85`), but is the fixture demo's
  default (`scripts/demo-fixture.ts:51`).
- A review stage cannot spawn subagents: Read, Grep and Glob only, checked
  after every call (`src/server/engine/headless.ts:391-403`).
- S5 gets the finding's path, lines, severity, issue and mechanism, not its
  rule, its comment or a quote (`src/server/review/pipeline.ts:638-650`); it
  answers a verdict, a quote, lines and a note, with no field for severity,
  rule or evidence (`src/lib/review/stage-schemas.ts:110-129`). The quote
  check proves the cited code exists at those lines, not the mechanism
  (`src/lib/review/quote-match.ts:91-116`). The finder and the verifier are
  one model. An open question can be confirmed into the report with no
  quote check (`src/lib/domain/state-machines.ts:121`).
- 03 says S5 receives a "quoted claim" and must "confirm mechanism" and
  "confirm severity" (`docs/03-REVIEW-PIPELINE.md:155-166`); the code does
  neither. A stale record, fixed in WP-C.
- The run view (`src/app/reviews/[id]/page.tsx:1730-1982`) shows seven
  technical stage names on an unlabelled bar; only stage `started` events
  are ever sent (`src/server/jobs/manager.ts:391-400`), and the page re-reads
  its snapshot only on status changes (`page.tsx:586`), so by reading it
  likely shows "Risk" through S2 to S4 (unverified). No live finding
  counts; refuted and quote-check kills are listed as one.

## 3. Work packages

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| WP-A | Run view stuck on one stage: show it, with a test, then send `finished` and `failed` stage events and update the step live. | G1 verdict | DONE 2026-10-23. The run view re-reads the review on each stage start, which the server announces after writing it, so the step is live; shown held in S3 (59c5a0b, CI run 39897805741). `finished` and `failed` are not sent: the next stage's start or the review's status change already moves the step, and WP-G's live counts are where they would be needed. |
| WP-B | Models: probe `claude-opus-5-5`, `claude-fable-5-1`, `claude-sonnet-5-5` and each at `[1m]`; add those that probe usable, each on the profile its window and family give; Opus 5.5 at `[1m]` (or 200k if that is all there is) the recommended default; remove Haiku from the candidates; the demo's default becomes Opus 5.5. | G1 verdict; maintainer go on the probes (given, D-184) | DONE 2026-10-23 (2578fa3, CI run 39907610072, D-187). The review round's R1 found the retired id still startable through the API (f10ee0c, CI run 39916928715). |
| WP-C | Proof the verifier must give, checked by the app: S5 receives each candidate's rule text, rule code, severity, the finder's quote and comment; a verified verdict must carry `ruleApplies`, its own `severity`, `trigger`, and `evidence`, an ordered path of `{path, lineStart, lineEnd, quote}` from trigger to failure, plus `guardsSearched`; the app quote-checks every evidence step and kills the finding on any that fails; 03 rewritten to say what S5 does. | WP-B | DONE 2026-10-23. C1, the rule text and the finder's comment (ea6c7ac, CI run 39908588330); C2, the proof, checked (14594de, CI run 39910556621, D-189); C3, the proof on the card (51f2b6c, CI run 39913987752). The review round's R2 told the verifier the proof's rules (626bf33, CI run 39918309399). |
| WP-D | No unproven finding in the report: an open question cannot be confirmed; it can be dismissed, or verified again (a paid request, said before it is sent). | WP-C | DONE 2026-10-23. D1, an open question cannot be confirmed, by route, button or key (52d68ef, CI run 39914932325). D2, verifying again: S5's checks moved to their own module (9c6845d, CI run 39933248050), the route and a fresh request never replayed (680f36d, CI run 39934861439), the button and the dialog that says the cost first (7b6d489, CI run 39936635146). Review round 2 ran it through the job manager, kept its call out of the run's stages and kept the card honest while it is out (24f3e14, a43cb16, 75789ce). D-190 records a dismissed open question apart (5b2893b). |
| WP-E | A second, independent verifier: after S5 and the quote check, every verified finding goes to a fresh session on the paired model (PG-1) with the same proof schema; it stays verified only if both verify and both evidence paths pass the quote check; any disagreement makes it an open question, which WP-D keeps out of the report. Pre-flight counts the request. | WP-C, WP-D | DONE 2026-10-23. E1, the pairing and Start refused while the paired model is unprobed (6c96012, CI run 39947133241). E2, a request may name its own model (e522220, CI run 39951089730); the stage s5b_second_verification, S5's proven findings held and proven again, the second verifier a required input (cd671ff, CI run 39952881322); verify-again asks both and the card names them (fec78cc, CI run 39956627327). Review round 3 closed the gaps it found, Mode B held to D-185 among them (6587dff). |
| WP-F | The picker and pre-flight say what each model gets: "the whole ruleset in one pass", "one pass per rule theme, N passes", or "each file against the rules that apply to it"; a plain line on the non-recommended ones that accuracy may fall; and a request count that includes every stage, the splits and the second verifier, not S3's batches alone. | WP-B, WP-E | DONE 2026-10-23. F1, the batch arithmetic moved into lib (594f4a9, CI run 39964268157); F2, the pre-flight counts every request a review makes, by stage, the splits and the second verifier (e18add3, CI run 39966097165); F3, each model in the picker says how its work is divided and, when not recommended, that accuracy may fall (fd17810, CI run 39968240161). Review round 4 sized the count as the run sizes its prompts (1f1b895, CI run 39972600126). |
| WP-G | Five steps a person reads, mapped onto the stages: Understand the rules (S0's frozen ruleset and sweeps), Understand the change (S1, S2), Find issues (S3, S4), Prove each finding (S5, the quote check, the second verifier), Report (S6, your confirmation, the report). Labelled on the bar, live counts per step (candidates raised, proven, refuted, discarded by the quote check, open), and the same five steps summarised on a finished review, refuted and discarded told apart. Design shown to the maintainer before it is built (PG-4). | WP-A, WP-E, PG-4 | DONE 2026-10-23, to the approved mockup. G1 and G2, the five steps live in the scan theater with a count each and the findings so far (a103e07, CI run 39974539794); G3, a finished review summed up in its five steps, the time and requests of each from its stage rows (1a91c99). Review round 5 found the live view counting none proven while the second verifier worked, and fixed it with the rest of its findings (c15ccda). 1a91c99's new phone-width check failed CI on Ubuntu and macOS, whose fonts run wider: the confirmation queue and the review's sidebar were bare grids sized to their longest word (d9ec2fc, f657fd1, CI run 39985920272). |
| WP-H | Fresh evidence: the fixture reviewed on the new engine with Opus 5.5 on Windows, scored against the key, every finding's evidence path read. | WP-B to WP-G; maintainer go on spend | DONE 2026-10-23, the maintainer's go, through the CLI on their subscription (3024725 first made the demo probe the second verifier too). Opus 5.5, Fable 5.1 the second verifier: 11 candidates raised, one for each planted defect; 8 proven by both, 3 open questions, none refuted, none discarded, nothing raised in the clean files; 7/11 by the key; $3.1545 cost-equivalent in 344.4s. Every proof read (D-193). Evidence in `review/2026-10-23-fg2/173944-claude-opus-5-5/`. |
| WP-I | The design checked (D-191), one step per diff, each screen it adds shot and graded A to D as all frontend work is. I1: per project, off until turned on, the commands to run (install, tests, e2e), the folder the e2e saves screenshots to, and the path of the project's design standard; turning it on says plainly that it runs the branch's code on this machine. I2: a throwaway copy of the branch per review, apart from the read-only review worktree, in which app code alone runs those commands, each under a time limit, its output kept and the copy removed after; one new server module is the only one that spawns them, and `CLAUDE.md`'s laws say so. I3: a test command that fails is a finding, its evidence the command's exit code and the output quoted, checked by the app. I4: a stage grades every screenshot A to D against the A to D definitions and the project's standard, the model reading each image with Read alone; a C or D is a finding carrying the image, its grade and what is off; the second verifier grades it too and both must agree it is C or D, or it is an open question. A project with no e2e command gets "design not checked" in the report, never a grade. I5: the pre-flight counts the new requests and images, the steps view shows them in Find issues and Prove each finding, and the confirmation card shows the screenshot. I6: a fixture with screens and planted design defects (overflow, low contrast, clipped text) beside clean screens, with a key, proven end to end on the fake engine. | WP-H | IN BUILD 2026-10-24. I1, a project's checks set from its page, off until turned on, stored whole and refused in the server's words (`project_checks`, 0016; 78fc2e5). I2, the commands run in S0 on a throwaway clone at the commit, each under a time limit with its tree killed at it, their output and the e2e's screenshots kept, the copy removed, a resume reusing the result (D-196; fc83280). I3a, a failing command a check finding of its own, proven by the app (D-197; 333a0e0). I3b-1, decided above the queue as code findings are, and counted before a review completes (fb03107); review round 7 (3d9be06). I3b-2, the report's section of its own, and how each command ended (cafa2be). I4a, the screens graded A to D in S4b and again in S5c, each stage able to read the screenshots' folder alone (D-198, D-199; 88ef103). I4b, a design finding shows its screen, on its card from its review's own folder and in the report carried whole (15659ef). I5, the pre-flight says the project's commands and how grading adds requests, and the five steps say what grading came to (72e8f74). Review round 8 (734c12c). The report says the design was not checked, and why, where it was not. |
| WP-J | Fresh evidence for WP-I: the design fixture reviewed with Opus 5.5 on Windows, scored against its key, every grade read against its screenshot. | WP-I; maintainer go on spend | TODO |

## 4. Decision gates (maintainer)

- **PG-1: the second verifier's model. RESOLVED (a), D-185.** (a) The other recommended family:
  a review on Opus 5.5 is verified again by Fable 5.1, a review on Fable by
  Opus 5.5, any other by Opus 5.5. (b) One verifier model chosen on
  Settings. Recommended: (a), with the review refused at Start, saying why,
  when the paired model has not probed usable.
- **PG-2: an open question at confirmation. RESOLVED (a), D-185.** (a) It cannot be confirmed;
  dismiss it, or verify it again. (b) It can be confirmed but the report
  lists it apart as unproven. Recommended: (a), the maintainer's "proven a
  real issue".
- **PG-3: severity disagreement. RESOLVED (a), D-185.** (a) The verifier's severity stands, the
  finder's kept beside it. (b) The lower of the two. (c) It becomes an open
  question. Recommended: (a); a disagreement on how bad is not a doubt that
  it is real, and the person confirming sees both. A verifier answering that
  the rule does not apply kills the finding.
- **PG-4: the steps view.** A mockup of the five steps, live and finished,
  in both themes, shown before WP-G is built.
- **PG-5: how WP-I gets the screens. RESOLVED (a), D-192.** (a) The project's own e2e command,
  grading the screenshots it saves; the project knows its routes, states,
  themes and widths, and how to sign in. (b) Trysquare starts the app and
  shoots a list of URLs itself. (c) Both. Recommended: (a), the
  maintainer's "start e2e tests or something" (2026-10-23); (b) cannot
  reach a state behind a click or a sign-in.

## 5. Cost, said before it is spent

WP-B: about six probe calls, each a tiny request. WP-E adds one verification
request per review (plus at most one schema-repair round) on the paired
model, uncached; S5 is one request for every candidate today, by the code
(`src/server/review/pipeline.ts:632-663`). WP-H is one fixture
run; MVP 7.3's cost $5.2976 cost-equivalent on Fable without a second
verifier. No figure is claimed for the second verifier's cost until WP-H
measures it. WP-I adds a grading request for the screenshots on each
verifier, images included; its cost is claimed only once WP-J measures it.

## 6. Review cadence

A structured review pass after every 3-4 completed WPs and before anything
goes external. Findings numbered and fixed before new WPs start.
