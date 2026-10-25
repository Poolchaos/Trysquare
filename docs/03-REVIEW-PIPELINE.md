# 03 Review pipeline

Status: RATIFIED 2026-07-30 at G0. This is the engine
specification: how a review executes the maintainer's protocol as verifiable stages.
The protocol's mandatory execution procedure (REVIEW_PROTOCOL.md) is the
source; this doc maps each protocol step to either deterministic app code or
a bounded AI stage. Principle: **everything that can be deterministic is
deterministic; the AI does judgment, code does bookkeeping.**

## Not built yet

This document specifies the target. Verified against the code on 2026-10-23,
these parts of it do not exist yet. They stay here as requirements rather
than being edited away.

- Sweeping whole changed files where the protocol asks for it (section 0.4).
  Sweeps run over added lines only (`lib/review/sweep.ts`), and a rule has
  no way to ask for more. Unowned.
- Bulk dismissal by rule (section 7). A finding is dismissed one at a time,
  by id. Unowned: U7 built the rule text and the diff hunk in confirmation
  and did not take this on.

Trued up 2026-10-23: three items listed here since 2026-08-03 are built and
gone from this list. S4 reads each deleted file's pre-change copy from
`base/` (U3), its `reviewedDeletions` are reconciled against the files it
was shown and a file closes only on that evidence (U3), and the stages after
S1 work its risk-tagged files first (U12).

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
   `<slug>/<repo-relative-path>`. What each checkout reports changed when
   it is made, and those files' content, is kept in
   `runs/<id>/worktree-baseline/<slug>.json` for the end check (D-107).
3. Build the **bundle** under `runs/<id>/bundle/`:
   - `diff.patch` (and `diff-linked.patch`): full text per repo, taken
     with the user's diff config overridden (external tools, textconv,
     prefixes, submodule display, the diff algorithm) and refused unless it
     names exactly the files `git diff --name-only` lists (D-108, D-110)
   - submodule pointers and Git LFS pointer files in the change set are
     named in the run notes as not reviewed: the diff holds only the pointer
     (4.23). An LFS file is known by either side of its first hunk reading
     as a whole pointer from line 1 (version line first, an oid and a size,
     nothing else), not by a line mentioning the spec (D-119 review)
   - `inventory.json`: every changed file and hunk across both repos
     (parsed by `lib/git`), repo-tagged, including renames and deletions,
     and a typechange (a symlink becoming a file, or the reverse) as one
     modified file rather than git's deletion and addition at one path (D-127);
     this seeds ledger_files/ledger_hunks
   - `base/<slug>/<path>`: pre-change copies of every modified and deleted
     file (from each repo's merge base)
   - `links.json`: package-to-worktree mapping from project_links, e.g.
     `{"@acme/shared-core": "shared-core/"}`, so stages resolve imports of
     the package to the linked worktree source instead of node_modules
   - `stats.json`: per-repo and combined counts
4. Run the **mechanical sweeps**: for every enabled rule with sweepPatterns,
   run the regexes over changed files' added lines (and whole changed files
   where the protocol says so). Persist every hit as a sweep_hit (pending),
   one per rule and line, named by the first of its patterns that matched:
   a hit is dispositioned by path, line and rule, so a second pattern's hit
   could never be reached (audit finding 11, D-204).
   Sweeps are implemented in Node (read the file, apply the regex), NOT by
   shelling out to ripgrep: `rg` is not guaranteed to exist as a binary (on
   the maintainer's machine it is a shell function from an editor integration and is
   absent in non-interactive processes), and a sweep that silently returns
   nothing would break the coverage guarantee while looking green. Sweep
   coverage is asserted by unit tests against fixtures with known hits. The
   AI never runs its own sweeps.
5. Compose the **ruleset snapshot**: process directives + enabled rules,
   full verbatim text, ordered; freeze into review_rulesets.snapshotJson.
