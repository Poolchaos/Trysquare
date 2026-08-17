# Post-M4 plan: land the in-flight fix, close the gates, spend down the inbox

Status: RATIFIED, written 2026-08-04 for the Opus driver. WP-A landed with
this document, which is why the plan and its `docs/README.md` index line
arrive in the same commit as the sweep fix.

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done, and
"verified" means `./verify.sh` exited 0, run unpiped.

Definition of done for every work package:

- One WP per diff; no batching.
- `./verify.sh` exits 0, run unpiped.
- The real flow is driven at runtime, not just typechecked.
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.
- Open decisions are asked, or the WP is scoped so the decision is not
  needed yet. Do not guess.

Standing rails that bind every WP here:

- Prompt changes go through the fake quality gate first, the real model
  after (T18's rule). A paid run is never the first test of anything.
- AI review stages keep read-only tools. The ultracode effort tier stays
  withheld at picker and API.
- `docs/DECISIONS.md` is append-only and dated. `review/` stays gitignored.
- Real-engine spend only on the maintainer's explicit go, and only on
  subscription auth (check `readAuthStatus` first: `usesSubscription` true).

## 1. Where things stand (verified 2026-08-04, end of session)

- All twelve build-plan work packages are DONE. M4 items U1-U12 are DONE;
  U13's runs are done and captured. Construction is finished; what remains is
  judgment, this plan's follow-ups, and one in-flight fix.
- The maintainer imported their real protocol as a project-tier ruleset
  (51 rules, 70 directives, 23 sweep patterns, all 2,774 lines mapped,
  id `01KZ6K8SAMAXGG0YQ2XCFH5HBF` in the live DB). Two importer defects were
  found and fixed on the way in: CRLF documents parsed as zero rules
  (c4ca58b, D-63), and five numbered checklist headings collided with rule
  codes 1-5 (resolved by de-numbering the document; D-63).
- The maintainer then drove the first real review of a real project:
  `feat/supplier-ordering-schedule` into `master`, 61 files, 114 hunks,
  model `claude-fable-5[1m]`, effort high. It FAILED in S0 at $0.0000
  because rule 29's sweep pattern `new Date(` is not a valid regular
  expression, and the pipeline refuses a partial sweep. That review is
  resumable and is the FG-3 / G2 attempt in progress.
- The failure exposed two defects. First, sweep patterns written as literal
  code fragments (which is how real protocol authors write them) kill the
  whole review when they do not compile as regexes. Second, the pre-flight
  API returns `sweepProblems` and the new-review screen never rendered it,
  so the warning the RUNBOOK points at was invisible.

**The in-flight change (uncommitted, tree red).** Three files are modified:

- `src/lib/review/sweep.ts`: `compile()` now falls back to an escaped
  literal when the pattern is not a valid regex; `SweepOutcome` gained
  `ranAsLiteral: { ruleCode, pattern }[]`; `problems` remains for a pattern
  unrunnable even as literal (practically unreachable, kept for honesty).
- `src/server/review/pipeline.ts`: appends a `kind: "note"` run note when
  `ranAsLiteral` is non-empty (guarded by `!alreadySeeded` so a resume does
  not duplicate it). Needs `npx prettier --write` before commit.
- `src/app/api/reviews/preflight/route.ts`: `sweepProblems` entries now
  carry rule code and pattern; new `sweepLiterals` field lists patterns that
  will run as literal text.

`./verify.sh` fails on exactly the expected three things: prettier on
pipeline.ts, and two tests that assert the old refusal behaviour:
`tests/lib/review/sweep-and-quote.test.ts` ("reports an unusable pattern
instead of quietly running fewer checks") and
`tests/server/review/pipeline.test.ts` ("stops the run when a sweep pattern
could not be executed"). Rewriting those two tests to assert the new
behaviour is WP-A's work, not a nuisance to suppress.

## 2. Work packages

| WP   | Scope | Blocked on | Status |
| ---- | ----- | ---------- | ------ |
| WP-A | Finish and land the sweep literal fallback | - | DONE 2026-08-04 |
| WP-B | Resume the maintainer's first real review; capture G2 evidence | WP-A | TODO |
| WP-C | Stop S4 re-raising what S3 already found (D-59) | WP-A | DONE 2026-08-04 (mechanical half; the prompt half waits on a real run's fold count) |
| WP-D | Normalise prose rule codes at the stage boundary | - | DONE 2026-08-04 |
| WP-E | Give the fixture a sweep hit, so the sweep-disposition path stops being vacuous | WP-C | DONE 2026-08-04 |
| WP-F | Small inbox items: demo scorer app/ prefix; clearHunk vs sweep-clear reason mismatch; cache-creation token line | - | TODO |
| WP-G | Records on gate verdicts (G1, G2, G3 rows; BUILD-PLAN milestones) | maintainer | GATE |

### WP-A. Finish and land the sweep literal fallback

The code half is done (section 1); what remains is proof and records.

1. `npx prettier --write src/server/review/pipeline.ts`.
2. Rewrite `sweep-and-quote.test.ts`'s unusable-pattern test: a pattern like
   `new Date(` over an added line containing `const t = new Date();` now
   produces a hit at that line, appears in `ranAsLiteral`, and leaves
   `problems` empty. Keep a companion assertion that a compilable pattern
   still runs as a regex (the fixture's own `console\.` semantics must not
   change). Mutation-prove: reverting `compile()`'s fallback branch must
   fail the new test by name.
3. Rewrite `pipeline.test.ts`'s stop-the-run test: the run now completes,
   the hit is recorded and dispositioned like any other, and the run notes
   contain the literal-pattern note naming `29`-style code and pattern.
   The note must appear once after a resume, not twice (the
   `!alreadySeeded` guard is load-bearing; assert it).
4. New-review screen: render the pre-flight's `sweepLiterals` as a muted
   informational line and keep rendering `sweepProblems` as the existing
   warning. The `Preflight` interface at
   `src/app/reviews/new/page.tsx:58` needs the new field. This closes the
   RUNBOOK's "fix those first" claim pointing at an invisible field.
5. `./verify.sh` unpiped, exit 0.
6. Records in the same diff: DECISIONS entry D-64 (pattern semantics are
   regex-first with literal fallback; refusal kept only for the unrunnable;
   alternatives rejected: refusing outright kills real protocols over
   punctuation, always-literal breaks the fixture's escaped patterns and
   legitimate regex use). RUNBOOK's sweep-pattern sentence updated.
   Commit this plan and its `docs/README.md` index line in the same commit.

### WP-B. Resume the first real review, capture G2 evidence

The failed review is resumable at zero cost so far. The maintainer presses
Resume (their spend, their go; the standing authorisation covers a first
real review on subscription). The driver's half:

- Watch the run. Root-cause any failure before any retry: an anomalous
  artifact is a defect until root-caused, and this is the first real
  protocol, first real repo, first 61-file change set through the pipeline.
- WP-C landed first, so each finding should now appear once. Read the run
  notes for the fold count: it says how many times the deletions stage
  repeated the adversarial stage, and it is the evidence that decides whether
  the S4 prompt still needs scoping.
- When the review completes and the maintainer decides findings and
  exports: that is FG-3. Record the G2 row in `docs/GATES.md` with dated
  evidence (counts, cost, wall time, what the maintainer said), status set
  only by their words, never by the driver.

### WP-C. Stop S4 re-raising what S3 already found (D-59)

Both clean fable runs produced 9 distinct findings as 18 candidates: S4
reads the deleted side of every modification as a deletion and re-reports
it. Two mechanisms, in order:

1. **Mechanical, testable, first:** dedup at candidate creation. A stage
   answer finding whose (path, overlapping line range) matches an existing
   candidate from an earlier stage of the same run is folded, not inserted;
   the fold is counted on the review (a run note: "S4 re-raised N finding(s)
   S3 already held; folded"). This is enforceable in app code and provable
   in the fake suite: extend the scripted runner so S4 returns a
   near-duplicate of an S3 finding and assert one candidate, one note.
   The fake gate is currently blind to this class (ideal answers never
   duplicate), so the test must be written to fail before the fix.
2. **Prompt scoping, second:** tighten the S4 system prompt to deletions
   without a surviving replacement. This is a prompt change: fake gate
   first, then at most one real fixture run on the maintainer's go to
   confirm the duplication is gone (expect 9 candidates, not 18).

Decision needed before building (section 3, gate 2): fold silently versus
keep-and-mark. Recommendation is written there. DECISIONS entry either way;
D-59 moves from PROPOSED to DECIDED.

### WP-D. Normalise prose rule codes at the stage boundary

Fable writes `ruleCode: "Rule 11"` where the ruleset speaks `"11"`; the
stage schema accepts any string, so the finding's rule-text expansion on the
confirmation screen will not resolve. Normalise at the stage answer
boundary (strip a leading `rule`/`Rule` prefix, trim), validate the result
against the frozen ruleset's codes, and leave an unmatched code null rather
than invented. Unit tests on the normaliser; one pipeline test proving a
prose code from a stage answer reaches the finding row bare.

### WP-E. Give the fixture a sweep hit

The seeded fixture produces zero sweep hits, so `pendingSweepHits === 0`
and the whole sweep-disposition path are vacuous on it, while the
maintainer's real protocol carries 23 sweep patterns. Plant one sweepable
pattern (the example protocol's table already names `toFixed` for rule 8;
an added line using `toFixed` in a defect file does it) and extend the
ideal answers' sweep dispositions accordingly. The quality gate's sweep
assertions become load-bearing for the first time. Watch the trap recorded
in `U12-FIXTURE-GAPS.md`: the suites stay byte-identical only while risk
tags are empty; a sweep hit does not disturb that, but verify the fake
service suites still pass unchanged before assuming.

### WP-F. Small inbox items

Each is one small diff, in this order, each with its dated inbox line
retired in the same commit:

1. `scripts/demo-fixture.ts:264`-area scoring: qualify by the defect's
   `repo` instead of hardcoding `app/`, so a future shared-core defect
   cannot score MISSED forever.
2. `clearHunk` demands a reason while the sweep-clear guard does not:
   align them (require the reason) or record why they differ. Look before
   deciding; if requiring it breaks real stage answers, that is the answer.
3. Surface `reviews.usage_cache_creation_tokens` in the run screen's usage
   panel (it accumulates already and is shown nowhere).

Deliberately left in the inbox: the rule-4 retag / rule 15 (touches the
maintainer's protocol semantics; theirs to want), and the risk-tagged
quality-gate variant (real work, low yield until a prompt change needs it).

### WP-G. Records on gate verdicts (maintainer-gated)

When, and only when, the maintainer speaks:

- G1 (FG-2): their verdict per `plans/FG2-CHECKLIST.md`. Record in
  `docs/GATES.md` with the evidence directory named. A "pass with prompt
  work" verdict naming the D-59 duplication feeds WP-C's real-run
  confirmation.
- G2 (FG-3): from WP-B's evidence.
- G3 (FG-4): design acceptance over `review/2026-08-04-fg4/DESIGN-NOTES.md`
  plus the engine quality gate evidence and full e2e. On a pass, v1 is
  closed: update `GATES.md`, `PROJECT-STATE.md`, `BUILD-PLAN.md` milestone
  lines, and the README's Status section in one records commit.

## 3. Decision gates (maintainer)

1. **G1 verdict** (pass / pass with prompt work / fail). Recommendation:
   pass with prompt work, naming the S4 duplication (D-59) and the prose
   rule codes (WP-D) as the prompt work; both are already scoped above.
2. **D-59 fold behaviour.** Options: (a) fold duplicates silently into the
   earlier candidate; (b) fold and note the count on the run (recommended:
   the fold is evidence about the prompts, and a silent fold hides a
   regression signal); (c) keep both and let the human dismiss one
   (rejected: it doubles the confirmation queue, which is the defect).
3. **G3 acceptance** per FG-4. Nothing in this plan assumes it.

## 4. Review cadence

A structured review pass after WP-C lands (WP-A through WP-C are the
behaviour-changing cluster), and another before G3's records commit.
Findings numbered and fixed before new WPs start, per the charter.
