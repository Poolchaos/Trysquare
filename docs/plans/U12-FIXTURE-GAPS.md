# U12 fixture gaps: the four seeded-fixture defects still owed

Status: EXECUTED 2026-08-04, all phases. Written the same day by a parallel
investigation of the live tree and then adversarially verified against it, so
every file path, line number and failure mode below was checked rather than
recalled. Phase A (risk ordering), Phase B (both dead-export passes), and
Phase C (gaps a, d, b, c as commits 7261168, 2b7f9a3, 09c479f, 41d5867, with
records in D-60 to D-62) are all committed. Kept as the record of the working
order and its measured traps; nothing here is owed anymore.

Read `docs/plans/M4-FINISH-PLAN.md` first for where this sits. The four gaps
are owed by `docs/05-TESTING.md` section 4 and were deferred once already
(DECISIONS.md, 2026-08-03 DEFERRED).

Why they are worth doing: the seeded fixture is the regression net for every
prompt change, and today it exercises no whole-file deletion at all. Gap (a)
would produce the first non-empty `s4_deletions.findings` anywhere in the
suite, and gap (d) closes a `docs/05` requirement that is currently
unreachable rather than merely unwritten.

The corrections below are the valuable part. Several are cases where the
obvious implementation passes the suite while proving nothing, and each is
marked where it applies.

# Phase C - Seeded fixture gaps

*Each gap = protocol rule + fixture pair + manifest entry + ideal-answers route, landing together. `tests/lib/rulesets/import.test.ts`'s exact rule-code list (**:74-85**, currently `1,2,2a,3,4,5,6,7,8,9,10,11`) goes red the moment a rule is added - update it in the **same commit**, as an exact list. Loosening it to a length check would be changing the test to make it pass.*

**Standing hazard for all of Phase C:** `tests/fixtures/` is excluded from eslint, prettier and the house-style gate. Nothing will catch a stray em dash or emoji there - apply house style by hand, and run the byte-for-byte round-trip test (`import.test.ts:41`) before anything else.

## Gap (a) - whole-file deletion with a surviving caller

### 10. Protocol rule 12 + import test
`tests/fixtures/example-protocol.md`: append `### 12. Deleted File With a Live Caller` inside the existing `## Deletion Anti-Patterns` group, using rule 11's exact field shape. Detection text must say the caller usually does not appear in the diff at all. No sweep-table row (rule 4 already has none). Add `"12"` to `import.test.ts:74-85`.

### 11. Fixture pair + manifest - `tests/fixtures/build-seeded-repos.mjs`
Import `rmSync`, add `remove(root, path)`, add `const REMOVED = ["src/orders/retry.ts"];` applied after the AFTER map is written and before `commitAll` (which already uses `git add -A`, so deletions stage). BEFORE-only: `src/orders/retry.ts` exporting `retryOnce`, and `src/orders/dispatch.ts` importing and calling it. **`dispatch.ts` must NOT appear in AFTER**, so it is unchanged and absent from the diff. Manifest entry `deleted-module-live-caller` with `kind: "deleted-file"`, `file: "src/orders/dispatch.ts"`, `deletedFile: "src/orders/retry.ts"`, `ruleCode: "12"`, `severity: "CRITICAL"`.

- **Drop plan 2's rationale sentence "Do not delete src/orders/persist.ts instead: save.ts also imports it."** Measured: **`src/orders/persist.ts` does not exist**. `grep -n persist tests/fixtures/build-seeded-repos.mjs` returns only save.ts's `import { persist } from "./persist";` at :91 and :176 and the marker at :272 - the fixture already ships a dangling import.
- **Add a comment on rename detection:** `diffText` runs `git diff -M -C` (`repo.ts:131-145`) and the deletion of `retry.ts` lands in the same commit as gap (b)'s added `apply.ts`. They are dissimilar enough today that git reports delete+add, but an edit making them similar would collapse both defects into one rename and silently delete the S4 case.

