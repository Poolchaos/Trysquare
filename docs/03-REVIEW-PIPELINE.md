# 03 Review pipeline

Status: RATIFIED 2026-07-30 at G0. This is the engine
specification: how a review executes the maintainer's protocol as verifiable stages.
The protocol's mandatory execution procedure (REVIEW_PROTOCOL.md) is the
source; this doc maps each protocol step to either deterministic app code or
a bounded AI stage. Principle: **everything that can be deterministic is
deterministic; the AI does judgment, code does bookkeeping.**

## Not built yet

This document specifies the target. Verified against the code on 2026-08-03,
these parts of it do not exist yet. They stay here as requirements rather
than being edited away; the item in `plans/M4-FINISH-PLAN.md` that owns each
is named.

- Giving S4 the pre-change file contents. The bundle writes `base/` and
  nothing reads it back, so a deleted file is reviewed from its diff rather
  than from what it contained. U3.
- Reconciling S4 answers. The stage returns `reviewedDeletions` and the
  pipeline discards it, then marks every file reviewed unconditionally, which
  makes the deleted-file invariant unfalsifiable. U3.
- Ordering later stages high-risk first (section 1). S1 risk tags are stored
  and never read. U12.
- Sweeping whole changed files where the protocol asks for it (section 0.4).
  Sweeps run over added lines only. Unowned.
- Showing the verbatim rule text and the diff hunk during confirmation
  (section 7), and bulk dismissal by rule. U7.

## 0. S0 Prepare (deterministic app code, no AI)

1. `git fetch` the project; resolve fromBranch and intoBranch to commits;
   pin them on the review row. Compute `mergeBaseCommit`. For a **linked
   review** (a dependency project included, e.g. shared-core alongside the app that consumes it),
   do the same for the linked pair and pin the linked commits.
2. Create the worktree(s). Single review: detached checkout of fromCommit
   at `runs/<id>/worktree/`. Linked review: a parent directory with one
   subdirectory per repo, named by project slug:
   `runs/<id>/worktree/<primary>/` and `runs/<id>/worktree/<linked>/`;
   AI stages get cwd = `runs/<id>/worktree/` so both trees are readable,
   and every path in inventory, ledger, and findings is qualified as
   `<slug>/<repo-relative-path>`.
3. Build the **bundle** under `runs/<id>/bundle/`:
   - `diff.patch` (and `diff-linked.patch`): full text per repo
   - `inventory.json`: every changed file and hunk across both repos
     (parsed by `lib/git`), repo-tagged, including renames and deletions;
     this seeds ledger_files/ledger_hunks
   - `base/<slug>/<path>`: pre-change copies of every modified and deleted
     file (from each repo's merge base)
   - `links.json`: package-to-worktree mapping from project_links, e.g.
     `{"@acme/shared-core": "shared-core/"}`, so stages resolve imports of
     the package to the linked worktree source instead of node_modules
   - `stats.json`: per-repo and combined counts
4. Run the **mechanical sweeps**: for every enabled rule with sweepPatterns,
   run the regexes over changed files' added lines (and whole changed files
   where the protocol says so). Persist every hit as a sweep_hit (pending).
   Sweeps are implemented in Node (read the file, apply the regex), NOT by
   shelling out to ripgrep: `rg` is not guaranteed to exist as a binary (on
   the maintainer's machine it is a shell function from an editor integration and is
   absent in non-interactive processes), and a sweep that silently returns
   nothing would break the coverage guarantee while looking green. Sweep
   coverage is asserted by unit tests against fixtures with known hits. The
   AI never runs its own sweeps.
5. Compose the **ruleset snapshot**: process directives + enabled rules,
   full verbatim text, ordered; freeze into review_rulesets.snapshotJson.

Failure of any S0 step fails the review with the git/filesystem error.

## 1. Stage contracts (AI stages)

Common contract for every AI stage:

- cwd = worktree; tools = Read, Grep, Glob only (no Edit, no Bash, no web).
- System prompt = composed ruleset snapshot + stage instruction + the
  protocol's scope rule (review changed code only) + output contract.
- Output = one JSON document matching the stage's zod schema. Invalid output
  triggers exactly one repair round (same session, "your output failed
  schema validation at X") and then fails the stage. No silent retries.
- Every stage's result event (tokens, cost-equivalent, session id) is
  persisted to stage_executions before the pipeline advances.
- Stages S1-S4 share one CLI session (resumed) so comprehension context
  carries into the adversarial pass. S5 verification always runs in a
  **fresh session** with no access to the reasoning that produced the
  findings; independence is the point (protocol step 6).

### S1 Risk classification (protocol step 2)

Input: inventory.json summary + diff stats. Output per file: riskTags from
the protocol's category table (money, auth, data_shape, destructive,
concurrency, time, shared) with a one-line reason each. App orders the
remaining stages' file lists high-risk first (protocol: deepest tracing
while attention is fresh).

### S2 Comprehension pass (protocol step 3)

Instruction: read every changed file in full, follow every execution chain
(callers, callees, shared components), trace data paths end to end. Findings
are FORBIDDEN in this stage's output (protocol: do not form findings yet).
Output per file: what the change does and why (own words), chain files read
(absolute repo paths; persisted to ledger_files.chainFilesRead), open
uncertainties. A file whose behaviour cannot be explained gets an explicit
uncertainty entry, which S3 must resolve or convert to an open question.

### S3 Adversarial pass (protocol step 4)

Instruction: per hunk, walk the rule database explicitly (which rules could
apply, confirm each was checked), apply the junior-dev checklist (types,
data flow, bindings, state/effects, edge cases) and the four devil's
advocate lenses. Disposition every sweep_hit: finding or cleared with
reason. Output: candidate findings (protocol finding format fields +
mechanism + ruleCode), per-hunk clears with reasons, sweep dispositions.
App code cross-checks: every hunk and every sweep hit dispositioned, else
the stage output is rejected as incomplete (one repair round, then fail).

**Linked-review addendum (mandatory when a linked repo is present):** every
changed exported type, interface, signature, enum/union, or default value
in the dependency repo is a cross-repo contract change. For each one, the
stage must enumerate its consumers in the primary repo (Grep the primary
worktree, resolving the package import via `links.json`), verify each
consumer against the new contract, and disposition the contract change like
a hunk: findings or an explicit all-consumers-verified clear naming the
consumer files checked. The protocol's backwards-compatibility section
applies across the repo boundary exactly as within one repo. App code
enforces completeness: S0 extracts the list of changed exported symbols
from the dependency diff, and S3's output must disposition every symbol.

### S4 Deletion review (protocol step 5)

Input: deleted files/hunks list + `bundle/base/` copies. Instruction: for
every deletion state what behaviour the removed code provided, search the
worktree for who depended on it, flag removed guards/awaits/cleanups/error
handlers. Output: candidate findings and per-deletion clears.

### S5 Finding verification (protocol step 6) - FRESH SESSION

Input: candidate findings only (file, lines, issue, mechanism, quoted
claim). No S2/S3 reasoning is passed. Instruction per finding:

1. Open the actual file at the cited lines in the worktree; quote the code.
2. Confirm quoted code, line numbers, and mechanism match exactly. Line
   numbers must come from the checked-out file, never the diff.
3. Hunt neutralizing context: guards, defaults, narrowing, upstream
   handling in surrounding function, callers, types.
4. Confirm severity against the ruleset's severity definitions.
   Verdict per finding: verified (with quotedCode + confirmed lines), killed
   (with reason), or open_question (with what would resolve it). App code then
   re-checks mechanically: the cited lines exist in the file, and quotedCode
   matches the worktree file at those lines once both sides are normalised.
   Normalisation forgives only what carries no meaning: CRLF, trailing
   whitespace, a trailing newline, and lost common indentation. Anything
   looser would let a paraphrase pass as a quotation. A mechanical mismatch
   kills the finding regardless of the AI verdict.