6. Run the **project's own checks**, when a person turned them on for the
   project (WP-I, D-191, D-192, D-196): a throwaway clone of the project's
   clone, checked out at fromCommit, apart from the review's read-only
   worktree; in it, install, then tests, then e2e, each that is set,
   through the platform's shell, with the person's environment less the
   app's and Claude's, each under a 20-minute limit after which, or on a
   cancel, its whole process tree is killed. A failed install stops the
   rest. Each command's output is kept in `runs/<id>/checks/logs`, the
   screenshots an e2e saved in its folder are copied to
   `runs/<id>/checks/screenshots`, each with the sha256 of its bytes, at
   most 200 in order of name and none over 8 MiB; a name the app could not
   list in a grading request or find again (a line break, ": ", a
   backslash, a drive, a space at either end) is left out, as is a folder
   that resolves outside the copy, each said in a run note, as is a
   screenshot the CLI's Read will show scaled down, past 2000 pixels on a
   side (D-201); the result is kept as
   `runs/<id>/checks/result.json`, a run note says each command's outcome,
   and the copy is removed, or, when something still holds it, said in a
   run note and left for the next run (D-217). A resume reuses the result for the same commit
   and the same checks, unless it was kept before the design standard, the
   hashes and the scaling notes were, when they run again. The dependency of a linked review
   is not run.
   A command that fails, or stops at its limit, is a check finding
   (D-197), proven by the app from its exit code and its output.

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
  carries into the adversarial pass, each under its own system prompt:
  every stage passes `--system-prompt-snapshot off`, without which 2.1.301
  sends a resumed call the session's first system prompt (D-182). S5
  verification always runs in a **fresh session** with no access to the
  reasoning that produced the findings; independence is the point
  (protocol step 6).

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
consumer files checked. A finding at a consumer the branch never touched is
kept when a symbol whose verdict is finding names that file among its
consumers checked; it accounts for no hunk and faces the quote check like
any other (D-181, amending D-60). The protocol's backwards-compatibility section
applies across the repo boundary exactly as within one repo. App code
enforces completeness: S0 extracts the list of changed exported symbols
from the dependency diff, and S3's output must disposition every symbol.

### S4 Deletion review (protocol step 5)

Input: deleted files/hunks list + `bundle/base/` copies, a deleted file's
lines numbered as a finding in it must cite them (D-106). Instruction: for
every deletion state what behaviour the removed code provided, search the
worktree for who depended on it, flag removed guards/awaits/cleanups/error
handlers. Output: candidate findings and per-deletion clears.

### S4b Design grading (WP-I, D-191, D-192, D-198) - FRESH SESSION

Asked only when the project's own checks are on and its e2e saved
screenshots (S0 step 6). The review's model grades every screenshot A to D
by looking at it, against the scale (A ready, B minor polish, C visibly
off, D broken or misleading) and the project's design standard when one
is named, its text read from the copy and capped at 50,000 characters, and
only a file inside the copy, so a committed symlink cannot put a file from
elsewhere into a prompt; a run note says when it is not a file there, and
when it was cut. Eight screenshots a request, each listed by its name, its
path and the sha256 of its bytes, so a resume after the e2e saved another
image asks again rather than replaying a grade of the old. The stage may
read the screenshots' folder and nothing else outside its checkout:
`--add-dir` names that folder, the tools stay Read, Grep and Glob (D-198).
Each grade says whether the grader opened the image, and the engine sees
every file the session opened with Read. App code then checks that every
screenshot asked about was opened and graded exactly once, the opening
seen in the session, not taken on the grader's word, and that a C or D
says what is off, refusing the answer otherwise: a screen that could not
be opened is a failed stage, never a D nobody saw (round 9). A replayed
answer was checked when it was given; Mode B's terminal is not watched, so
there the grader's word stands alone. A C is a
WARNING, a D a CRITICAL: each a check finding of kind design (D-197), its
evidence what is off and where, its screenshot kept by name.

### S5 Finding verification (protocol step 6) - FRESH SESSION