### 12. Route it through S4 - `tests/helpers/ideal-answers.ts`
Widen `SeededDefect.kind` to `"addition" | "deletion" | "cross-repo" | "deleted-file"`; add `deletedFile?: string` and `dependsOnSymbol?: string`. Split the findings build: non-`deleted-file` defects feed `findings` as today, `deleted-file` defects build `s4.findings`. In `reviewedDeletions`, when a `deleted-file` defect names this entry's path, emit `dependents: [qualify(defect)]` and a reason naming the caller. Type `s1..s4` on `IdealStageOutputs` as the stage-schema types rather than `unknown`.

> **`s5ByLine` must be built from `[...findings, ...s4Findings, ...extras]`.** If missed, the failure is misleading: the run still completes, the candidate becomes an open question, and **three** tests go red - `quality-gate.test.ts:158` ("verifies every seeded defect", because an open question is not `verified`), `quality-gate.test.ts:212`, and `scripted-pipeline.test.ts:183`. Plan 2's risk note listed only the last two.

**Why S4 and not S3:** `pipeline.ts:284-313` builds `findingHunks` from every S3 finding and rejects any hunk outside the change set, so an S3 finding citing `dispatch.ts` fails reconciliation. S4 findings bypass that (`:397-412`) and face only the quote check, which passes because `dispatch.ts` exists in the worktree.

### 13. `tests/server/review/seeded-fixture.test.ts`
Add `deletedFile?: string` and the widened `kind` to the inline manifest type (:24-40).
> **Placement correction:** the `deleted-file` branch must sit **before line 92**, not inside the addition branch. Lines 92-93 run `const file = appFiles.find((entry) => entry.path === defect.file); expect(file, defect.file).toBeDefined();` *before any kind branch*, so a defect whose `file` is the untouched caller fails there. Branch and `continue` after asserting against `appFiles.find((e) => e.path === defect.deletedFile)`.

In "changes every file the manifest talks about" (:65), skip `deleted-file` for the `changed.has(defect.file)` check; assert `changed.has(defect.deletedFile!)` is **true** and `changed.has(defect.file)` is **false**. Assert `defect.deletedFile` is defined for that kind - the builder is imported with `@ts-expect-error`, so a mistyped field is invisible to tsc.

New test: **"deletes a whole file whose caller the change never touches"** - deleted file present as `changeType === "deleted"`, its removed lines contain `retryOnce`, caller absent from the diff, caller still imports the module.

### 14. `tests/server/review/quality-gate.test.ts`
New test **"reports the deletion the diff cannot show, from the stage that reads removals"** - a verified finding at `qualified(defect)` and `defect.line`, and the ledger file for the deleted path is `reviewed` (via `listLedgerFiles`), so the S4 accounting is proven and not just the finding. Leave the existing two tests untouched: `result.verified === manifest.defects.length` now silently covers the S4 finding, which is what catches a routing regression.

### 15. Two consumers this newly makes reachable
- `tests/server/api/confirmation.test.ts`: "returns the lines around the one that was cited" (:181) currently does `const [finding] = ...findings` and asserts `body.hunk` is non-null. Pick the finding **explicitly** (one whose `filePath` is in the diff). Add a new test: **"serves the file alone when the finding is in code the change never touched"** - 200, lines present, `hunk: null`. That branch (`context/route.ts:81`, rendered at `confirmation.tsx:451`) has no test today, and gap (a) is what makes the state reachable.
- **`e2e/journey.spec.ts:199` hazard, missed by both plans.** The spec asserts "What the change did here" is visible for the *selected* finding; `confirmation.tsx:451` renders it only when `shownContext?.hunk` is truthy. The new CRITICAL at `app/src/orders/dispatch.ts` has no hunk. The step stays green **only because `app/src/auth/guard.ts` still sorts first among CRITICALs** under `confirmation.tsx:78-86` (severity → `filePath.localeCompare` → line). Put that constraint in a comment beside the manifest entry, or make the journey step select a finding whose file is in the diff.

> **Run `./verify.sh --e2e` before continuing.** This is the first point where an e2e-visible fixture change lands.

**Also note in D-60 (was D-59 before the 2026-08-04 U13 entries took 57-59):** an S4 finding is subject to **no coverage reconciliation at all** - it bypasses hunk, sweep and symbol reconciliation and faces only the quote check (`pipeline.ts:482-500`). By design, but this change introduces the first such finding in the fixture, so a reader should not have to infer it.