### S6 Coverage self-audit (protocol step 7; deterministic + AI summary)

App code asserts the invariants: all hunks dispositioned, all sweep hits
dispositioned, all deletions reviewed, all candidates resolved. Any
violation fails the review (it is a pipeline bug, not a warning). S6 is
deterministic only: the summary and completeness statement are rendered
from the reconciled ledger, not written by a model, because a model
summarising its own coverage is exactly the claim this app exists to
distrust (D-52). Review moves to `awaiting_confirmation`.

## 2. S7 Human confirmation (UI, the user only)

Verified findings and open questions are presented one by one: finding
fields, quoted code with surrounding context from the worktree, the diff
hunk, mechanism, rule text it violates. Actions: confirm, dismiss (reason
required, stored), edit-then-confirm (comment wording only; file/lines are
immutable post-verification). Bulk actions exist only for dismiss-by-rule.
Nothing reaches the report without an explicit confirm.

## 3. S8 Report (deterministic)

Rendered from confirmed findings in the protocol's Review Output Format:
summary, completeness check (ledger totals: files, hunks, sweeps, chains
read), findings grouped by severity in the exact finding format, out of
scope notes, final verdict line. Confirmed NITPICK findings are included
(D-11 supersedes the earlier exclusion: a confirmed finding is a decision
the human already made). Dismissed findings appear in an appendix with
their reasons. Export: markdown file to `exports/`
and clipboard. The report footer records: model, ruleset snapshot names and
versions, commits reviewed, token usage, duration. No em dashes anywhere in
generated output (enforced by a lint on the renderer and a unit test).

## 4. Prompt composition

Order: (1) process directives (prime directive, junior-dev standard,
procedure for this stage, scope rule, severity model), (2) rule database
verbatim (S3 only; S1/S2/S4/S5 get the directives plus the rule index of
codes+titles), (3) stage instruction, (4) output contract with the JSON
schema inlined. Composition is a pure function, `composeSystemPrompt` in
`lib/rulesets/compose.ts`, covered by explicit assertions on the composed
text rather than by snapshots.

**How the work is divided depends on the model's review profile**
(`06-MODELS-AND-PROFILES.md`). `full-context` sends the whole ruleset and
whole change set at once; `chunked` runs the adversarial pass once per rule
theme over file groups; `decomposed` narrows further to per-file prompts
carrying only the rules whose tags match that file's tech. The completeness
invariant is identical on every profile: the app tracks which (rule, hunk)
pairs each request covered and refuses to leave S3 until the union covers
every enabled rule against every hunk. Rules are never summarised or dropped
to fit a window, and truncation is never silent (workspace law); the app
splits the work instead and records the split in the run log.

## 5. Failure, pause, resume, cancel

- Stage failure after repair round: review `failed` with full error detail.
  Recovery is by resuming the review rather than retrying one stage (D-50):
  stages already answered replay for free from their checkpoints and only
  the failed one runs live, which is the same mechanism as a limit pause.
- CLI limit/429: review `paused_limit`, CLI message shown verbatim, manual
  resume re-invokes the stage with `--resume <sessionId>`.
- Cancel: kills the subprocess, marks stage cancelled; worktree and
  completed-stage results are kept so restart is cheap.
- Server restart: running reviews become `interrupted`; resume re-runs the
  interrupted stage only.

## 6. Engine quality gate (the app's own proof)

A fixture repository with a seeded feature branch ships in `tests/fixtures`
(built by script, committed as a bundle). Seeded defects map to expected
findings (the seed manifest). The pipeline gate (run in e2e with the fake
engine, and manually pre-release with the real engine):

- every seeded defect is found or explicitly surfaced as an open question;
- zero findings survive S5 whose quoted code does not match the file;
- the coverage invariants hold.
  This gate is the app's definition of "the reviewer works", and it runs
  against every change to prompts, composition, or pipeline code.