Input: candidate findings only (file, lines, severity, issue, mechanism, the
finder's comment and the rule code it cites), with each cited rule's text
verbatim, once however many cite it (proof-and-steps plan, WP-C). The finder
gives no quotation to pass on. No S2/S3 reasoning is passed. Instruction per
finding:

1. Open the actual file at the cited lines in the worktree; quote the code.
   A file the change deleted is not there: its contents before deletion
   come with the prompt, once per file however many candidates cite it,
   and the quotation is checked against them (D-106, D-110).
2. Confirm quoted code, line numbers, and mechanism match exactly. Line
   numbers must come from the checked-out file, never the diff.
3. Hunt neutralizing context: guards, defaults, narrowing, upstream
   handling in surrounding function, callers, types.
4. Judge whether the rule the finding cites applies to this code, a finding
   citing no rule against the protocol's directives (D-188), and confirm
   severity against the ruleset's severity definitions.
   Verdict per finding: killed (with reason), open_question (with what would
   resolve it), or verified, which must carry its proof (proof-and-steps
   plan, WP-C): whether the cited rule applies, its own severity, the
   trigger, the evidence, an ordered path of steps from the trigger to the
   failure, each a file, its lines and the code there quoted, one step at
   the cited code and the path free to go on to where the failure shows,
   and where it searched for a guard. App code then re-checks
   mechanically: a rule that does not apply refutes the finding; a step is
   in the cited file and overlaps the cited lines, the finding taking its
   lines from that step (D-99, D-194); and every step's quotation matches
   the worktree file (a deleted file's copy before deletion) at its lines
   once both sides are
   normalised, the first that does not naming itself in the note. The
   verifier's severity stands, the finder's kept beside it (PG-3, D-185);
   the proof is stored with the finding.
   Normalisation forgives only what carries no meaning: CRLF, trailing
   whitespace, a trailing newline, lost common indentation, a byte-order
   mark at the start of the file, and the width the file's tabs were shown
   at, one width for every line so nesting still counts (D-114, D-115).
   Anything
   looser would let a paraphrase pass as a quotation. A mechanical mismatch
   kills the finding regardless of the AI verdict.

### S5b Second verification (WP-E, D-185, D-188) - FRESH SESSION

Every finding S5 proved, and whose proof the program's checks held, is held
unmarked and asked about again on the other strong family: an Opus review by
claude-fable-5-1, any other by claude-opus-5-5, frozen on the review as
`verifier_model` when it first runs. Same contract and checks as S5, under
the same labels, and not shown S5's proof, which is what makes it
independent. Both proofs holding verifies the finding, S5's severity
standing and S5b's proof kept beside it (`second_proof_json`); anything
else, a refutation, an open question, a rule it says does not apply, a
proof that does not hold, or no verdict, makes it an open question that
names the second verifier and why, so neither verifier overrides the other.
With nothing proven by S5, S5b is not asked. A stage of its own, so it is
checkpointed, replayed on resume and named in the run view.

### S5c Second grading (WP-I) - FRESH SESSION

Every screenshot S4b graded C or D, graded again by the paired model under
the same names, not shown the first grades, with the same folder readable.
Both C or D proves it: verified, the first grade standing, the second's
noted ("Graded D again by the second grader, <model>: ..."). An A or B
leaves it an open question naming the second grade, one grader not
overriding the other (D-188). Not asked when nothing was graded C or D.

### S6 Coverage self-audit (protocol step 7; deterministic + AI summary)

App code asserts the invariants: all hunks dispositioned, all sweep hits
dispositioned, all deletions reviewed, all candidates resolved. Any
violation fails the review (it is a pipeline bug, not a warning). S6 is
deterministic only: the summary and completeness statement are rendered
from the reconciled ledger, not written by a model, because a model
summarising its own coverage is exactly the claim this app exists to
distrust (D-52). Review moves to `awaiting_confirmation`.

A finding accounts for the hunks its first or last cited line falls in, and
a sweep hit dispositioned as a finding needs a finding whose lines include
it (D-96, D-101). A deleted file has no lines to cite, so S3 accounts for
its hunk only by clearing it. A finding in a file outside the change set
refuses the S3 answer, except at a consumer a finding verdict named (D-181).
A hunk or hit whose every finding S5 refuted
stays accounted for, but the statement of what was examined counts it, and
the review page lists every refuted finding with its reason (D-97).

## 2. S7 Human confirmation (UI, the user only)

Verified findings and open questions are presented one by one: finding
fields, quoted code with surrounding context from the worktree, the diff
hunk, mechanism, rule text it violates. Actions: confirm, dismiss (reason
required, stored), edit-then-confirm (comment wording only; file/lines are
immutable post-verification). Bulk actions exist only for dismiss-by-rule.
Nothing reaches the report without an explicit confirm, and only a proven
(verified) finding can be confirmed: an open question is dismissed, or
verified again, never confirmed (PG-2 (a), D-185). Verifying again asks S5
about that one finding in a fresh session, never replayed from a stored
answer, and holds the answer to the same checks (proof-and-steps plan,
WP-D2). The card says what that request costs, the model, the billing
and the stage timeout, and sends nothing until Send request is pressed.
It counts against the reviews at once, and while it runs its finding
cannot be decided nor its review completed or deleted;
the card shows the
verifier's proof, and the finder's severity where the verifier's differs.

## 3. S8 Report (deterministic)

Rendered from confirmed findings in the protocol's Review Output Format:
summary, completeness check (ledger totals: files, hunks, sweeps, chains
read), findings grouped by severity in the exact finding format, out of
scope notes, final verdict line. Confirmed NITPICK findings are included
(D-11 supersedes the earlier exclusion: a confirmed finding is a decision
the human already made). Dismissed findings appear in an appendix with
their reasons, those left out unproven (dismissed open questions) under
their own heading, apart from the ones a person rejected (D-190). Export: markdown file to `exports/`
and clipboard. The report footer records: model, ruleset snapshot names and
versions, commits reviewed, token usage, duration. No em dashes anywhere in
generated output (enforced by a lint on the renderer and a unit test).

## 4. Prompt composition

Order: (1) process directives (prime directive, junior-dev standard,
procedure for this stage, scope rule, severity model), (2) rule database
verbatim (S3 only; S1/S2/S4/S5 get the directives plus the rule index of
codes+titles, and S5 the text of each rule a candidate cites in its prompt), (3) stage instruction, (4) output contract with the JSON
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
- A resume reuses the ledger seeded on the first run only when it is the
  change read now: the same files, the same hunks at the same lines, and
  the same sweep hits, rule by rule and line by line (D-220). Otherwise
  it was seeded in part, or by a version of the app that read the change
  differently, and the resume is refused, asking for the review to be
  started again (D-205).

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