## Gap (b) - duplicated merge helper

### 16. Rule 13 + fixture + assertion (one commit)
- `example-protocol.md`: new group `## Duplication Anti-Patterns` before `## Review Output`, with `### 13. Duplicated Helper`, severity WARNING. The heading matches no `TAG_KEYWORDS` pattern, so the rule is tagged `general`, which applies to every file and therefore **adds no new decomposed exclusions** - keeping the excluded-pair count and the README assertion at `quality-gate.test.ts:348` unchanged. Add `"13"` to `import.test.ts`.
- `build-seeded-repos.mjs`: BEFORE gains `src/settings/merge.ts` exporting `mergePrefs` with an explicit undefined guard; AFTER gains new file `src/settings/apply.ts` exporting `applyPrefOverrides` as `return { ...base, ...override };`. Manifest `duplicated-merge-helper`, marker `return { ...base, ...override };`, ruleCode "13", WARNING. Keep added lines free of `as `, `any`, `console.`, `TODO`, `setTimeout`, `toFixed` so it does not entangle with the sweep. The duplicate must differ *behaviourally* (undefined overwrites a real default) or it is a style opinion, not a defect a rule can name.
- **Missing assertion plan 2 omitted:** `merge.ts` goes into BEFORE only, so nothing proves the helper being duplicated is still in the tree. Add to `seeded-fixture.test.ts`: the original helper exists in the checked-out feature branch and is absent from the change set. Without it the duplicate is nominal and the answer key would still pass if `merge.ts` were silently dropped.

> **Run `./verify.sh`.**

## Gap (d) - second cross-repo defect and the dedicated both-assertion

### 17. Rule 14 + consumer + manifest-driven dispositions (one commit)
- `example-protocol.md`: new group `## Dependency Anti-Patterns` with `### 14. Changed Default Nobody Opted Into`, WARNING. Add `"14"` to `import.test.ts`. *(Rule 15 / the rule-4 retag is dropped - see the dropped table.)*
- `build-seeded-repos.mjs`: change `src/settings/prefs.ts` in **both** BEFORE and AFTER to import `{ DEFAULT_TIMEOUT_SECONDS, type Prefs }` and add `saveTimeoutMs()` returning `DEFAULT_TIMEOUT_SECONDS * 1000`. **Byte-identical in both maps**, so it never appears as an added line. Manifest `silently-shortened-default`, `kind: "cross-repo"`, `dependsOnSymbol: "DEFAULT_TIMEOUT_SECONDS"`, marker `DEFAULT_TIMEOUT_SECONDS * 1000` (unique - the import line has no `* 1000`), ruleCode "14". The changed-default bug is **not currently a defect at all**: nothing consumes the constant, so "the gate asserts both are found" is unreachable until a consumer exists.
- `ideal-answers.ts`: replace the hardcoded `symbol.name === "Prefs"` in the `symbolDispositions` build with manifest-driven logic - cross-repo defect whose `dependsOnSymbol` matches → `finding` with `consumersChecked: [qualify(defect)]`; else non-empty `manifest.verifiedConsumers?.[symbol.name]` → `all_consumers_verified`; else `no_consumers_found`. **Resolve plan 2's contradiction**: add `verifiedConsumers?: Record<string, string[]>` to **`SeededManifest`** (`ideal-answers.ts:35-38`), and have the fixed-variant `runGate` assemble `{ defects, cleanFiles, verifiedConsumers }` from `manifest.fixedVariant`. With two cross-repo defects the name check is wrong: it would answer `no_consumers_found` for the timeout symbol while a finding cites it, and `assertSymbolVerdictsAreBacked` would then reject.
- `quality-gate.test.ts`: replace "finds the defect that only exists across the two repositories" (:176) with **"finds both defects that exist only across the two repositories"** - `expect(crossRepo).toHaveLength(2)` (this length assertion is the dedicated part: it pins the size of the cross-repo answer key so deleting one fails loudly), then per defect assert a finding at exactly `defect.line`, `statusOf` verified, and matching ruleCode. Keep the comment explaining neither line changed and the contract under both moved in the other repository.

> **Run `./verify.sh`.**

## Gap (c) - fixed-variant branch (last: the only one touching e2e infrastructure)

### 18. Third branch in the app repo - `build-seeded-repos.mjs`
After committing the feature branch: `git checkout -qb rename-prefs-migrated` **from `feature/rename-prefs`** (so every seeded change carries over without re-application), write a FIXED map containing only a migrated `src/settings/prefs.ts` (`autoNavigateDestination === "none" ? "stays" : "navigates"`, and `Math.max(SAVE_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS) * 1000` with a local `const SAVE_TIMEOUT_SECONDS = 30`, so the symbol keeps a live consumer that is correct under the new contract), commit, compute the fixed defect lines with `lineOf` **while this branch is checked out**, then `git checkout -q feature/rename-prefs` before computing the main manifest. Return `manifest.fixedVariant = { branch, defects (manifest minus `cross-repo`, lines re-derived), cleanFiles: [...CLEAN_FILES, "src/settings/prefs.ts"], verifiedConsumers }`, deriving `verifiedConsumers` by walking the checked-out app tree for `\bPrefs\b` / `\bDEFAULT_TIMEOUT_SECONDS\b`.

**Constraints, each needing a comment naming what depends on it:**
- The name must **sort after `main` by refname** and must **not contain the substring `feature/rename-prefs`** (Playwright `hasText` is a substring match). `rename-prefs-migrated` satisfies both - measured on a real bare clone with the fixture's pinned dates: `git for-each-ref --sort=-committerdate refs/heads/` returns `feature/rename-prefs, main, rename-prefs-migrated`, so the into-fallback still lands on `main` and both browser specs stay green.
- Restoring HEAD to `feature/rename-prefs` is load-bearing: the bare clone inherits HEAD and the branch picker's detected default comes from it.
- **State the default-branch mechanism as both lines, not just the fallback:** `chosenInto` is first seeded from `branchList.defaultBranch` at `src/app/reviews/new/page.tsx:168`; the `:249-252` fallback fires only because this fixture's bare-clone HEAD is the from-branch (measured: `git symbolic-ref --short HEAD` returns `feature/rename-prefs`).

### 19. e2e defence - `e2e/failure-paths.spec.ts` only
Add explicit `selectOption("main")` on Compare against in `startAReview` (:39-44), where there is no assertion to lose and the spec relies entirely on the fallback (a wrong into-branch makes the fake CLI exit 2 with "was not asked about `<<candidate:...>>`", reading as an unrelated engine fault). **Leave `e2e/journey.spec.ts:112`'s `toHaveValue("main")` verbatim** - rewrite only the now-false comment at :109-111 ("main is already the only candidate").

### 20. `quality-gate.test.ts` fixed-variant describe
In `beforeAll`, resolve `feature/rename-prefs` and `rename-prefs-migrated` separately, parse the fixed app diff, add a second worktree root (app at `fixedHead`, shared-core at `coreHead`); give `runGate` an options field swapping files, manifest and worktreeRoot together.

**Assertions (the two tautological ones dropped):**
1. The run completes with `pendingHunks`/`pendingSweepHits`/`pendingFiles`/`unresolvedCandidates` and `killedByQuoteCheck` all 0 - **the run completing IS the proof that `assertSymbolVerdictsAreBacked` accepted the clears.**
2. `result.verified === manifest.fixedVariant.defects.length`.
3. Replacing dropped assertion (4): every name in `consumersChecked` **exists under the fixed worktree root and actually contains the symbol** - so "all consumers verified" is a claim about a consumer that exists rather than about an empty file.

**Correct the stated reason in the test's comment.** Plan 2's "nothing today proves the all_consumers_verified path survives a whole pipeline run" is false: `pipeline.test.ts:649` ("accepts a symbol verified against named consumers") already drives it through a whole `runReviewPipeline` linked run, with `:704` as its negative control. What the fixed variant adds is a **derived consumer list from a real repaired tree**. Say so, and say that the pipeline does not persist symbol dispositions, so the end-to-end claim is that a repaired change set produces clears the pipeline accepts.

> **Run `./verify.sh --build --e2e` before continuing.** This is the gate for all of Phase C.

### 21. Phase C records
- `docs/05-TESTING.md`: delete the two "Not built yet" bullets these gaps own (the linked gate asserting both contract bugs plus the fixed variant, and the duplicated-merge-helper defect). Leave the others.
- `docs/RUNBOOK.md:64` ("eight defects"): replace with the count **measured** by running `npm run demo:fixture -- --fake`, not an arithmetic guess.
- `docs/plans/FG2-CHECKLIST.md:28,30,62` and the G1 evidence cell in `docs/GATES.md`: **do not rewrite the captured numbers** ("8 planted defect(s)", "8/8") - they are a real 2026-07-31 measurement. Add a dated line saying the fixture now plants N and the transcript predates the U12 additions.
- `docs/DECISIONS.md`: **D-60** (deletion defect raising its finding from S4, why an S3 finding cannot cite a file outside the change set, and that S4 findings face no reconciliation), **D-61** (second cross-repo defect + rule numbering 12/13/14 and that the rule-4 retag was deliberately deferred), **D-62** (fixed variant as a third branch, both naming constraints, why HEAD is restored). Mark the 2026-08-03 `DEFERRED (U3 to U12)` entry **closed** rather than leaving it reading as owed.
- `docs/plans/M4-FINISH-PLAN.md`: strike the fixture bullet at 570-573. Update `docs/PROJECT-STATE.md` counts again (re-measure).
- `docs/plans/idea-inbox.md`, one dated line each: the rule-4 mis-citation retag; a risk-tagged quality-gate variant; **the fixture produces zero sweep hits, so `quality-gate.test.ts`'s `pendingSweepHits === 0` and the whole sweep-disposition path are vacuous on this fixture**; `scripts/demo-fixture.ts:264` scores every defect against `app/${defect.file}`, so a future shared-core defect would score MISSED forever; the `clear_reason` guard incoherence; the missing cache-creation token line.

---


## Ranking

**Worth doing, in value order** (value = closes a real gap between what the records claim and what the code does):

1. **Phase A, risk ordering** - closes the one gap `docs/03` declares against itself in its own "Not built yet" block, and converts a write-only column into a load-bearing one. Highest value per line changed, and the mutation record makes the claim falsifiable rather than asserted.
2. **Phase B step 7, zero-consumer deletions** - deleting dead surface, no test changes, and one item (`symbolDispositionSchema`) is actively harmful: a stale duplicate offering two verdicts beside a live schema offering three, with a long comment explaining why the third must exist.
3. **Gap (a), the deletion defect** - closes a `docs/05` requirement and produces the **first non-empty `s4_deletions.findings` anywhere in the suite** (grep: only `findings: []` appears today), plus the first test of the `hunk: null` context branch.
4. **Gap (d), both-cross-repo** - closes a `docs/05` requirement that is currently *unreachable*, not merely unwritten.
5. **Phase B step 8, test-only exports** - real deletions, but each costs a test edit and two cost a whole block.
6. **Gap (b), duplicated helper** - named in `docs/05`'s minimum list; cheapest of the four.
7. **Gap (c), fixed variant** - owed by `docs/05`, but the heaviest and the only one touching e2e. Do last; it is the most reasonable single item to defer if the pass has to stop early.
8. **Step 1 and the record corrections** - trivially cheap, and the counts are wrong *right now*.

**Deliberately not done, recorded with reasons:** every column drop (G1 awaiting verdict + live user DB + unreviewable batch size); `renameProject` (documented live requirement, U10/D-51); the dead-export gate script (new feature, needs mutation proof first); the rule-4 retag and the risk-tagged gate variant (batching); un-exporting `selfUses>=1` symbols and consolidating the three identical `StageUsage` declarations (no behaviour change, churny); surfacing `clear_reason`, `sweep_hits.finding_id`, `into_commit` and the cache-creation token line (each is a real feature with its own blast radius, not a U12 tail item).
## Deliberately not done, with reasons

## Dropped from the input plans, with reasons

| Dropped | Why |
|---|---|
| Plan 3 step 1 ("land or stash the in-flight change") | Premise false. `git status --porcelain` is empty; the effort-tier change landed as `b2584cf`. Keep only the warning that plan-3 line numbers were computed against an older tree. |
| **All nine column-dropping migrations** (`ledger_files.risk_tags`, both `clear_reason`, `sweep_hits.finding_id`, `reviews.linked_into_branch/_commit/into_commit`, `findings.verified_at/decided_at`) | `docs/GATES.md:10` has G1 **AWAITING VERDICT**; a destructive schema change ahead of a gate verdict is out of order. `runMigrations` executes against the maintainer's live `~/.local/share/trysquare/db.sqlite`, and SQLite column drops rebuild tables carrying FKs and indexes. Giving a column its reader is the lower-risk half of the U12 sentence. Record the write-only ones; drop none. |
| Deleting `renameProject` (`src/server/db/repositories/projects.ts:140`) | Genuinely unreferenced, and that is the trap. `docs/02-DATA-MODEL.md:12-16` keeps project-name editing as an unbuilt requirement owned by U10/D-51, under a heading saying such items "stay here as requirements rather than being edited away". D-51 has no `DECISIONS.md` entry. Deleting it silently retires a documented requirement. |
| `scripts/check-dead-exports.mjs` + its `verify.sh` line, in this pass | Right idea (nothing catches this today: `eslint .` runs with no `--max-warnings` and the effective `no-unused-vars` severity is warn), but it is a new gate = a separate feature, and it must be mutation-proved before it counts. Its own commit, after. |
| Replacing `await expect(page.getByLabel("Compare against")).toHaveValue("main")` in `e2e/journey.spec.ts:112` | Measured: `rename-prefs-migrated` sorts **after** `main` under `for-each-ref --sort=-committerdate` refname tiebreak, so the derived default still resolves to `main`. Replacing the assertion with `selectOption` deletes the only test that would catch a future branch sorting before `main` - the exact risk the fixture plan opened with. Keep it; fix only the now-false comment. |
| Fixed-variant assertions (1) and (4) as worded | (1) asserts `outputs.s3.symbolDispositions`, which the test itself constructs and the pipeline never persists - it tests the helper. (4) "no verified finding in prefs.ts" restates the answer key's own construction (`fixedVariant.defects` is defined as the manifest *minus* both prefs.ts defects) and cannot fail. Replaced below. |
| Optional rule 15 + retagging `unmigrated-consumer` from ruleCode "4" | The mis-citation is real (rule 4 is "Index Signature Hiding a Typo"; the `Prefs` interface has no index signature), but it is a fifth feature on a change already spanning four gaps. → `docs/plans/idea-inbox.md`. |
| Adding risk tags to `buildIdealStageOutputs` (`tests/helpers/ideal-answers.ts:207`) | Every file there carries `riskTags: []`, which is the only reason the quality gate, scripted, service and browser suites stay byte-identical under a stable sort. → `idea-inbox.md`. |
| Reordering the S5 candidate list / `refFor(index)` | `pipeline.ts:441-444` makes positional labels load-bearing for replay; 03 mandates nothing about verification ordering. |
| Editing the dated "Verified starting state (2026-08-03)" section of `docs/plans/M4-FINISH-PLAN.md` (incl. lines 62, 183, 184) | Evidence record of that date, not a live claim. Rewriting destroys evidence. Only the live "Still open" bullet at **574-575** changes. |
| Un-exporting the ~30 `selfUses>=1` symbols; `StageUsage` consolidation | No behaviour change, large churny diff, works against `enums.ts`'s stated single-vocabulary purpose. Separate commits if wanted at all. |

**One input-plan risk is simply false and must not be carried into a comment:** plan 1 claims reordering changes "the confirmation queue's within-severity order (listFindings has no ORDER BY, so it returns insertion order)". `src/components/confirmation.tsx:78-86` sorts by severity → `filePath.localeCompare` → `lineStart`. The queue is **not** in insertion order. Drop that risk.

---

