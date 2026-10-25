# Decision log

Dated, append-only. Any choice that would otherwise be re-litigated (stack,
data source, architecture, naming) gets an entry with the reason and the
alternatives rejected. DECIDED items are settled; challenge only with new
verified evidence, in writing, here.

- 2026-07-30 DECIDED: Workspace follows the maintainer's established convention
  family: markdown-and-shell workflow (charter + docs tree + one `verify.sh`
  gate), no `.claude/` agent tooling. Reason: proven pattern across the maintainer's
  other projects; both reference repos were investigated on this date.
  Rejected: Claude Code hooks/skills/commands setup (neither reference project
  uses them; can be added later if a rule needs hard enforcement).
- 2026-07-30 DECIDED: `docs/README.md` is the canonical doc index name (the
  established convention) rather than a separate `INDEX.md`.
- 2026-07-30 DECIDED: `verify.sh` is created with the first code commit, not
  during setup, because the stack is unknown until the brief lands.
- 2026-07-30 DECIDED (feasibility): reviews run on the Claude Code
  subscription via headless `claude -p`; same usage limits as interactive
  chat, no additional billing. Evidence: official support article (June 16,
  2026 update: credit-pool change paused, "claude -p and third-party app
  usage still draw from your subscription's usage limits") plus a successful
  live probe on the maintainer's login this date. Agent SDK with subscription OAuth
  remains disallowed, so the app drives the CLI. Engine is an adapter
  (headless Mode A primary, interactive Mode B fallback) so future policy
  changes stay absorbable. Details in `plans/APP-PLAN.md` section 0.
- 2026-07-30 DECIDED: local web app started by command; no Electron/Tauri
  shell. (maintainer)
- 2026-07-30 DECIDED: stack is Next.js + TypeScript + SQLite (Drizzle) +
  Tailwind, Vitest unit, Playwright e2e. Matches the maintainer's established tooling. (maintainer)
- 2026-07-30 DECIDED: rulesets are structured per-rule records plus process
  directives, seeded by a fidelity-gated import of `REVIEW_PROTOCOL.md`
  (round-trip diff proves completeness, kept as a permanent unit test);
  markdown export for sharing. Choice delegated to the AI by the maintainer;
  rejected: whole-document rulesets (no per-rule composition or severity).
- 2026-07-30 DECIDED: per-review model dropdown; unavailable models shown
  disabled in the picker, availability probed. (maintainer)
- 2026-07-30 DECIDED: review model options are Opus and Fable only, chosen
  for reliability; first-run default Fable (1M context), then last-used.
  (the maintainer; default choice by the AI)
- 2026-07-30 DECIDED: the build will be driven by Opus in Claude Code,
  executing `plans/BUILD-PLAN.md` work package by work package under this
  workspace's charter. (maintainer)
- 2026-07-30 DECIDED: the model picker lists what the account probed
  available (not a hardcoded pair), with Fable and Opus 5 flagged as
  recommended for review. Full model ids only: probing proved `opus` and
  `sonnet` aliases resolve to the previous generation (4.6) and `fable` is
  not an alias at all. Evidence in `06-MODELS-AND-PROFILES.md`. (maintainer)
- 2026-07-30 DECIDED: the pipeline's delivery strategy is model-dependent
  (review profiles: full-context, chunked, decomposed, mechanical-only),
  because a weaker model cannot absorb the whole protocol at once. Rules are
  never summarised or dropped to fit; the app splits the work and enforces
  that the union of requests covers every rule against every hunk. Reason:
  the maintainer, "Fable I can give this full document and will get great results,
  but I can't say the same about sonnet." Rejected: one fixed pipeline for
  all models (fails weak models silently), and per-model rule pruning
  (breaks the completeness requirement).
- 2026-07-30 DECIDED (mechanism, from measurement): every spawned `claude`
  process has `CLAUDECODE` scrubbed from its environment, or the CLI refuses
  to run nested; and every spawn passes an explicit `--system-prompt` plus a
  minimal `--tools` list, which cut a probe from $0.0748 to $0.0007
  cost-equivalent. Evidence in `06-MODELS-AND-PROFILES.md`.
- 2026-07-30 DECIDED (from measurement, WP-A): no code path may depend on
  `rg`. It is a shell function from an editor integration on this machine,
  not a binary, so it is absent in non-interactive scripts. The first
  house-style gate used `rg` with stderr suppressed and therefore passed a
  deliberate violation; it was rewritten in Node
  (`scripts/check-style.mjs`) and now fails correctly. The review pipeline's
  mechanical sweeps are likewise Node-implemented (`03` section 0.4).
  Rejected: keeping `rg` with a PATH check, since Node is already a hard
  dependency and needs no guard.
- 2026-07-30 DECIDED (WP-A): vitest runs with `disableConsoleIntercept: true`
  so console output reaches stdout where `verify.sh` can scan it for runtime
  error markers. With the default interception the gate was blind to
  anything a test printed.
- 2026-07-30 ACCEPTED RISK (WP-A): 9 high advisories remain, all the same
  `brace-expansion` DoS (GHSA-mh99-v99m-4gvg) reached through minimatch 3.x.
  The advisory patches only 5.0.8, whose export shape is incompatible with
  minimatch 3.x's CommonJS API: forcing it breaks eslint outright (verified).
  minimatch 3.x arrives via eslint itself and via eslint-plugin-import,
  jsx-a11y, and react inside eslint-config-next, so no upgrade removes it
  today. It is a lint-time dev dependency, never reached by app runtime or
  reviewed-repo content. Re-check when those plugins upgrade minimatch.
  postcss, sharp, and the esbuild-kit esbuild advisories WERE fixed by
  overrides in `package.json`.
- 2026-07-30 DECIDED: linked reviews are in scope for v1: a project can
  declare dependency projects (consumer -> package, e.g. app -> shared-core);
  a review can optionally include the dependency's branch pair, producing
  one combined ledger with mandatory cross-repo consumer verification of
  every changed exported symbol. Same-name dependency branches are
  suggested, never auto-included. (the maintainer; mechanism by the AI)
- 2026-07-30 DECIDED: review history kept per (project, from-branch,
  into-branch); merged reviews user-deletable with a merged badge and
  cleanup affordance, never auto-deleted silently. (maintainer)
- 2026-07-30 DECIDED: the project is published publicly as Trysquare under the
  MIT licence at github.com/Poolchaos/Trysquare. Name chosen for fit (a try
  square verifies that work is genuinely square rather than merely looking
  square) and for clearance: free on npm and PyPI, no software trademark or
  existing project found. Rejected: Diffwright (cleaner clearance, but a
  "wright" makes things rather than examines them), Straightedge (search
  collides with the music subculture), Assize (PyPI name taken, easily
  mispronounced). MIT rather than Apache-2.0: this is a small tool that wraps
  a vendor CLI rather than a patentable system, and MIT keeps contribution
  friction lowest.
- 2026-07-30 DECIDED: private working material lives in `docs/private/`, which
  is gitignored AND enforced by an executable gate
  (`scripts/check-no-private.mjs`, run by verify.sh) that inspects the files
  git tracks or has staged. A .gitignore line alone is not a control: it is
  one `git add -f` away from publishing a client document. The gate is proven
  to fire on a force-added private file, a proprietary marker in a staged
  file, and this machine's home directory path.
- 2026-07-30 DECIDED (from the pre-publication audit): the ruleset import
  fidelity gate runs against a committed public sample
  (`tests/fixtures/example-protocol.md`), never against a private document. A
  test whose input is gitignored would make `./verify.sh` unrunnable for every
  contributor and turn the single definition of "verified" into something only
  one machine can produce.
- 2026-07-30 DECIDED (WP-B): `rules.code` is UNIQUE per ruleset at the
  database level, not merely indexed. A duplicate code would make
  `findings.ruleCode` ambiguous and would run that rule's sweep patterns
  twice, and without the unique constraint an idempotent importer has no
  valid ON CONFLICT target. The initial migration was regenerated rather
  than amended by a second one, which is safe only because no database
  exists anywhere yet. Once any database exists, migrations are append-only.
- 2026-07-30 DECIDED (WP-B): the audit gate `assertCoverageComplete` checks
  all four conditions in `03-REVIEW-PIPELINE.md` S6: hunks dispositioned,
  sweep hits dispositioned, changed files reviewed, and candidate findings
  resolved. The file check is load-bearing on its own because a deleted or
  renamed file has no hunks, so checking hunks alone would let a whole
  deleted file pass the gate unreviewed, which is the exact regression class
  the deletion stage exists to catch.
- 2026-07-30 DECIDED (WP-B): `deleteProject` counts reviews that reference a
  project either as the primary or as the linked dependency. Counting only
  owned reviews let a shared package be deleted while a linked review still
  depended on it, surfacing a raw SQLite foreign-key error instead of the
  actionable one the UI needs to offer bulk deletion.
- 2026-07-30 DECIDED (WP-C): the diff parser is fixtured against output from a
  real git binary rather than hand-written patches. This immediately paid for
  itself: mode-only changes and binary files emit no `---`/`+++` lines at all,
  so the first implementation dropped them from the inventory entirely, which
  is the silent-skip failure the coverage ledger exists to prevent.
- 2026-07-30 DECIDED (WP-C): changed-symbol detection also attributes context
  lines and the hunk header's enclosing declaration, not just added and
  removed lines. Renaming a field inside an exported interface never touches
  the `export interface` line, so a purely line-based scan missed the single
  most dangerous cross-repo contract change: one that still compiles where it
  is declared and only breaks at the consumer. The scan deliberately
  over-reports; a spurious symbol costs one disposition, a missed one costs a
  contract nobody checked.
- 2026-07-30 DECIDED (WP-C): git URLs are validated before use, rejecting the
  `ext::` and `fd::` transports (which execute an arbitrary command) and any
  URL beginning with a dash (which git parses as an option). Arguments are
  always passed as an array, never through a shell, and `--` separates
  options from operands on clone.
- 2026-07-30 DECIDED (WP-E): every stage and probe passes
  `--setting-sources user` and `--strict-mcp-config`. Verified by experiment:
  a repository carrying a CLAUDE.md saying "end every reply with BANANA"
  changed the model's output without these flags and did not with them. A
  repository under review is untrusted input and must not be able to instruct
  its own reviewer. Kept honest by a real-CLI regression test that plants the
  instruction. Rejected: relying on the review prompt to tell the model to
  ignore repository instructions, which is exactly the kind of prose-only
  control the charter says to replace with an executable one.
- 2026-07-30 DECIDED (WP-E): stages replace the default system prompt with
  `--system-prompt` rather than appending. The review's instructions are the
  entire contract, and the default prompt also costs thousands of tokens per
  call.
- 2026-07-30 DECIDED (WP-E): a probe distinguishes unavailable from
  indeterminate. A timeout or transport failure leaves availability unknown
  instead of marking a model unavailable, because greying a working model out
  of the picker on one slow call would be both wrong and hard to notice.
- 2026-07-30 FIXED (WP-E, from measurement): child processes must have stdin
  closed. `execFile` leaves it open, and the CLI waits on it, so every probe
  hung for its full timeout (60s observed) instead of answering in about a
  second. The CLI also reports a rejected model as a result event on stdout
  while exiting non-zero, so stdout is parsed before the exit code is
  consulted; stderr is empty in that case.
- 2026-07-30 DECIDED (WP-E): every stage and probe passes
  `--setting-sources user` and `--strict-mcp-config`. Verified by experiment:
  a repository carrying a CLAUDE.md saying "end every reply with BANANA"
  changed the model's output without these flags and did not with them. A
  repository under review is untrusted input and must not be able to instruct
  its own reviewer. Kept honest by a real-CLI regression test that plants the
  instruction. Rejected: relying on the review prompt to tell the model to
  ignore repository instructions, which is exactly the prose-only control the
  charter says to replace with an executable one.
- 2026-07-30 DECIDED (WP-E): stages replace the default system prompt with
  `--system-prompt` rather than appending to it. The review's instructions are
  the entire contract, and the default prompt also costs thousands of tokens
  on every call.
- 2026-07-30 DECIDED (WP-E): a probe distinguishes unavailable from
  indeterminate. A timeout or transport failure leaves availability unknown
  rather than marking a model unavailable, because greying a working model out
  of the picker on one slow call would be both wrong and hard to notice.
- 2026-07-30 FIXED (WP-E, from measurement): child processes must have stdin
  closed. `execFile` leaves it open and the CLI waits on it, so every probe
  hung for its full timeout (60s observed) instead of answering in about a
  second. The CLI also reports a rejected model as a result event on stdout
  while still exiting non-zero, so stdout is parsed before the exit code is
  consulted; stderr is empty in that case.
- 2026-07-30 DECIDED (WP-E): engine tests run against a fake CLI committed at
  `tests/fixtures/fake-claude.mjs`, so the suite is hermetic and spends no
  model usage. A fake only proves the code agrees with our beliefs about the
  CLI, so an opt-in real-CLI suite (TRYSQUARE_REAL_CLI=1) checks the beliefs.
- 2026-07-30 FIXED (WP-E, found by CI): the stage transcript write stream had
  no error handler, so a stream failure became an uncaught exception. CI's
  timing exposed it (the temp directory was removed while the stream was still
  opening, giving ENOENT); locally it never fired. In the running app the same
  fault would take down the server rather than fail one stage. The stream now
  has a handler, and a lost transcript is reported on the stage outcome without
  aborting the run, since the transcript is evidence rather than the review
  itself. This is why CI runs the same gate rather than a reduced one.
- 2026-07-30 DECIDED (WP-D): the protocol importer keeps each block's verbatim
  markdown alongside its parsed fields. The parsed fields drive composition;
  the raw text is what proves the import lost nothing, via a byte-exact round
  trip against the source document. Without that, an importer that silently
  failed to understand a rule would produce a review claiming to apply a
  protocol it had partly discarded.
- 2026-07-30 DECIDED (WP-D): rule text reaches the model verbatim. Summarising
  a rule to save tokens would change what is being checked while looking like
  an optimisation.
- 2026-07-30 DECIDED (WP-D, correcting docs/06): the completeness invariant is
  "every rule/file pair is either checked or recorded as deliberately
  excluded", not "every rule against every file". The stricter wording was
  incoherent: the decomposed profile narrows by technology, so a React rule is
  never applied to a markdown file. Narrowing is legitimate; narrowing
  invisibly is not, so `planRuleBatches` returns the exclusions with reasons
  and `assertBatchesCoverEverything` refuses any pair that is neither covered
  nor named. Only the decomposed profile may exclude anything at all.
- 2026-07-30 FIXED (WP-D): a scripted edit wrote a NUL byte into
  `compose.ts`, replacing the separator in a coverage key. Every key looked
  correct in an editor and matched nothing at runtime, so a complete plan was
  reported as covering none of its pairs. Two changes came out of it: the key
  is now built by one shared `pairKey` function used by both producer and
  consumer, and `check-style.mjs` fails on any control character in a source
  file, proven by deliberately planting one.
- 2026-07-30 DECIDED (WP-F): the pipeline reconciles each stage's answer
  against what it was given, in both directions. Something unaccounted for
  means work was skipped while the review looked complete; something reported
  that was never asked for means the stage is describing a change set that
  does not exist, which makes the rest of its output unsafe to trust. Both
  fail the run.
- 2026-07-30 DECIDED (WP-F): a verified finding is byte-checked against the
  file it cites before it is stored as verified. The verification stage says
  it opened the file and quotes what it found; the program then confirms that
  quotation really is what stands at those lines. A mismatch kills the finding
  regardless of the verifier's confidence, because a citation that does not
  match the code is not evidence. The comparison forgives only what carries no
  meaning (trailing whitespace, a trailing newline, lost common indentation,
  carriage returns), since anything looser would let a paraphrase pass as a
  quotation.
- 2026-07-30 DECIDED (WP-F): a candidate the verification stage never ruled on
  becomes an open question, never a silent pass. Verification returning fewer
  verdicts than it was given findings is a gap, and a gap must be visible.
- 2026-07-30 DECIDED (WP-F): the stage runner is injected. The real one spawns
  the CLI; tests supply a scripted one, so the orchestration is exercised end
  to end against answers that are wrong, incomplete, or invented, without
  spending model usage or depending on what a model happens to say today.
- 2026-07-30 DECIDED: all remaining work is sequenced in
  `plans/EXECUTION-ORDER.md` as a standing execution order (T1-T19) with
  founder gates FG-2/FG-3/FG-4 as the only stopping points and decisions
  D-1..D-20 pre-resolved so the driver does not ask between gates. Two of
  those decisions adjust earlier records: D-11 (a report includes every
  finding the human confirmed, NITPICKs included, because a confirmed finding
  is a decision already made) and D-12 (the review worktree is removed when a
  review reaches a terminal status rather than at pipeline end, so the
  confirmation screen can show real file context).
- 2026-07-30 DECIDED (T1): stage prompts give post-change line numbers on
  every line rather than leaving the model to count them. Counting is exactly
  where citations drift, and a drifted citation is what the quotation check
  then has to kill. Removed lines get no number, since they are not in the
  file a finding would cite.
- 2026-07-30 DECIDED (T1): the toolset is re-checked on every stage call, not
  once per review. A session that gained a tool part way through would
  otherwise pass unnoticed.
- 2026-07-30 DECIDED (T2): exactly one repair round, in the same session,
  quoting the precise validation errors and instructing the model to fix only
  the shape and change no judgement. Refusing to ask at all wastes a whole
  stage over a missing field; asking twice is how a stage becomes an argument
  that burns the budget. Usage from both attempts is summed, so a failure does
  not understate what the review cost.
- 2026-07-30 DECIDED (T3): a sweep hit dispositioned as a finding must match a
  finding in the same file, chosen by line containment and then by nearest
  line. Attaching an empty id, as the first implementation did, left a hit
  that reads as handled in the ledger and points at nothing, which is worse
  than an open hit because it cannot be traced.
- 2026-07-30 DECIDED (T4): how a run divided its work is recorded on the
  review itself, in an append-only `run_notes` column: which batches were
  split to fit the context window, which rule/file pairs a narrowing profile
  did not check, and any prompt too large to fit even alone. A run that
  quietly did less than another would otherwise be indistinguishable from it.
- 2026-07-30 DECIDED (T4): a prompt too large to divide further is sent
  anyway and reported, rather than being trimmed or skipped. Being told by the
  model that a request is too large is recoverable and visible; deciding here
  not to review a file is neither.
- 2026-07-30 DECIDED (T4): with no probed context window the pipeline makes
  one request per batch and does not split. Guessing at a limit would either
  waste requests or fail anyway, and the model's own refusal is a clearer
  signal than a number invented in the app.
- 2026-07-30 DECIDED (T5): a changed exported symbol in a linked dependency
  has three possible verdicts, not two: all consumers verified, no consumers
  found, or a finding. Folding "no consumers" into "all verified" with an
  empty list would have made the check meaningless, because the app could no
  longer tell looking-and-finding-nothing apart from not looking. A newly
  exported symbol genuinely has no consumers, and that answer stays available
  without weakening the other two.
- 2026-07-30 DECIDED (T5): each symbol verdict must carry the evidence it
  claims. "All consumers verified" must name at least one consumer, and a
  "finding" verdict must be backed by a finding citing the symbol's file or a
  named consumer, which then faces the quotation check like any other. A
  verdict without evidence reads as handled and points at nothing.
- 2026-07-30 DECIDED (T6): the seeded fixture's manifest is derived, not
  written by hand. Each defect declares the text that identifies it, and the
  builder finds the line by locating that text in the file it just wrote. A
  hand-counted manifest would drift the first time a fixture file changed, and
  a drifted manifest fails the quality gate for the wrong reason.
- 2026-07-30 DECIDED (T6): a seeded defect declares how it arrives in the
  change: as added code, as removed code, or as neither. The third kind is the
  cross-repo case, where the defective line does not change at all and the
  contract underneath it does, in the other repository. Writing the fixture
  forced this distinction: the test first assumed every defect appears as an
  added line, which is false for a removed guard and false again for an
  unmigrated consumer. Those are the two defect classes a naive review misses,
  so the fixture models them explicitly.
- 2026-07-30 DECIDED (T6): the example protocol gained rules 9, 10 and 11
  (timezone-dependent date boundary, weakened test assertion, removed guard),
  because every seeded defect must have a rule to violate. A defect with no
  matching rule would test the model's instincts rather than the protocol,
  which is not what the gate is for.
- 2026-07-30 DECIDED (T7): the quality gate is driven by a reviewer built from
  the manifest rather than by a model, so it measures the pipeline rather than
  today's model behaviour. Whether a model finds these defects is a separate
  question, answered at FG-2 and again at T18 with the real engine; whether a
  correct review survives the pipeline intact is this gate's question, and it
  must be answerable without spending usage or waiting on a network.
- 2026-07-30 DECIDED (T7): the gate states plainly what the quotation check
  does and does not do. It catches misquotation, not misjudgement. A finding
  that is wrong but accurately quoted survives to the confirmation screen,
  because deciding whether a correctly quoted concern is real is the human's
  job. A test asserts each behaviour, so neither is mistaken for the other.
- 2026-07-30 DECIDED: T8, T9 and the FG-2 demo are planned to commit level in
  `plans/M2-FINISH-PLAN.md` (W1-W8), fixing the resume design in advance:
  stage outputs are checkpointed in `stage_executions` keyed by
  (stage, sha256(prompt)), S0 seeding is idempotent, and findings are wiped
  and deterministically recreated on re-entry. Chosen over making every
  pipeline write individually idempotent because findings are wholly derived
  from checkpointed outputs, so wipe-and-replay is exact, cheap, and leaves
  `runReviewPipeline` almost untouched. Rejected: re-running completed stages
  on resume (pays twice, and 01-ARCHITECTURE forbids it) and persisting a
  resumable program counter inside the pipeline (a second state machine to
  keep honest against the first).
- 2026-07-30 DECIDED (W1): the rules and process_directives tables store the
  verbatim markdown each record came from, alongside its parsed fields. Found
  while writing the unchanged-content check: a reload could never equal an
  import, because the parsed columns are a lossy view of what the author
  wrote. Storing the source makes the comparison honest, gives the rulesets
  screen an export that still matches its origin, and is now proven by a test
  that parses, stores, reloads and exports the example protocol byte for byte.
  Rejected: comparing only the persisted subset, which would have made the
  version-bump check quietly weaker than it appears.
- 2026-07-30 DECIDED (W1): stage_executions is the resume mechanism as well as
  the audit trail, so a stored answer is keyed by the hash of the prompt it
  answered, not by the stage alone. A stage whose prompt changed is a
  different request and runs live, which is what stops a resume replaying
  yesterday's answer to a question the review is no longer asking.
- 2026-07-30 DECIDED (W1): `deleteAllForReview` exists for the resume path
  alone and says so where it is defined. Findings are the record of human
  decisions, and deleting them anywhere else would destroy the one thing this
  app treats as authoritative.
- 2026-07-30 DECIDED (D-27, from the user): a review pins its commits from
  refs fetched moments earlier, never from whatever the last clone left
  behind. Creating a draft fetches every clone involved, including both
  sides of a linked pair, and only then resolves the branch tips. A stale
  pin is the worst failure this app can have: the run completes, the report
  reads as authoritative, and it describes code the branch has moved past.
  A fetch that fails blocks creation rather than falling back to stale refs.
  Recorded against T10 and surfaced in the T12 pre-flight, which shows when
  the refs behind the pins were fetched.
- 2026-07-30 DECIDED (D-28): the run-time fetch in the review service still
  never re-pins. Once a review exists it describes fixed commits, and a
  resume that quietly moved to a newer tip would review something other than
  what its findings already record, leaving the coverage ledger counting two
  different change sets.
- 2026-07-30 DECIDED (D-29): branch pickers fetch before listing and show
  how fresh the list is, with a manual refresh. Listing may fall back to
  cached refs when the remote is unreachable and must say so; browsing
  offline is reasonable, starting a review from stale refs is not.
- 2026-07-30 DECIDED (W2): the fake CLI resolves candidate placeholders
  against the prompt it was actually given, rather than emitting the sentinel
  finding id the plan proposed. The sentinel does not survive contact with the
  pipeline: a verdict whose finding id matches no candidate leaves that
  candidate stranded, and the pipeline marks stranded candidates as open
  questions. Every finding in a scripted run would have come back unresolved,
  so the service tests would have been asserting about a run in which
  verification effectively never happened. Resolving by place in the code
  keeps the answers writable in advance and still exercises the real
  verification path. An unresolved placeholder is a hard error naming the
  placeholder, because silently passing it through is the failure this
  replaces.
- 2026-07-30 DECIDED (W2): the fake gained FAKE_CLAUDE_RECORD_DIR, which
  records the argument vector of every call rather than only the last one.
  A run makes several calls and what a later one was told matters as much as
  what the first was; W3 needs this to prove a resumed stage rejoined the
  recorded session.
- 2026-07-30 DECIDED (W2): added `scripted-pipeline.test.ts`, which the plan
  did not list. The shared helper exists so the in-process and file-driven
  answers cannot drift, and nothing proved they agree. It drives the real
  engine runner and the real pipeline through the fake and asserts the same
  verified defects and the same clean coverage the in-process gate asserts.
  It also proves at the command line that verification is spawned without
  --resume while the four chained stages carry it, which is the independence
  the stage exists for.
- 2026-07-30 DECIDED (W3): the hash that identifies a question covers the
  system prompt as well as the stage and the prompt, where the plan called for
  the stage and prompt alone. The rules a stage judges against travel in the
  system prompt, so two identical prompts judged against different rules are
  different questions. Including it costs nothing and closes the case where a
  ruleset edit would have replayed an answer given under the old rules.
- 2026-07-30 DECIDED (W3): a stage_executions row is a call the engine
  actually made, so the failure is recorded differently depending on what
  failed. An unreadable answer means every call reported back and the last
  one's answer was the problem, so the last row carries the error and no row
  is added. Any other failure means a call died without reporting, so it gets
  a row of its own with no usage, because the CLI produced no result to take
  usage from. The alternative, always appending a verdict row, would have made
  the attempt count overstate how many times the model was asked.
- 2026-07-30 DECIDED (W3): the checkpointing runner refuses to answer two
  questions at once, with an error rather than a silent queue. Its attempt
  buffer belongs to one call, and two in flight would attribute one stage's
  cost to another. The pipeline asks sequentially, so this asserts the
  assumption instead of relying on it.
- 2026-07-30 DECIDED (W3): the wrapper is the only writer of stage_executions
  rows and the only caller of addReviewUsage. Two writers would eventually
  disagree about what a stage returned or what it cost, and usage is the
  number the user makes decisions with. A replay writes no row and adds no
  usage, which is what keeps a resumed review's total equal to what was
  actually spent.
- 2026-07-30 FOUND (W4, fix owed by W5): resuming a review re-asks the
  verification stage, breaking the architecture's promise that a completed
  stage is never re-run. Candidates are wiped and recreated on re-entry and
  each is given a fresh ULID, so the verification prompt, which embeds those
  ids, is a different question from the one the interrupted run asked. The
  checkpointing runner then correctly refuses to replay across that change.
  Confirmed empirically, not inferred: a review paused at verification and
  resumed records two verification rows whose prompt hashes differ, while
  every earlier stage replays. Correctness is unaffected, cost is not: this
  re-pays for the most expensive stage. The fix belongs with W5, which owns
  resume determinism, and is either deterministic candidate ids derived from
  the finding's content or a verification contract keyed by place in the code
  rather than by id. The second is the better shape, because the fake CLI and
  the ideal-answers helper already match verdicts to candidates by path and
  line, and it removes the dependency on id stability altogether.
- 2026-07-30 DECIDED (W4): S0 seeding runs once per review, not once per run.
  The inventory is derived from commits that cannot move, so a resumed run was
  inserting a second identical set of ledger files and hunks, and every count
  the coverage report states about the change set would have been double what
  the change set contains. Found by running a resume rather than by reading:
  the mutation that restores the old behaviour fails the resume test.
- 2026-07-30 DECIDED (W4): the plan's single `removeReviewArtifacts` is split
  in two. Removing the run directory on every terminal transition would delete
  the bundle and the stage logs at exactly the moment someone wants to read
  them, and T8 requires that evidence be kept until the review is deleted.
  `removeReviewWorktrees` removes the checked-out copies and the worktree
  root; `removeReviewArtifacts` removes the evidence too and is for deletion
  alone.
- 2026-07-30 DECIDED (W4): the review's frozen ruleset is settled before the
  review is transitioned to running. A review that was never going to be able
  to start should not first look started and then fail.
- 2026-07-30 FIXED (W4): a cancel arriving between stages was dropped, and the
  run finished and reported itself completed. The engine hands the abort signal
  to the process it spawns, which covers a cancel arriving while a stage is in
  flight; between stages there is no child to kill and nothing was checking.
  Found by a reproduction left from an earlier session, which passed, meaning
  it was documenting the bug rather than the fix. The runner now checks the
  signal at every stage boundary and once more before a review is called
  finished. The stage already in flight still completes and is checkpointed,
  so cancelling loses nothing that was paid for.
- 2026-07-30 DECIDED (W4): recording how a run ended never throws. A cancel
  from the job manager can land while a run is failing, and cancelled is
  terminal, so transitioning anyway would throw from inside the catch block
  and replace a real diagnosis with a state-machine complaint. The outcome
  returned still describes what actually went wrong; the terminal status
  stands.
- 2026-07-30 DECIDED (W4): a review that names a linked repository but records
  no pinned commits for it is refused rather than run. Reviewing the primary
  alone would look complete while the half of the change that motivated
  linking the two repositories went unread.
- 2026-07-30 FOUND (W4, fix owed by W5): the resume key is sensitive to the
  model registry as well as to the review. `contextWindowFor` returns
  undefined when a model's probe has gone stale, which changes how the
  adversarial stage batches, which changes its prompts, which changes their
  hashes. A review resumed after its model's probe expired therefore re-asks
  the adversarial stage. Read from the code rather than proven by a test; the
  scratch probe from an earlier session that explored this no longer runs. W5
  owns the fix, which is to freeze the context window onto the review the way
  the ruleset is frozen, so a resumed run batches the way the original did.
- 2026-07-31 DECIDED (maintainer request): a review records how hard the model
  should think, and the engine passes it as `--effort` on every stage. The
  levels are low, medium, high and max, read from the CLI's own validator on
  2026-07-31 rather than from its help text, which lists only the first three
  and is out of date. There is no tier between high and max, so the four
  levels asked for (medium, hard, extra hard, max) map to three.
- 2026-07-31 DECIDED: effort is fixed when a review is created, not changed
  while one runs. The resume key covers the question a stage was asked, not
  how hard it was asked to think, so a stage answered at low effort and
  replayed after a change to max would report a thoroughness the answer never
  had. Choosing differently means starting a new review.
- 2026-07-31 DECIDED: the default effort is high. This app exists to find
  defects a careful reviewer would find, so the cheap default is the wrong
  one; max stays a deliberate choice because it costs materially more.
  Unset passes no flag at all, leaving the decision to the CLI, rather than
  this app quietly deciding on the user's behalf.
- 2026-07-31 FIXED (W5): the verification stage no longer names candidates by
  database id. Candidates are wiped and recreated whenever a review is
  resumed, so an id made the question different on every re-entry and the
  stage could never be replayed, breaking the architecture's promise that a
  completed stage is never re-run. Each candidate now carries a label,
  C1, C2 and so on, assigned by position when the prompt is built. Position is
  fixed by the stage answers that produced the candidates, and those are
  replayed byte for byte, so the question is stable. The change also removed a
  test helper that had to read an id back out of the database to answer a
  verification prompt.
- 2026-07-31 DECIDED (W5): the label is positional rather than derived from
  path and line range. Two candidates can legitimately sit on the same lines
  under different rules, so a location is not unique, and disambiguating it
  would have reintroduced ordering as a hidden dependency anyway. Position
  states the dependency plainly.
- 2026-07-31 FIXED (W5): the context window a review batches against is frozen
  onto the review, alongside its ruleset and for the same reason. It was read
  from the model registry on every run, so a probe expiring between runs
  changed how the adversarial stage divided its work, which changed its
  prompts, which changed their hashes, and a stage that had already been
  answered and paid for was silently re-asked. Null on the column means the
  window was decided to be unknown, not that it is undecided.
- 2026-07-31 DECIDED (W5): the registry is consulted at exactly one line, inside
  the freeze. The standalone helper that read it was deleted rather than left
  available, so the run site can only see the frozen column. A mutation that
  restored the live read passed the tests, which said plainly that the tests
  proved the value was recorded and not that it was the value used. Making the
  wrong thing unreachable is the stronger answer, and the batching behaviour
  itself is already covered by the pipeline's own context-window tests.
- 2026-07-31 DECIDED (W6): the job queue lives in memory only. On a restart it
  is empty and the reviews that were waiting are still drafts. That is the
  honest behaviour for a local tool: nothing was promised to them and nothing
  was spent on them, and persisting a queue would mean a crash could start
  expensive work nobody was watching.
- 2026-07-31 DECIDED (W6): the manager announces only what the database already
  says, and reads the row before emitting. An event that arrived before the row
  it describes would let the screen show a stage as started while the database
  still said draft, and reloading the page would appear to undo it.
- 2026-07-31 DECIDED (W6): the bus swallows a listener's error rather than
  letting it escape. A browser that disconnected mid-write must not stop the
  other watchers being told and must not fail the review it was watching.
  Listeners are copied before iteration, because a done-event listener
  unsubscribes itself and mutating the set mid-iteration would skip whoever
  came after it.
- 2026-07-31 DECIDED (W6): migrations run in `instrumentation.ts`, not in the
  manager. Startup migrates, the manager schedules. It also keeps `migrate.ts`
  out of the SSE route's import graph, which matters because Turbopack reads
  `new URL("../../../drizzle", import.meta.url)` as a module it must resolve
  and fails the build over a directory that is only ever read at run time. The
  path is now assembled with join for the same reason.
- 2026-07-31 DECIDED (W6): every import in `instrumentation.ts` is inside
  `register()` and behind the runtime check. Next builds that file for its edge
  runtime too, where none of it can load, and a top-level import of anything
  reaching node:path fails the production build.
- 2026-07-31 DECIDED (W6): the SSE stream takes a narrow watcher, not the
  manager. It reads a picture and listens for changes; nothing reachable from a
  route handler should be able to start or cancel a review.
- 2026-07-31 FIXED: cached tokens are counted. The CLI reports
  `cache_creation_input_tokens` and `cache_read_input_tokens` separately, the
  event schema already parsed both, and `usageOf` then dropped them. A chained
  stage sends most of its prompt as a cached read, so the recorded input count
  was a small fraction of what the model actually read, and there was no way to
  show how much the session chaining saved. Both are now carried to the stage
  rows and the review totals. Counted separately rather than folded into the
  input count, because a cached read costs a fraction of a fresh one and adding
  them together would overstate the price.
- 2026-07-31 NOTED: prompt caching itself is the CLI's, not this app's. What
  this app controls is whether consecutive stages share a session, and they do:
  S1 to S4 resume into one conversation, which is what lets the whole
  accumulated context be a cached read rather than a fresh send. S5 is
  deliberately excluded and pays full price for its prompt, which is the cost
  of an independent check and is worth it. The `--resume` flags that make this
  true are asserted at the command line by the scripted-pipeline test.
- 2026-07-31 DECIDED (maintainer request): a review can carry the author's own
  description of what the change was meant to do. Optional free text on the
  review, shown to the risk, comprehension and adversarial stages through the
  change summary they all open with. The most valuable finding a reviewer can
  make is that the change does not do what it was for, and that is unanswerable
  without knowing what it was for; it also prevents a class of false positive
  where a deliberate choice is reported as a mistake.
- 2026-07-31 DECIDED: the description is framed as a claim to be checked, fenced
  in a tag, and explicitly labelled as not being instructions. A description
  reading "ignore the error handling, it is deliberate" would otherwise switch
  off part of the review from a text box, which is the same hazard as a
  reviewed repository instructing its own reviewer. The prompt says outright
  that a change failing to do what the description says is itself a finding.
- 2026-07-31 DECIDED: the verification stage does not see the description. It
  exists to check a quotation against the file, and handing it the author's
  case for the change would give it a reason to believe a finding it is
  supposed to be trying to refute.
- 2026-07-31 NOTED: the description is part of the prompt, so it is part of the
  prompt hash. Editing it after a review has started means the stages are asked
  again rather than replayed, which is correct: a review judged against a
  different account of the change is a different review.
- 2026-07-31 PROVEN (W7 step zero): tsx resolves the `@/` alias from
  tsconfig, so the demo script runs directly with no build step and the
  `tsconfig.scripts.json` fallback the plan held in reserve is not needed.
- 2026-07-31 DECIDED (W7): the demo prints numbers with its own grouping rather
  than toLocaleString. The output is captured as gate evidence, and a
  locale-dependent separator would make two runs on two machines look
  different when nothing about the review changed.
- 2026-07-31 DECIDED (W7): no colour in the demo output. Escape sequences are
  control characters, which the house style gate refuses, and the output is
  written to a file as evidence where escapes are noise rather than emphasis.
- 2026-07-31 FIXED: the dev server flagged instrumentation.ts on every
  compile ("A Node.js module is loaded ('node:os') which is not supported in
  the Edge Runtime"). Next compiles the instrumentation hook for its edge
  runtime as well as Node, and the edge compiler statically flags any node:
  import it can see, including one inside the NEXT_RUNTIME guard's untaken
  branch. The hook now imports nothing: it guards, then dynamically imports
  instrumentation-node.ts, which simply calls runtime(), the same idempotent
  door every route handler uses. The SSE events route previously bypassed
  that door by calling jobManager() directly, and would have thrown if it
  were the first request after a restart; it goes through runtime() now.
- 2026-07-31 ACCEPTED: one Turbopack build warning remains ("Encountered
  unexpected file in NFT list"). Root cause established, not assumed: the
  engine's process spawner opens per-review log streams at paths only known
  at run time, and Next's file tracer treats a filesystem operation with a
  dynamic path as "the whole project might ship", so the standalone output
  manifest over-includes. The paths cannot be static, because they live
  under the user's data directory per review. The consequence is confined
  to the standalone-output file manifest, which this app does not use: it
  runs with next start from the repository. A second cause, the migrations
  folder joined from import.meta.url up to the repository root, was real
  and is fixed with the documented turbopackIgnore comment. Re-check
  trigger: if the app ever adopts output "standalone", this acceptance is
  void and the warning must be resolved.
- 2026-07-31 DECIDED (V1, D-30): every engine call carries --max-budget-usd
  from the stageMaxBudgetUsd setting, default 15 USD-equivalent. Zero
  disables the flag, which is a choice someone makes on purpose rather than
  a default they fell into. Per call rather than per review, because the CLI
  flag is per call; a runaway stage is bounded even when nothing else goes
  wrong.
- 2026-07-31 DECIDED (V1, D-31): nothing spends model usage without an
  explicit user action: starting a review, pressing a probe button, or
  running the demo without --fake. There is no automatic probing at startup
  or anywhere else. Reason: the 2026-07-31 incident where a manual test
  silently used the real CLI and spent about 0.50 USD-equivalent.
- 2026-07-31 DECIDED (V1, D-32): every run opens with a run note naming the
  engine binary it will use, the model and the effort, so a fake-versus-real
  mixup is readable from the run itself instead of deduced from token counts.
- 2026-07-31 DECIDED (V1, D-33): worktrees are removed when a run settles
  cancelled or failed, and kept while it is paused, interrupted or awaiting
  confirmation; complete joins the cleanup list when the confirmation flow
  lands (D-12 as implemented). Cleanup is best effort: a failure to remove
  becomes a run note, never a mask over the outcome that matters.
- 2026-07-31 DECIDED (V2, D-34): dismissing a finding requires a reason;
  confirming does not. Accepting the engine's case adds nothing to it, while a
  dismissal without a reason leaves no record of whether the engine was wrong
  or the reviewer was in a hurry, and those two are the difference between a
  prompt that needs fixing and one that does not.
- 2026-07-31 DECIDED (V2, D-35): a review completes only when every finding is
  decided, enforced by the complete route with the undecided count in the
  message. The human gatekeeper is a rule about the data, so a script calling
  the API directly meets the same wall the screen does.
- 2026-07-31 DECIDED (V2, D-36): the file-context endpoint serves only paths a
  finding in that review actually cites, and only while the review awaits
  confirmation. Without the first guard it is a way to read any file on the
  machine; without the second it promises a checkout that D-12 has already
  removed. Proving the first guard needed a test using a file that genuinely
  exists in the checkout: an absent path 404s from the failed read whether the
  guard is there or not, and the first version of that test passed with the
  guard deleted.
- 2026-07-31 DECIDED (V2): completing a review removes its worktrees, joining
  cancelled and failed from V1 (D-12 now fully implemented). The confirmation
  screen was the last thing that needed the checkout; the bundle and the logs
  stay as the evidence behind the report.
- 2026-07-31 DECIDED (V3): deleting a project removes its whole directory
  under the data root, not only the bare clone inside it. Found by driving the
  live server rather than by the test, which asserted on the clone path and so
  passed while an empty directory was left behind for every project ever
  deleted. The test now asserts the parent is gone too.
- 2026-07-31 DECIDED (V3): the project detail endpoint returns the projects
  that could still be linked, excluding itself and anything already linked, so
  the form cannot offer a choice the repository would refuse. The repository's
  own errors for a self-link and a duplicate are passed through verbatim
  rather than restated in different words on the route.
- 2026-07-31 DECIDED (V3): a branch row links to the new-review screen with
  the branch already chosen. Arriving at a form that has forgotten the choice
  just made is the kind of small friction that makes a tool feel like
  paperwork.
- 2026-07-31 DECIDED (V4, D-37): the pre-flight endpoint is read-only and free.
  Git and arithmetic only: it fetches, diffs, parses, runs the sweep and
  estimates tokens, and writes nothing except the fetch timestamp. Its pins are
  advisory and the screen says so, because creating the review fetches and pins
  again (D-27); the numbers are a preview rather than a promise.
- 2026-07-31 DECIDED (V4): the pre-flight reports sweep problems separately
  from sweep hits. A pattern that could not run means an incomplete sweep,
  which the pipeline refuses outright, and seeing that before paying is worth
  more than the hit count itself.
- 2026-07-31 NOTED (V4): the seeded fixture produces zero sweep hits against
  the example protocol. Six patterns run and none match its changed lines.
  Measured rather than assumed: a test asserting hits were non-zero failed, and
  the expectation was wrong rather than the code. What the test asserts now is
  that every pattern ran.
- 2026-07-31 DECIDED (V4): a dependency is never included in a review
  automatically. When the dependency has a branch of the same name as the one
  being reviewed it is preselected and labelled as suggested, because that is
  almost always the other half of the change, and almost always is not always.
- 2026-07-31 DECIDED (V5, D-38): the report is the app's own rendering of the
  finding format, and a protocol's prose about output format is not parsed.
  Rendering arbitrary instructions is not tractable, and a report whose shape
  depended on prompt-shaped text would change meaning without anyone editing
  the code that writes it.
- 2026-07-31 DECIDED (V5): the report states what was examined as well as what
  was found. A reader cannot otherwise tell "nothing is wrong" from "nothing
  was looked at", and that distinction is the whole value of a review. The
  counts come from the coverage ledger the pipeline already reconciled, not
  from anything a model claimed.
- 2026-07-31 DECIDED (V5): dismissed findings appear in the report with their
  reasons. A dismissal is evidence about the engine rather than an absence of
  one, and dropping it would throw away the only signal that says which
  prompts need work. Confirmed NITPICKs are kept too (D-11): what a person
  chose to keep is not the report's to second-guess.
- 2026-07-31 DECIDED (V5, D-39): exports are written under the data root's
  exports directory, outside the run directory, so a report outlives the
  worktrees, bundle and logs that deleting a review removes. The filename uses
  the UTC day and turns branch slashes into hyphens, so a second export the
  same day replaces the first rather than accumulating near-identical files.
- 2026-07-31 FIXED (maintainer question): the report renders each finding in
  the labelled structure the example protocol defines, File, Lines, Issue,
  Comment, rather than as a markdown heading and prose. It did not before, and
  the tests passed both before and after the change, which means they were
  asserting on the text of a finding and never on its shape. They pin the
  format now. Lines is a single number, or a range only when the finding
  genuinely spans more than one line.
- 2026-07-31 FIXED: the adversarial prompt now says what a comment is for.
  Nothing told the model that the comment must be plain language a
  non-author can follow, or that code belongs in the quotation rather than in
  the sentence explaining the problem. A report cannot make prose out of a
  comment full of code, so the instruction belongs where the comment is
  written rather than where it is rendered.
- 2026-07-31 DECIDED (V6, D-41): merged detection reads the refs the clone
  already has rather than fetching, and runs when a review is opened or listed.
  It is a convenience, not a fact the app owes the network on every page load,
  so a branch that merged is noticed at the next fetch, which is what someone
  does anyway when they open a branch list.
- 2026-07-31 DECIDED (V6): every review except one that is mid-run is checked
  for a merge. The first version checked only finished reviews and missed the
  clearest case there is: a draft of a branch that has since merged is stale
  before it ever ran, and is exactly what someone would want to delete. A
  review in flight is the only one where the answer is noise.
- 2026-07-31 DECIDED (V6, D-43): the settings API accepts only catalogued
  keys, each validated by its own schema, and refuses anything else by name. A
  settings table that accepts whatever it is handed is where typos live
  silently, and a reader cannot tell which keys are real.
- 2026-07-31 FIXED (V6): `readAuthStatus` parsed the CLI's output without a
  guard, so any binary that printed something unexpected threw out of a status
  check whose whole job is to answer a question calmly. Found by pointing
  TRYSQUARE_CLAUDE_PATH at the fake and watching the route return a JSON
  syntax error instead of "not signed in".
- 2026-07-31 DECIDED (V7, D-40): switching a rule off bumps the ruleset
  version. A review's frozen snapshot names the version, so without the bump
  two different sets of rules would share a name and a number, and a report
  saying which version it used would not identify what the review was actually
  judged against. Toggling to the value a rule already has moves nothing.
- 2026-07-31 DECIDED (V7): the frozen snapshot stores enabled rules only, and
  the exported document always contains every rule. That is the difference
  between the document and the choice this app made about applying it: the
  export has to reproduce what was imported, byte for byte, and a rule someone
  switched off is not part of what a new review is judged against.
- 2026-07-31 DECIDED (V7): freezing a ruleset with nothing enabled is refused.
  A review judged against no rules comes back clean and reads exactly like a
  review that found nothing wrong, which is the same hazard the empty-import
  guard exists for.
- 2026-07-31 DECIDED (V7, D-44): the new-review screen links to the ruleset
  page rather than opening a drawer. At one screen of this size a drawer
  duplicates a page that already exists.
- 2026-07-31 FIXED: the stage timeline was ordered by (startedAt, id), and
  every row a single call writes shares one startedAt. ULIDs are not monotonic
  within a millisecond: measured over twenty thousand pairs, the second of two
  generated in the same millisecond sorts before the first 9,594 times out of
  19,198, so one call's rows came back in a random order. It surfaced as a test
  that passed locally and failed in CI. Ordering is now by attempt within a
  timestamp, which is the real sequence, and a test reproducing the old
  ordering fails it about two runs in three. Recorded because the same trap
  applies anywhere else ULIDs are used as a tiebreak within one timestamp.
- 2026-07-31 FIXED (V8): the light theme never rendered. Tailwind 4's `@theme`
  does not honour being nested in a media query, so the dark block overwrote
  the light values unconditionally and the built CSS contained no
  prefers-color-scheme rule at all. The dark values are plain custom-property
  overrides on `:root` now, which is what the components' var() references
  actually read. Found by photographing both themes and noticing that the file
  named light was dark, which is the whole reason the design doc calls both
  themes first-class and says both are screenshotted.
- 2026-07-31 DECIDED (V8): the browser journey is one test with named steps
  rather than several tests. Playwright gives every test a fresh page, so a
  journey split into tests is a journey that starts over each time. Its steps
  depend on each other because the flow does.
- 2026-07-31 DECIDED (V8): the e2e web server is never reused
  (`reuseExistingServer: false`). Reusing one would run the journey against a
  server started without the fake engine, which is exactly the mistake that
  spent real usage on 2026-07-31. A port already in use fails loudly instead.
- 2026-07-31 DECIDED (V8): screenshots capture the body element with
  animations frozen, not the full page. The rail polls for a running review, so
  the page is never idle and a full-page capture intermittently failed
  mid-repaint; freezing animations also makes two photographs of one screen
  identical, which is what evidence has to be.
- 2026-07-31 NOTED (V8): a test asserting the light theme was itself wrong
  before it was right. Chromium reports these colours as `lab()`, where the
  first channel is lightness on a 0 to 100 scale; summing the channels read
  98.8 as "dark". The helper now normalises lab, oklch and rgb to one scale.
- 2026-07-31 DECIDED (V9): gate G1 is recorded as AWAITING VERDICT rather than
  passed. The fake-engine half is complete and its evidence is captured, but
  the half that decides whether findings are worth reading needs a real model
  and the maintainer's usage. Nothing in this repository marks a gate passed,
  which is the point of a gate.
- 2026-08-03 FIXED (U1, D-45): gate scripts resolve filesystem paths with
  `fileURLToPath`, never `URL.pathname`. This directory's name contains a
  space, which a file URL carries percent-encoded, so `check-style.mjs`
  walked a path that does not exist, collected nothing, and exited 2 as
  misconfigured on a clean tree. Measured: the gate checked 0 files before
  the fix and 180 after, on the same tree. `./verify.sh` was therefore red on
  the reference machine while CI stayed green, because CI's checkout path has
  no space, which is the worst version of this bug: the one that only fails
  where the work happens. Found by running the gate during the 2026-08-03
  audit rather than by reading it.
- 2026-08-03 DECIDED (U1): the house-style gate scans the repository root by
  listing it, instead of naming the root files it covers. The old list named
  five markdown files and therefore checked no config file, no `package.json`
  and not `verify.sh` itself. A list is a promise to remember; listing the
  directory covers a new file the day it lands. `package-lock.json` and
  `next-env.d.ts` are excluded by name because they are generated, not
  authored.
- 2026-08-03 DECIDED (U1): a declared target directory that is missing fails
  the gate by name with exit 2, rather than being skipped. The empty-result
  guard alone was too weak: it fires only when every target is missing, so a
  gate that had lost one directory would still report a healthy file count.
  The failure that prompted this was invisible in exactly that way.
- 2026-08-03 FIXED (U6): the run screen shows the coverage ledger. Every count
  it needed was already reconciled by the pipeline and returned by the job
  manager's snapshot, and the page's own type discarded it. Without it the
  screen could not tell a review that found nothing apart from one that looked
  at nothing, which is the distinction the whole app exists to make.
- 2026-08-03 DECIDED (U6): the timeline covers S0 and S6 as well as the five
  model stages. They are deterministic app code and write no
  `stage_executions` row, so they had been left off entirely, which hid the
  two halves of a review that cannot be blamed on a model: preparing the
  change set, and the audit that refuses to finish while anything is
  outstanding. Their state is derived from the review instead, and the row
  says what they do rather than pretending to a token count they never had.
- 2026-08-03 FIXED (U6): per-stage duration, tokens and cost are rendered.
  `stage_executions` has stored all of it since W3 and the screen showed a
  status dot, so the one place a person could see where a review's money went
  was the total at the bottom.
- 2026-08-03 FIXED (U6): a failed stage shows its error class, its message and
  the path to its transcript, which 01 section 8 has always required. The
  transcript is the evidence behind a failure and it is on this machine;
  naming the file is the difference between a diagnosable run and a shrug.
- 2026-08-03 FIXED (U6): persisted run notes are rendered. They are how a run
  records that it split a batch or excluded a rule/file pair, written
  precisely so a run that quietly did less than another is distinguishable
  from it, and nothing displayed them: only the live event tail was shown, so
  the record vanished on reload.
- 2026-08-03 FIXED (U6, D-15): the SSE polling fallback exists. It was decided
  when SSE was chosen and never built, so a dropped stream left the page
  frozen on whatever it last heard and the only way to learn a review had
  finished was to reload by hand. Two seconds, only while the stream is down,
  and the page says it is degraded rather than looking healthy.
- 2026-08-03 DECIDED (U6): cancelling asks the state machine whether a review
  can be cancelled instead of matching statuses. That covers the draft, the
  one awaiting a person and the one paused on a limit, all of which the
  machine has always allowed and none of which had a path, so the only way to
  be rid of them was deletion, which also discards their findings.
- 2026-08-03 FIXED (U5, D-53): a usage-limit pause records when the limit
  clears. The CLI reports it, the engine parsed it into `StageOutcome`, the
  job manager re-emitted it, and every consumer below that dropped it: there
  was no column and nothing rendered it, so a paused review was
  indistinguishable from a hung one. It is stored as unix seconds on the
  review (migration 0008) and shown beside the pause reason, and it is cleared
  on any other transition so a running review cannot show a limit it already
  passed.
- 2026-08-03 FIXED (U5, D-50): a failed review is resumable. 03 always specced
  a retry after a stage failure and the state machine made `failed` terminal,
  so the only recovery was starting over and paying for every stage again.
  Resuming replays each answered stage from its checkpoint and runs only the
  one that broke, which is the mechanism a limit pause already used. Chosen
  over a per-stage retry because the pipeline cannot re-enter partway through
  a stage anyway, and one recovery path exercised often beats two that are
  not. `completedAt` is cleared on any transition to running, or the report
  would describe a run that ended and then kept going.
- 2026-08-03 DECIDED (U5): `RESUMABLE_REVIEW_STATUSES` is now the single
  source of the rule, used by the service guard and the Resume button. It was
  an exported constant with no callers while three places hardcoded the same
  list, which is how the list and the rule drift apart.
- 2026-08-03 FIXED (U5): the clone status machine is enforced, and this
  immediately caught a real bug. `cloning` was declared in the enum from the
  first migration and never written, so the projects screen polled while a
  project was `pending` and treated anything else as finished. Writing
  `cloning` for the first time would have left a clone in progress frozen on
  screen with no badge, and the route test that caught it had the same
  weakness: it waited for "not pending" rather than for a terminal state.
  Both now wait for `ready` or `failed`. A status nothing ever writes lets
  every reader of it be wrong for free.
- 2026-08-03 FIXED (U5): `serialiseJsonColumn` validates against the schema
  its reader uses, so 02's "validated on read and write" is true rather than
  half true. A wrong shape was stored happily and failed later at a read, in
  a stack trace pointing at whoever opened the row instead of whoever wrote
  it. The schema is optional, because a free-form setting value has no reader
  schema to check against.
- 2026-08-03 FIXED (U5): the file-context route parses its query with zod,
  the last route reading input without it. It coerced by hand, so a
  non-numeric line became NaN and was silently treated as line one, answering
  a different question than the one asked. A line of zero or "abc" is now a
  400 rather than a quiet round to the top of the file.
- 2026-08-03 FIXED (U4, D-47): a review's profile is resolved from the model's
  registry entry instead of defaulting. The create route defaulted `profileId`
  to `full-context` and nothing ever read `models.profileId`, so every review
  this app has ever run divided its work as though the model could hold the
  whole protocol, whatever model was chosen. The four profiles were fully
  implemented in the planner and unreachable from the product.
- 2026-08-03 DECIDED (U4): the override is asymmetric. A downgrade is accepted
  and recorded as a run note; a profile stronger than the model's registry
  entry is refused. Sending a model less than it can hold costs requests;
  sending it more than it can hold loses part of the protocol quietly, and the
  result reads as a clean review rather than as a failure. The comparison uses
  the order of `REVIEW_PROFILES` itself rather than a second list, so the two
  cannot disagree, and a test pins that order because reordering the enum
  would silently change which overrides are accepted.
- 2026-08-03 DECIDED (U4, D-46): a model registered `mechanical-only` is
  refused for a review, and so is asking for that profile explicitly. Its
  batch plan contains no judgment requests at all, so the run would raise
  nothing and then fail reconciliation with every hunk unaccounted for. The
  API accepted it before and failed mid-run, after the worktrees were built.
- 2026-08-03 DECIDED (U4): a model that is not in the registry resolves to
  `full-context` and the review records a run note saying so. This is the same
  stance the pipeline already takes on an unknown context window: make one
  request per batch and let the model refuse, rather than inventing a limit
  here. The note is what keeps it from being the silent default it used to be.
- 2026-08-03 PROVEN (U4): the engine quality gate now runs the seeded fixture
  under `full-context`, `chunked` and `decomposed`, asserting every planted
  defect is still found and the clean files stay clean under each. docs/06
  promised this and it did not exist, so "a narrower profile still finds the
  seeded bugs" was an assertion rather than a measurement. A second test pins
  the trade itself: the request count rises as the profile narrows, which is
  what tells dividing the work apart from dropping it.
- 2026-08-03 FIXED (U3): the deletion stage now has to account for what was
  removed, in both directions, like every other stage. It returned
  `reviewedDeletions` and the pipeline threw the list away, then closed every
  ledger file unconditionally, so the audit's changed-files check could never
  fail. A removed file leaves no hunk behind in the file it used to be, which
  means nothing else in the ledger notices its absence: a stage that simply
  omitted it produced a review where every other count still added up.
  Measured by mutation: neutering the new assertion fails four tests that
  pass with it.
- 2026-08-03 DECIDED (U3): a rename counts as a removal for the deletion
  stage. The old path stops existing and whatever imported it breaks, which is
  the same failure as a deletion and the one a diff hides best, because the
  content it shows is unchanged. A rename with no content change also has no
  hunks, so without this it would have been the one file kind nothing at all
  accounted for.
- 2026-08-03 DECIDED (U3): a ledger file closes on evidence rather than on
  reaching the end of the stages: its hunks are dispositioned, and if it
  removed anything, the deletion stage named it. A file with neither hunks nor
  removals is a binary blob or a mode change, where there is no text for a
  reader to account for, so nothing is owed and it closes. Honest about what
  this is worth: the reconciliation above is what actually catches a skipped
  deletion, and `pendingFiles` is now a second line of defence that means what
  it says rather than a rubber stamp.
- 2026-08-03 DECIDED (U3): a deleted file whose pre-change copy cannot be read
  is reviewed from the diff and the prompt says so outright, rather than the
  run failing or the omission passing silently. Losing a whole review over one
  unreadable evidence file is worse than a narrower review; letting the stage
  quietly judge a deletion from its minus lines is worse than both, because
  the transcript then reads like a file that was opened.
- 2026-08-03 DEFERRED (U3 to U12), discharged 2026-08-04 by D-60: the
  seeded fixture does not yet delete a whole file, so the quality gate
  exercises the deletion path only through the pipeline tests, which use a
  real deleting patch. Adding it needs a deletion
  mechanism in the fixture builder and a new protocol rule for the defect to
  violate, and U12 already owns two other fixture defects. Recorded rather
  than dropped: the gate is the regression net for prompt changes, and until
  this lands its deletion coverage comes from the pipeline tests alone.
- 2026-08-03 DECIDED (U2): where a spec describes something that is not built,
  the sentence stays and the document gains a "Not built yet" block naming the
  gap and the work item that owns it. Only statements that are wrong about a
  decision already taken are edited in place. Rewriting an unbuilt requirement
  to match the code would silently delete it, which is how a design loses its
  accessibility pass and nobody notices: the axe requirement in 04 had already
  been stated as fact for four days while no axe dependency existed.
- 2026-08-03 DISCHARGED (U2): the 9 high npm advisories accepted on 2026-07-30
  are gone. Re-checked with `npm audit`: 0 vulnerabilities across 586
  dependencies (28 production, 520 dev, 187 optional). The re-check trigger
  recorded with the original acceptance has fired and closed it.
- 2026-08-03 CORRECTED (U2): specs 00 to 06 were relabelled from DRAFT to
  RATIFIED. G0 passed on 2026-07-30 and `GATES.md` says so; only the headers
  were stale. `plans/APP-PLAN.md` keeps its DRAFT label, which is accurate.
- 2026-08-03 FOUND (U2): there is no `ReviewEngine` interface. 01 section 6
  describes one, and the code calls `runStage` on the headless module
  directly. Mode B therefore has no seam to plug into, and U11 must extract
  one before it can add a second engine. Recorded because the plan had assumed
  the interface existed, which would have made U11 look smaller than it is.
- 2026-08-03 FOUND (U2): the SSE polling fallback decided in D-15 was never
  built. The review page opens an EventSource and stops updating if it errors;
  only the left rail polls, and only to notice an active review. Folded into
  U6 rather than left as a decision nothing implements.
- 2026-08-03 DECIDED (U1): `verify.sh` requires `git` alongside node and npm.
  The gitops suite, the seeded fixture and the e2e setup all shell out to it,
  and `check-nothing-hidden.mjs` deliberately skips itself when git is
  absent. Without the requirement, a machine without git turns a security
  gate into a no-op and the rest into opaque test failures.
- 2026-08-04 FIXED (review round 1, P0): a stage answer the pipeline rejected
  stayed checkpointed as succeeded, so resuming replayed it byte for byte and
  failed the same way forever. The checkpointing runner writes a succeeded row
  the moment the engine returns schema-valid JSON; every reconciliation the
  pipeline runs happens after that. With `failed -> running` now legal (D-50),
  the Resume button offered a recovery that could not work: the prompt is
  pinned, so the hash matches, so the poison answer replays free. One model
  misspelling of a deleted path made a review unrecoverable except by deleting
  it and paying for all five stages again. The pipeline now takes an
  `invalidate` callback, called with the stage and the reason whenever it
  refuses a stored answer; the runner strikes every succeeded row for that
  stage (keeping its output and usage, changing only its standing) so the next
  run asks again. Every answer for the stage is struck rather than one row: a
  batched stage merges its answers before reconciliation, so which batch was
  at fault cannot be told apart. Proved by neutering the service wiring and
  watching the recovery test fail.
- 2026-08-04 DECIDED (review round 1): the rule behind that fix, stated once
  so it is not rediscovered per stage. A checkpoint is only safe to replay
  because everything that judged the answer accepted it. Any new check that
  can refuse a stored answer must therefore either run before the answer is
  stored or strike it on refusal. The seam exists so the second is a one-line
  obligation rather than a redesign.
- 2026-08-04 FIXED (review round 1, P0): deleting a project while its clone
  ran took the server down. The clone is deliberately unawaited, and its
  status writes began asserting the project exists, so a delete mid-clone made
  the completion write throw `ProjectNotFoundError`, the catch block's own
  write throw it again, and that second throw escape as an unhandled rejection
  from a promise nobody held. Under Node's default policy that ends the
  process. The background clone moved out of the route into
  `server/projects/clone.ts`, whose stated contract is that it never rejects:
  a vanished project is recognised, its half-written repository removed, and
  the task returns. A write that fails for any other reason is reported to
  stderr rather than swallowed, because it is the last resort for work nothing
  awaits.
- 2026-08-04 FIXED (review round 1): the run page polled forever after every
  finished review. The server closes the stream when a run ends, which a
  browser can only report as an error, and the D-15 fallback could not tell
  that apart from a dropped connection: it started a two-second poll that
  nothing ever stopped, so a finished review re-queried the detail route (with
  its merge check, which spawns git) every two seconds for as long as the tab
  stayed open, including throughout the confirmation session. The page now
  records that it heard `done`, polls only when a live or queued run has no
  stream to speak for it, and stops as soon as the snapshot says nothing is
  running. Resuming a review opens a fresh stream, since the one it had was
  closed by the run that ended.
- 2026-08-04 FIXED (review round 1): cancelling a queued review dequeued it
  and changed nothing else, so the row stayed `draft` with its Cancel button
  intact and a second tab waited on a queue entry that no longer existed. The
  same click on an unqueued draft cancelled it properly. Dequeueing now falls
  through to the same state-machine judgment as every other cancel, so the
  review ends cancelled and a watcher is told.
- 2026-08-04 FIXED (review round 1): a clone interrupted by a restart was
  stranded. Reviews have had startup recovery since W5; clones had none, and
  enforcing the clone machine made `cloning -> pending` illegal, so nothing
  could move the row and the projects screen polled it every second forever.
  `markOrphanedClonesFailed` joins `markOrphanedReviewsInterrupted` in the
  manager's init, failing anything left pending or cloning with a message
  saying the server restarted. Failed is the honest status and the one with a
  retry path.
- 2026-08-04 FIXED (review round 1): every deleted binary produced a run note
  claiming its pre-change copy was missing. The bundle deliberately stores no
  base copy for a binary, and the reader checked only that the file was
  deleted, so the read always failed and the note fired. A note that cries
  lost evidence over ordinary behaviour teaches people to ignore notes, which
  is the opposite of what the ledger is for. The reader now skips exactly what
  the writer skips.
- 2026-08-04 FIXED (review round 1): a deleted file was inlined inside a bare
  three-backtick fence, so deleting a document containing its own fences ended
  the block early and the rest of the file was read as prompt text. The fence
  is now one backtick longer than the longest run inside the content.
- 2026-08-04 FIXED (review round 1): an unregistered model that also carried a
  deliberate profile downgrade got a run note stating the review assumed
  full-context and made one request per batch, while the row said decomposed
  and the run made many. The two notes were branches of one conditional; they
  are two independent facts and are now recorded as such.
- 2026-08-04 FIXED (review round 1): refusing a judgment profile on a
  mechanical-only model ended with "a weaker profile is allowed", and every
  weaker profile is itself refused. The model is the problem, not the profile,
  so that case is now answered first and says to pick a model probed for
  review work. The remaining stronger-than-model refusal names the profile
  that will work, which is honest because that branch is only reachable for a
  model that can judge.
- 2026-08-04 FIXED (review round 1): the stage timeline pulsed every
  unfinished stage, so during preparation all seven pulsed at once and during
  S3 the four after it did too, on the screen whose purpose is saying what is
  running. Stage rows are only written when a stage ends, so "not finished"
  never distinguished the executing stage from the future ones. The pulse now
  follows `reviews.current_stage`, which is stamped on every stage lifecycle,
  with preparation before the first lifecycle and the audit after verification
  answers.
- 2026-08-04 FIXED (review round 1): the two deterministic rows misread two
  reachable states. Cancelling a review after its findings were on the table
  left Audit grey, reading as an audit that never ran when it had passed; and
  a first attempt that failed left Prepare grey, though nothing can be
  attempted before the worktree and bundle exist. Both now derive from
  evidence (any attempt at all; the ledger having nothing outstanding) rather
  than from a list of statuses.
- 2026-08-04 FIXED (review round 1): a stage the user cancelled mid-run
  rendered as a critical-red failure with an error line, because an abort is
  recorded as a failed row carrying the `cancelled` error class. The class was
  already stored; the screen now reads it and says the stage was cancelled,
  in muted text. A decision should not be dressed up as a fault.
- 2026-08-04 FIXED (review round 1): two new tests promised more than they
  checked. One asserted a count was at least zero, which cannot fail; it now
  asserts the decomposed profile genuinely excludes pairs on this fixture
  (README.md carries only the general theme) and that the excluded pairs are
  named in a run note. The other was titled for the skipped-deletion path and
  ran the accounted path; the skip direction is now asserted directly, that
  the run refuses and the ledger leaves the file open. Both were caught by the
  round rather than by the suite, which is the argument for the round.
- 2026-08-04 CORRECTED (review round 1): the plan's commit map still called U4
  TODO while its own section said DONE and the code was in the tree; the U5
  section claimed a browser proof of the limit banner that was never written
  (it moves to U12 with the other failure-path flows, D-55); and "takes about
  a second" appeared in three documents with no measurement. The demo was
  timed (2026-08-04, three runs: 1.45s, 1.46s, 1.54s wall clock, pipeline
  itself 0.6s), the number recorded once in the runbook, and the other two
  places now point at it or say nothing.
- 2026-08-04 DECIDED (U7): a rewritten comment is stored beside the engine's,
  never over it. `findings.edited_comment` (migration 0009) holds the
  person's words; `comment` keeps the model's. The report and every screen
  prefer the edit, because the report is read by whoever fixes the code; the
  original stays because how well the engine explained itself is the only
  measurement of whether the prompts work, and each edit is a data point in
  exactly that. An empty or unchanged rewrite stores null, so "edited" keeps
  meaning edited. Rejected: a free-text override of `comment` in place, which
  would erase the evidence, and a separate annotations table, which is a
  join for a one-to-one fact.
- 2026-08-04 DECIDED (U7): the confirmation queue is two panes. The left is
  the queue itself, grouped by severity worst-first with a state chip per
  decided finding; the right is everything one decision needs: the verbatim
  rule text from the review's frozen snapshot, the diff hunk that produced
  the finding, and the worktree lines it cites. The rule text comes from a
  new `/api/reviews/[id]/rules` route reading the snapshot, so a rule edited
  after the run cannot change what a past finding is shown to have broken.
  The hunk rides on the existing context route, read from the bundle's
  `diff.patch`, which survives the worktree by design; one fetch serves the
  pane because the screen is driven by a key repeat.
- 2026-08-04 DECIDED (U7): j and k walk the visual order. The queue is
  sorted by severity then path then line, and the keyboard walks exactly
  that sequence, because a cursor that moves in an order the eye cannot see
  is a cursor that teleports. After a decision the selection skips to the
  next undecided finding; the decided one stays in place and stepping back
  onto it shows the record.
- 2026-08-04 DECIDED (U7): the D-16 map is complete: e opens the comment
  editor prefilled with what the report would say, Escape leaves any input,
  g g goes first, G goes last, and the footer hints show all of it. Screen
  readers get the decided count and the active finding as polite live
  regions naming the finding, not reciting its card. The dismissal input has
  a visible label; it was the most-used input in the app and had only a
  placeholder, which disappears the moment typing starts.
- 2026-08-04 FOUND (U7): git emits a deleted file as a single hunk covering
  the whole file (checked against a 200-line deletion: `@@ -1,200 +0,0 @@`),
  so `hunkForLine` needs no old-numbering special case; the first-hunk
  fallback is the only possible answer for a deletion. The test pins the
  single-hunk assumption so a git behaviour change would surface as a
  failure here rather than as a wrong hunk on screen. A first draft carried
  the special case and a test that could not fail; both were removed after
  the check, and the containment logic is mutation-proved (returning the
  first hunk unconditionally fails the multi-hunk test).
- 2026-08-04 DECIDED (U8): the picker enforces what the server enforces. Only
  a model a fresh probe vouches for is selectable, the exact rule of
  `listSelectable` and 06 section 2; unknown and stale rows show a Probe
  button and what is known about them, and unavailable rows show the probe's
  own error verbatim. Before this, a never-probed model was selectable while
  a stale one was disabled, inverting the spec, and the helper carrying the
  correct rule was dead code. The judgment moved to `lib/models/availability`
  so the screen and the server read one function instead of agreeing by
  coincidence, and the ordering (recommended families first, recommended
  models first within one) is pure and unit-tested there.
- 2026-08-04 DECIDED (U8): nothing is preselected when nothing is probed. The
  form cannot start until a probe vouches for a model, and a successful probe
  selects the model it vouched for when no choice was made, because probing
  is what someone does in order to use it. The browser journey now probes
  before it reviews, which is the honest first-run flow; the fake CLI answers
  a probe in script mode without consuming a scripted answer, recognising it
  by the probe's own system prompt.
- 2026-08-04 DECIDED (U8): the advanced fold shows the price of a downgrade
  before it is chosen. Pre-flight already computed per-profile adversarial
  request counts; the fold lists them, offers only profiles strictly weaker
  than the model's own (the server refuses stronger ones anyway), and sends
  the override with both the pre-flight and the creation so the preview and
  the run share one resolution. Engine mode renders as a statement rather
  than a disabled control, because a control that cannot be operated is a
  promise this build does not keep (U11 makes it one).
- 2026-08-04 PROPOSED (U8): multi-ruleset reviews move to U9. 04 specs a
  ruleset multi-select; U8 shipped a single-select grouped by tier with
  enabled-rule counts. The read side already merges plural snapshots
  (`readReviewSnapshot`), so the remaining work is the write side: creation
  and start accepting several ruleset ids and freezing each. That is ruleset
  composition, which is U9's domain. Logged per the standing rule rather
  than asked, since no listed item owned it.
- 2026-08-04 DECIDED (U8): the branch list names the moment it was read from
  the remote and offers Refresh beside it, and the pre-flight shows the merge
  base commit it computed. Both were fetched and thrown away; a review is an
  assertion about two commits, and the screen setting one up should say which
  moment and which base it is talking about.
- 2026-08-04 AMENDED (U9, D-48): the unmapped-lines block cannot fire on the
  importer as it stands, and that is a property, not a gap. Probed with a
  leading stray line, a trailing unowned appendix, and a stray between
  blocks: the block partitioning claims every line of any document, because
  every heading owns its whole block, non-rule blocks become directives
  verbatim, and preamble becomes one. D-48's intent, that nothing is silently
  dropped, is met by construction and pinned by the lib tests plus the
  byte-for-byte round trip. The import route now returns the fidelity
  numbers (the screen says "All N lines accounted for" with the importer's
  own counts) and keeps the 400-with-lines branch as a trap that only an
  importer regression can spring. A blocked-import browser test was planned
  and is unwritable against a correct importer; the e2e asserts the positive
  sentence instead.
- 2026-08-04 DECIDED (U9): severity edits move the version through the same
  door as the toggle. One `patchRule` carries both, refuses nothing-to-change
  bodies at the route, and a patch that changes nothing costs no version.
  A WARNING promoted to CRITICAL is a different standard, and a report
  naming "version 3" must identify exactly one standard.
- 2026-08-04 DECIDED (U9): duplicate-to-tier copies the ruleset as used, not
  the document as first imported. The copy keeps the toggles as they stand,
  starts at version 1 with its own history, and is built through the same
  save path an import uses, so a copy and a re-import cannot mean different
  things. The usual move is promotion: a rule proven on one project becomes
  a standard elsewhere.
- 2026-08-04 DECIDED (U9): a refused project delete now carries its review
  count as a field and the screen offers the remedy 02 promises: delete the
  blocking reviews first, behind its own second step, naming the count. The
  bulk route removes owned and linked-referencing reviews both, because a
  linked review blocks the delete just the same, and refuses the whole batch
  while any is running rather than killing one mid-run. Exported reports
  survive, because exports live outside the review's artifacts.
- 2026-08-04 DEFERRED (U9 to its own slice): multi-ruleset reviews. The
  refinement of the U8 PROPOSED entry after reading the merge: composing two
  rulesets can collide on rule codes, which would make findings.ruleCode
  ambiguous and run one rule's sweeps twice, so the write side needs a
  collision refusal designed with it. That is its own reviewable change, not
  a rider on U9's six features; 04's gap line keeps naming it.
- 2026-08-04 FIXED (review round 2, P1): duplicating a ruleset twice under one
  name overwrote the first copy instead of making a second. Found by running
  it: two duplicates returned the same id. `saveImportedRuleset` is keyed by
  name and replaces what it finds, so the second copy adopted the first
  copy's row, wiped whatever had been toggled or re-graded into it, and reset
  its version to 1 while a past review could still name a later one. The
  duplicate path now refuses a taken name (`RulesetNameTakenError`, 409) and
  the screen offers a name field to resolve it. Merging silently was never a
  candidate: a copy that quietly becomes an edit of something else is the
  kind of surprise this app exists to refuse.
- 2026-08-04 DECIDED (U10, D-56): 04's "severity is the only place strong
  colour appears" is amended to scope that rule to review content. Severity
  owns red, amber and blue wherever findings are shown; outside findings, the
  good and critical tokens may mark a run's own state (a status chip, a
  failed clone, a confirmation that landed). The alternative, holding the
  literal rule, would have meant a status chip in neutral grey on every
  screen, which loses the one thing a status chip is for. What is preserved
  is the actual intent: on any screen showing findings, nothing but a
  finding's severity uses a severity colour, so a red badge never competes
  with red chrome for the same meaning.
- 2026-08-04 DECIDED (U10): the app's own screens carry the 40px hit target
  at the kit rather than per screen. `Button`, `Input`, `Textarea` and
  `Select` set `min-h-[var(--hit-target)]`, because a floor honoured only
  where someone remembered is not a floor. Reduced motion likewise moved
  from the one pulse class to every animation and transition: each is
  decorative feedback on a state the screen also states in words, so removing
  them all costs a reader nothing.
- 2026-08-04 DECIDED (U10): deleting all data walks the same delete paths the
  single buttons use rather than truncating tables, so a wipe cannot orphan
  the clones and run directories a raw delete would leave on disk. Exports
  are kept and the response says so: a report is the thing a review was for,
  and someone clearing working state is not asking to lose the reports they
  already wrote. It refuses while any review is running, which is
  mutation-proved (neutering the guard fails the test).
- 2026-08-04 FIXED (review round 2, P1): deleting a queued review stranded the
  scheduler. The queue holds ids, and nothing in any delete path took an entry
  out of it, so a review deleted while it waited made `launch` throw from the
  `finally` of the run that ended. That both escaped as an unhandled rejection,
  which under Node's default policy ends the process, and abandoned the loop
  that starts the next review, leaving every review behind it queued forever
  while the screen kept saying so. Two changes, because either alone leaves a
  hole: the delete paths now dequeue first (`manager.dequeue`), and
  `startNextQueued` skips a review whose row is gone and reports any other
  fault to that review's watchers rather than out of a promise nobody holds.
  Mutation-proved: removing the guard fails the new test.
- 2026-08-04 FIXED (review round 2, P1): holding `c` in the confirmation queue
  walked down the list confirming findings. The key had no in-flight guard,
  unlike the button beside it, so a repeat fired a second decision that landed
  on whichever finding the first had already advanced to. Nothing may enter a
  report without a person deciding it, and holding a key is not deciding
  twenty things. The handler now ignores auto-repeat outright and respects the
  same `busy` flag the button does.
- 2026-08-04 FIXED (review round 2): the dismissal reason was one string
  shared by the whole queue, so an abandoned draft on one finding was still in
  the box on the next, and dismissing that one recorded, permanently, why
  something else was not a problem. Reasons are now keyed by finding exactly
  as the comment drafts already were. The browser journey asserts both halves:
  moving away leaves the box empty, and coming back finds the draft.
- 2026-08-04 FIXED (review round 2): a failed probe and a failed start both
  returned the control to idle with nothing said, which reads as a click that
  never registered rather than a request that failed. Both now surface the
  message, and both have a catch, so a rejected fetch is not an unhandled
  rejection.
- 2026-08-04 DECIDED (U11): Mode B exists behind a seam rather than as a
  branch inside the headless runner. `ReviewEngine` (server/engine/adapter.ts)
  is the narrowest thing the pipeline already needed: ask a stage, get a
  validated answer. Which engine answers is the review's own frozen column,
  not a live setting, so a resume cannot change what a run means half way
  through.
- 2026-08-04 DECIDED (U11): the interactive engine is not a looser review. It
  composes the prompt with the same code, validates the answer against the
  same schema before the pipeline sees it, and the pipeline's reconciliation
  runs over it unchanged, so an answer that skipped a hunk is refused there
  exactly as it would be in Mode A. Usage is recorded as zero rather than
  estimated: the tokens were spent in someone else's session and a guess would
  corrupt the one number the user makes decisions with. A run note says so on
  every interactive review. Proof: eight unit tests over the exchange
  contract, plus a full review driven end to end from files on disk with no
  CLI path configured at all.
- 2026-08-04 FOUND (U11): the ideal-answer fixtures carry
  `<<candidate:path:line>>` placeholders that the fake CLI resolves by reading
  the verification prompt, so any engine that does not go through that fake
  must resolve them itself. The Mode B integration test does it the way a
  person would, from the prompt it was handed. Recorded because the first
  attempt looked like a product failure (a completed review with zero verified
  findings) and was a harness gap.
- 2026-08-04 FIXED (U12): 04 section 4 claimed WCAG AA "checked in e2e via
  axe" and nothing checked it. `@axe-core/playwright` now runs over every
  screen in both themes plus the completed review, scoped to WCAG 2 A and AA
  (best-practice rules are opinions, and failing a suite on an opinion trains
  people to ignore it). It found three real violations on first run, all now
  fixed rather than waived:
  - `--color-ink-faint` failed contrast in both themes (64% light, 58% dark).
    Moved to 52% and 68%. The third grey now sits close to the second, which
    is the honest trade: AA is not negotiable against a preference for three
    distinct tiers.
  - The WARNING severity badge measured 3.75:1 on its own soft background,
    the only severity badge that failed. Amber reads lighter than red or blue
    at equal lightness, so it had been set to 58% where the others sit at
    52%; it is now 49%.
  - Scrollable regions (the report, the activity log, the rule text, the diff
    hunk, the file context, the findings list) had no keyboard access. Each
    now takes focus and carries a name, so it is reachable and announced as
    something rather than as an unlabelled tab stop.
  The claim in 04 is now checked on every run rather than asserted.
- 2026-08-04 DECIDED (U12): the `defaultModel` and `defaultEngineMode`
  settings keys are deleted rather than given readers. Both were catalogued
  from the start and never read by anything, and U11 made the engine a
  per-review decision frozen on the row, which is the right place for it: a
  global default that a review could silently diverge from is worse than no
  default. A settings key nothing reads is a promise the screen does not
  keep.
- 2026-08-04 DONE (U12): CI uploads `review/`, `test-results/` and
  `playwright-report/` on every run, passing or failing. On a failure they are
  what the failure is diagnosed from; on a success the screenshots are the
  record of what the app actually looked like at that commit, which is the
  whole point of photographing it.
- 2026-08-04 DECIDED (U12): the browser suite can arm a usage limit with a
  file. Its server boots once for the whole run, so an environment variable
  cannot be changed per test, and a pause was the one ordinary ending no
  browser had ever walked. A test writes the trigger, the next spawned CLI
  reads it, un-counts its own call so the answer it would have used is still
  waiting, and fails the way a real limit does. The journey now proves the
  whole arc through a screen: paused rather than failed, the CLI's own words,
  when the limit clears, resume, and completion. D-55 stands for restart
  recovery, which stays at the integration layer.
- 2026-08-04 DONE (U12): the journey asserts the exported report equals the
  confirmed set exactly: the findings section holds one entry per confirmed
  finding and none for the dismissed one, whose reason appears only in its own
  section. Counting was the missing half; the report already carried the right
  content, and nothing checked that it carried only that.
- 2026-08-04 DECIDED (maintainer): the CLI's top effort tier, `max`, is not
  offered for any model and is refused at the API. It is the ultracode
  setting: extra-high reasoning plus the ability for the session to spawn its
  own workflows and sub-agents. A review here already fans out across five
  stages and as many batches as the profile calls for, runs unattended, and
  spends a subscription this app is a guest on, so that tier turns one review
  into an unbounded amount of someone else's usage. The value stays in
  `REVIEW_EFFORTS` because reviews created before this rule still name it and
  a row that stopped parsing would take its whole review with it;
  `SELECTABLE_REVIEW_EFFORTS` is what the picker reads and what the route
  checks. Enforced in both places on purpose: a rule only the screen knows is
  not a rule.
- 2026-08-04 DECIDED (U12): `ledger_files.risk_tags` gains its reader rather
  than being dropped by migration. S1 must classify risk whatever happens (03
  section S1), so removing the column would leave a stage that spends tokens
  and produces nothing, and would need two ratified specs amended. The reader
  is the ordering 03 already specifies: after S1's tags are persisted they are
  read back and used to permute the file list handed to S2, S3 and S4, and the
  path list handed to `planRuleBatches`.
  The rank is how many DISTINCT categories a file touches. The protocol lists
  its seven categories without ranking them, so ordering by severity would
  mean inventing a severity the protocol does not state, while "how many kinds
  of risk does this one file carry" is derivable from what S1 actually
  answers. Distinct, not counted: the stage schema puts no uniqueness
  constraint on the array, so a model repeating itself would otherwise outrank
  a file genuinely touching two categories.
  Coverage is untouched by construction: the result is a permutation, and
  every reconciliation downstream compares sets rather than sequences.
  Mutation-proved twice, which matters here because in a normal run the
  column and the in-memory answer are equal and no black-box test can tell
  them apart: removing the ordering fails two tests, and reading the S1 answer
  in memory instead of the ledger fails three.
- 2026-08-04 DECIDED (U12): the equal-risk tie-break ranks against the
  inventory order, not against the ledger's rows. `listLedgerFiles` is a bare
  select with no ORDER BY, so ranking its output would move the tie-break to
  whatever order SQLite happened to return, and no pure-function test could
  catch that regression.
- 2026-08-04 DONE (U12, D-54): the dead-export sweep, first pass. Deleted with
  no test changes at all, because none of these had a consumer of any kind:
  `userEventSchema` and the `SystemInitEvent`/`AssistantEvent`/`RateLimitEvent`
  aliases; the `LEDGER_FILE_STATUSES` triple (the ledger writes and compares
  the raw strings); `AuthStatus`; the `EngineRunner` alias, whose own comment
  claimed callers held one directly when every caller imports `ReviewEngine`
  from the adapter; the `StageFailedError` pass-through re-export; the
  `listLedgerFiles` re-export from the pipeline; and the manager's
  `ReviewEvent`/`ReviewListener` re-exports.
  The one worth naming is `symbolDispositionSchema` with its
  `SymbolDispositionOutput`. It was a stale duplicate that contradicted the
  live shape: two verdicts where the module-private
  `symbolDispositionEntrySchema` has three, the third being
  `no_consumers_found`, which carries a long comment explaining why it must
  exist. A dead schema is untidy; a dead schema that disagrees with the live
  one about what a valid answer looks like is a trap for whoever reaches for
  the wrong name.
  `docs/plans/EXECUTION-ORDER.md` and `M2-FINISH-PLAN.md` named two of these
  symbols and were corrected in the same change.
- 2026-08-04 DECIDED (U12): no column is dropped in this pass, and the
  write-only ones are recorded instead. G1 is awaiting a verdict, migrations
  run against the maintainer's live database, and SQLite column drops rebuild
  tables carrying foreign keys and indexes, so a batch of destructive schema
  changes ahead of a gate verdict is out of order. Still unread, deliberately:
  `ledger_hunks.clear_reason`, `sweep_hits.clear_reason`,
  `sweep_hits.finding_id`, `reviews.linked_into_branch`,
  `reviews.linked_into_commit`, `reviews.into_commit`, `findings.verified_at`,
  `findings.decided_at`, and the accumulate-only
  `reviews.usage_cache_creation_tokens`. `engine_mode` is no longer among them:
  U11 gave it its reader.
  `renameProject` is also kept though unreferenced: 02 still carries project
  renaming as an unbuilt requirement, and deleting the function would retire a
  documented requirement by stealth rather than by decision.
- 2026-08-04 D-57 (U13): the haiku smoke failing is the coverage law working.
  With the maintainer's go, the real-engine smoke ran first on
  claude-haiku-4-5-20251001: it reached S3 and the pipeline refused to
  complete the stage, with one hunk unaccounted for, two changed symbols
  undispositioned, and two symbols dispositioned that were never in the
  change set. The score reads "0/8" only because candidates persist after
  reconciliation, which never happened; the run did not miss quietly, it was
  stopped loudly. This is D-18 confirmed by a live run (haiku is a plumbing
  smoke, never a quality claim) and the first empirical proof that the
  refusal is mechanical rather than prompt-trusted.
- 2026-08-04 D-58 (U13): a real-run failure of the fake gate's blind class
  gets an echoing test, not just a fixed expectation. The first fable run
  answered S3 with substantively perfect dispositions and was refused on
  spelling: it wrote symbols against their worktree paths
  ("shared-core/types.ts") while the expectation held repo-relative ones
  ("types.ts"), because the symbol listing was the one place the prompt still
  spoke repo-relative paths. The fake suite could never catch this: ideal
  answers echo the expectation, so prompt and expectation can drift apart
  invisibly. Fixed (06cf1a7) by qualifying changed symbols at the pipeline
  boundary like every other path family, mandating in the prompt that paths
  be copied exactly as printed, and adding two tests, one of which answers
  with what the prompt actually printed rather than with the expectation.
- 2026-08-04 D-59 (U13) PROPOSED: scope S4 so a modification is not reported
  twice. In both clean fable runs, S3 raised the nine distinct defects and
  S4, whose brief is deleted code, raised the same nine again in different
  words by reading the deleted side of each modification as a deletion; all
  eighteen candidates verified, so the confirmation screen would show every
  defect twice. Proposed: tighten the S4 prompt to deletions without a
  replacement, and consider a mechanical same-path, same-line cross-stage
  dedup at candidate creation. Any prompt change goes through the standing
  rule that the fake quality gate runs first and the real model after.
  Also observed, recorded, not fixed: fable writes ruleCode as prose
  ("Rule 11") where the ruleset speaks bare codes ("11"), and the stage
  schema accepts any string.
- 2026-08-04 DONE (U12): the dead-export sweep, second pass, the exports only
  their own tests kept alive. Deleted: `listPendingHunks` (its assertions now
  ask `coverageReport`, the surface the app asks), `projectNameFromUrl` (the
  projects route's own `nameFromUrl` is the live rule; not consolidated
  because the two disagree on fallbacks), `listReviewsForBranchPair` (the UI
  lists by project; the branch-pair index stays with an honest comment),
  `listSelectable` (U8 moved the rule to `availabilityOf`; the staleness test
  got stronger in the rewrite), and the state-machines introspection five
  (`reviewTransitionsFrom`, `findingTransitionsFrom`, `isTerminalReviewStatus`,
  `isTerminalFindingStatus`, `isReportableFindingStatus`), whose claims now
  run exhaustively through `canTransitionReview`/`canTransitionFinding`.
  The failed-to-running positive was explicitly preserved and both it and the
  candidate-fates loop are mutation-proved: emptying `failed`'s transitions
  fails two tests by name, removing a candidate fate fails one.
  `canTransitionClone` and `canTransitionFinding` stay exported though only
  self-used: un-exporting working code is churn, not cleanup.
- 2026-08-04 D-60 (U12): the whole-file deletion defect is raised by S4 and
  only S4 can raise it. The fixture deletes src/orders/retry.ts while its
  caller, untouched and absent from the diff, still imports it; an S3 finding
  citing that caller is rejected because every S3 finding must land in a hunk
  of the change set. An S4 finding faces no coverage reconciliation at all,
  by design: it bypasses hunk, sweep and symbol reconciliation and answers
  only to the quote check against the worktree. This is the first such
  finding in the fixture, so the property is now stated rather than left to
  be inferred. This discharges the 2026-08-03 deferral.
- 2026-08-04 D-61 (U12): the changed-default plant needed a consumer before
  it was a defect. Rules 12, 13 and 14 take their numbers in document order
  (deletion, duplication, dependency); prefs.ts consumes
  DEFAULT_TIMEOUT_SECONDS byte-identically on both sides of the diff so the
  defect stays cross-repo; and the ideal answers derive symbol dispositions
  from the manifest because with two broken symbols a hardcoded name check
  would produce a clear the pipeline itself rejects. The rule-4 retag of
  unmigrated-consumer (its citation is wrong: the Prefs interface has no
  index signature) was considered and deferred to the idea inbox rather than
  ridden along on a four-gap change.
- 2026-08-04 D-62 (U12): the fixed variant is a third branch,
  rename-prefs-migrated, cut from the feature branch with exactly one file
  repaired, so its answer key is the manifest minus the cross-repo pair. Two
  naming constraints are load-bearing for the browser suite and pinned by
  test: it sorts after main under the refname tiebreak (the into-branch
  fallback must keep landing on main) and it does not contain the substring
  feature/rename-prefs (Playwright hasText matches substrings). HEAD is
  restored to the feature branch after the build because the bare clone
  inherits HEAD and the new-review screen's detected default reads it. Its
  consumer lists are derived by walking the repaired tree, and the gate's
  claim is precise: the pipeline does not persist symbol dispositions, so
  what is proven end to end is that a repaired change set produces clears
  the pipeline accepts, with every claimed consumer existing and using the
  symbol.
- 2026-08-04 REVIEW ROUND (after U12, per the charter): a structured pass
  over the day's fourteen commits, focused on the two gate-adjacent scripts
  and the fixture rebuild. Zero defects requiring fixes. Two notes: the
  check-style review-json exemption assumes "/" as the separator, which on a
  non-Linux machine fails closed (more is scanned, never less); the demo's
  run-label sanitiser was traced against the observed directory name. The
  heavier changes carried their proof when they landed: two mutation proofs
  on the S4 routing and the state-machine tests, and two full
  `./verify.sh --build --e2e` runs at exit 0.
- 2026-08-04 D-63: a protocol document is normalised for line endings on
  import, and duplicate rule codes stay refused. The maintainer's real
  2,774-line protocol imported as zero rules because it was saved with CRLF
  endings and JavaScript's `.` does not match a carriage return, so not one of
  its 129 headings matched the heading pattern. Normalisation happens once, at
  the top of `importProtocol`, so nothing downstream and nothing stored
  carries a stray return.
  Fixing that exposed a second refusal: the document numbered five checklist
  items under a level-4 heading, colliding with real rules 1 to 5. Two ways
  out were put to the maintainer, and the decision is that documents give way
  rather than the importer: the five checklist headings were de-numbered in
  the source document. The alternative, treating only the shallowest numbered
  heading level as rules, was rejected because a later document adding one
  shallow numbered heading would silently demote a whole family of real rules
  to prose, which is the exact failure this module exists to prevent.
- 2026-08-04 D-64: a sweep pattern is read as a regular expression when it is
  one, and as literal text when it is not. Refusal is kept only for a pattern
  that cannot run either way.
  The maintainer's first real review, 61 files against their own protocol,
  failed in S0 at $0.0000 because rule 29's pattern `new Date(` is an
  unterminated group to the regex engine. The protocol is not wrong: people
  write sweep patterns as code fragments, and `new Date(`, `console.log(` and
  `items.map(` all mean find this text. Killing a whole review over one
  character of punctuation, with an error naming the symptom rather than the
  fix, is the worse failure.
  Rejected, always-literal: the example protocol's own patterns are real
  regexes (`\bas\b`, `console\.`), and reading those literally would match
  nothing while looking like a clean sweep. Rejected, guessing the author's
  intent: not knowable from the string.
  The residual risk is stated rather than hidden. A genuinely mistyped regex,
  `console\.(log|warn` with the bracket missing, now runs as literal text and
  finds nothing, where before it stopped the run. That trade is only
  acceptable because it is recorded at both ends: the pre-flight lists every
  pattern that will be read as text before anything is spent, and the run
  carries a note naming them. `assertSweepComplete` stays as the boundary for
  a pattern that cannot run at all, which escaping makes unreachable today.
- 2026-08-04 D-65: the private-material gate scans untracked files too, not
  only tracked and staged ones. A plan document written this session carried a
  private product name; `./verify.sh` was run before `git add`, the file was
  untracked, the gate had nothing to look at, and the name reached a commit.
  It was caught on the next run, when the file had become tracked, and the
  commit was amended before it left this machine. A gate that only sees a file
  after it is staged cannot protect the commit that stages it, so the scan now
  includes `git ls-files --others --exclude-standard`. The exclusion is what
  keeps `docs/private/` and `review/` out, which is the same list `.gitignore`
  already maintains. Proven both ways: an untracked file carrying the name
  fails the gate, and the ignored private material still passes.
- 2026-08-04 D-59 DECIDED (was PROPOSED, same day): a finding the deletions
  stage raises that the adversarial stage already raised is folded into the
  earlier one, and the count is written on the run.
  Both clean runs of the seeded fixture produced nine distinct defects as
  eighteen candidates: a modification removes lines as well as adding them, so
  S4 reads the removed half of a change S3 has already reported and reports it
  again in different words. Every finding in the review would have been decided
  twice by hand.
  Folded rather than kept-and-dismissed, because the duplication is the
  defect, not a judgment for the person to make eighteen times. Counted rather
  than folded silently, because how often S4 repeats itself is the measurement
  of whether its prompt is scoped correctly, and a silent fold would erase the
  only evidence that it is not.
  The match is deliberately narrow: same file, same rule code, overlapping
  line ranges. Matching on position alone would merge two genuinely different
  findings that cite one line, and a fold that ate a real finding is exactly
  the silent loss this pipeline exists to prevent. The cost of the narrow
  match is that a duplicate whose rule code is spelled differently by the two
  stages survives; that is visible noise, and prose rule codes are their own
  item.
  The second half, scoping the S4 prompt to deletions without a surviving
  replacement, is deliberately not done yet. The fold note is now the
  instrument that measures whether it is needed: a real run that reports no
  folds needs no prompt change, and one that reports nine has its evidence.
  A prompt change on speculation would be a paid experiment with no baseline.
- 2026-08-04 D-66 (WP-D): a rule code from a stage answer is read back to the
  ruleset's own spelling at the boundary where the answer enters, and a code
  that cannot be resolved is kept verbatim rather than nulled or guessed.
  Models answer in prose about as often as not: both live runs of the fixture
  returned "Rule 1" where the protocol says "1". Two things break on that. The
  confirmation screen looks the code up to show the rule's own words beside
  the finding, which is how a person judges whether the rule says what the
  engine claims, so a prose code renders as "Rule Rule 1" and reports the rule
  as absent from the ruleset it came from. And the adversarial stage's sweep
  dispositions are reconciled against hits whose codes come from the ruleset
  itself, so one prose code there fails reconciliation and stops the run.
  Kept verbatim when unresolvable, because what the model cited is evidence
  about the prompts; nulling it would hide that a rule was named at all, and
  matching it to the nearest code would put words in the protocol's mouth.
  The screen already says such a code is not in the frozen ruleset.
  The prefix stripped is a word and its punctuation, never digits, so a
  ruleset containing "1" cannot swallow a citation of "11".
- 2026-08-04: the inbox's claim that `clearHunk` demands a reason while the
  sweep-clear guard does not is FALSE, checked against the live code and
  removed rather than built. `clearHunk` and `clearSweepHit` both reject a
  reason that is empty after trimming, with their own messages, and the stage
  schemas require a non-empty string for both `clearedHunks[].reason` and
  `sweepDispositions[].reason`. The only `reason` in the stage schemas with no
  minimum is S1's risk rationale, which disposes of nothing and refuses
  nothing; it stays as it is rather than gaining a constraint that could fail
  a run over a cosmetic field.
- 2026-08-04 REVIEW ROUND (after the WP-A to WP-F cluster, per the plan's
  cadence): a pass over the day's eight behaviour-changing commits. One
  finding, fixed in the same pass.
  Finding 1: the D-59 fold matched on rule code equality, and two findings
  that both name no rule compared equal, so a deletions-stage finding citing
  nothing could be folded into an unrelated adversarial one at the same line.
  The observed duplication always carried rule codes, so this was a latent
  path rather than an active defect, but it is the one direction this fold
  must never take. A finding naming no rule is now never folded; the test
  fails by name when the guard is removed.
  Checked and sound: the literal-pattern fallback never changes a valid
  regex's meaning; the fold cannot merge across repositories, since ledger
  paths carry their slug; the deleted-module finding, which S4 raises by
  design, is not foldable because no adversarial finding exists in a file
  outside the change set; the rule-code reader strips a word and its
  punctuation, never digits, so "Rule 1a" against a ruleset holding "1" is
  kept rather than snapped; and the private-material scan over untracked
  files did not grow the file count, so .gitignore is doing the excluding.
  `./verify.sh --build --e2e` exited 0 over the whole cluster.
- 2026-08-17 D-67: the house-style gate's target list distinguishes required
  directories from optional ones, and `review/` is optional. It joined the
  scan during the design pass so captured prose would be checked, but the
  directory is gitignored by design, so it exists on workstations and not on
  a CI checkout; the misconfiguration guard then failed every CI run with
  exit 2 while every local run was green. An environment-dependent gate is
  the exact failure the guard exists to catch, pointed the wrong way. An
  absent optional target is skipped by name in the output; a present one is
  scanned in full; a missing required target still exits 2. Proven all four
  ways, including under a fresh worktree with no gitignored directories,
  which is CI's checkout exactly.
- 2026-08-17 D-68: the UX direction is ratified as the restrained night
  instrument, chosen by the maintainer from three rounds of generated mocks
  rather than from adjectives. Dark leads and light is derived; both stay
  first-class and photographed. The language: near-black blue-gray matte
  surfaces, thin 1px borders, one cyan-teal accent reserved for interactive
  elements and progress, monospace for everything code-adjacent, large
  tabular numerals for headline counts, and glow spent on at most one live
  element per screen. The severity law is unchanged and was re-proven by the
  process: the rejected full-neon round is the one where CRITICAL red
  drowned. Per-screen picks: the confirmation queue with line-referenced
  finding rows, a failure-mechanism strip under the code, and honest stat
  tiles (what the review cost, how long it ran); the dense scoreboard with
  named per-rule yield bars and local-history sparklines; the typographic
  report (title, one bold summary sentence, prose-first finding cards,
  provenance footer); the mobile single-column queue with bracketed
  Confirm/Dismiss. Elements from the mock rounds that are banned from ever
  shipping, with reasons: predicted remediation cost and fix duration (the
  product cannot measure them), a live critical-miss rate (measurable only
  on the seeded fixture, a lie on real code), contributor leaderboards,
  avatars and reviewer columns (no accounts exist; cross-person competition
  is the documented distortion), an AI-confidence percentage (invented; the
  real figure is verification survival), apply-recommendation actions (the
  app never writes to reviewed code, by architectural law), and
  search/notification/account chrome (nothing behind them). The maintainer's
  mock set is designated evidence at review/2026-08-17-ux-direction/, kept
  local like all review evidence.
- 2026-08-17 D-69: the UX plan's gates are answered by the maintainer, on
  the recommendations. Gate 1 yes: the review screen becomes queue-first and
  state-dependent. Gate 2 tier b: measurements plus momentum, completion
  moment and the honest wait; streaks, badges, levels and decision-speed
  metrics are rejected in writing. Gate 3: resolved by D-68. Gate 4 yes:
  the report renders in-app and exports as a self-contained single HTML
  file beside the markdown. Gate 5 yes: home becomes the scoreboard. Gate 6:
  multi-ruleset composition stays deferred. The direction is proven on the
  confirmation queue first. Mobile scope: responsive monitor-and-decide on
  phone widths; setup flows stay desktop-first. My-branches: a branch
  counts as mine when its tip commit author email matches the identities in
  settings, seeded from git config, with no manual assignment in v1.
- 2026-08-17 D-68 amended, same day: the confirmation queue builds from the
  denser of the two final queue mocks, chosen by the maintainer for a
  reason now promoted to a requirement: the file path is always visible,
  on every finding row (path and line beside the title) and as a filename
  header on the code panel. A reviewer's first orientation question is
  "where am I", and a queue that answers it only in the detail pane makes
  every list scan a click. The evidence set is saved at
  review/2026-08-17-ux-direction/ with a README noting one mislabel
  corrected during filing.
- 2026-08-17 D-70: `./verify.sh --e2e` builds first, because the browser
  suite serves the built output. Playwright starts its server with
  `npm run start`, which serves whatever was last built, so `--e2e` without
  `--build` ran the whole browser suite against stale output: green, and
  blind to the change being verified. Found by watching a layout change fail
  to appear in its own screenshot, then pass its e2e run anyway.
  This is the false-positive class the charter names: a passing test that
  does not exercise the change does not count. Two runs earlier today
  reported `--e2e` green over UI changes that were not in the built bundle
  (the cache-write panel, 5686d81, and the first attempt at this one). Both
  are now covered by full runs that built first; no defect survived, but the
  proof was weaker than the commit messages claimed, and that is recorded
  rather than quietly fixed.
- 2026-08-17 D-71 (WP-D): the adversarial stage plans every request before it
  sends the first one, so a batched prompt can say which of how many it is.
  It passed a total of zero, which is falsy, so the "This is request N of M"
  line the prompt was written to carry was skipped on every batched request
  ever sent: a decomposed or chunked run told each request to account only
  for what it was shown while never telling it that other requests existed.
  No coverage was lost, since reconciliation compares the merged answer
  against the whole change set either way, but the prompt did not say what it
  was written to say and nothing noticed for as long as batching has existed.
  Planning up front costs one extra pass over the batches and makes the total
  knowable; the same numbers now ride on the stage request, so a runner can
  report progress through a stage that makes nine calls rather than one.
  Pinned by a test that fails when the total goes back to zero.
- 2026-08-17 D-72 (WP-H): the palette is retuned to D-68 and the token set is
  made honest. The accent moves from blue at hue 250 to the cyan-teal of the
  ratified direction at hue 200, the dark surfaces deepen so a panel reads as
  raised off its ground, and the open-question tone shifts to 265 so it is not
  read as the accent. Severity stays at 25 and 75, far enough from the accent
  that a CRITICAL badge can never be mistaken for chrome; axe checked every
  screen in both themes and passed.
  Two token families were not merely unused, they were unusable. The type
  scale did generate utilities and nothing had ever referenced one, so
  headings now sit on the heading step and page titles on the title step.
  The spacing set generated nothing at all: Tailwind reads --spacing-*, this
  file declared --space-*, so no component could have used one even by
  accident. They are deleted rather than renamed, because the 4px grid 04
  asks for is Tailwind's own scale and a second vocabulary for it is a
  decision nobody could apply consistently, which is exactly what happened.
  Motion tokens stay, read through arbitrary values, so a duration is named
  once rather than typed into a component.
- 2026-08-17 D-73: where the saved mock and the written record disagreed, the
  saved file wins. The maintainer kept `report-final.png` and
  `scoreboard-final.png` as the denser left-hand variants while D-68's prose
  described the right-hand ones, said "happy with all of these" and then said
  go three times without settling it. Continuing to ask was blocking work
  that was asked for repeatedly, so it is resolved this way and recorded
  rather than left implicit: the picked file is what the maintainer chose
  with their hands, and prose written about a picture is the weaker evidence.
  One element of the recommendation survives regardless, because D-68's own
  rule requires it: rule-yield bars name their rule. Anonymous bars are a
  measurement nobody can act on, and "every element surfaces a measurement
  the product already makes" is meaningless if the reader cannot tell which
  rule a bar is about. If the maintainer meant the other variants, replacing
  the two files re-opens this cheaply, since the difference is density rather
  than structure.
- 2026-08-17 D-74 (WP-C): the report is typeset from the same structured
  input the markdown is written from, and exports as a self-contained HTML
  file beside it. No markdown parser is involved: the page and the document
  are two renderings of one build, so they cannot drift, and nothing has to
  infer what a heading was from a string. The HTML carries its styles inline
  and requests nothing, because a report that phones home for a stylesheet
  stops working the moment it is opened somewhere else, which is the only
  place it is ever opened. Markdown stays the archival form and is what the
  suite still asserts document structure against. The screen names the HTML
  path, since that is the file a person sends to whoever fixes the code.
- 2026-08-17 D-75 (WP-F): the root is the scoreboard rather than a redirect to
  Projects, and every figure on it is counted from rows this app wrote. The
  app opened on a list of repositories and never once said what any of the
  work had produced, while the database held all of it: what reviews cost, how
  often a finding survived a person's judgment, how often the engine cited
  code that was not there, and which rules of a protocol ever earn a place in
  a report.
  Two rules make this the honest version of a dashboard. A rate with no
  denominator renders as a dash, never a zero, because zero percent is a claim
  about findings that were judged and "nothing has been decided yet" is a
  different statement. And the sparkline is one mark per completed review in
  the order they ran, drawing nothing below two reviews, because a line
  through a single point is a shape invented for decoration.
  Killed findings are the point here. They are filtered out of every other
  screen deliberately, and this is the one place they are the measurement:
  the invention rate is what the quotation check killed out of everything
  raised. Rule yield is sorted worst first, because the rule costing the most
  attention for the least return is the one an author needs to see, and each
  bar names its rule: an anonymous bar is a measurement nobody can act on.
- 2026-08-18 D-76: the prompt travels on the CLI's stdin, never in argv. The
  maintainer resumed the first real review of a real project and it died at
  the second stage with `spawn E2BIG`. Linux caps a single argument at
  MAX_ARG_STRLEN, 128KB; the comprehension prompt for a 61-file change set
  measured 297,207 bytes, so execve refused the command outright. The failure
  was not a large-review failure but a real-review failure: every change set
  big enough to be worth reviewing was too big to review, and the seeded
  fixture's prompts are three orders of magnitude smaller, so nothing in the
  suite could ever have caught it.
  `-p` is a flag, not a value. The CLI's own help calls it useful for pipes
  and documents `--input-format text` as the default for print mode, which is
  the stdin path. The prompt is written to the child and the stream closed at
  once, since the CLI reads until end of input and a stream left open is a run
  that waits forever. The probe travels the same way and exports its prompt
  for the purpose. The fake CLI reads stdin and records what it read, so tests
  that assert what a stage was told keep working, and a new test refuses an
  argument vector containing anything above the kernel's limit.
  Stated rather than left implied: only the per-review prompt was unbounded.
  The system prompt is composed from the ruleset and stays in argv, so a
  protocol large enough to matter will need the same treatment, and the test
  says so.
- 2026-08-18 D-77: a review's `startedAt` is stamped on every entry into
  running, not only the first, so the duration times the run rather than the
  calendar. It was written once and never again, so the maintainer's review,
  begun on 2026-08-04 and resumed on 2026-08-18, reported having taken 327
  hours: a number made almost entirely of sitting still, on a screen whose
  whole claim is that its numbers are measured. A resumed run is a new run,
  since every stage already answered replays from its checkpoint for free and
  what remains is the work actually being done. When a review was created is a
  separate fact and `createdAt` still holds it. The test that asserted the old
  behaviour now asserts this one and says in its comment that it used to say
  the opposite, because a reader finding it later deserves to know the
  reversal was deliberate.
- 2026-08-18 D-78: no screen scrolls the page sideways, enforced on the body
  and checked in the browser. 04 has always said it; nothing measured it. A
  run note naming sixty-one changed paths, and engine output carrying a whole
  JSON answer on one line, each widened their container until the document
  itself scrolled and every panel sat off centre. Long notes wrap, the
  activity panel scrolls within itself rather than clipping, since clipped
  text is lost text, the aside may shrink, and `overflow-x: hidden` on the
  body is the floor so a screen written later cannot forget. A Playwright
  check compares scrollWidth against clientWidth on every top-level screen.
- 2026-08-18 D-79: the visual identity is the instrument itself, named so it
  can be judged: the drafting board. The app is named for a drafting tool, so
  the ground is drafting paper, a faint dot grid on the 4px rhythm with one
  low wash of accent falling from the top; panels are machined, carrying a
  one-pixel top highlight so a surface reads as an object under light rather
  than a rectangle of a second grey; progress tracks are ruled gauges, ticked
  like the tool, so a fill reads as a measurement against a scale; and the
  display voice is the monospace face, on titles, tile numerals, micro-labels
  and badges, because the product's subject is code and its numbers are
  measurements. The glow budget from D-68 is spent on the live pulse alone.
- 2026-08-18 D-80: while a review runs, the scan takes the whole screen. The
  maintainer asked for exactly this ("when doing a scan, I want it to take
  over the screen, I want to see it do things; people want to see progress"),
  and the research half of the UX plan supports it: visible work is the
  honest form of the labor effect. The theater covers the rail because
  watching a scan is a mode, not a page; it shows the pipeline as a ruled
  gauge, the current stage named large with its local usually-takes, the
  engine's activity streaming center-stage, the clock and the running cost at
  reading distance, and coverage counters once the ledger is seeded. Escape
  or Hide steps out without touching the run; which run was minimized is
  stored rather than a flag, so the next run opens on the theater again.
  Cancel lives in the theater, so the browser suite's cancel path is intact.
- 2026-08-18 D-81 MAINTAINER DIRECTIVE, recorded for the next structural
  pass: a widget dashboard as the primary surface in place of the left nav
  rail. The scoreboard is the seed of it. This is an information-architecture
  change, not a polish item: navigation moves to a slim top bar, the home
  becomes composable widgets (scoreboard tiles, awaiting queue, recent runs,
  rule yield), and the rail retires. Planned as its own work package rather
  than begun mid-flight, because the maintainer's first real review is
  running inside the dev server and IA changes deserve the full browser gate
  the running review currently blocks.
- 2026-08-18 D-82 (M1-M3 of the dashboard shell plan): the five PROPOSED
  decisions in that plan are DECIDED as built. Dashboard is a nav item and
  the wordmark also links home, because every screen must mark exactly one
  current link and `/` is a screen; its match is exact where the others are
  prefixes, since every path begins with a slash. The widget composition is
  fixed in v1: arrangeable widgets mean persistence, drag and a settings
  surface, none of which was asked for, and nothing here forecloses it. The
  live-scan widget hides when nothing runs, because an empty panel labelled
  live is a dashboard claiming to have something to watch. The attention
  endpoint stays the polled one, now for both the bar and the live widget,
  so there is one source of truth about what is running; the dashboard's
  richer data loads once per visit. `rail.tsx` is deleted rather than kept
  as a fallback: two shells is a design decision nobody made.
  The projects widget matches reviews to projects by id, never by name, for
  the reason the reviews list already learned: two remotes can end in the
  same repository name, and merging them would report one project's last
  finding as another's.
- 2026-08-18 D-71 CLOSED (M4 of the dashboard shell plan): the runner-side
  half is built. The batch numbers have ridden the stage request since the
  totals were fixed; nothing carried them out to a watcher, so a stage making
  nine calls looked exactly like one making a single call for as long as it
  took. The checkpointing runner reports them on each live attempt, the
  lifecycle event carries them, the bus emits them, and the scan theater and
  activity feed say "request 3 of 9". A replayed stage stays silent about
  requests: replaying costs nothing and spawns nothing, so announcing one
  would be announcing work that is not happening. Both properties are tested,
  the second by stopping a run part way, which is the only way to reach a
  resumable state with checkpoints already stored.
- 2026-08-18 D-83 (M5 and M6 of the dashboard shell plan): the shell's
  phone-width behaviour is a measured law, not a look. A test sets 360px and
  compares `document.scrollWidth` against `clientWidth` on the dashboard, the
  reviews list and settings, and requires every destination reachable with
  exactly one marked current. It found 25px of real overflow in the reviews
  list, from a row that kept a status chip, a project name and a full branch
  pair on one unbreakable line; the branch pair now takes its own line below
  640px. The reading that said the fix had not worked came from a build that
  predated it, which is D-70 a second time: `npx playwright test` run by hand
  serves the last build, and only `./verify.sh --e2e` rebuilds first. Nothing
  measures the browser except through the gate that builds.
  The FG-4 argument is refreshed rather than amended:
  `review/2026-08-18-fg4/DESIGN-NOTES.md` is the document the design verdict
  is given on, against `review/2026-08-18-e2e/`. The 2026-08-04 notes are
  marked superseded in place, because they describe a left rail, an older
  palette and a run screen that put coverage above the queue, none of which
  exist. The README now carries three screenshots instead of two: the
  dashboard is the app's front door and was not in it, and the queue's
  caption claimed a stage timeline and a coverage panel that the shot no
  longer contains, both having moved inside the Run detail fold.
- 2026-08-18 D-84 (review pass over the dashboard shell, M1-M6): six numbered
  findings, all fixed in one diff before any new work started.
  1. The Needs-you widget said "N of M decided" and counted neither. N was the
  confirmed findings, so someone who had dismissed an entire queue was told
  they had not started it; M included findings the quotation check killed,
  which the queue never shows, so the target could not be reached. The
  scoreboard now carries `decided` (confirmed plus dismissed) and a total that
  is the size of the queue a person will actually be handed.
  2. The awaiting badge in the top bar linked to `/reviews`, unfiltered, which
  is the list someone pressing a count of three wants least. The filter lived
  only in component state, so nothing could link to it. The reviews list now
  seeds its filter from `?status=awaiting` and the badge points there.
  3. The projects widget fetched the last review's timestamp and id and the
  per-project review count, and rendered none of the three, while the plan's
  own row asked for "when" and a way to review a branch. All three are on
  screen now: the age, the count when there is more than one, an outcome chip
  that opens the review it describes, and a Review link per row.
  4. That widget's tally read "3 of 12" with no word saying what the numbers
  were, where every other surface names its number. It says confirmed.
  5. The dashboard's one-second clock was keyed to the polled object rather
  than to whether anything is running, so every four-second poll tore the
  interval down and started it again.
  6. The e2e assertion for finding 2 was written first as a row scrape over
  `ul > li`, which matches the projects list on the page it was navigating
  away from: it passed against the old DOM and then read an empty list, which
  is a flake and stop-the-line. Root-caused rather than retried, and replaced
  with a wait on the URL plus the filter toggle's own `aria-pressed`, which
  the toggle now carries because it is a toggle.
- 2026-10-16 D-85 DECIDED (maintainer, MVP scope, answering four questions
  put after the 2026-10-16 audits): the MVP supports Linux, Windows and
  macOS, each proven in CI and named in the README; it serves the
  maintainer first, and a public release is a later milestone; install
  stays git clone plus npm, in line with the 2026-07-30 local-web-app
  decision; interactive Mode B is fixed for the MVP rather than hidden.
  Rejected: Linux or WSL only (the maintainer's own machine is Windows and
  the app does not run on it today, `plans/AUDIT-2026-10-16.md` section 2),
  Windows plus Linux only, public-first, an npx package, a desktop shell,
  hiding or removing Mode B. The work is `plans/MVP-PLAN.md`, DRAFT until
  its gate MG-1 is decided.
- 2026-10-16 D-86 DECIDED (maintainer, `plans/MVP-PLAN.md` gates):
  MG-1: G1 is re-scoped to "working pipeline on Linux, Windows and macOS";
  its verdict is given on a fresh real-engine run at MVP WP 7.3, G2 stays
  as written, and G3 becomes the later public release. Rejected: a G1
  verdict on the 2026-08-04 runs, which predate five pipeline changes and
  CLI 2.1.301. MG-8: all three decided-but-unbuilt items are built for the
  MVP: D-51 project editing, the last-used model default, and the T19
  dead-export gate. MG-9: CI on `macos-latest` is the macOS proof and the
  README says so; no Mac is driven by hand. Working rule for the plan: one
  branch per WP, merged into `main` once `./verify.sh` is green and pushed,
  so CI proves it; no pull requests (the maintainer's standing consent for
  this repository, 2026-10-16). The driver runs the plan to completion.
- 2026-10-16 D-87 DECIDED (maintainer, MVP-PLAN MG-2): better-sqlite3 goes
  from ^13.0.2 to ^12.11.1. Measured on Windows 11 without Python or a C++
  toolchain: 13.0.2 and 13.0.3 fail `npm ci` on npm 10.9.2 and 11.21.1,
  because a lockfile entry does not record the package's `"gypfile": false`,
  so npm finds `binding.gyp` and runs `node-gyp rebuild` (arborist
  `rebuild.js:238-265`). A lockless `npm install` succeeds, and `npm ci` from
  the lockfile it writes fails. 12.11.1 installs through prebuild-install,
  which downloads a prebuilt binary: `npm install` and a clean `npm ci` exit
  0, its tree audits clean, and it bundles SQLite 3.53.2 against 13.0.2's
  3.53.4. Rejected: requiring npm 11 (fails the same way), patching
  `gypfile` into the lockfile behind a gate (measured working, and dropped
  by the next `npm install`), requiring a C++ toolchain, and
  `--ignore-scripts` (skips esbuild and unrs-resolver installs too).
  Re-check trigger: a better-sqlite3 13.x with an install script, or an npm
  that records `gypfile` in the lockfile.
- 2026-10-16 D-88 REVIEW (MVP phase 1, WP 1.1 to 1.4, a45f73f..0f4d35c):
  the four diffs re-read whole against the plan rows and the charter. No
  findings. Checked in particular: the self-check cannot pass with a broken
  scan (driven by swapping the old pipe back in); every new skip or exit in
  the two leak gates fails toward "not checked" rather than "clean"; the
  rewritten paths assertions still fail on a wrong layout because they
  compare whole paths, not separators; the mode fixture still asserts
  `100755`; CI on `ubuntu-latest` is green for every phase-1 commit,
  including `--build --e2e` on better-sqlite3 12.11.1 (run 38921212190).
- 2026-10-16 D-89 DECIDED (MVP WP 2.1, accepted risk): five high advisories
  stay, all one dev-only chain: eslint-config-next 16.3.8 to
  @next/eslint-plugin-next to fast-glob to micromatch to `braces`, whose
  advisory ("stack-exhaustion denial of service through deeply nested
  patterns") covers `<=3.0.3`, and 3.0.3 is the newest `braces` published.
  The chain runs only when eslint expands this repository's own globs, so
  the input is ours, never a reviewed repository's or a user's. npm offers
  only a "fix" to eslint-config-next 14.2.35, which would pair Next 14 lint
  rules with Next 16. `npm audit --omit=dev` is 0. Re-check trigger: a
  `braces` release above 3.0.3, or any advisory in this chain reaching a
  production dependency. Also recorded: npm 10.9.2 crashes in its peer-set
  resolver (`build-ideal-tree.js:1289`, "Cannot read properties of null
  (reading 'edgesOut')") on any install that touches vitest or on
  `npm audit fix`; the vitest bump was written with npm 11.21.1, and a clean
  `npm ci` on npm 10.9.2 installs the result.
- 2026-10-16 D-90 DECIDED (MVP WP 2.2): the agent-rules block that
  `next dev` 16.3.8 appends to `CLAUDE.md` when it detects an AI agent is
  reverted, not committed. It tells agents to treat Next as unfamiliar and
  read `node_modules/next/dist/docs/` before writing code; that is a
  dependency writing standing instructions into the charter, which section
  4 keeps lean and stable, and the block carries an em dash the house-style
  gate refuses. Observed when this session started `npm run dev` to prove the
  loopback bind. Rejected: committing it, which the block itself recommends.
  Re-check trigger: a Next release with an opt-out for the generator.
- 2026-10-16 D-91 DECIDED (maintainer, MVP-PLAN MG-3 and MG-4).
  MG-3: review stages require Claude Code 2.1.301 or newer, the only version
  measured accepting `--system-prompt-file` (its parser takes the flag though
  `--help` omits it; a missing file fails with "System prompt file not
  found" before any model call). The engine asks `--version` once per CLI
  per process and refuses an older one by name; probes and the sign-in check
  do not need the flag and run on anything. Rejected: bisecting older
  releases (about 270MB each) for a lower floor.
  MG-4: private HTTPS clones on Windows keep `GIT_CONFIG_NOSYSTEM`, which is
  what keeps Git for Windows' `core.autocrlf=true` out of the worktrees, and
  forward only the system `credential.helper`. Rejected: re-enabling system
  config and pinning keys one by one, and SSH-only.
- 2026-10-16 D-92 DECIDED (maintainer): the app installs and uses its own
  local Claude Code CLI, never the API. `@anthropic-ai/claude-code` is a
  dependency pinned exactly to 2.1.301, so `npm install` brings a CLI known
  to work on Linux, Windows and macOS, and the CLI version moves only when
  this repository's lockfile does. The resolver takes `TRYSQUARE_CLAUDE_PATH`
  first, then the platform package's binary in `node_modules` (not the
  wrapper's `bin`, which npm 11 leaves as a placeholder until its install
  script is approved), then PATH. `npm run claude -- <args>` runs that same
  CLI, for `auth login`. Measured: the bundled CLI reads the same
  `~/.claude` sign-in as the VS Code extension's (signed in, subscription),
  and the running app answered `/api/auth` through it with nothing on PATH.
  Cost: about 250 to 272MB per install, by platform. The package's terms:
  "All rights reserved. Use is subject to the Legal Agreements" at
  https://code.claude.com/docs/en/legal-and-compliance; each user downloads
  it from npm under those terms. Also decided: a sign-in that bills per
  token gets a warning, not a block, because the people using this all have
  a subscription (MVP-PLAN phase 6). Rejected: relying on whatever CLI is
  installed, which let untested versions arrive by self-update.
- 2026-10-16 D-93 REVIEW (MVP phases 2 and 3, 5d64d54..2e6c699, by a
  separate read-only reviewer, then each finding re-checked here before it
  was fixed). Sixteen findings, all dispositioned before new work:
  1. HIGH: `file:///\host`, `file:///%5Chost` and `file:///%2Fhost` passed
  the network-share check, and git opened each over SMB. Fixed 5f05bd2.
  2. The run note said "claude on PATH" for every default run, which
  resolves the bundled CLI. Fixed 2a15d9f: it names the program and version.
  3. No test could tell the settle-on-exit and SIGKILL escalation from the
  code they replaced. Fixed 44af4b7; the old behaviour fails the new tests.
  4. Two RUNBOOK paths were garbled into a TAB and a CR by a scripted edit.
  Fixed here, and check-style now refuses a carriage return mid-line.
  5. RUNBOOK still said the app drives whatever `claude` is on PATH, and the
  Stack line named a CLI stages now refuse. Fixed here.
  6. System credential helpers forwarded at command scope landed after
  global config and undid a user's global reset. Fixed e5fa96b with a
  stand-in system config. 10 (the machine-dependent test) and 13 (count
  arithmetic, a remembered failed lookup) went with it.
  7. Loading the e2e config from anywhere swept every run directory, a live
  one included. Fixed 1052d56: only directories idle for six hours.
  8. Two plan rows changed scope with no entry here. Recorded now: 2.3
  dropped its Content-Type rule because browsers send Origin on every
  non-GET request, so the Origin rule covers everything a page can forge
  and a Content-Type rule would only have broken curl; 3.1 reads an npm
  `.cmd` shim for the program it launches instead of refusing every `.cmd`,
  because npm writes the target as a quoted `%dp0%` path and the program
  then starts without a shell.
  9. The 3.2 figure used a stub output contract without saying so.
  Re-measured with the real one and corrected in the plan here.
  11. A test left prompt files in the shared temp directory. Fixed 44af4b7.
  12. An export with no caller. Removed 2a15d9f.
  14. The CLI environment was rebuilt on every resolve, and a Mac x64 Node
  looked for the x64 build the CLI's installer avoids. Fixed 1c16d59.
  15. D-91 says `--help` omits `--system-prompt-file`; it names it inside
  the `--bare` description, not as an option of its own. D-92 said the CLI
  version moves only with the lockfile, which nothing enforced; 1c16d59
  sets `DISABLE_AUTOUPDATER=1` on every claude the app starts, a variable
  the 2.1.301 binary lists among those it reads.
  16. `scripts/claude.ts` spawned claude outside `server/engine`. Moved
  into the engine, 2a15d9f.
  Not fixed, carried to MVP WP 4.1: a user's own global `core.autocrlf=true`
  would still give worktrees CRLF line endings; whether that breaks the
  quotation check is part of 4.1's line-ending pass.
- 2026-10-17 D-94 FOUND (open, not root-caused): one `./verify.sh` run on
  the maintainer's Windows machine exited 1 on 2026-10-16, just before
  f58981a (MVP WP 4.3) was committed, and the commit and push went ahead,
  because the gate's output was sent to /dev/null and the commit was chained
  after it with `;` rather than `&&`. Which step failed is unknown. Tried
  since: the same sequence again (production build, the two probe servers
  of the 4.3 proof, then the gate) and five further full unit runs, all
  green (817 passed, 6 skipped each); CI run 38970405121 passed f58981a on
  Ubuntu, Windows and macOS. That narrows it to something intermittent,
  which the suite has not shown since, and does not explain it. The two
  process faults are fixed in how this plan is driven: the gate's output is
  always kept in a log, and nothing that commits or pushes runs unless the
  gate before it exited 0. If any step fails again, its log is the root
  cause's starting point.
- 2026-10-17 D-95 REVIEW (MVP 3.6 to 4.9, 1052d56..a680cc3, by a separate
  read-only reviewer; each finding re-checked here before it was fixed).
  Fourteen findings, all dispositioned before new work:
  1. HIGH: a hunk line starting `--- ` or `+++ ` was read as a file header,
  dropped from the hunk or renaming its file; the 4.9 note's reason for
  dropping a line-count check was false. Fixed b2ecd0f, note rewritten.
  2. The file-context route joined a finding's path onto the worktree
  without containment and could serve a file outside it. Fixed 1de0365.
  3. Mode B's timeout told a person to resume, but a resume asked again at a
  new path. Fixed 46a60d6: files are named by a hash of the question.
  4. CI run 39005536267 failed on macOS in the browser journey at a commit
  identical in code to one that passed, and was not recorded. Root-caused:
  after a confirm or dismiss replied, the queue moved the selection even
  when the person had moved meanwhile, here with `g g`. A product bug, fixed
  e1eb4e5; the journey now holds the reply back and fails the old code every
  time. This is not D-94's failure, which stays unexplained.
  5. The Perl timeout signalled only the step's own process. Fixed 8b34b1a.
  6. Mode B did not refuse a model alias. 7. A shutdown between a stage's
  start and its spawn still started the CLI (fixed 955b85b). 8. An
  unreadable engine mode left a review marked running. 9. The Mode B run
  note claimed an effort it never passes. 10. PowerShell ends a quoted
  string at U+2018 to U+201B. 12. No test exercised the default call id.
  14. The bash quoting test could run WSL's bash. 6, 8, 9, 10, 12 and 14
  fixed 46a60d6.
  11. DECIDED: a changed path holding a backslash or starting with a drive
  letter refuses the whole review on every platform, though both are legal
  names on Linux and macOS. Such a name in a change set is rare, a review
  that stops and names it is recoverable, and a looser rule is what wrote a
  file outside the data directory on Windows (4.8). Noted in the RUNBOOK.
  13. DECIDED, restating the 2026-07-30 probe decision as the code keeps it:
  an indeterminate probe changes nothing but its message, so the last
  definite verdict stands, available, unavailable, or never probed and
  unknown. The original wording said such a probe leaves availability
  unknown; its reason, that one slow call must not grey out a working model,
  is what the code holds.
- 2026-10-17 D-96 DECIDED (WP 4.10, supersedes T3's nearest-line fallback):
  a finding accounts for the hunks its line range overlaps and for no other.
  One elsewhere in a changed file is kept as a candidate, since unchanged
  code can break with the change, but it accounts for no hunk. A sweep hit
  dispositioned as a finding must be matched by a finding whose line range
  contains the hit's line, or the stage is refused. New evidence, from the
  4.1 audit and reproduced by tests that fail on the old code: a finding at
  line 11 of a file whose only hunk is lines 3 to 9 stood in for that hunk,
  and a hit at line 2 was attached to a finding at line 3 and read as
  handled. Overlap rather than the start line, because a finding that starts
  above a hunk and ends inside it is about the change. A deleted file has no
  lines after the change, so S3 accounts for its hunk only by clearing it;
  removed code is S4's to raise findings on. Rejected: keeping the
  fallbacks, since coverage then says nothing about the hunk or hit; and
  refusing a finding outside every hunk, since verification is what judges
  it. Cost: a stage that cites loosely now fails the run where it used to
  pass, so the S3 prompt states both rules.
- 2026-10-17 D-97 DECIDED by the maintainer (WP 4.10): a hunk or sweep hit
  whose every finding verification refuted stays accounted for, since S3
  and S5 both read the code and the refutation carries a reason. It is said,
  not assumed: the coverage report counts such hunks and hits, the report's
  statement of what was examined gives the count, and the review page lists
  every refuted finding with its reason. Every refuted finding, not only
  those a hunk rested on, because a list titled refuted that left some out
  would be its own silence. Rejected: sending each one to the person, which
  adds a decision to every review where verification refutes something; and
  failing S6, which the pipeline spec keeps for pipeline bugs and which
  would fail a review after its whole run was spent. The counts are taken
  when read, so a review finished before D-96 also counts a hunk whose only
  finding sat outside it: no standing finding is about that hunk either,
  though the sentence names refutation as the reason.
- 2026-10-17 D-98 DECIDED (WP 4.11, corrects that row's stated fix): a
  deletion-stage finding is refused, with the stage's answer struck, when
  its path cannot name a file in one of the review's repositories: a path
  the 4.8 rule calls unsafe, a first segment that is no repository of the
  review, or a repository with no file named. It is not refused for lying
  outside the change set, as the row first said. S4 is asked who depended
  on what was removed, and that dependent is usually a file the change
  never touched: the seeded deleted-module-live-caller finding sits in
  exactly such a file, so the row's fix would have refused a finding the
  fixture exists to catch. Refused at the stage rather than killed at S5,
  so verification spends nothing on it. The repositories are the ones the
  service checked out, passed in, since a linked repository that changed
  nothing has no changed file to name it.
- 2026-10-17 D-99 DECIDED (WP 4.12): a verified verdict whose lines do not
  overlap its candidate's is killed, counted with the quotation-check kills,
  and the finding keeps the lines it was raised at. The verdict may still
  correct a range it overlaps, since S5 is told to report where it found
  the code. Evidence, from the 4.1 audit and reproduced by a test that
  fails on the old code: a finding about line 2 was verified by an exact
  quotation of line 1 and moved there, so a true quotation of unrelated
  code stood as proof of the claim. Overlap rather than a distance, because
  the pipeline spec already asks S5 to confirm the line numbers match, the
  prompts number every line (T1), and no real run on record measures how
  far a correct verdict moves; a number picked here would be invented.
  Rejected: sending such a verdict to the person as an open question, since
  the spec kills on a mechanical mismatch regardless of the AI verdict,
  and since D-97 a killed finding is listed with its reason.
- 2026-10-17 D-100 UNEXPLAINED (CI run 39022106093, at 19bc554): the
  Windows job failed one browser test, "reviews renders and photographs",
  when Chromium's connect to the app server failed with
  net::ERR_NO_BUFFER_SPACE (Winsock WSAENOBUFS) 5 ms after the navigation
  began; the other 40 browser tests, and the macOS and Linux jobs, passed.
  Not caused by the suite's own connections, by measurement: the whole
  browser suite run here peaks at 267 sockets on the server port (254 in
  TIME_WAIT, 266 distinct client ports, sampled every 300 ms) against a
  dynamic port range of 16,384. Searches found no report of this error
  under Playwright or GitHub Actions, and it did not reproduce locally. It
  is not retried away: a Windows job that fails now saves the runner's TCP
  table to its evidence, so a recurrence shows whether ports ran out.
- 2026-10-17 D-101 DECIDED (review of 4.10 to 4.12, finding 1; narrows
  D-96): a finding accounts for the hunks its first or last cited line
  falls in, not every hunk its range overlaps. New evidence, reproduced
  against the code: one finding at lines 1 to 999999 accounted for both
  hunks of a 30-line file and the review completed, where the code before
  D-96 refused it. First or last line rather than one hunk only, because a
  finding that runs from one hunk into the next is about both, and a range
  reaching into a hunk from either side stays counted as D-96 meant. A
  range that only passes over a hunk no longer counts for it. The S3
  prompt states the rule, and, when a deleted file is shown, that its hunk
  can only be cleared, which D-96 decided but the prompt never said.
- 2026-10-17 D-102 DECIDED (review of 4.10 to 4.12, findings 2, 3, 5 and
  6; refines how D-97 counts): what rests only on refuted findings is
  judged by the lines each finding was raised at, now kept on the finding
  as raised_line_start and raised_line_end (migration 0010), because those
  decided what it accounted for. A hunk or hit counts only when a killed
  finding is about it and no standing one is, and a hunk another request
  of a divided stage cleared keeps that reason and does not count.
  Evidence, each reproduced and now a test that fails on the D-97 code: a
  standing finding verified one line past its hunk made the report say the
  hunk rested on a refutation with nothing killed; a refuted hunk was
  hidden when another finding's corrected range moved onto it; a resume,
  which removes the findings while the ledger keeps its marks, stated
  refutations that never happened; and a hunk one batch cleared was said
  to rest only on another batch's refuted finding. Rows from before 0010
  fall back to their current lines, so a review verified before D-99 can
  still be counted by where verification moved its findings. The count
  reads hunks and hits only in files with a killed finding; measured with
  the reviewer's benchmark at 2,000 files, 20,000 hunks and 2,000
  findings, a call takes 9.4 ms with nothing killed (5.5 ms before 4.10,
  193.4 ms at fc96c7a) and 43.0 ms with every finding killed.
- 2026-10-17 D-103 REVIEW (MVP 4.10 to 4.12, dd38aa6..19bc554, by a
  separate read-only reviewer; each finding re-run here before it was
  fixed). Ten findings, all dispositioned before new work:
  1. HIGH: one finding with an unbounded line range accounted for every
  hunk in its file. Fixed 8a1e9ab (D-101).
  2. MEDIUM: the refuted-only counts used the lines verification had
  corrected, naming refutations that never happened and hiding one that
  did. 3. A resume stated refutations for findings it had only removed.
  5. A hunk one batch cleared was said to rest only on another batch's
  refuted finding. 6. coverageReport went from 5.9 to 193.4 ms at 20,000
  hunks in the reviewer's run. 2, 3, 5 and 6 fixed d3f7e73 (D-102).
  4. The S3 prompt never said a deleted file's hunk can only be cleared.
  Fixed 8a1e9ab.
  7. A deletion finding in a linked repository that changed nothing was
  stored as primary. Fixed 77be1e4.
  8. Stale records: the ideal answers' hunk and hit mapping (8a1e9ab);
  the G-1 note, the quotation-check count's description and run note,
  Mode B's misplaced comment and the scoreboard's comment (770ced0).
  D-97's caveat is superseded by D-102.
  9. 11daa0f's changes had no test the old code fails, and a refused
  decision whose body was not JSON went unsaid. Fixed d70e423. The
  prompt's write-then-rename has no test: a reader catching a half-written
  prompt cannot be staged deterministically.
  10. The refuted list labelled quotation-check discards as refutations.
  Fixed 770ced0.
  Found on the way, outside the reviewed range: the invention rate counts
  every killed finding as a quotation-check kill. Plan row 4.24.
- 2026-10-17 D-104 UNEXPLAINED, continuing D-100: Windows failed again at
  77be1e4 (run 39024193784) with the same net::ERR_NO_BUFFER_SPACE, this
  time loading a script chunk of /reviews, so the page never hydrated and
  a test waited 30 s for its list. The TCP table D-100 added was saved at
  the failure: 266 TIME_WAIT, 9 established, 24 listening, so the runner
  had not run out of ports, and port exhaustion is ruled out. Both
  failures and the six Windows passes today ran the same image,
  windows-2025-vs2026 20261007.264.1, across six Azure regions, with
  westus3 among both. Two of the last eight Windows runs failed this way;
  none on macOS or Linux, and none locally on Windows 11. Searches found
  nothing tying the error to Windows Server 2025 or to Chromium on
  loopback. The cause stays unknown.
- 2026-10-17 D-105 DECIDED by the maintainer (D-100, D-104): Windows CI
  writes Chromium's network log into its evidence, one file per Playwright
  worker, so the next ERR_NO_BUFFER_SPACE names the socket call that failed
  and its OS error. Checked here with CI set: the journey wrote a 2.3 MB
  log holding every connect attempt with its result. Until the cause is
  known, a Windows job whose only failure is net::ERR_NO_BUFFER_SPACE is
  re-run once, and each occurrence is recorded here with its run id, so
  the rate is measured, never hidden. Any other failure, or this error
  twice in a row on one commit, still stops the line. This is an exception
  to "a test that only passes on retry is failing", for this error only:
  the connection is refused before the app answers, so no test of the app
  ran. Occurrences: 39022106093 (19bc554; 4180bd0, the same code plus the
  TCP table step, then passed) and 39024193784 (77be1e4, re-run under this
  rule).
- 2026-10-17 D-106 DECIDED (WP 4.13): a finding in a file the change
  deleted is verified against the file's contents before deletion, the
  copy the bundle keeps, since the worktree no longer has it. S4 is shown
  those contents with their lines numbered, as hunks are (T1), and S5 gets
  them inside the candidate's own JSON entry, which keeps the prompt one
  block for the two readers that parse it. Evidence, reproduced by tests
  that fail on the old code: a finding at line 2 of a deleted file, quoted
  exactly, was killed as unreadable, so the finding the deletion stage
  exists to raise could never survive verification. The row's fix alone,
  checking quotes against the base copy, would still have failed: S5 can
  read only the worktree, and S4 had no line numbers to cite. A file with
  no base copy, a binary or a missing one, is still killed as unreadable.
- 2026-10-17 D-107 DECIDED (WP 4.14): the end-of-review worktree check
  compares against what the checkout reported when it was made, and the
  content of each file it named, kept beside the worktrees in
  runs/<id>/worktree-baseline/<slug>.json. Evidence, reproduced against
  real git: a file committed with CRLF under `* text eol=lf` reads
  ` M crlf.txt` in a fresh checkout, and a review of such a repository
  failed at its last step with nothing written. `* text=auto` does not do
  this, since git leaves a file committed with CRLF alone under it. The
  status line of a file already reported changed does not move when it is
  written to again, so its content is hashed at checkout and compared at
  the end; a new file, a line that disappears, and a rewrite all still fail
  the review. A worktree found at the right commit with no baseline, from
  an interrupted run or one from before this change, is checked out again
  rather than trusted. The run notes say when a checkout started changed.
- 2026-10-17 D-108 DECIDED (WP 4.15): the diff a review is built from is
  taken with --no-ext-diff, --no-textconv and explicit a/ and b/ prefixes,
  and is refused unless the files it names are exactly those
  `git diff --name-only -z` lists. Evidence, reproduced with a global
  config: diff.external replaced the whole diff with the tool's output, so
  the parser found nothing and the review covered nothing; diff.noprefix
  wrote `diff --git a.txt a.txt`. Explicit prefixes rather than
  --default-prefix, which is recent: the Linux machine on record runs git
  2.43. diff.suppressBlankEmpty and core.quotePath were tried as well and
  the parser already reads both. The cross-check is stronger than the row
  asked, a diff that parses empty while the commits differ: it also
  refuses a diff that lost some files and kept others. The name list is
  untouched by formatting settings, so whatever else a config might
  reshape fails here rather than becoming a review of less than the change.
- 2026-10-17 D-109 DECIDED (WP 4.16): a review's ledger is seeded in one
  transaction, files, hunks and sweep hits together, so a crash leaves all
  of it or none, and a resume either seeds it whole or finds it whole. A
  resume over a ledger whose stored sweep hits differ in number from what
  the sweep finds now stops and says to start the review again. The sweep
  is deterministic over frozen commits and a frozen ruleset, so a
  difference can only be a seed that stopped part way, before this change;
  repairing it in place was rejected, because which rows are missing
  cannot be known from a count. Tests: a hit the database refuses leaves no
  file and no hit behind, and fails if the transaction is removed; a
  ledger holding the files but not the hit stops the run by name.
- 2026-10-17 D-110 REVIEW (MVP 4.13 to 4.16, cc954b0..8cce64d, by a
  separate read-only reviewer; each finding re-run here before it was
  fixed). Nine findings, all dispositioned before new work:
  1. MEDIUM: the checkout baseline accepted any difference git reported at
  checkout. With two paths differing only in case on a case-insensitive
  file system, Config.ts held config.ts's bytes and the review completed.
  DECIDED: a file enters the baseline only when its bytes equal
  `git cat-file --filters` for the commit, the normalisation case; any
  other difference refuses the review before a stage runs. 6. A baseline
  cut short by a crash failed every run at its end; it is now written
  whole or not at all, and one that cannot be read means a fresh checkout.
  1 and 6 fixed 8f1b1f2.
  2. MEDIUM: verification carried a deleted file whole for every candidate
  in it, so five candidates in a 2,000-line file made a 725,290-character
  prompt. DECIDED: each deleted file goes once, in a map beside the
  candidates. Fixed 3e1a94b.
  3. MEDIUM: diff.submodule=log refused every review that moved a
  submodule, and diff.ignoreSubmodules=all left the move out unnoticed,
  since it drops the entry from the name list too. 4. diff.algorithm
  changed which lines a hunk held, so the same commits gave different
  sweep hits, which D-109's premise missed. DECIDED: both diff commands pin
  the submodule display and the algorithm (git's default, myers). 3 and 4
  fixed 570c49b, with the resume error naming its other cause.
  5. LOW: a typechange's new file is quote-checked against its old link
  target. Hidden by a worse, older failure of the same change, so both
  are plan row 4.25.
  7. LOW, accepted: a review interrupted before 4.14 is checked out again
  on resume, losing any write the old end check would have caught. Only
  reviews from before 4.14 can be in that state, and none is known.
  8. Records: D-108 gave the wrong reason for explicit prefixes, since
  --default-prefix arrived in git 2.41 (git-diff docs for 2.41.0 list it,
  for 2.40.0 do not); the decision stands on the explicit flags working on
  far older git. Also the data layout in 01, the RUNBOOK bullet, and the
  preflight comment. 9. A doc comment had lost its function in content.ts.
  8 and 9 fixed in the commit recording this review.
  Found on the way, older than the range: writes to gitignored paths pass
  the end check (plan row 4.26), and the parser trims a trailing space
  from a path (4.27).
- 2026-10-17 D-111 UNEXPLAINED, continuing D-100 and D-104, now located:
  Windows CI run 39030140623 at 70baf02 failed a third time with
  net::ERR_NO_BUFFER_SPACE, on a script chunk of /projects, and passed on
  its D-105 re-run. Chromium's net log, which D-105 added, names the call:
  a TCP connect to 127.0.0.1:3100 failed within 1 ms with OS error 10055,
  WSAENOBUFS, from Winsock's connect. At that moment the browser held 3
  sockets (6 at most in its log), had made 9 connect attempts in the
  previous second and 32 in all, and the runner's TCP table held 180
  TIME_WAIT and 12 established. Neither the app, the tests, nor the
  machine's ports were near a limit, so the refusal comes from the
  runner's network stack. The D-105 rule stands: re-run once, record each.
- 2026-10-17 D-112 DECIDED (WP 4.17): two verdicts for one candidate,
  counted by the candidate a label resolves to so that C1 and c1 are one,
  refuse the verification stage's answer, which strikes it so a resume
  asks again. The second verdict used to be applied as a second state
  change and threw outside the checks that strike a refused answer, so
  every resume replayed it and failed the same way; a test shows both.
  A verdict naming no candidate is still left aside, as a test already
  pinned: its candidate goes to the person as an open question, which
  costs nothing, where refusing would pay for the stage again.
- 2026-10-17 D-113 DECIDED (WP 4.18): one server per data directory. The
  runtime takes a lock file, server.lock, naming its process before it
  opens the database, so a second server neither marks the first one's
  running reviews interrupted nor migrates beside it. A lock whose process
  is gone, after a crash or a kill, is taken over; one that cannot be read
  is too. A server refused the lock prints why and exits, rather than
  answering every request with a 500 as Next left it doing. Driven for
  real with two production servers on one directory: the first kept
  answering 200, the second exited 1 naming the first's process. `next
  build` was checked not to open the data directory at all, and `next dev`
  works with the lock, holding it in one process. Rejected: a database
  level lock, since the first thing a second server does is the orphan
  sweep, which a SQLite lock would not prevent without one held for the
  whole life of the server.
- 2026-10-17 D-114 DECIDED (WP 4.21): the quotation check forgives three
  more things that carry no meaning, each a valid quote it was killing,
  each reproduced by a test that fails on the old check: a byte-order mark
  at the start of a file, which no quote carries (one line already passed,
  since JavaScript trims it as whitespace; across lines it did not); a
  character composed of one code point in the quote and two in the file,
  compared after NFC, which Unicode defines as the same text; and the
  indentation of a line where a tab is part of it, since a quote shows a
  tab as however many spaces its writer chose. Kept strict: space
  indentation against space indentation, and every character after the
  indentation; tests show a respaced line and changed code under a tab
  still fail. A paraphrase still cannot pass.
- 2026-10-17 D-115 DECIDED (review of 4.17 to 4.21, finding 1 and 3;
  corrects D-114 with new evidence): the tab forgiveness compares each line's
  indentation only at one tab width shared by every line, and only when the
  file itself indents with a tab. D-114 ignored indentation per line wherever
  a tab was involved, so a quote that moved a Python line into or out of a
  block passed, with tabs on one side or both, and so did a quote re-nesting
  a space-indented file with tabs; each is now a test, and each is killed.
  One width for all lines keeps nesting, and it also verifies a faithful
  quote of a file mixing tabs and spaces, which D-114 still killed. NFC is
  withdrawn: canonically equivalent text is different code, since a string
  holding OHM SIGN and one holding GREEK CAPITAL OMEGA are unequal in
  JavaScript though one character after NFC, so a quote could misstate the
  very character a finding is about. The byte-order mark is dropped from the
  start of the file only, as D-114 said and the code did not.
- 2026-10-17 D-116 DECIDED (review of 4.17 to 4.21, finding 2; refines
  D-113): the data directory lock is created whole, written aside and
  linked into place, so no reader sees it half written, and a stale lock is
  taken over only by the process that creates a takeover token, and only if
  it still holds the stale content that process read. Removing a stale lock
  unguarded let two servers starting together each remove the other's fresh
  lock: the reviewer's probe found both holding it in 23 of 300 starts, and
  20 of 200 here. The same probe on the new lock: 0 in 300 with a stale lock
  and 0 in 300 without, every start ending with one holder and one refusal
  by name. A test now races two processes over 100 locks and failed on the
  old lock at its first. Windows' EPERM for a name being deleted is retried,
  and every lock failure, not only a live holder, makes the server print why
  and exit.
- 2026-10-17 D-117 REVIEW (MVP 4.17 to 4.21, da9cac2..124b773, by a
  separate read-only reviewer; each finding re-run here before it was
  fixed). Seven findings, all dispositioned before new work:
  1. MEDIUM: the tab forgiveness let a quote re-nest a line, so a Python
  line moved into or out of a block passed. 3. NFC treated different code
  as the same, and the byte-order mark was dropped from any cited range,
  not only the file's start. 4. A faithful quote of a file mixing tabs and
  spaces was still killed. 1, 3 and 4 fixed 37bbcf4 (D-115, correcting
  D-114).
  2. LOW, demonstrated: two servers starting together on a stale lock both
  held it in about one start in ten; and a lock failure other than a live
  holder left the server up. 6. The in-use message's advice did not fit the
  only case it is raised in. 7. Closing the runtime and the refused start
  were untested. 2, 6 and 7 fixed 39b4097 (D-116).
  5. LOW: the review page's Resume button ignored a 409, so a review another
  tab had cancelled showed nothing. Fixed 0fbf353, with a stale manager
  comment.
  The reviewer could not drive `next dev` without writing into the repo;
  it was driven here for D-113, and holds the lock in one process.
  The race test added for finding 2 then failed once in the full gate, with
  both racers refused. By the lock's own logic that needs the stale holder's
  pid to be alive: the pid of a process that had exited, which the test used,
  had been reused while the parallel suite spawned. Ten rounds of 100 trials
  alone found no fault in the lock. The tests now use a pid no process can
  have, odd and above every platform's limit (382acd9), and the full gates
  since are green.
- 2026-10-17 D-118 DECIDED (supersedes D-116's mechanism; revisits D-113's
  rejected alternative with new evidence): the data directory lock is
  SQLite's, an exclusive transaction opened on a small database of its own,
  server-lock.sqlite, and never committed, so it is held for as long as the
  server's connection is open and released by the operating system when the
  process ends, however it ends. Evidence: the hand-managed lock of D-116
  still let two servers both take it on macOS (CI run 39040825134, trial 90
  of the race test): a process that read the lock path as empty removed a
  fresh lock linked there in the moment after, which Windows' refusal to
  reuse a name being deleted had hidden in 600 local starts. Fixing that
  check would have left the same kind of window in removing a stale
  takeover token. A kernel-held lock has no staleness, no process ids to
  trust and no takeover. D-113 rejected a database lock as needing to be
  held for the server's whole life; held for its whole life is what this
  is, on a file of its own. Two traps met on the way: SQLite's exclusive
  locking mode keeps even a failed attempt's shared lock, so two servers
  starting together blocked each other and both refused, every time; and a
  busy timeout of zero can make both fail. A one-second wait settles the
  instant two start together; the race test, which runs each process as
  itself rather than under the tsx command (whose child outlived a kill on
  Windows), shows one holder in every trial. The holder's process id is
  written beside the lock only for the refusal message; a file at the lock
  path that is not a SQLite database is refused and left alone.
- 2026-10-17 D-119 REVIEW (MVP 4.18 to 4.23, 62ea1a8..63b5e4a, by a
  separate read-only reviewer; each finding re-run here before it was
  fixed). Nine findings, all dispositioned before new work:
  1. HIGH: branch names were read in git's shortened form, heads/main when
  a tag shares the name, which the 4.22 qualifying turned into a ref that
  does not exist: the branch list answered 500, and a project cloned after
  such a tag stored heads/main as its default. Fixed e9bc2e9: names are
  read unshortened, tested on a clone that had the tag before cloning.
  2. MEDIUM: an updated Git LFS file, whose version line is context, was
  not named, and a README quoting a pointer was. Fixed d5f3287: a side of
  the first hunk must read as a whole pointer from line 1; a real-git test
  holds the three lines of context that relies on.
  3. MEDIUM: a page whose stream the server let go polled for the rest of
  the run, though the stream claimed it reconnected. Fixed 6d9e50c: the
  last frame says to reconnect, and the page opens a new stream.
  4. LOW: a failed pid write left the lock held by a handle nothing kept,
  so the same process then refused itself. Fixed 24ed9d5.
  5. LOW: a settings change refused part way had written the keys before
  the refusal and started no waiting review. Fixed 41a131e.
  6. LOW: the decision queue went on offering decisions after a 409, and
  completing read an HTML refusal as JSON. Fixed c5badfa.
  7. LOW: four stale or misplaced comments. Fixed 24ed9d5 and b9bc535.
  8. LOW: the race test went from 100 trials to 30, below trial 90 where
  D-118's macOS fault showed, and D-118 gave no count. The test now says
  what thirty catch (1217e31): a fault at one start in ten 96 times in
  100, one at macOS's apparent rate 28. D-118's counts: CI runs
  39043693135, 39044366812, 39044912063, 39045571070 and 39046942782
  (4c646dd to e9bc2e9) each ran the 30 trials on Windows, macOS and
  Ubuntu, green at the first attempt: 150 trials on each, one holder in
  every one.
  9. LOW: the docs left out the lock's journal and the server.lock a build
  before D-118 leaves, whose server does not see the new lock; the demo
  fixture and the e2e setup resolved branch names as commits. Fixed
  f892e08.
- 2026-10-17 D-120 DECIDED (maintainer's choice; revisits the reason, not
  the rule, of the CLAUDECODE scrub): a review's CLI loses only what a
  Claude Code session, or the editor or SDK hosting it, sets for the
  processes it starts, named: CLAUDECODE, CLAUDE_CODE_CHILD_SESSION,
  CLAUDE_CODE_SESSION_ID, CLAUDE_CODE_SESSION_ATTENDED, CLAUDE_PID, AI_AGENT,
  CLAUDE_EFFORT, CLAUDE_CODE_ENTRYPOINT, CLAUDE_AGENT_SDK_VERSION,
  CLAUDE_CODE_MESSAGING_SOCKET, CLAUDE_CODE_MESSAGING_TOKEN,
  CLAUDE_CODE_EXECPATH and CLAUDE_CODE_SSE_PORT. Every other variable,
  CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_CODE_GIT_BASH_PATH included, passes
  through. Evidence, all on the bundled 2.1.301 and spending nothing (an
  empty config directory, so no credentials, and a dead API base URL): no
  variable makes it refuse to run nested, measured in 17 runs, with none,
  each of 15 alone and all together, every one reaching "Not logged in";
  the refusal text is not in the binary. The binary does read CLAUDECODE
  and CLAUDE_CODE_CHILD_SESSION as meaning it is a session's child, and
  then looks for credentials elsewhere, and it sets the first five names
  above on every process it starts. Rejected: stripping every
  CLAUDE_CODE_ variable, which dropped a headless subscription sign-in and
  a Git Bash path (E8); keeping that with an allowlist of settings, which
  drops any setting not yet listed. Accepted risk: a marker a later CLI
  adds passes until it is named. TRACEPARENT, which the CLI also sets when
  tracing, is generic and passes.
- 2026-10-17 D-121 DECIDED (maintainer's choice; refines D-120 with new
  evidence): CLAUDE_CODE_EFFORT_LEVEL is stripped from a review's CLI as
  well. It is a person's setting, so D-120 let it through, but the 2.1.301
  binary resolves effort with it first, ahead of the --effort flag every
  stage passes, and its own /effort command says the variable "overrides
  effort this session". A review created at high therefore ran at whatever
  it said and still recorded high, against the 2026-07-31 decision that
  effort is fixed when a review is created. --model, the other pinned value
  a review records, ranks ahead of ANTHROPIC_MODEL in the same binary, so
  nothing is stripped for it. Rejected: setting the variable to the
  review's effort (the same result, one more value the engine writes), and
  accepting a recorded effort that can be wrong.
- 2026-10-17 D-122 DECIDED (maintainer's choice; MVP 4.7): xhigh is a
  review effort, offered only on a model that runs it, and refused at the
  API for any other. Evidence, from the bundled CLI 2.1.301 and spending
  nothing: its effort validator and its help both list low, medium, high,
  xhigh and max, so the enum's "no tier between high and max" was out of
  date; it runs xhigh as high, without a word, on a model its table does
  not mark with the xhigh capability; of this app's candidates the table
  marks claude-fable-5 and claude-opus-5, not claude-sonnet-5 or
  claude-haiku-4-5; and its cost index prices xhigh at 1.74 times high on
  fable-5 and 1.6 on opus-5. The models the table marks are listed in
  lib/models/effort-support.ts. High stays the default. Rejected: offering
  it on every model, which records xhigh for a high run on two of the four
  families, and not offering it.
- 2026-10-17 D-123 DECIDED (maintainer's choice; corrects D-122, which rested
  on a misreading found by the review of 4.5 to 4.7): xhigh is offered on
  every model the CLI runs it on, which is every model but the fixed list
  the 2.1.301 binary checks: claude-3 models, Opus 4.0 to 4.6, Sonnet 4.0 to
  4.6 and Haiku 4.5. D-122 said the CLI's table did not mark claude-sonnet-5;
  its row is marked, and the earlier extraction missed it. Measured against
  a local stand-in for the API, spending nothing: Fable, Opus and Sonnet 5,
  each also at [1m], and Haiku 5.5 send xhigh; Opus 4.6 sends high; Sonnet
  4.5, Sonnet 4 and Sonnet 3.7 send no effort at any level. So among the
  candidates xhigh is offered for fable-5, opus-5 and sonnet-5, and the CLI's
  own cost index puts it at 2.41 times high on sonnet-5. D-122's rejected
  alternative, offering it everywhere, would not have mislabelled any
  candidate that can run a review. Found on the way, not acted on here: the
  CLI swapped claude-opus-4-1-20250805 for claude-opus-5-5 without a word.
- 2026-10-17 D-124 DECIDED (maintainer's choice; found by the review of 4.5
  to 4.7, refining D-121 and the 2026-07-30 WP-E isolation flags): every
  stage and probe passes --setting-sources naming no source, so no settings
  file and no CLAUDE.md is read, and CLAUDE_CODE_EXTRA_BODY is stripped from
  the child like CLAUDE_CODE_EFFORT_LEVEL. Evidence, all against a local
  stand-in for the API on the bundled 2.1.301, spending nothing: with
  `user`, a person's CLAUDE.md was sent in every request (on this machine,
  the maintainer's global rules reached every review), a settings env
  CLAUDE_CODE_EFFORT_LEVEL made a review at high send low, and a settings
  maxEffortLevel of high made one at xhigh send high; CLAUDE_CODE_EXTRA_BODY
  in the shell made it send low even with the effort pinned through
  --settings; with no sources, neither CLAUDE.md was sent and xhigh was sent
  as asked. A --settings flag overrides a settings effort but not a
  maxEffortLevel cap, which is why sources are dropped rather than pinned.
  The subscription sign-in is still found: the same stand-in received the
  request with a Bearer token. Kept by tests/server/engine/stand-in-api.test.ts,
  which runs the real CLI with the engine's own arguments and environment.
  Not measured: an organisation-managed cap. Rejected: pinning through
  --settings and reading the person's settings for a cap, and recording
  the difference as accepted.
- 2026-10-18 D-125 REVIEW (MVP 4.5 to 4.7 and D-120 to D-122,
  fe271cd..45ec555, by a separate read-only reviewer; each finding re-run
  here before it was fixed). Eight findings, all dispositioned before new
  work:
  1. HIGH: D-122 refused xhigh on claude-sonnet-5 on a misread of the CLI's
  model table; the row is marked, and a probe against a local stand-in for
  the API showed sonnet-5 sending xhigh. Fixed 71add72 (D-123, maintainer's
  choice: offer it wherever the CLI runs it).
  2. HIGH: CI run 39059059261 failed the journey on Windows. The page's
  reload after a 409 is in Chromium's net log and in no Playwright event: a
  times: 1 route that expires as the last one turns interception off, and
  Playwright 1.62 then never reports a request it was holding. Measured
  here, the next request never finished in 5 of 100 trials with times: 1
  and in 0 of 100 with a route that stays until removed. Fixed fe3135b.
  3. MEDIUM: CLAUDE_CODE_EXTRA_BODY, which D-120 let through, outranks
  --effort. 4. MEDIUM: the person's settings, loaded through
  --setting-sources user, changed the effort a review ran at (a settings
  effort, a maxEffortLevel cap), and the same flag put the person's own
  CLAUDE.md into every request. 3 and 4 fixed 2e018f3 (D-124, maintainer's
  choice: read no settings file, strip the extra body), with a test that
  runs the real CLI against a stand-in for the API on every platform.
  5. MEDIUM: the picker kept Extra high as the choice under a model that
  showed high, so switching back brought it back. Fixed f432f1c.
  6. LOW: the shutdown test allowed the SIGTERM case fifteen seconds where
  the control waits two, and leaked its server if setup failed part way.
  Fixed e74b083.
  7. LOW: D-120's names left out what the CLI itself deletes when it starts
  a fresh session, token file descriptors among them, and matched case
  exactly. Fixed 5d44180. D-120's 17 runs were: none; each of CLAUDECODE,
  CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_CHILD_SESSION, CLAUDE_CODE_SESSION_ID,
  CLAUDE_CODE_SESSION_ATTENDED, CLAUDE_CODE_EXECPATH,
  CLAUDE_CODE_MESSAGING_SOCKET, CLAUDE_CODE_MESSAGING_TOKEN,
  CLAUDE_CODE_EMIT_STARTUP_TIMING, CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING,
  CLAUDE_CODE_ENABLE_TASKS, CLAUDE_CODE_QUESTION_PREVIEW_FORMAT,
  CLAUDE_AGENT_SDK_VERSION, CLAUDE_EFFORT and CLAUDE_PID alone; and all
  together. The last four session-host switches named there pass through,
  which D-120's wording overstated.
  8. LOW: stale records: the effort comment in the stage arguments, max
  described as the tier that spawns workflows, and rows 4.6 and 4.7 without
  commits. Fixed ba2e726. In 2.1.301 the workflow tier is ultracode, a
  separate setting no review reads since D-124, and the maintainer kept max
  refused on cost: the CLI's own index prices it at up to 5.59 times high
  per call (sonnet-5).
  Found on the way: the CLI swaps a retired model id for a current one
  without a word (claude-opus-4-1 ran as claude-opus-5-5), and Sonnet 4.5,
  Sonnet 4 and Sonnet 3.7 send no effort at any level; both in the idea
  inbox or D-123, neither among the candidates a review can run.
- 2026-10-18 D-126 DECIDED (MVP 4.24; the driver's recommendation, taken
  under the maintainer's instruction of 2026-10-18 to proceed on
  recommendations while away): a killed finding records why, killed_by
  `verification` when the verifier refuted it and `quote_check` when the
  program's own checks threw it out, and the scoreboard's invention rate
  and the demo's discarded quotes count only `quote_check`. A refuted
  finding cited code that is there, so counting it as invention overstated
  how often the engine makes things up. Earlier kills are classified by
  migration 0011 from the note the pipeline wrote: the three checks have
  written the same openings since the engine's first commit (1f60761; the
  overlap check since 19bc554), so a model-written refutation note would
  have to begin with one of them word for word to be misfiled. Rejected:
  deriving the kind from the note at read time, which would tie a metric
  to the wording of a message. D-97's count of what only a killed finding
  covered still counts every kill; not changed here.
- 2026-10-18 D-127 DECIDED (MVP 4.25; the driver's recommendation, under
  the maintainer's instruction of 2026-10-18): a typechange is read as one
  modified file. Git prints a symlink becoming a file, or the reverse, as a
  deletion followed by an addition at the same path, and prints nothing
  else that way, so the parser merges such a pair: both halves' hunks in
  git's order, renumbered, the old mode from the deletion and the new from
  the addition. Read as two files, the ledger held two rows with one path,
  so a review of such a change was refused at the adversarial stage for a
  hunk "not in the change set", after the stages before it were paid for;
  and the deletion's base copy, keyed by the same path, would have stood in
  for the new file in the quote check. Rejected: a new change type, which
  every reader of the inventory would have to learn, for a change the
  model reads perfectly well as a modification. Not handled: a finding on
  a file that became a symlink is quote-checked through the link.
- 2026-10-18 D-128 DECIDED (MVP 4.26; the driver's recommendation, under
  the maintainer's instruction of 2026-10-18): the end-of-review worktree
  check reads git status with --ignored, in the list of changes and in the
  baseline's hashes alike. A write under a path the repository ignores,
  build output or a log, was not a change to git status and went unseen,
  though "the app never writes inside a worktree" covers it as much as any
  other path. Checked before adopting it, since a clean review must not
  fail on it: the bundled CLI, run with a stage's arguments against a local
  stand-in for the API in a checkout whose .gitignore ignores everything,
  left nothing in it, ignored or not. A checkout has no ignored files when
  it is made, so the baseline is unaffected.
- 2026-10-18 D-129 DECIDED (MVP 4.27; the driver's recommendation, under
  the maintainer's instruction of 2026-10-18): the diff parser takes a path
  from a --- or +++ line by removing only the tab git ends that line with
  when the name holds a space (git's own rule, observed here on a new file
  `notes `), and no longer trims the diff --git line. Trimming took a name's
  own trailing spaces with the tab, so `notes ` was read as `notes`; since
  D-108 the change set was then refused rather than reviewed under the
  wrong name, which was safe but meant such a change could not be reviewed
  at all.
- 2026-10-18 D-130 REVIEW (MVP 4.24 to 4.27, 3bce10d..d96d37e, by a
  separate read-only reviewer; each finding re-run here before it was
  fixed). Ten findings, one MEDIUM and nine LOW, all dispositioned before
  new work; every new test of the range failed on the old code (13 of 13).
  1. MEDIUM: git worktree add runs post-checkout hooks, a person's global
  ones included, and one writing a file the repository ignores made every
  review's baseline refuse once D-128 read ignored paths. Reproduced with a
  global hooksPath writing `tags`. Fixed 5e49245: checkouts are made with
  hooksPath set to an empty directory made for the call, so no hook runs.
  2. LOW: PROJECT-STATE named migrations 0000 to 0010 and ten of them; there
  are twelve, to 0011. 3. LOW: rows 4.24 to 4.27 lacked their commits and
  gate results. 9. LOW: the 4.25 row said a merged typechange gets no base
  copy (one is written, only not read), the 4.27 row said a pure rename
  depends on the diff --git line (a rename names its paths on its own
  lines; a mode or binary change does), a test comment placed the old
  typechange failure at the audit (it was refused at the adversarial
  stage), and the architecture doc's worktree check overstated what git
  status sees: a write inside a submodule's empty directory is not
  reported (idea inbox). 10. LOW: a misplaced doc comment and an unwrapped
  line. 2, 3, 9 and 10 fixed with this record; the test that never built
  its intended diff was rewritten in ce7cfd7.
  4. LOW: the end-of-run note gave every kill as refuted beside the
  quotation check's count. Fixed f3ac523.
  5. LOW: a merged typechange was binary when one half was, so the sweep
  skipped a symlink's added line. 6. LOW: LFS detection read only the
  first hunk, the old side's after a merge, and missed a pointer that
  replaced a symlink. 7. LOW: "nothing else does" left out submodules,
  which git also prints as a deletion and an addition when one becomes a
  file; D-127's "prints nothing else that way" means typechanges of any
  of the three kinds. 5, 6 and 7 fixed ce7cfd7.
  8. LOW: migration 0011 matched notes with LIKE, case-blind and loose in
  the overlap pattern, so D-126's "word for word" overstated it. Fixed
  82ff9d3 with case-sensitive GLOB held to the pipeline's wording; no real
  database had applied 0011 (this machine's holds 0000 to 0010).
- 2026-10-18 D-131 REVIEW (MVP 5.1 to 5.4, 70433b3..6015c6f, by a separate
  read-only reviewer; each finding re-run here before it was fixed). Ten
  findings, three MEDIUM, one LOW-MEDIUM, six LOW, all dispositioned before
  new work:
  1. MEDIUM: Enter on a focused branch or model radio, or the dependency
  checkbox, still submitted the start form and started a paid review; 5.2
  had guarded only the filter. Fixed fcdcaad: the form swallows Enter on
  everything but a button and a text area.
  2. MEDIUM: with Enter left to focused buttons (5.4), a row clicked with
  the mouse kept focus, so Enter after j re-clicked it and the selection
  jumped back; the journey had blurred around it, which the charter counts
  as a test changed to pass. 10. LOW: the guard's Space half did nothing,
  and it skipped clearing a pending g. Fixed 21c7f04: a mouse click leaves
  no focus on a queue button, the workaround is gone, the guard takes Enter
  only and clears the pending g.
  3. MEDIUM: the theater's cancel said nothing when the server had gone,
  because the reading after it threw. 4. LOW-MEDIUM: the toolbar's "Yes,
  cancel" outlived the status it was asked under, leaving a finished review
  one click from cancelled, and Cancel and Delete could be armed at once.
  5. LOW: only the theater's Cancel was driven in a browser. 6. LOW: the
  confirmations gave no sign of a cancel in flight. 3 to 6 fixed 837a89e,
  with browser tests for the toolbar and the dropped request.
  7. LOW: settings told what is not yet a number that it had been left
  empty, and a failed save threw past its message. 8. LOW: the review and
  project deletes, the list's delete and the export threw past their
  messages on a dropped request or a non-JSON error page. 7 and 8 fixed
  bbcb509 through one request helper that always returns words to show.
  The dependency link's one-click Remove stays as it is: it is undone by
  adding the link again, and nothing is lost by it.
  9. LOW: rows 5.1 to 5.4 lacked their commits and gate results. Fixed
  with this record.
- 2026-10-18 D-132 DECIDED (MVP 5.5; MG-6 resolved (a), taken by the
  driver on the plan's recommendation under the maintainer's instruction of
  2026-10-18 to proceed on recommendations while away, and open to the
  maintainer's reversal): confirming a finding from the keyboard takes
  Shift+C, and a bare `c` does nothing. One stray lowercase keystroke
  confirmed the finding in front of it, and no decision can be taken back.
  Rejected: an undo for the last decision, which adds reversal state to a
  record whose premise is that each decision was deliberate; and removing
  the shortcut, which a person working down a long queue relies on.
- 2026-10-18 D-133 REVIEW (MVP 5.5 to 5.7, 52f977c..1dba8b5, by a separate
  read-only reviewer; each finding re-run here before it was fixed). Twelve
  findings, one HIGH, three MEDIUM, eight LOW, all dispositioned before new
  work:
  1. HIGH: while a clone ran, the project page reloaded itself every
  second without waiting for the last reload, and each one listed branches,
  which runs git fetch inside the clone still being written. 8. LOW: a
  failed clone's page said "Fetching the latest refs..." forever. Fixed
  82ccf3f: the branches and fetch routes refuse a clone that is not ready
  with a 409, the page polls the project alone, one request at a time, and
  the branch card shows the refusal or error.
  2. MEDIUM: a retry whose removal of the last clone's leftovers threw left
  the project pending with nothing cloning it. 12. LOW: that removal is
  recursive and went wherever the row's path pointed. Fixed 0f43155: the
  project goes back to failed with the reason, and the path is derived from
  the data directory and the id.
  3. MEDIUM: routes that caught every error themselves still hid an unknown
  id: deleting a review answered 409, starting one 400, linking to a
  project 400, its links an empty 200, and patching a rule 400. Fixed
  43bee5f.
  4. MEDIUM: rows 4.20 and 5.5 to 5.7 lacked their commits and gate
  results, and the macOS CI failure at 52f977c (run 39109455025) with its
  fix in 6819704 was on no row. 5. LOW: "a stream that breaks after a 200"
  was wrong, it was a 500; the d7c2cc1 message says it too and stays as
  pushed. 10. LOW: stale records: the restart message's "delete the project
  and add it again", Retry clone missing from the UI design doc and the
  runbook, 34 route handlers where there are 35, and keyboard comments and
  D-16 saying c. The 5.7 row said the project page read through the request
  helper, which was false until 82ccf3f. Fixed c32925c.
  6. LOW: under Caps Lock, Shift+C arrives as "c" with Shift held and
  confirmed nothing. Fixed e7762a9; the other letter keys under Caps Lock
  are in the idea inbox.
  7. LOW: a repository already added was recognised only character for
  character. Fixed e025bcf: addresses compare by a key that folds a
  trailing slash, the host's case, a local path's slashes and drive letter,
  and a hosted address's .git, and keeps the path's case and a local .git.
  9. LOW: a completion that left the checkout behind was not shown on the
  page, and its note advised deleting the review. Fixed a862595: the note
  is shown above the report and advises deleting the folder by hand.
  11. LOW, tests: the bare-c step did not count confirm requests (it does
  since e7762a9); the retry's polling and its removal were not exercised
  (82ccf3f, 0f43155); and the failed clone's error was matched by text the
  page header also shows, the "twice" project's clone was not awaited, and
  the project test's git printed a line-ending warning (c4a8636).
  Found during the fixes: macOS CI failed a stopped-stage test at c32925c
  (run 39113234471), which changed only docs and comments. The fake CLI
  created its pid file before writing the number, a read in between gave
  pid 0, and process.kill(0, 0) succeeds for the caller's own group, so the
  stopped process read as running; 6 of 300 tight reads on Windows found the
  file empty. Fixed 365f507: written whole and renamed into place, 0 of 300.
- 2026-10-18 D-134 REVIEW (the D-133 fixes, 1dba8b5..316894b, by a separate
  read-only reviewer; each finding re-run here before it was fixed). Ten
  findings, one MEDIUM and nine LOW, all dispositioned before new work:
  1. MEDIUM: the fix commits' gate results and CI runs were recorded
  nowhere, and rows 5.5 to 5.7 did not name the fixes. Fixed with this
  record: those rows carry each fix's commit, its Windows `./verify.sh
  --e2e` counts and its CI run.
  2. LOW: the repository key folded `.git` on every hosted address, read
  `C://repos/app` as a scheme and folded every backslash, so two
  repositories could be refused as one. Fixed 3aecbe2: `.git` folds only on
  github.com and gitlab.com (measured with git ls-remote), a drive path is
  tested first, and backslashes fold only in a Windows path. This replaces
  D-133 item 7's "a hosted address's .git".
  3. LOW: deleting a project, and deleting everything, removed the parent of
  the row's path. Fixed 60a438d.
  4. LOW: a preview whose dependency names nothing answered 400. 5. LOW:
  creating and previewing a review fetched into a clone that was not ready.
  4 and 5 fixed cb7c523. The new review screen's untrue lines beside that
  refusal, and its dependency read that drops one, are added to row 5.13.
  6. LOW: the project page followed a project deleted mid-clone forever,
  dropped failed reads without a word, and kept a refusal over a ready
  project when its two reads straddled the clone finishing. 10. LOW: the
  browser test counted branch reads before a late poll could add one, and
  never removed its listener. 6 and 10 fixed eb0df4e.
  7. LOW: three untrue sentences. D-133 and the 365f507 message say c32925c
  changed only docs and comments; it also changed the restart message in
  the projects repository, which could not have caused that failure. The
  retry route's "before the first await" is corrected in 60a438d, and the
  repository key's "most servers hold App and app as two repositories" in
  3aecbe2.
  8. LOW: the completion note said "its folder", and the evidence sits
  beside the checkout. 9. LOW: the shutdown browser test read the pid file
  without a guard before a SIGKILL. 8 and 9 fixed 3b1b7fd.
  Found during the fixes: Windows CI hung 35 minutes at 316894b (run
  39115191562, cancelled by hand), after its unit tests had passed. Root
  cause, measured: Git Bash 5.2.37 hangs writing a here-string of 65,537 to
  65,664 bytes, and the gate's error-marker scan gave grep the unit output,
  65,624 bytes that run, as one. Fixed 7a2eb0d, with the testing doc in
  59df9de: the scan reads a temporary file, its self-check runs at a size
  in that window, and the CI job has a 30-minute limit.
- 2026-10-18 D-135 REVIEW (the D-134 fixes and the gate's scan,
  316894b..c5e64c8, by a separate read-only reviewer; each finding re-run
  here before it was fixed). Eight findings, all LOW, all dispositioned
  before new work:
  1. A write to the scan's temporary file that failed part way left grep a
  short file that read as clean. 2. The 65,600-byte self-check ran in the
  gate's own shell, so the hang it exists to catch would have hung the gate
  too; 7a2eb0d and 05-TESTING said it would fail. 1 and 2 fixed 920682b: a
  failed write counts as a marker, and the self-check runs in a child under
  a 60-second limit. With the here-string scan swapped back in, the gate
  failed at 60 seconds.
  3. 7a2eb0d's gate result and CI run were recorded nowhere. Windows
  `./verify.sh --e2e` exited 0 at 7a2eb0d with 1033 unit and 45 browser
  tests, and CI run 39118829036 at 59df9de, which carried it, passed on all
  three. Row 1.1 now says so.
  4. "However it is spelled" (row 5.7, the repository key's docstring, the
  projects repository) overclaimed: `git@github.com:acme/app` and
  `https://github.com/acme/app` are one repository and two keys, by
  design. Each now names what folds.
  5. No test drove a linked dependency that was not ready, so reverting
  either route's check passed the suite. 6. Creating a review fetched the
  primary before it read the dependency. 5 and 6 fixed 073336d: the
  dependency is read and its link checked first, both sides are fetched
  before either is pinned, and a test covers a dependency still cloning,
  one unknown and one not linked.
  7. The demo fixture cloned into a shared directory and left its projects
  pending, so a data directory kept with --keep refused them, failed them
  at the next start, and since 60a438d deleting one left its clone. Fixed
  9b15ab8.
  8. A path shaped like a Windows one is read as Windows on every platform,
  so on Linux and macOS `.\app` and `./app` share a key. Left as it is,
  and said in the docstring: it matters only for a directory whose name
  begins with `.\` or a drive letter.
- 2026-10-18 D-136 REVIEW (MVP 5.8 to 5.10 and the D-135 fixes,
  c5e64c8..6b3eafc, by a separate read-only reviewer; each finding re-run
  here before it was fixed). Nine findings, one MEDIUM and eight LOW, all
  dispositioned before new work:
  1. MEDIUM: the repository gate bee1780 added matched only the two import
  spellings the old routes used, under src/app and src/components, so the
  schema through the client, the query API, a raw prepare, a run-time import
  or a relative path all passed it, and the architecture doc and row 5.10
  said more. Fixed a3776a2: read per file, across src outside
  src/server/db, it refuses value imports of drizzle, better-sqlite3, the
  schema or the client, at load or run time, and calls on the handle; type
  imports pass, and runtime.ts and data-dir-lock.ts are named owners. Of
  eight bypass samples the old gate flagged two, the new one all eight.
  2. LOW: the rulesets screen kept the import question while the form was
  edited, so Replace could replace a ruleset nobody was asked about. 3. LOW:
  the question came for an unchanged document, warning of a loss that does
  not happen. 4. LOW: the API test passed only after another test, and no
  test ran a Replace that changed anything. 2 to 4 fixed 3e128a1: asked only
  when the document differs, dropped when the form changes, tested alone and
  through a real replacement.
  5. LOW: the self-check's exports reached every later gate step, marker
  text and all. Fixed 4cd2cb9: exported in a subshell; 3 variables leaked
  before, 0 after.
  6. LOW: a link already removed answered in ids and its row stayed until a
  reload. Fixed c5b4f95: the message says what happened, and a 404 reloads
  the page.
  7. LOW: a "__proto__" setting was dropped by zod and answered 200. Fixed
  57748c1: the body is read as JSON.parse made it, and the key is refused.
  8. LOW: four untrue sentences: row 5.9 said every cited CI run passed
  (39127235484 failed on macOS); row 5.8 and e2ddb74 listed "a bare confirm
  still confirms" among tests failing on the old code, which it passes; a
  test title still said "however its address is spelled"; the attention
  route said "no joins". The rows, the title and the comment are corrected
  here; e2ddb74's message stays as pushed. 9. LOW: 073336d and 9b15ab8 had
  no gate result or CI run on record; rows 5.6 and 5.7 now carry them, 1034
  and 45 at each, CI runs 39120772872 and 39121300647.
- 2026-10-18 D-137 REVIEW (MVP 5.11 to 5.13 and the delete-mid-clone fix,
  05bf84a..e28d856, by a separate read-only reviewer; each finding re-run
  here before it was fixed). Twelve findings, one HIGH, two MEDIUM and nine
  LOW, all dispositioned before new work:
  1. HIGH: a review queued behind a running one is a draft in the database,
  and its screen offered Start review with a ruleset the run would not use;
  starting it answered 200 and dropped the choice. 9. LOW: the draft
  control said nothing with no rulesets, or when its ruleset read failed.
  Fixed 92635a8: Start shows only on a draft neither queued nor running,
  with words and a link for no rulesets and Try again for a failed read.
  The 5.11 test now checks the ruleset sent and waits for its run to end
  (10 and 11 in part).
  4. LOW: the theater showed the dropped-stream notice at the end of every
  run, the server closing the stream on purpose. 5. LOW: a review that does
  not exist had its stream reopened and its reading polled for as long as
  the tab stayed open. Fixed 2ff683a; the 5.12 test matches the theater's
  own words (10 in part).
  2. MEDIUM: a failed ruleset read on the new review screen claimed no
  rulesets existed. 7. LOW: the stale-refs banner outlived its refs. 8.
  LOW: failed reads ran together as one sentence. 12, first half: the
  pre-flight and the model list read after a probe were still bare. Fixed
  8c3682a.
  3. MEDIUM: the review screen's report read and the confirmation panel's
  rules read had no error state, though row 5.13 was marked done for every
  first read. Fixed 4e0a2db.
  6. LOW: delete-everything judged clone status from a list read before
  many awaits, and a clone's cleanup of a deleted project swallowed its
  failure. Fixed 19efbf4; the re-read is by reading, not tested.
  10, the list test: Try again was proved only by the old message going.
  Fixed 018939b.
  12, second half: row 5.13 gave no counts at 4845d0d. They were 1040 unit
  and 51 browser tests; the row now says so.
- 2026-10-18 D-138 REVIEW (the D-137 fixes, e28d856..66b5ea7, by a separate
  read-only reviewer; each finding re-run here before it was fixed). Seven
  findings, one MEDIUM and six LOW, all dispositioned before new work:
  1. MEDIUM: 92635a8 hid the draft's Start on a queued or running review,
  but the start API still answered 200 and dropped a ruleset sent to one,
  which a second tab could reach. Fixed 0e9bf6e: the job manager refuses a
  ruleset for a review queued or running, and the start route one for a
  review frozen with its own, both as 409s.
  2. LOW: an ended run skipped the poll with the notice, so a failed
  reading after the end left the page on the run for good, and the poll
  stopped on a stale "not live". Fixed ffd16ab.
  3. LOW: the confirmation panel's file read took a failure for a checkout
  that was gone. Fixed 7f46f96.
  4. LOW: the review screen replaced the server's words with a fixed
  sentence and offered a futile Try again for a review that does not
  exist, as the project and ruleset screens did; the scoreboard said a
  fixed sentence with no Try again. Fixed b911a87: the server's words,
  and a link back for a missing subject.
  5. LOW: retries kept the old message until the answer came, and the new
  review screen had two Try again buttons that disagreed. 6. LOW: failed
  reads were keyed and told apart by their text alone. 5 and 6 fixed
  4fb787b.
  7. LOW: row 5.11 listed "the start sends the ruleset the picker shows"
  among checks failing on the build before, which it passed; corrected
  here. And D-137 left its finding 11 unstated: the 5.11 browser test
  ended with its review still running into the theme screenshots, which
  92635a8 fixed in full by waiting for the run to end.
- 2026-10-18 D-139 REVIEW (the D-138 fixes, 66b5ea7..979ea26, by a separate
  read-only reviewer; each finding re-run here before it was fixed). Seven
  findings, one MEDIUM and six LOW, all dispositioned before new work; the
  test one of them asked for found an eighth:
  1. MEDIUM: the file pane said "The checkout is no longer available" for
  a file the change deleted, the one case where the context route answers
  200 with no lines, and the checkout is there. Fixed 7323cf7.
  2. LOW: a run just started or resumed kept the "not live" from before
  until a reading landed, so a stream that dropped in that moment was
  never opened again, and the poll had lost its stop for a finished
  review. 4. LOW: the browser test for a run whose last reading fails
  waited a fixed nine seconds for the run's end and never checked that it
  came. 2 and 4 fixed d69ede7; the first half of 2 is by reading.
  3. LOW: the queued review's 409 was proven in the manager alone, and the
  retries' "Reading..." states by no test. The held reads went in d85d52f.
  The API check found the eighth, a MEDIUM: the 409 never reached a
  client. In the built app the job manager on globalThis is the
  instrumentation bundle's copy of its module, so its errors were never
  instanceof a route's classes, and the start route answered both of its
  refusals with 500, ReviewNotStartableError since 4.19. A cancel of an
  unknown review was a 500 the same way. D-138's item 1 and row 5.11
  stated the 409 as done; it held in unit tests, which load one module
  graph. Fixed e05cfed: the start route knows the refusals by name
  (isStartRefusal), the cancel route looks the review up itself, and
  check-style refuses a manager error class imported into a route.
  Asking every id route on the built server about an id that names
  nothing found one more 500, the rules route, which never looked the
  review up. Fixed b28542b, with that sweep kept as a browser test.
  5. LOW: Try again and Refresh on the new review screen left the cached
  refs' lines up with no refs under them. 6. LOW: the same screen offered
  Try again for a project that does not exist, with no way back. 5 and 6
  fixed cee8e95.
  7. LOW: a disabled guard on the draft's ruleset picker could never
  apply. Removed d85d52f.
  CI run 39145501965 at 979ea26, a docs-only commit, failed on Windows:
  the quality gate's last test ran its synchronous database setup or
  teardown past vitest's 10 s hook limit. The runner was slow throughout
  that run: the unit run took 154.67 s against 81.73 s at the next green
  run, and two tests in other files took 19.8 s and 9.6 s against 0.7 s
  and 0.9 s. Hooks now get the thirty seconds tests have (4d94db5).
- 2026-10-18 D-140 REVIEW (the D-139 fixes and their record, 979ea26..6555d26,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Seven findings, two MEDIUM and five LOW, all dispositioned before
  new work:
  1. MEDIUM: main was red. CI run 39157523156 at 6555d26 failed on
  Windows, in cee8e95's missing-project test: the page's Turbopack runtime
  chunk was refused with net::ERR_NO_BUFFER_SPACE as it loaded, the net
  log holds os_error 10055, and the page never hydrated. A D-105
  occurrence: its re-run, attempt 2, passed on all three.
  2. MEDIUM: e05cfed's check-style rule saw only a braced import into
  src/app or src/server/api, and missed a namespace import, a re-export, a
  dynamic import and a helper module between. 3. LOW: two routes reach the
  manager after an await, the review read and the complete, so a review
  deleted from another tab meanwhile made manager.snapshot throw its copy
  of ReviewNotFoundError, which the handler answered 500. 4. LOW: the
  mechanism was misstated in e05cfed, D-139 and the docs: the routes share
  one copy of the server modules (the thirteen route chunks register the
  manager as one module id in Turbopack's shared runtime), and the
  instrumentation bundle has its own. 2, 3 and 4 fixed 5057a5d: the HTTP
  layer knows every error by the name its class sets, the handler's lists
  too, and check-style refuses instanceof on an app class there, and the
  manager's error classes anywhere but its own module.
  5. LOW: the id-route sweep proved nothing for five of its 26 pairs,
  which refused {} before any lookup; it accepted any 404, and 400 from
  the cancel route, and never asked an inner id under a parent that
  exists; row 5.13's "asks every id route" said more than it did. Fixed
  12a299f.
  6. LOW: 7323cf7's premise was untrue: the context route answered any
  failed read with a hunk as a deleted file. Fixed 2a38f9d.
  7. LOW, the record: (a) D-139 called the first half of its item 2 by
  reading; both halves are, and item 4's test is the one that runs. (b)
  4d94db5 went unrecorded: 1045 unit and 59 browser tests on Windows, CI
  run 39156652809 passed on all three. (c) D-139's 154.67 s against
  81.73 s for the whole unit run showed nothing: five green Windows runs
  since took from 107.40 s to 155.14 s. The slow runner rests on the
  tests in other files, 19.8 s and 9.6 s against 0.7 s and 0.9 s, and the
  comment in vitest.config.ts now says only that. (d) d85d52f's message
  put the dead disabled prop on the Start review button; it was on the
  ruleset picker, as D-139 says. (e) Row 4.19 said the start route
  answers 409; in the built app it answered 500 from a6aab9a until
  e05cfed. The row now says so.
- 2026-10-19 D-141 REVIEW (the D-140 fixes and their record, 6555d26..bce003a,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Seven findings, all LOW, all dispositioned before new work:
  1. A file with no hunk whose checkout copy could not be read, busy,
  refused or a directory, was answered 404, not found. 2. A deleted file
  with no hunk pointed at a change above that was not there; and a file
  cited by its name before a rename was read from that name, a read error
  with a Try again that could never work. 3. The browser test for the
  pane's Try again proved only that the message went. 1, the first half
  of 2, and 3 fixed 4dafb5a, which also refuses a path that climbs out of
  the checkout before any read: widening the read errors had turned it
  into "could not be read", and the existing escape test caught that. The
  rename fixed 892368e.
  4. The check-style rules from 5057a5d read line by line, and missed an
  instanceof Prettier wraps, a line that opens with a comment, constructor
  and prototype comparisons, and a helper that calls the manager; and
  flagged a string and a trailing comment naming a manager error. Fixed
  8aef7be, which moves isNamed to src/lib/errors.ts so the
  instrumentation, a caller of the manager, can use it.
  5. The handler's names were checked against the test's own list, so a
  name added misspelt or twice stayed green. Fixed bd194d1.
  6. The id-route sweep took any not-found code, the generic one a guard
  before the lookup would answer among them, and the links POST's unknown
  dependency could answer for the path's id. Fixed e2e1ab7.
  7. Row 4.19 put the 500's end at 5057a5d, where it ended at e05cfed, and
  row 5.11 said the start route knows the refusals by name, which the
  handler has done since 5057a5d. Both corrected here.
- 2026-10-19 D-142 REVIEW (the D-141 fixes and their record, bce003a..8d6124b,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Six findings, two MEDIUM and four LOW, all dispositioned before
  new work:
  1. MEDIUM: the context route matched a finding's file by its path or the
  path it came from, and a copy carries the path it was copied from, listed
  before the file itself: a finding on a file the change also copied was
  shown the copy's hunk since 3f630e3, and since 892368e said to be renamed
  to the copy and shown its lines. Fixed b3b9b5d.
  2. MEDIUM: 8aef7be matched the instrumentation's lock check by name, and
  the refusal a second server gets is a subclass with a name of its own, so
  it crashed with a stack where it had said its reason; the startup test,
  checking the exit status and the words, passed the crash. Fixed 06efb83:
  instanceof again, the instrumentation being the manager's own copy, and
  the test wants no stack.
  3. LOW: bd194d1's test read each expected status from the list it
  checked. Fixed 3f06eb1.
  4. LOW: the check-style rules read lines, not code, and chose files by
  the word "manager". Fixed bac0b5d: TypeScript's parse, and the importers
  of the runtime and job modules.
  5. LOW, there before: a link in the checkout could lead the file read out
  of it. Fixed b97fd24.
  6. LOW, the record: row 5.11 and 01-ARCHITECTURE said the rules cover
  "every file that calls the manager", a text match on the word; 8aef7be
  said the instrumentation "now matches by name" without the subclass it
  lost; and its "all five and the helper" named four forms and the helper.
  D-141 item 4's fix, 8aef7be, carried the regression item 2 here undoes.
  The docs now say what bac0b5d does.
- 2026-10-19 D-143 REVIEW (the D-142 fixes and their record, 8d6124b..33be9c1,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Seven findings, all LOW, all dispositioned before new work:
  1. A link the change itself made, leading out of the checkout, was
  answered 404 and its hunk dropped. 2. A realpath that failed skipped the
  check, and the read resolved the path again. 1 and 2 fixed eff42db; 2 is
  by reading, no case being found where realpath fails and the read works.
  3. bac0b5d's rules missed an import named by a template literal, by
  import-equals or through "..", an app class with a global's name, and
  prototype comparisons. Fixed f1196f6, whose message says it "touches no
  app code"; it also corrected a comment in src/lib/errors.ts, item 6.
  4. b3b9b5d's comment, its test's and D-142 item 1 said git lists a copy
  before the file it came from. Git lists entries by the path they go to,
  so a copy comes first when its path sorts first: in a scratch repo
  diffed with -M -C, a.ts, then b.ts copied from m.ts, then m.ts, then
  z.ts copied from a.ts. The fix never depended on the order; the comments
  are corrected in eff42db.
  5. 3f06eb1's message said nothing else pins IllegalTransitionError at the
  handler. The status test's second-decision case pins it through the
  confirm route. InvalidCloneTransitionError was the one listed status no
  route test named: with it flipped to 404 in the handler's list, the unit
  suite failed in that test alone (1 failed, 1050 passed), and with the
  test from before 3f06eb1 it passed whole (1051).
  6. src/lib/errors.ts still said any file that calls the manager matches
  by name, which the instrumentation does not. Corrected in f1196f6.
  7. Row 5.11 said all its counts came from the browser gate, and
  3f06eb1's came from ./verify.sh alone. Corrected here, with f1196f6's.
- 2026-10-19 D-144 REVIEW (the D-143 fixes, their record and 5.14's first
  change, 33be9c1..3cab415, by a separate read-only reviewer; each finding
  re-run here before it was fixed). Eleven findings, one MEDIUM and ten LOW,
  all dispositioned before new work:
  1. MEDIUM, there before: a ticked dependency could be compared against
  its own branch, an empty half that reads as clean, and neither the create
  route nor the pre-flight refused a branch compared against itself, the
  primary's or the dependency's. Fixed 423b320.
  2. 3cab415 left a dependency ticked when its link went, seen at a read
  again, with Start off for good. 3. The line beside Start asked for a
  branch while the dependency's branches were read, refused or absent, and
  read as the only reason when another was missing. 4. 3cab415's test
  proved the gate and not the outcome. 2, 3 and 4 fixed 47bd5b6.
  5. A link the change made to a target not on this machine was a read
  error with a Try again that could never work. 6. eff42db's realpath is
  the native one, which throws EISDIR on Windows RAM and virtual disks that
  bypass the Volume Mount Manager, as Vite's source records; there every
  read would have been a read error. Not reproduced, there being no such
  disk here, so D-143 item 2's "no case being found" stands only for this
  machine. 5 and 6 fixed af5a37d, the fallback tested with the native call
  stood in for.
  7. f1196f6's rules missed a parameter or destructured name shadowing a
  global. 8. They flagged fn.prototype === undefined. 9. A stale comment
  sat above its replacement. 7, 8 and 9 fixed 8a75e2a.
  10. Row 5.14 still read TODO after 3cab415, where earlier first changes
  wrote their rows; and D-143 item 3 and row 5.11 left out the
  ["constructor"] comparison f1196f6 closed. Both corrected here.
  11. There since 5.2, and one of 5.14's keyboard gaps: the new review
  form's Enter guard took Enter from links and the Advanced fold. Fixed
  88295d0.
- 2026-10-19 D-145 REVIEW (the D-144 fixes and their record, 3cab415..e88223c,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Seven findings, two MEDIUM and five LOW, all dispositioned before
  new work:
  1. MEDIUM, there since the dependency fields: the dependency's suggested
  branch was written once and kept, so after the branch under review moved
  it stayed on the first one's name, the hint still saying it was the same
  name. Fixed d921173.
  2. MEDIUM, there before: a half of a review with no change, a branch
  never committed to or one already merged, was invisible on the
  pre-flight and ran, reading as clean; 423b320 caught only one branch
  against itself. Fixed 6697fec: each half's files on the card, Start off
  for an empty one, and the create route refusing it.
  3. LOW: the dependency's tick outlived its link, so a restored link came
  back ticked, and its pair outlived a refusal, with Start on. Fixed
  13bc8e8; since d921173 a refusal after a good read cannot happen through
  the screen's controls, so its part is by reading.
  4. LOW: brokenLink was answered for a link to a directory that is there,
  and for one to a file busy or refused. Fixed 5c88ff2.
  5. LOW: the real-path test stood in the fallback too, so the walk never
  ran. Fixed 84ea3fc, which says what the test still cannot tell apart on
  a machine where the native call works.
  6. LOW: error.constructor === undefined was flagged, and three forms of
  class test the rule never sees. Fixed 3d4b76a, the forms named in the
  rule's comment, as is the file-wide reading of names, which fails loud.
  7. LOW, the record: row 5.14 put the Enter guard among U12's gaps, which
  it is not, and said the dependency let go with its link before 13bc8e8
  made it so; both corrected here. 47bd5b6's message says that after a
  refusal the screen said only "Choose the dependency's branch", where the
  card showed the refusal and only the line beside Start said that.
  8a75e2a says it "still flags the four D-143 planted" where f1196f6
  planted seven; the four were D-143's p4 file: an imported File, a
  declared Headers, a getPrototypeOf comparison and a ["constructor"] one.
  af5a37d's "EISDIR walks the path" claimed a walk its test never ran,
  until 84ea3fc.
- 2026-10-19 D-146 REVIEW (the D-145 fixes and their record, e88223c..92a4458,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Nine findings, two MEDIUM and seven LOW, all dispositioned before
  new work:
  1. MEDIUM: 6697fec's empty-half block rested on a pre-flight a Refresh
  did not ask again, so a branch pushed to since stayed blocked as
  changing nothing. 3. LOW: the empty-half line named the choices now for
  an answer about the choices before. Both are U11's second trap, the
  stale pre-flight, and fixed with it, 53e0fec.
  2. MEDIUM: the create route judged an empty half by commits, so a branch
  whose commits add up to nothing, an empty commit or a commit and its
  revert, ran a review of no change; the records said it refused every
  empty half. 5. LOW: a dependency's refusal read as the primary's. 2 and
  5 fixed 1d65660, which reads the change set the review would read.
  4. LOW: the line beside Start gave one reason of two. 6. LOW: a ticked
  dependency's branches were never read again on Refresh. 4 and 6 fixed
  ee76800.
  7. LOW: brokenLink missed ENOTDIR, Linux's and macOS's code for a link
  through a file. Fixed 2546b57; that the route before failed there is by
  reading, Windows giving ENOENT for the same link.
  8. LOW: the check-style comment listed passed forms as if complete.
  Fixed 225d7c3.
  9. LOW, the record: (a) row 5.13 said all its counts came from the
  browser gate, and 84ea3fc's came from ./verify.sh; corrected here. (b)
  13bc8e8's message and two comments said a restored link came back with
  "no read"; the restore read the branches again, while the stale mark
  showed the old ones as read; the comments are corrected here. (c) A
  comment said a refusal leaves "none chosen"; a branch chosen by hand
  stays chosen, unsent; corrected here. (d) D-145 item 3's "since d921173
  a refusal after a good read cannot happen" holds only since 13bc8e8,
  and since ee76800 it can again, through Refresh, which 13bc8e8's
  clearing covers. (e) 92a4458's message put both D-145 MEDIUMs on "a
  dependency half"; its item 2 was about either half. (f) D-145 item 7
  cited a reviewer's scratch file no reader can open, and left a line
  unwrapped; the line is rewrapped here with its words unchanged.
  The first gate of ee76800 failed in a test after the new ones,
  "route.fetch: Test ended": a new test ended with its route handler
  still fetching an answer. ee76800 made the new tests wait for one
  response each, which was not enough: CI run 39317190548 at 225d7c3, a
  comment-only commit, failed on macOS in the same test, "Response has
  been disposed", a second pre-flight still being answered when it
  ended. Not a D-105 occurrence: the cause is the test's. ebe2f5e routes
  the 5.14 tests through a helper whose stop lets new requests through,
  waits for every answer in flight, and only then removes the route;
  removing it first made Playwright let the request through under its
  answer, "Route is already handled!", four times in six repeats of one
  test. After ebe2f5e that test passed six repeats of six here, 1058 and
  72 on Windows, and CI run 39401048625 passed on all three.
- 2026-10-20 D-147 REVIEW (the D-146 fixes and their record, 92a4458..26f74d1,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Seven findings, one MEDIUM and six LOW, all dispositioned before
  new work:
  1. MEDIUM: since 53e0fec and ee76800 a Refresh on the new review screen
  started up to three git fetches at once into one bare clone, the branch
  list's, the pre-flight's and a ticked dependency's. The reviewer ran two
  at once into a scratch bare clone after a branch moved on its remote,
  and one failed with "cannot lock ref" in 10 rounds of 10; with nothing
  moved, in none. The screen then said the remote could not be reached,
  or put git's error where the pre-flight was. Fixed c35c2a3: fetchAll
  queues per clone, each caller still getting a fetch that started after
  it asked (D-27).
  2. LOW, there before: the pre-flight effect sent an identical request
  again when the dependency's state settled, twice per tick of a
  dependency with no branch named like the one under review. Fixed
  b659654, which sends it only when the request itself changes.
  3. LOW: Start was on while the pre-flight for the choices on screen was
  pending. Fixed with U11's third trap, 94bd28d.
  4. LOW: the profile picker read the model's profile from the pre-flight,
  hidden on every pending window since 53e0fec, and offered a decomposed
  model "chunked". Fixed 6c53190, which reads it from the models list.
  5. LOW: 1d65660's change-set read at create time let a diff git
  disagrees with through as 500. Fixed fee33cb, which answers 400 as the
  pre-flight does, by reading, no fixture making git's diff and its file
  list disagree.
  6. LOW, the record: 53e0fec's message says three tests matched by a
  loose locator; two locators changed, fillANewReview's, which most
  new-review tests use, and one in the journey. Its "fails on the build
  before" lines cite :435 and :463, where the assertions are at :437 and
  :465; ee76800's cite :361 and :423, comments, where the assertions are
  at :366 and :431-432. The runs before were made on earlier versions of
  those tests; by reading, the tests as committed still fail on the code
  before them. The line references in the messages since all point at an
  assertion in the file committed, checked here.
  7. LOW, the record: row 5.14 left out ebe2f5e, which rewrote its tests'
  routes, so a reader of the row never learned those tests failed CI at
  225d7c3. Added to the row here.
  D-146's "Not a D-105 occurrence: the cause is the test's" was half the
  cause: the requests in flight on macOS were the screen's needless
  re-sends of finding 2, which b659654 stops; the test's half is ebe2f5e.
  b659654 was committed and pushed after its last gate, the fast one run
  for a comment change to e2e/answer-once.ts, exited 1: the commands were
  joined by ";", which did not stop on it. The full gate on the same code
  bar that comment had exited 0 (1060 and 73). The failure was "completes,
  and says the checkout was already changed" in
  tests/server/review/service.test.ts, the D-107 repository, expected ''
  to contain 'crlf.txt': git reported that checkout clean, once. Alone the
  test passed 4 of 4, the whole file 6 of 6, git reported a fresh checkout
  of that repository changed 20 times of 20, and the fast gate run again
  exited 0 (1060). Not root-caused, so open: the inbox holds it. Since
  then a gate and its commit are joined by "&&", so a failed gate stops
  the commit.
  The first gate of 3d3adf3 failed in the usage-limit browser test: the
  new theater test armed the stall trigger and left it armed, so the run
  after it stalled in its first stage. The test now clears it, and the
  gate run again exited 0.
- 2026-10-20 D-148 REVIEW (the D-147 fixes, 5.14's last changes and their
  record, 26f74d1..422c888, by a separate read-only reviewer; each finding
  re-run here before it was fixed). Nine findings, one MEDIUM and eight
  LOW, all dispositioned before new work:
  1. MEDIUM: c35c2a3's fetch queue was a module constant, and the built app
  holds two copies of the gitops module, the job manager's in the
  instrumentation bundle and the one the 27 route chunks share. A review's
  start or resume still fetched beside the routes' fetches into the same
  clone, the trap D-139 found for the manager. Fixed d2627bf: the queue is
  on globalThis under a Symbol.for key, which the next build put in the
  instrumentation chunk and the 27 route chunks. Its test loads the module
  twice; on the code before, its first round failed with "cannot lock ref".
  2. LOW: c35c2a3's test of a failed fetch never queued, its failing fetch
  going into another path; with the catch that lets a queued fetch run
  after a failure removed, it still passed. Fixed 606f7f2, which fails the
  first fetch into the clone itself; the same mutation then fails it.
  3. LOW: the queue ran every fetch asked for, those of pre-flights the
  screen had dropped among them, and Start waited for the newest after
  them all. Fixed 08628ea: callers asking while a fetch runs share the one
  after it, which still starts after each asked (D-27); five asked at once
  ran two fetches, where the code before ran five.
  4. LOW: 94bd28d's refusal line stood alone ahead of the joined reasons,
  D-146 item 4's class. Fixed e7c140e.
  5. LOW: 127f96e's ring was drawn outside the label and the scrolling
  branch list clipped it to two lines; its test read the computed style,
  which said solid. Fixed 70795aa: drawn inside, the test checking the
  ring's outer edge lies within the list.
  6. LOW: the theater test disarmed the stall only on its last line, so a
  failed assertion before it was said to fail the usage-limit test after.
  Not reproduced: with a failure injected right after the arming, under
  the hooks as they were, the usage-limit test passed, because Playwright
  discards a worker after a failed test and runs afterAll, which disarms
  both triggers. The fake CLI disarms a trigger when a call reads it, so
  what is left is a test that passes having cancelled before any call,
  which 3d3adf3's own disarm covers. No change.
  7. LOW, there before: hiding the theater left the focus on the page.
  Fixed 602ac46: Scan view takes it.
  8. LOW, the record: c35c2a3's message, the comment above fetchAll, D-147
  item 1 and row 5.14 said a Refresh starts three fetches into one clone.
  It starts two into each, the branch list's and the pre-flight's into the
  primary, the dependency's branch read and the pre-flight's into the
  dependency; a review's start or resume can add a third. The comment was
  corrected in d2627bf and the row here; D-147 item 1 and c35c2a3's
  message stand corrected by this line.
  9. LOW: 6c53190's test ended by setting the profile back, which sent a
  pre-flight nothing waited for. Removed in 8f4ec29.
  CI run 39420099693 at e7c140e failed on macOS in the shutdown control, "a
  server killed outright leaves its stage's CLI running": the CLI was gone
  two seconds after its server's SIGKILL. The first such failure in the 249
  runs CI lists, and the change it ran on touches no process handling. The
  run kept no stage log, so the cause is not known. 4aa31fa makes a
  recurrence say why: the fake CLI notes beside its pid how it ended,
  which a signal does not, the control's failure carries that note and
  the stage logs, and the SIGTERM test now requires that a signal ended
  its CLI, which closes a way it could have passed with the handler doing
  nothing; CI run 39423284598 ran both on ubuntu and macOS, and they
  passed. Run outside the suite, a hang whose stdout reader had gone died
  of EPIPE in 42 ms; one way, not a finding. The inbox holds it.
- 2026-10-20 D-149 REVIEW (the D-148 fixes and their record, 422c888..670c8af,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Seven findings, one MEDIUM and six LOW, all dispositioned before
  new work:
  1. MEDIUM: 70795aa's inset ring lay over the chosen row's border, the
  ring's own colour, and the focused row is nearly always the chosen one;
  the reviewer measured focus changing 756 pixels inset against 1,503
  outside, on a label styled the same in Chromium. Fixed c02ea71: the ring
  is outside again and the branch list padded by its reach; the test now
  also requires it drawn beyond the border.
  2. LOW: no test held the queue cleanup's guards. Fixed 8dd7fe6: a third
  fetch asked for from the first caller's continuation, the one place a
  caller can arrive between a fetch's cleanup and the next one's start;
  with the cleanup no longer sparing an entry with a fetch queued, two
  fetches ran at once at offset 1. The owner guard is kept, though no
  order of events reaches it: the cleanup is registered before any fetch
  can be queued behind its own, so it always finds its own entry.
  3. LOW, there before: git's stand-in system config was rewritten in
  place by every copy of the gitops module and by other servers, and a
  reader read it empty, 3 runs of 3. Fixed 7f2f1ac: left alone when it
  holds its text, otherwise written beside it and renamed into place.
  4. LOW, the record: D-148 and 4aa31fa's message said the control's
  failure was the first in "the 249 runs CI lists". The control came in
  with 1d4bb04; counted with gh run list on 2026-10-20, 129 runs carried it
  before e7c140e's, which was the 130th, and none of those failed it.
  5. LOW, the record: D-148's EPIPE route needed a signal between the pid
  file and the hang's only write, and the 42 ms EPIPE run was on Windows,
  which D-148 and the inbox left out. The route is closed in 6eb073e: the
  tests signal only once a stage log holds the CLI's init line.
  6. LOW: 4aa31fa's SIGTERM test built its failure message on every run.
  Fixed 61d752c.
  7. LOW, the record: 08628ea's "four to six fetches" for three model
  choices or two Refreshes was worked out by reading, not measured.
  CI run 39429832430 at 61d752c failed on its first attempt: GitHub never
  gave the macOS job a runner, "The job was not acquired by Runner of type
  hosted even after multiple attempts", beside notices of macOS arm64
  capacity, and no step ran. Its second attempt passed on all three.
- 2026-10-20 D-150 REVIEW (the D-149 fixes and their record, 670c8af..b8f93a6,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Six findings, one MEDIUM and five LOW, all dispositioned before
  new work:
  1. MEDIUM, there before, one of U12's gaps under row 5.14's DONE: the
  branch list never scrolled to a focused radio, sr-only placing it
  outside the unpositioned label, so the arrow keys chose branches out of
  sight. Fixed d3e57c4: the labels are relative.
  2. LOW: 7f2f1ac's stand-in could fail on a rename Windows refuses for a
  moment, or on its partial's clean-up, and systemGitConfig kept the
  failure, every git call's until a restart. Fixed 48ec996: refusals are
  retried for up to two seconds, the clean-up cannot fail it, and a
  failed build is not kept.
  3. LOW: no test reached the rename: the empty-read test only met a file
  already holding its text. Fixed c8aab20, whose variant puts other text
  there before each copy writes; an in-place write then reads empty.
  4. LOW: those tests removed and rewrote the machine's stand-in, which a
  running server and other workers read. Fixed 93d26c8: they use their
  own directory. Its message says the first test asserts the stand-in "is
  there"; it asserts it is in that directory.
  5. LOW, wording: the first caller's continuation lands between the
  cleanup and the queued fetch's start only at offset 1, not as 8dd7fe6's
  comments and message and D-149 item 2 put it. Corrected daccd92.
  6. LOW: c02ea71's padding set the branch rows 4px in from the model
  list's. Fixed ad6ba5b.
  Root-caused while gating c8aab20, whose first fast gate failed in the
  D-107 gitops test, as b659654's had in the service one (D-147): git's
  racy-clean rule. Git trusts a file's timestamps once the index is newer
  than the file, and compares content only while it is not; a checkout
  writes both in one timestamp, and under load the index came a tick
  later, so the CRLF checkout read clean. In a scratch repository, with
  the index made newer, 10 checkouts of 10 read clean; aged, 10 of 10
  read " M". The app is right either way, a clean read staying clean to
  the end check and a stage's write making git compare; only the tests
  depended on the timing. 9759785 ages the D-107 checkouts' index; with
  the helper made to do what load did, four D-107 tests fail, the two
  that failed for real among them. That closes the inbox's D-107 line.
  CI run 39442272010 at ad6ba5b failed on its first attempt as 61d752c's
  did: no macOS runner, "The job was not acquired by Runner of type hosted
  even after multiple attempts", and no step ran. Its second attempt
  passed on all three.
- 2026-10-20 D-151 REVIEW (the D-150 fixes and their record, b8f93a6..3054ebe,
  by a separate read-only reviewer; each finding re-run here before it was
  fixed). Two findings, one MEDIUM and one LOW, both dispositioned before
  new work:
  1. MEDIUM, there since D-110: the baseline compared bytes only for the
  paths git status named, and status trusts a file's timestamps once the
  index is newer than it, as under load and in any large checkout, whose
  files are written over many ticks. Two paths differing only in case and
  of one size then read clean on Windows, the file holding the other's
  bytes, and the review would have quoted the wrong bytes with no refusal.
  The reviewer saw it with the test's own fixture, the index made newer,
  and with plain git and 3,000 filler files, no aging, 3 checkouts of 3;
  here the test with the newer index resolved with nothing named, 3 of 3.
  D-150's "the app is right either way" held for D-107 alone. Fixed
  7b4a586: every tracked regular file is hashed through git's clean
  filters and compared with its blob, and a file that differs goes to the
  D-110 check. Listing and hashing every tracked file of this machine's
  working trees took 110 to 489 ms, the most for 3,436 files (3 MB). The
  architecture doc's D-110 sentence said only what status named; the
  correction belonged in 7b4a586 and is made here.
  2. LOW, the record: D-150 and 3054ebe said the inbox's D-107 line was
  closed, and the inbox was not changed. It is retired here, and the open
  lines filed since 2026-08-04, which sat under the Retired heading, are
  moved above it word for word, none re-verified.
- 2026-10-20 D-152 DECIDED (MVP 6.1, taken under the maintainer's standing
  instruction to proceed on recommendations; theirs to overturn): the CLI
  path can be kept in Settings, the first setting that is not a number.
  Which CLI a review runs through is, in order, TRYSQUARE_CLAUDE_PATH, then
  the kept path, then the CLI npm install put in node_modules, then claude on
  PATH. The variable wins because it is the choice of whoever started this
  server, as TRYSQUARE_DATA is, and a test or a deployment that pins the CLI
  by it must not be moved by a value in the database; Settings says when it
  is set. The path is read as each run starts and each check runs, not once
  at startup, so a saved path is the next run's. A path is refused holding a
  control character, which in a run note would forge a line, and is not
  judged otherwise: Check the CLI says whether it runs. Rejected: the kept
  path winning over the variable, which would let a value saved from the
  screen override the fake the browser suite pins; and checking the path on
  save, which would start the CLI without a person asking for a check
  (D-31). A cross-site request cannot set it: the request guard refuses
  foreign origins before any route (src/proxy.ts).
  FOUND the same day: proving 6.1's manager test on the code before its
  fix, a run started with no CLI path of its own resolved the CLI in
  node_modules, and one real stage ran on the maintainer's sign-in,
  claude-fable-5, 30 assistant messages, 33,893 output tokens, 60 uncached
  input, 171,462 cache-read and 104,435 cache-write tokens by its session
  record, before the run failed. No unit test was kept from the real CLI.
  c074998 refuses it to every unit test outside TRYSQUARE_REAL_CLI=1, at the
  resolveCli the engine modules import; the experiment was not run again.
- 2026-10-21 D-153 REVIEW (7b4a586, the D-151 record and MVP 6.1,
  3054ebe..9942d36, by a separate read-only reviewer told never to run
  anything that could reach the real CLI; each finding re-run here before it
  was fixed, without starting the real CLI). Eleven findings, one HIGH, three
  MEDIUM and seven LOW, all dispositioned before new work:
  1. HIGH: c074998's guard let through any program under the temp
  directory, where a git archive copy of the repository made to prove a fix
  against its parent sits, with its node_modules and the real CLI: the
  reviewer showed, by resolution only, resolveCli returning such a copy's
  claude.exe. Fixed fd98d4b: a fake is a program in this checkout's tests or
  a script in the temp directory, never one under node_modules.
  2. MEDIUM: TRYSQUARE_REAL_CLI=1, exported in a shell, opened the guard to
  every test of a run. Fixed a77defd: only inside real-cli.test.ts.
  3. MEDIUM: 7b4a586's hash-object check failed the whole baseline with
  git's error for a tracked file not on disk, foo beside FOO/bar.txt on a
  case-folding file system, which had been refused with a reason, and for a
  name starting with a double quote, which hash-object unquotes. Fixed
  4fb2357: such paths go to the full check.
  4. MEDIUM: 9942d36's "one resolver decides the path everywhere" was untrue:
  the review service fell back to the variable itself, and npm run claude,
  which its comment and the RUNBOOK said runs the program reviews use, never
  reads a path kept on Settings. Fixed 9c9cb79: the service takes its
  caller's path, and the script's comment and the RUNBOOK say what it runs.
  5. LOW: describeCli, resolving inside its own module, started the real CLI
  for its free --version past the guard. Fixed eea10d1.
  6. LOW: stale words: the minimum-version comment, two errors naming only
  the variable, ManagerInit's "for tests", the architecture doc's "every
  tracked file". Fixed 7ce6253.
  7. LOW: readCliStatus called any finding failure "not found", wrote
  "unknown" for a sign-in that named no method, and called a --version
  timeout an unreported version. Fixed e5aad77, with the precedence test
  now naming the CLI it found missing.
  8. LOW: Settings said "Runs draw on your max, at no extra cost.", a cost
  claim wider than its 2026-07-30 source. Fixed 0c99b68: "Reviews draw on
  your Max plan's usage limits rather than billing per token."
  9. LOW: two tests failed for whoever exports TRYSQUARE_CLAUDE_PATH. Fixed
  21cde8b: the setup file clears it for every test file.
  10. LOW: the full-checkout hash has a 600 s ceiling, measured here only up
  to 3,436 files (489 ms); a repository past it would fail every review. Not
  changed; the inbox holds measuring a large one.
  11. The record: 9942d36's CI run 39462852674 had no macOS runner on its
  first attempt and passed on all three on its second.
- 2026-10-21 D-154 REVIEW (the D-153 fixes and their record, 9942d36..05a3450,
  by a separate read-only reviewer told never to run anything that could
  reach the real CLI; each finding re-run here before it was fixed). Eight
  findings, all LOW, all dispositioned before new work:
  1. runCliAttached, npm run claude's runner, resolved inside cli.ts past the
  guard, as describeCli had, and runs the CLI with any arguments. Fixed
  0b93fcd.
  2. The fake rule was lexical and wide: a link in the temp directory to the
  installed package's cli-wrapper.cjs passed by its name, and any shell
  script there passed. Fixed 82becb4: only a .mjs, .js or .cjs that Node
  runs, judged where it really leads.
  3. npm run claude's words left out claude on PATH, its not-found error
  pointed at Settings, which it never reads, and its comment said Settings
  names a sign-in command 6.3 has yet to build. Fixed 993bbe9; 9c9cb79's
  message stands corrected by this line.
  4. e5aad77's Settings branches for a cannot-run with no path and a
  sign-in with no method were never rendered under test, and the second
  said "runs" beside a line saying "reviews". Fixed 88fd6ab.
  5. The --version timeout check's `killed` was said to catch a kill for
  output past execFile's buffer as well. Not reproduced: on Node 22.17.0 a
  --version answer of 2 MiB fails with ERR_CHILD_PROCESS_STDIO_MAXBUFFER and
  `killed` undefined, so it reads as an unreported version, not a timeout.
  No change.
  6. One lstat per tracked file, one after another: the reviewer measured
  34.5 us a file against 7.9 us batched, about 3.5 s at 100,000 files,
  small beside hash-object reading every byte. Called optional; not changed.
  7. Five guard tests passed only because a real CLI is installed for the
  guard to refuse. Fixed a8a99d7: they skip where none is.
  8. The record: D-153 counted eleven findings as one HIGH, three MEDIUM and
  seven LOW, and labelled only six LOW; its item 11, the CI record, is the
  seventh. And its item 10 and the inbox gave "3,436 files (489 ms)" without
  saying what was measured: git ls-files --stage and git hash-object
  --stdin-paths over the regular files of a private working tree on the
  maintainer's Windows machine, the largest of six local repositories
  timed. The inbox line now says so.
- 2026-10-21 D-155 REVIEW (the D-154 fixes and their record, 05a3450..e8f5540,
  by a separate read-only reviewer told never to run anything that could
  reach the real CLI; each finding re-run here before it was fixed). Seven
  findings, one MEDIUM and six LOW, all dispositioned before new work:
  1. MEDIUM: e8f5540 named one of the maintainer's private POS working
  trees, with its size, in D-154 and the inbox, in this public repository.
  Fixed deb96f3: both lines name no tree, D-154's changed in place against
  the log's append-only rule because the identifier, not the decision, must
  not stand; and check-no-private refuses those trees' names, failing on
  exactly the two lines before they changed. The name remains in git history
  at e8f5540. Asked on 2026-10-21, the maintainer chose to leave it: what
  leaked is a folder name and a size, a force-push would not take it out of
  GitHub's reach by commit hash, and it would move every hash since, which
  this log and the plan cite.
  2. LOW: 88fd6ab's no-path test could not fail: without the check that
  hides the path line, React draws it empty, and no text tells that apart.
  Fixed 69f03ad, which counts path lines; with the check removed it failed.
  3. LOW: a8a99d7 skipped where no bundled CLI exists, though a review falls
  back to claude on PATH. Fixed dca8608: skipped only where nothing resolves.
  4. LOW: 993bbe9's not-found advice told a person whose TRYSQUARE_CLAUDE_PATH
  named nothing to run npm install, and dropped the folders searched. Fixed
  5822acd.
  5. LOW: 82becb4's message and the link test said Linux and macOS CI run it;
  CI's Windows runner, an administrator, does too (run 39555858217). The
  comment is fixed in 1afac66 and the message stands corrected here.
  6. LOW: one header line of the guard left at 100 columns. Fixed 1afac66.
  7. LOW: a comment called a cannot-run answer "could not be found", fixed
  with 69f03ad's rewrite; an import out of order, fixed in dca8608.
- 2026-10-21 D-156 REVIEW (the D-155 fixes and their record, e8f5540..8e90039,
  by a separate read-only reviewer told never to run anything that could
  reach the real CLI, nor to write a private name into its report; each
  finding re-run here before it was fixed). Five findings, one MEDIUM and
  four LOW, all dispositioned before new work:
  1. MEDIUM: deb96f3, meant to keep one private working-tree name out of
  this public repository, wrote three such names into the leak gate's own
  pattern, two of them published for the first time; the gate exempts its
  own file. Row 6.1's "now named by none" and D-155's account of what leaked
  were therefore untrue from deb96f3 on. Fixed 7da9231: the gate holds those
  names only as sha256 hashes of their words, and no tracked file names
  them. The two names remain in history at deb96f3. The maintainer, having
  left the choice to this session, has history left as it is, for D-155's
  reasons and one more: the gate has always held the private product and
  package names as literal patterns, by its design. The maintainer can
  overrule; nothing has been rewritten.
  2. LOW: the folder pattern matched only a forward slash, so a path pasted
  from Windows passed. 3. LOW: one name matched inside longer words. Both
  fixed by 7da9231's splitting of each line into words: a staged probe,
  never committed, failed on the slash and backslash forms and both
  hyphenated names in another case, 4 violations, and not on
  "repos-workspace" or a lone "pos".
  4. LOW: dca8608's helper turned any error into a skip, so a broken guard
  could skip all five refusals on every runner with the gate green. Fixed
  ec54990: only a CLI not found or not runnable skips, and never on CI.
  5. LOW: the guard's header said a test handing in its own environment
  resolves nothing real; two hand in the real one on purpose. Fixed ec54990,
  reflowed in afc119a.
  A D-105 occurrence: CI run 39562134166 at 8e90039, a record commit,
  failed on Windows alone in the dark theme's detail-screens test, /projects
  left on "Loading..." because one of its script chunks was refused with
  net::ERR_NO_BUFFER_SPACE, so the page never hydrated and never asked for
  its list. Chromium's network log names the call: one TCP_CONNECT_ATTEMPT,
  os_error 10055 (WSAENOBUFS). The saved TCP table held 69 TIME_WAIT, 11
  established and 24 listening, so not port exhaustion. Re-run once under
  D-105; the second attempt passed on all three.
- 2026-10-21 D-157 REVIEW (the D-156 fixes and their record, 8e90039..c5c91ac,
  by a separate read-only reviewer told never to run anything that could
  reach the real CLI, nor to write or recover a private name; each finding
  re-run here before it was fixed). Seven findings, one MEDIUM and six LOW,
  all dispositioned before new work:
  1. MEDIUM: 7da9231's word split, at anything but a letter, digit or
  hyphen, missed a hyphenated name inside a longer hyphenated word, a
  numbered copy or a Claude Code project folder's path, and any name glued
  to a backslash escape, joined by an underscore, a dot or a URL's %20, or
  split by a line wrap. Fixed 44903b4: each file is one stream of words split
  at anything but a letter or digit, escapes are separators, and runs may
  cross a line break. A staged twelve-line probe, its names written by a
  scratch script and never committed: 9 violations from 44903b4, none from
  7da9231, and none on three ordinary lines.
  2. LOW: the gate still exempted its own file from every check. 3. LOW:
  nothing checked that a hash still matched. Both fixed 334546d: the
  exemption covers the literal list alone, a key that is not a sha256 stops
  the gate, and a probe of the names kept in the gitignored docs/private/
  must still match each hash; it now exists on the maintainer's machine.
  4. LOW: the hashing made the gate slower and 7da9231 gave no figure from
  before. Measured here, three runs each: 8e90039's gate 259 to 284 ms,
  44903b4's 770 to 808 ms.
  5. LOW, the record: D-156 and row 6.1 said 8e90039's re-run passed "on all
  three"; GitHub re-ran the Windows job alone, its other two having passed
  on the first attempt. And row 6.1's D-155 clause ran its findings on from
  "7da9231 replaced", and gave ec54990's fix to afc119a. Both are reworded
  in the row here; D-156's line stands corrected by this one.
  6. LOW, the practice: 8e90039's Windows job failed at 07:40 and afc119a
  was pushed at 07:43, before the D-105 re-run at 08:13. D-105 does not
  forbid it, but a red main is stop-the-line. From here, a commit waits for
  any pending D-105 re-run.
  7. LOW: real-cli-present.ts took any non-empty CI for CI, where
  playwright.config.ts asks for "true", and dropped the error it replaced.
  Fixed 1ab6fab.
  Asked of the maintainer, not decided here: whether the leak gate's
  remaining literal markers, the private product, package and project
  names, move to hashes too. The reviewer's account: it keeps the gate's
  own file from naming them, but history keeps every literal already, the
  product name is in most commits' author address, and hashing loses the
  patterns' reach (joins, substrings, the tracker id's shape). The inbox
  holds it.
- 2026-10-21 D-158 REVIEW (the D-157 fixes and their record, c5c91ac..e8dab46,
  by a separate read-only reviewer told never to run anything that could
  reach the real CLI, nor to read docs/private/ or write a private name; each
  finding re-run here before it was fixed). Four findings, one MEDIUM and
  three LOW, all fixed in b62bbf0:
  1. MEDIUM: 44903b4 read a backslash and the letter after it as an escape,
  so a Windows path to a folder whose name began with n, r, t, b, f or v
  lost that letter and its name passed, undoing D-156's fix for pasted
  Windows paths. Checked here against the names hashed now: none begins so,
  so none could have leaked this way; a future one could. The matcher now
  reads each file twice, escapes as separators and a backslash as one with
  the next letter kept, and takes both readings' finds.
  2. LOW: a pattern's \s, \d and \w still glued to the next word, so a name
  written as the gate's own product pattern is, joined by [-\s]?, passed.
  They are separators in the first reading now.
  3. LOW: a hashed name of one word would trip the gate on every use of the
  word. The probe check refuses one.
  4. LOW: the matcher had no repeatable test; 44903b4's probe was staged and
  removed. It is its own module, scripts/lib/hashed-names.mjs, with twenty
  unit tests over made-up names; five failed on the matcher before.
  The gate runs in 969 to 988 ms here.
- 2026-10-21 D-159 DECIDED (MVP 6.3, MG-7, taken under the maintainer's
  standing instruction to proceed on recommendations; theirs to overturn):
  MG-7 resolves as (a). A signed-out CLI is signed in by a command the app
  shows and the person runs, never by the app: it starts the CLI with
  read-only tools alone, and whether the login flow runs without a terminal
  is unverified. The command is `npm run claude -- auth login`, from the
  project directory, when no CLI path is configured, which resolves the CLI
  as a review does; and the configured path's own, `node "<path>"` for a
  script and `& "<path>"` on Windows for PowerShell, when one is set, since
  npm run claude never reads a path kept on Settings and the variable the
  server was started with may not be set in the person's terminal (D-152).
  Settings' check shows it when the CLI is signed out, and the refusal to
  create a review for a signed-out CLI (MVP 6.2) names it. Nothing stores a
  token. Rejected: (b), the server spawning `auth login`.
- 2026-10-21 D-160 REVIEW (b62bbf0, the D-158 record and MVP 6.2 and 6.3,
  e8dab46..70c9f34, by a separate read-only reviewer told never to run
  anything that could reach the real CLI, nor to read docs/private/ or
  write a private name; each finding re-run here before it was fixed).
  Eleven findings, one MEDIUM and ten LOW, dispositioned before new work:
  1. MEDIUM: 470a4a9 checked the CLI at create alone, so a Resume, a
  draft's own Start and every review a restart left waiting started
  whatever the CLI's state. Fixed 883ef7d: src/server/cli-readiness.ts is
  asked by the create and start routes both.
  2. LOW: the check ran last, after the fetch. Fixed 883ef7d: first.
  3. LOW: a sign-in that bills per token is warned of in a run note after
  the review has started. Not changed: showing it before Start is a choice
  between a passive warning and an acknowledgement, and D-92 is "a warning,
  not a block"; the inbox asks the maintainer.
  4. LOW: the sign-in command named a configured path as typed, though a
  relative path or a bare name resolves from the server's directory and
  PATH. 5. LOW: its Windows form was PowerShell's, said as "a terminal", and
  double-quoted so a shell expanded it. 6. LOW: neither command said where
  the sign-in lives, the config directory. 7. LOW: the refusal did not say
  where to run it. 8. LOW: an answer with no command left an instruction
  over nothing. All fixed bdfd1b1: the command is built from the resolved
  path, single-quoted for its shell, with where to run it, in PowerShell
  on Windows; the check says where the sign-in it read is kept; Settings
  and the refusal say the same. D-159's `node "<path>"` and `& "<path>"`
  stand corrected by this line: the quotes are single, and the path is the
  one the CLI resolved to.
  9. LOW: the matcher read a % before two hex letters as a URL escape in
  both readings, and glued \u and \x escapes to the name after them. Fixed
  8162b19, with three tests over made-up names.
  10. LOW: the 6.2 browser test's mocked refusal had gone stale in 70c9f34.
  Its words are the route's current ones since bdfd1b1.
  11. LOW: confirmation.test.ts set and deleted the CLI path the shared
  helper owns. Fixed 069320a.
  Main was red from 883ef7d to 069320a: the shutdown tests, which only
  Linux and macOS run, start their review through the start route on
  servers whose fake had no sign-in status, so 883ef7d's check waited out
  the fake's hang, called the CLI unable to run and refused the start, in
  CI runs 39582703657, 39583851614, 39584192055 and 39584516206. bdfd1b1,
  8162b19 and 069320a were pushed without 883ef7d's run having been read.
  Fixed 2b0a128, which signs those servers' fake in; its run 39586380131
  passed on all three, the shutdown tests running on Linux and macOS. From
  here, a commit is pushed only once the one before it has passed CI.
- 2026-10-21 D-161 DECIDED by the maintainer: reviews draw on the claude.ai
  subscription sign-in the CLI shares with the editor's Claude Code, by
  default and always; that is the point of the app. Asked whether a sign-in
  that bills per token should be refused outright, the maintainer first
  chose that, then settled on: keep D-92's warning, not a block, but default
  to the subscription and notify strictly that a switch costs API usage. So
  ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are kept from every CLI the app
  starts, which would otherwise take over from the sign-in and bill per
  token without a word; a sign-in made with a key in the CLI itself is the
  only way left to per-token billing, and the new-review screen says before
  Start that such a review costs API usage, as Settings' check and the run
  note do.
- 2026-10-21 D-162 REVIEW (70c9f34..dd51866, the D-160 fixes and D-161,
  by a separate read-only reviewer told never to run anything that could
  reach the real CLI, nor to read docs/private/ or write a private name;
  each finding read again here before it was fixed). Ten findings, three
  MEDIUM and seven LOW, dispositioned before new work:
  1. MEDIUM: the notice before Start could be skipped: Start went ahead
  before the check answered, a check that failed showed nothing, a sign-in
  could change after the page opened, and a Resume or a draft's Start
  showed no notice at all. Fixed 34ebb52: each page sends what it showed
  with Create and Start, both routes answer 409 BillingNotShown until it
  has shown a sign-in that bills per token, or may, and the page shows the
  notice from that answer; the run note moved to the start. Its words were
  corrected by 16012f1 and its staleness by 7a8aba8 (D-163 items 2 and 6).
  2. MEDIUM: the paid providers' selectors and keys passed to the CLI,
  winning over the sign-in. Fixed 87d9d84: ten more names are kept back,
  each found in the 2.1.301 binary. D-120's "every other variable passes"
  stands narrowed by that commit and this line.
  3. MEDIUM: an oauth_token sign-in, which 2.1.301 reports both for a
  token `claude setup-token` made and for a Console profile, and a sign-in
  naming no method, were said to bill per token. Fixed 3f4c658: a state of
  their own, maybePerToken, said "may", as is a method the app does not
  know.
  4. LOW: probes and the real demo spent under such a sign-in with no word.
  Fixed 3746db3, Settings asking as it opens and saying it above Models,
  and a5ed582, the real demo stopping before it spends unless told it may.
  5. LOW: the notice showed for an Interactive review. e91b95c hid it,
  which D-163 found wrong: 07a5f86 words it for the commands such a review
  prints, which run this same CLI.
  6. LOW: the start route asked the CLI before the manager judged the
  review. Fixed 2cb5541 (D-163 item 4).
  7. LOW: the signed-out refusal ran its command into the next sentence.
  Fixed 1cdb34a: the command is in the body and on its own line.
  8. LOW: PowerShell ends a single-quoted string at U+2018 to U+201B too.
  Fixed 803cda2, each measured on PowerShell 5.1.26100; one module since
  78b1ebb.
  9. LOW: the browser test's no-notice check could pass before the check
  answered, and axe never ran with the notice showing. Fixed 499938c.
  10. LOW: stale records, fixed by the commit that writes this entry: the
  inbox's D-160 item 3 line, which D-161 decided, is retired; MVP row 6.2's
  "a run note, not a block" is corrected there; PROJECT-STATE's "never the
  API" is said as D-161 has it; the models doc's "each is an explicit
  action" was corrected in 3746db3. D-161 and 08d1291 called a key signed
  into the CLI the only way left to per-token billing, which stands
  corrected by this line: a token given the CLI in CLAUDE_CODE_OAUTH_TOKEN
  passes and wins over its sign-in, and ANTHROPIC_BASE_URL passes, what it
  does beside a claude.ai sign-in unmeasured. D-161 also described the
  notice before Start that dd51866 then built. The inbox line 34ebb52 added
  had landed under Retired, at the file's end; the same commit moves it to
  the open list.
  Found in the round besides: the gate failed once in the stand-in
  gitconfig's rename test, Windows refusing the rename for the whole two
  seconds while the test's reader held the file. Under full CPU load it
  failed 3 of 8 runs, alone 12 of 12 passed; trying every 5ms rather than
  backing off to 200ms, 12 of 12 passed under the same load (d5e0226).
- 2026-10-21 D-163 REVIEW (dd51866..803cda2, the D-162 fixes so far, by a
  separate read-only reviewer under D-162's rules, reading the commits
  rather than the working tree; each finding read again here before it was
  fixed). Eleven findings, three MEDIUM and eight LOW, dispositioned before
  new work:
  1. MEDIUM: e91b95c hid the notice for an Interactive review, whose
  printed commands run this same CLI, with the person's user settings, in
  their own terminal, where nothing is kept from the environment. Fixed
  07a5f86: the notice is worded for those commands.
  2. MEDIUM: the BillingNotShown refusal always blamed a changed or failed
  check, though a review's own screen asks nothing before Resume. Fixed
  16012f1: it says only what is so.
  3. MEDIUM: the notice offered the Claude sign-in for an apiKeyHelper and
  another provider, which the 2.1.301 binary takes before it. Fixed
  5daa0a6: the setting is named instead. Still open, in the idea inbox:
  the check reads the person's settings and a headless review or a probe
  reads none, so "will cost" for those two is unmeasured there.
  4. LOW: the start route asked the CLI and wrote its note whatever the
  manager answered, so a second press noted again, and a review that could
  not start was refused for billing. Fixed 2cb5541: the manager's judgement
  comes first, and only a run begun is noted. Still open, in the idea
  inbox: a review in line is not asked again as it leaves the queue.
  5. LOW: a refused Start after Create made a second review at the next
  press. Fixed f470510.
  6. LOW: a notice once shown stayed beside a later signed-out refusal.
  Fixed 7a8aba8.
  7. LOW: the run note's "may" branches were untested since 34ebb52.
  Fixed 1b0f961, with the billing rule.
  8. LOW: five passages stale. Fixed 91ea3af.
  9. LOW: three phrasings of an oauth_token's billing disagreed in
  strength. Fixed 1b0f961: each says "may".
  10. LOW: the PowerShell quoting was implemented twice. Fixed 78b1ebb.
  11. LOW: the probe route spends with no billing check. Not changed: a
  probe is pressed on Settings, which says it above Models as it opens
  since 3746db3; a check that failed there says so instead, and the
  inbox keeps the route.
  The reviewer also found CLAUDE_CODE_GATEWAY_TOKEN still passing,
  probably inert without its selector, which is kept back; unverified.
- 2026-10-21 D-164 REVIEW (803cda2..a5ed582, the D-163 fixes and the rest
  of D-162's, by a
  separate read-only reviewer under D-162's rules, reading the commits;
  each finding read again here before it was fixed). Ten findings, three
  MEDIUM and seven LOW, dispositioned before new work:
  1. MEDIUM: the real demo checked and probed the bundled CLI while its
  review ran on the one TRYSQUARE_CLAUDE_PATH names. Fixed 2750cbf: all
  three take configuredClaudePath. Driven with the variable set to the
  fake signed in with a key, the demo refused before any probe.
  2. MEDIUM: a draft f470510 reused ran on the branch tips pinned at its
  first press, only creating a review fetching and pinning. 3. MEDIUM: a
  draft started, cancelled or deleted elsewhere was pressed at for ever.
  Both fixed 1fa44e3, which reverses f470510's reuse (D-163 item 5): the
  next press removes the draft it left, if still a draft, and makes the
  review afresh.
  4. LOW: two presses that both put a review in line both noted it.
  Fixed 8ee196e: the route judges again after the CLI answers.
  5. LOW: a check pressed while Settings' own was in flight could be
  overwritten by the older answer. 6. LOW: Probe was pressable before that
  answer. Both fixed 8ad8a27: Settings starts as checking, its button and
  probes off until the first answer. The themes suite then measured
  Settings with its controls off, and axe flagged their faded text, the
  native disabled attribute present, though WCAG 1.4.3 exempts an inactive
  control: it measures Settings once settled. The probe route itself still
  asks nothing, in the idea inbox.
  7. LOW: 2cb5541's and 7a8aba8's claims untested, and judge untested.
  Fixed c865329; judge is 2cb5541's, so its test has no code before it to
  fail on.
  8. LOW: "will cost" said for an apiKeyHelper or another provider, which
  only a settings file gives and a headless review or a probe does not
  read. Fixed 1e6404f: "may" for those, with why; "will" for an
  interactive review's commands, which read the person's settings.
  9. LOW: an interactive review's own screen said nothing of its commands'
  cost before Start or Resume. Fixed 5067c6b.
  10. LOW: 78b1ebb's message gave "28 of 28 in the two files" without the
  command. It was `npx vitest run tests/lib/engine/sign-in-command.test.ts
  tests/server/engine/interactive.test.ts`, which printed "Tests 28 passed
  (28)": 6 and 22, by its verbose reporter, rerun for this entry.
  CI run 39624092957, 91ea3af's, stayed "in progress" for over half an
  hour after all three of its verify jobs had passed; the pushes after it
  were judged by the jobs' conclusions, each passing on all three.
- 2026-10-21 D-165 REVIEW (a5ed582..5067c6b, the D-164 fixes, by a
  separate read-only reviewer under D-162's rules, reading the commits;
  each finding read again here before it was fixed). Eleven findings, one
  HIGH and ten LOW, dispositioned before new work:
  1. HIGH: 1fa44e3 removed a review someone had just put in line. The
  new-review screen read the draft it left and removed it when its status
  said draft, which a queued review keeps (D-137), as does one launched a
  moment ago. Fixed e3b0d3c: DELETE with ?unstarted=1 removes only a draft
  the manager neither runs nor holds, judged by the server, and every
  delete is refused while the manager runs the review. 1fa44e3 to 5067c6b
  had not been pushed; they went out with e3b0d3c in one push, once
  2750cbf had passed, so 1fa44e3 never stood on main alone, and they have
  no CI run of their own, each having passed `./verify.sh --e2e` here.
  2. LOW: a failed removal was silent and the draft forgotten. Fixed
  e3b0d3c: said, and the draft kept for the next press.
  3. LOW: the billing refusal said "will" and the demo "would" for an
  apiKeyHelper or another provider, beside a notice saying "may". 8. LOW:
  Settings said reviews "may" while the notice said an interactive
  review's commands "will". 9. LOW: those commands read user settings
  only (`--setting-sources user`), and the check may have found the
  setting in a project's, so "will" was not established there either.
  All three fixed 6c5801b: every reader says may for those two, with what
  each reads. D-164 item 8's "will" for an interactive review's commands
  stands corrected by this line.
  4. LOW: the Settings test's probe checks could pass on an empty list.
  10. LOW: the demo's comment said it finds the CLI as the app does,
  though its own data directory holds no Settings path. Both fixed
  ce2b988.
  5. LOW: a browser test's absence check could pass before the answer was
  applied. 6. LOW: an interactive review's failed check was silent, and an
  older answer outlived it. Both fixed f971302.
  7. LOW: saving a CLI path on Settings checked nothing again. Fixed
  8044551.
  11. LOW: the models doc and the inbox cited D-164 before any entry
  existed. Fixed by the commit that writes this entry, with D-162 to
  D-165.
- 2026-10-21 D-166 REVIEW (5067c6b..ce2b988, the D-165 fixes, by a
  separate read-only reviewer under D-162's rules, reading the commits;
  each finding read again here before it was fixed). Ten findings, two
  MEDIUM and eight LOW, dispositioned before new work:
  1. MEDIUM: Settings' check after a saved path could overlap the one it
  asks as it opens, and an older answer landing last took the card and
  released the probes. Fixed 4695d42: only the latest check is shown, and
  only it ends the hold.
  2. MEDIUM: an interactive review's Start and Resume went ahead while its
  check was still asked, and an earlier answer stood when it came back to
  startable. Fixed c2d0855; the return to startable is not driven by a
  test.
  3. LOW: every delete checked and then awaited the removal of files
  before the row, so a start landing between ran on a review going from
  under it. 4. LOW: e3b0d3c gave the wrong window for refusing a run's
  delete; the real one is a run cancelled or failed whose row says so
  while its worktrees are still being removed. 5. LOW: that refusal was
  untested. 8. LOW: the project's and the data wipe's deletes checked the
  stored status alone. All fixed e568069: the job manager claims a review
  for its delete, refusing one it runs, and starts nothing claimed
  (ReviewBeingDeletedError); all three deletes hold their claims. The gate
  then failed once, a browser test's delete after a real run refused 409:
  it waited for the row alone, while the manager still held the run. That
  race is older than e568069, the review's delete having refused while the
  manager held a run since e3b0d3c; ba7b869 waits for the manager too, and
  939b3a9 does the same for the cancel test, which ba7b869 had missed.
  6. LOW: a may-cost test passed with nothing asserted when nothing was
  refused. 9. LOW: Settings' path hint and the demo's comment out of date.
  Both fixed daa0689, which was committed while its gate was red, the
  commit chained on a command that succeeded whatever the gate did; the
  red was ba7b869's test, and the gate with both passed.
  7. LOW: a dropped request's reason ran into the next sentence. Fixed
  d8febe9.
  10. LOW: the two-frame wait standing for "the answer was applied", and
  nothing driving a second check within one interactive review's page.
  Not changed: the two-frame wait is kept, and the second check is
  recorded here as untested.
  e568069 to ba7b869 went out in one push, once c2d0855 had passed, so
  e568069 never stood on main without ba7b869's test fix; they have no CI
  run of their own, each but daa0689 having passed `./verify.sh --e2e`
  here, and daa0689 with ba7b869.
- 2026-10-21 D-167 REVIEW (ce2b988..ba7b869, the D-166 fixes, by a
  separate read-only reviewer under D-162's rules, reading the commits;
  each finding read again here before it was fixed). Five findings, one
  MEDIUM and four LOW, dispositioned before new work:
  1. MEDIUM: 4695d42's test waited on a count already reached, so it could
  pass on code that let a stale answer take the card. 3. LOW: the cancel
  test ended on the row's status while the manager might still hold the
  run, and the next test deletes it; ba7b869 had called its own test the
  only one deleting after a real run. Both fixed 939b3a9; with 4695d42's
  guard taken out, the first now fails.
  2. LOW: a second delete of the same review could claim it again and
  release the first's claim. 5. LOW: the review's delete told a run still
  ending to be cancelled, and the error table's comment left out the new
  error. Both fixed cc03307, with tests of a project's delete refused while
  a review is claimed or ending: the claimed case failed on the code
  before, and the ending case tests e568069's refusal, which was there
  already, though cc03307's message said each failed. The data wipe's
  refusal was left untested for a reason that was wrong, D-168 item 1.
  4. LOW: ba7b869's and e568069's messages blamed e568069 for a race older
  than it. Corrected in D-166 above, which had not yet been committed.
- 2026-10-21 D-168 REVIEW (ba7b869..cc03307, the D-167 fixes, and these
  records before they were committed, by a separate read-only reviewer
  under D-162's rules). Six findings, one MEDIUM and five LOW:
  1. MEDIUM: the data wipe's refusal while a review is claimed or ending
  was untested, for the wrong reason: tests/server/api/danger-zone.test.ts
  runs wipes in a suite of its own. Fixed 7507b57; its claimed case failed
  on the code before.
  2. LOW: row 6.2 still called ba7b869's test the only one deleting after
  a real run. 3. LOW: cc03307's message said each of its cases failed on
  the code before, which its ending case could not have. 4. LOW: D-163's
  and D-164's ranges did not say what they held. 5. LOW: row 6.1 put
  499938c, a D-162 fix, under D-163. 6. LOW: two edited lines in
  PROJECT-STATE and the inbox ran past the column. All fixed in the commit
  that writes this entry.
- 2026-10-21 D-169 DECIDED by the maintainer, asked together:
  1. The real CLI's `auth status` may be run on this machine to measure
  whether a headless review, which passes `--setting-sources ""`, reads an
  apiKeyHelper or provider the check reports: `auth status` alone, which
  calls no model and spends nothing. Until measured, the "may cost"
  wording stands (D-165).
  2. 4.2, 7.3 and 7.4, which spend usage, wait: 7.1 and 7.2 come first,
  and the maintainer is asked again before anything spends.
  3. The leak gate's remaining literal markers, the private product,
  package and project names, move to hashes as the working-tree names did
  (D-157), so the gate's own file in a public repository stops naming
  them; the cost, exact names only and a list no reader can review, is
  accepted.
  4. Claude Code's /security-review runs once after 7.2, and /code-review
  runs read-only, never with --fix; neither /simplify nor the grill plugin.
- 2026-10-22 D-170 MEASURED (D-169 item 1) and BUILT: whether
  `--setting-sources` reaches `auth status`. Measured on the bundled
  2.1.301 binary with throwaway config directories, so neither the
  maintainer's sign-in nor settings were read, no model was called and
  nothing was spent: one whose settings name an apiKeyHelper printing a fake
  key, and one whose settings' env sets CLAUDE_CODE_USE_BEDROCK. Without the
  flag, `auth status` reported api_key_helper and third_party (bedrock);
  with `--setting-sources ""` before `auth`, both reported signed out. So the
  check, run with neither, named settings a headless review and a probe
  never read. Each check now asks as its reader reads: `""` for a headless
  review, a probe and the demo, `user` for an interactive review's commands
  (`/api/auth?reader=interactive`); the new-review screen asks both. With
  every status exact, the "may cost" said of an apiKeyHelper or a provider
  since D-164 item 8 and D-165 items 3, 8 and 9 is "will" again, and those
  entries stand corrected by this line.
- 2026-10-22 D-171 BUILT (D-169 item 3): the leak gate's private product,
  package and project names are hashes now, not literal patterns, so
  scripts/check-no-private.mjs no longer names them. Two are two words, as
  the matcher reads a name, and join the hashed list; three are single
  coined words, and the probe check's refusal of one-word names, kept since
  D-157 so an ordinary word is not hashed by accident, would refuse them.
  They sit in a list of their own, which the probe check requires to match
  as exactly one word, so the refusal still holds for every other hash.
  The tracker identifier, the deployed-function prefix and the personal
  email stay patterns: none is a name a hash can stand for. Proved on an
  untracked scratch file, since deleted, holding each name in the forms the
  old patterns caught, a domain among them: six of six found, and a line
  with the ordinary word "pos" not. The maintainer's gitignored probe file
  gained the five names, and every hash finds its own there.
- 2026-10-22 D-172 BUILT (MVP 7.1, T19, MG-8): the dead-export gate,
  scripts/check-dead-exports.mjs, run by `./verify.sh`. An export from src/
  or scripts/ that nothing there uses fails it; a use from the tests does
  not count, so an export only a test reaches is dead (D-54), except the
  seams the gate names with why, one so far: runtime's closeRuntime, which a
  test needs to close the database before deleting its data directory on
  Windows. Every identifier in production is resolved through imports and
  re-exports to what it names; a namespace handed on whole, as the schema is
  to drizzle, uses every export in it; a script with a declaration file is
  judged by that file; the exports Next.js reads by name are named as used.
  Mutation-proved, as U12 required before it counted: a new export nothing
  used, an export left with only its test once its production use was taken
  out, and a dead export in a script library each failed it, naming the
  export; restored, it is clean over 146 production files.
- 2026-10-22 D-173 REVIEW (767868f..fe36706: D-170, D-171, the three MVP
  7.1 items and 74a5c26, by a separate read-only reviewer under D-162's
  rules; each finding read again here before it was fixed). Eight
  findings, one HIGH, three MEDIUM and four LOW:
  1. HIGH: the project form's default-branch select was left to the
  browser, which took the newest branch once the list arrived, so a save
  meant as a rename moved the default. 2. MEDIUM: both of ec9f6cb's tests
  set the default to the one already stored, the fixture's detected
  default being its newest branch, so they could not fail, and its message
  claimed a move. Both fixed c1c06d0, pushed as soon as fe36706 passed:
  the form holds its fields, and the tests move the default to main and
  rename alone after the branches load.
  3. MEDIUM: the dead-export gate skipped re-exports, which hid client.ts's
  unused `export { schema }`. 5. LOW: it counted a destructured dynamic
  import as no use. 6. LOW: its list of the names Next.js reads by path was
  short. All fixed 5a19308, the dead re-export deleted, each proved against
  fe36706's gate on the same trees.
  4. MEDIUM: 74a5c26's wait for every animation hung on the top bar's
  pulse, which never ends, and rejected on an interrupted one. Fixed
  9a4fd19, shown hanging with the pulse injected and passing after.
  7. LOW: D-171 called its proof "each name in the forms the old patterns
  caught". The old patterns matched a name inside a longer token, a
  camelCase identifier or one with letters or digits glued on, and the
  hashed matcher splits only at what is not a letter or digit, so those
  forms are no longer caught: D-171's six forms were each separated by
  something else. That line stands corrected here; D-169 accepted the lost
  reach.
  8. LOW: the headless notice names a setting "in your Claude Code
  settings", which a headless review does not read; only a managed policy
  file might still reach it, unmeasured. Not changed: in the idea inbox,
  measuring it touching a machine-wide policy file.
- 2026-10-22 D-174 DECIDED by the maintainer: what is configured in the app
  wins over the machine's own Claude configuration, so a global setting, an
  environment variable or a policy file does not quietly change what a
  review runs with.
  1. The environment a CLI the app starts gets becomes an allowlist: what
  the CLI needs to run (system paths, home and app-data directories, temp,
  locale, proxy and certificate settings) and the app's own, plus
  CLAUDE_CONFIG_DIR and CLAUDE_CODE_OAUTH_TOKEN, so a sign-in kept in a
  custom config folder or made with `claude setup-token` still works.
  Everything else in the server's environment is dropped. Rejected: keeping
  D-120's denylist, which let every variable it did not name through, and
  dropping the two sign-in variables too.
  2. An interactive review's printed commands read no settings files,
  `--setting-sources ""`, as a headless review has since D-124, which found
  the person's settings changing a review's effort and putting their own
  CLAUDE.md into every request. Rejected: keeping user settings.
  3. A managed policy file outranks any flag by the CLI's design, so the
  app looks for one, read-only, where the CLI reads it, and warns on
  Settings and before Start when one exists. Rejected: ignoring them.
- 2026-10-22 D-175 BUILT (D-174 item 3), from the 2.1.306 binary read, not
  run: where the CLI reads a managed policy, and whether
  `--setting-sources ""` keeps one out. It does not: the binary's source
  filter adds the policy and flag tiers to whatever `--setting-sources`
  allows. The policy folder is fixed per platform, its override stubbed
  out: `C:\Program Files\ClaudeCode` (a literal, not %ProgramFiles%),
  `/Library/Application Support/ClaudeCode`, otherwise `/etc/claude-code`.
  In it, `managed-settings.json` and each file or link in
  `managed-settings.d` ending `.json` and not starting with a dot. On
  Windows it also runs `reg.exe query <key> /v Settings` for HKLM and HKCU
  `\SOFTWARE\Policies\ClaudeCode`, waiting 5 seconds.
  Built: findManagedPolicy looks in each of those places, read-only;
  /api/auth carries what it found and where it could not look; Settings,
  the new-review screen and a review's own screen while it can be started
  or resumed say a policy found, and Settings names a place not looked at.
  reg.exe's exit 1 reads as nothing there, though it also means any other
  refusal, because its words for which are translated.
  Not looked for: a macOS MDM profile, whose reader the Windows binary does
  not carry, and a policy an organisation's account delivers; nothing on
  this machine shows either.
  Settles D-173 item 8: a review reads no settings and gets no provider
  variables, so an apiKeyHelper or another provider a check names can only
  come from a managed policy, and the notice says so rather than sending
  the person to their own settings. Measuring it still means writing a
  machine-wide policy file, which waits for the maintainer (idea inbox).
  Rejected: overriding a policy with flags, which none outranks by the
  CLI's design; and reading a found policy to say what it sets, more of a
  file the person may not own than a warning needs.
- 2026-10-22 D-176 REVIEW (fe36706..d7159fc: D-173's fixes and D-174's
  three changes, by a separate read-only reviewer under D-162's rules; each
  finding read again here before it was fixed). Seven findings, one MEDIUM
  and six LOW:
  1. MEDIUM: an interactive review's commands run in the person's own
  terminal with its whole environment, which the check does not see, yet
  06 and D-175 said every reader alike and gets no provider variables; on
  a subscription nothing was said of that terminal, the sentence about it
  being inside the billing notice alone. D-175's "gets no provider
  variables" holds for a CLI the app starts, not for those commands.
  Fixed: each screen that prints them says so whatever the check found,
  and 06 says what the check cannot see.
  2. LOW: `npm run claude`, the sign-in the app tells people to run, got
  b3fb1ef's closed environment, without the terminal and display variables
  the 2.1.306 binary reads to decide whether to open a browser.
  3. LOW: the notice names a managed policy as the source of an
  apiKeyHelper or a provider from a reading of the binary, not a
  measurement, and the comment saying so was deleted.
  4. LOW: Settings drew an empty spaced wrapper where no policy was found.
  5. LOW: d7159fc's test read the notice's absence without waiting for the
  answer to be applied, and expected the real route to find exactly
  nothing, which fails on a machine with a policy or a slow reg.exe.
  6. LOW: a failed check on a headless review's own screen said nothing,
  so whether a policy applies went unsaid.
  7. LOW: the dead-export gate's comment for FRAMEWORK sat above
  SEGMENT_CONFIG.
- 2026-10-22 D-176 FIXED, each pushed once the commit before it passed CI
  on all three: item 1 4cc0a1d (1167 and 99, CI run 39761676947); item 2
  f14b262 (1171 and 99, CI run 39762817337); items 3 to 6 3169502 (1171
  and 99, CI run 39764540954); item 7 89901b5 (1171, CI run 39766201111).
  Item 3 kept its wording, with its basis said beside it: the binary's code
  leaves no other source. Item 4's absence check cannot fail on the code
  before it, whose block had no name to look for; the presence check
  beside it failed there, and item 6's message was shown missing on a
  build without it. Counts are unit then browser tests from
  `./verify.sh --e2e` on Windows, 89901b5's unit tests from `./verify.sh`.
- 2026-10-22 D-177 VERIFIED (MVP 7.2): 06 against the current CLI, the
  bundled 2.1.301, by reading its binary and its free commands; nothing
  probed. Holds: the effort levels low to max; `auth status`'s shape and
  signed-out exit (measured in D-169). D-175 and D-176 read the VS Code
  extension's 2.1.306; the same code is in 2.1.301: the policy folder and
  its stubbed override, the drop-in rule, the registry query, the policy
  tier added past `--setting-sources`, and the browser rule. Stale, fixed:
  06's "Not built yet" listed the profile control, which shipped with U8
  on 2026-08-04. New: 2.1.301's baked catalog names claude-fable-5-1,
  claude-opus-5-5, claude-sonnet-5-5 and claude-haiku-5-5 as each family's
  latest, and the shipped candidates carry none of them
  (src/server/engine/probe.ts). Whether this account can use them, and
  where an alias points on 2.1.301, each needs a probe, which spends, so it
  goes to the maintainer (idea inbox). The probe table and the probe's cost
  stay 2.1.71's, and 06 says so.
- 2026-10-22 D-178 BUILT: `agentRules: false` in next.config.ts. Found
  re-proving `npm run dev` for MVP 7.2: Next 16.3.8's dev server appended a
  block of its own rules to the repository's CLAUDE.md as it started
  ("Generated CLAUDE.md for AI agents" in its log), with an em dash the
  charter forbids and a line asking to be committed so the tree stays
  clean. The charter is loaded by every session and edited only for
  durable rules (CLAUDE.md section 4), so it was put back, not committed,
  and the option its own log names turns it off: run again, the server
  answered `/` with 200, its log said nothing of it, and CLAUDE.md was
  unchanged. Rejected: committing the block, and gitignoring the change,
  which cannot be done for a tracked file.
- 2026-10-22 D-179 DONE (MVP 7.2, the records pass), each commit pushed
  once the one before it passed CI on all three, unit tests from
  `./verify.sh` for the docs: 06 re-verified against the bundled CLI,
  D-177 (e665683; 1171, CI run 39769651393); the inbox's built and decided
  entries retired (a8148e6; 1171, CI run 39771814027); README and RUNBOOK
  name the OSes, the CLI floor and the sign-in check (ef25522; 1171, CI run
  39773436939); PROJECT-STATE brought up to the code, and CLAUDE.md's
  dated proof of its commands moved there after each was run again
  (e16c5d5; 1171, CI run 39774595523); `next dev` kept out of CLAUDE.md,
  D-178 (3826aab; 1171 and 99 from `./verify.sh --e2e`, CI run
  39776141378); the stale plan rows closed (d60a550; 1171, CI run
  39777897643). The audit findings were gathered by a separate read-only
  agent and each read again here before it was acted on.
  Left as they stand: GATES' G3 row cites the 2026-08-18 e2e run's counts,
  dated evidence, not a claim about now; the `review/` evidence GATES and
  PROJECT-STATE cite is git-ignored and not on this machine, which
  PROJECT-STATE now says. The four 2026-07-30 WP-E entries appear twice in
  this log, the second set a rewording of the first that adds nothing;
  both stand, the log being append-only, and both name
  `--setting-sources user`, which D-124 made `""`. Whether README's
  screenshots, last taken in c09b2ad, still match the screens is unknown
  and in the idea inbox.
- 2026-10-22 D-180 FIXED, from the security review D-169 set after 7.2.
  Claude Code's /security-review compares a branch with main, where every
  MVP change already was, so it saw only bfb548e's docs; the same
  instructions were run by one read-only agent over a45f73f..bfb548e's
  production code (112 files), and its one finding was read again here.
  MEDIUM: the stand-in system gitconfig (28dce93, 7f2f1ac) is at the shared
  temp folder and a hash of text anyone can work out, and a file there
  holding that text was taken whoever owned it. On a shared Linux /tmp
  another user could make it first, keep it, and later add a
  core.fsmonitor or a credential helper that git runs as this user. Fixed:
  only a plain file this user owns that no one else can write is taken; a
  link or a writable file is replaced; one another user holds sends this
  process to a stand-in of its own in a folder only it can open; and the
  stand-in is written 0644 whatever the umask. macOS and Windows give each
  user a temp folder, so Linux was the one exposed. The test runs on POSIX
  only and was shown failing on Linux and macOS before the fix, in draft
  pull request 1 (run 39783478068: a file anyone could write, taken as it
  was), Windows skipping it. Rejected: moving the stand-in into the data folder, which
  undoes the one path every copy and server shares (D-148, D-149).
  The agent judged sound the request guard, the git URL and branch-name
  handling, worktree hooks, path containment, the CLI spawn and its
  environment, the printed interactive commands, reg.exe, the settings and
  data-deletion routes, the UI's rendering and the CI workflow.
- 2026-10-22 D-181 REVIEW (Claude Code's /code-review at high effort, read
  only, over a45f73f..97125b1, 375 commits, D-169 item 4; each finding read
  again here before it was acted on). Nine findings:
  1. The quote check reads a cited file through insideRoot, which checks
  the path's text only, so a symlink the reviewed branch commits is read
  out of the worktree and its contents stored as quotedCode. The context
  route already contains by real path (D-142, D-143). To fix.
  2. A dependency's contract change that breaks a primary file the branch
  never touched cannot be reported: the S3 prompt asks for a finding at
  the consumer, and D-60's rule, every S3 finding in a hunk of the change
  set, refuses the whole answer, retried into the same refusal. DECIDED by
  the maintainer, amending D-60 for this case: an S3 finding may cite a
  file outside the change set when a symbol disposition names that file
  among the consumers it checked; it accounts for no hunk and faces the
  quote check like any other. Rejected: keeping D-60 and asking the model
  to cite the dependency's hunk, which points the report away from where
  the code must change; and waiting for 7.3 and 7.4.
  3. isFullModelId took `claude-opus[1m]` for a full id, the 1 of the
  context suffix counted as a version. To fix.
  4. D-180's stand-in is trusted once per process; a temp cleaner removing
  it later would let another user make it again under a running server.
  To fix: checked again before it is used.
  5. The data wipe refused with a bare 500, half done, when a review was
  made during it. To fix.
  6. A runtime() whose database or migrations failed kept the lock and,
  tried again, opened a second handle on the database. To fix.
  7. Creating a linked review fetches the two clones one after the other.
  8. The top bar's count of reviews awaiting confirmation loads every row
  to count them. 9. readCliStatus resolves the CLI twice. These three are
  efficiency; fixed as they are small.
- 2026-10-22 D-182 DECIDED and MEASURED (MVP 4.2; MG-5 resolved (a)). The
  maintainer approved spending on 4.2, then 7.3, D-169 item 2's ask; 7.4
  stays theirs to drive. Measured on the bundled 2.1.301, signed in through
  a claude.ai Team subscription, with claude-haiku-4-5-20251001, no tools
  and no settings, system prompts from files as stages pass them: a call
  told to answer ALPHA did, and a call resuming its session told to answer
  BETA also answered ALPHA; with `--system-prompt-snapshot off` on both,
  the resume answered BETA. Four calls, $0.0086 cost-equivalent as the CLI
  reported it. So every stage that resumed S1's session, S2 to S4, ran
  under S1's system prompt on 2.1.301, S3 without the ruleset its own
  prompt carries; every real run on record predates 2.1.301 (D-92), so none
  of them was affected. MG-5 taken as (a), the plan's recommendation for a
  replay found real, by the driver under the maintainer's instruction of
  2026-10-18 and open to their reversal: every stage passes
  `--system-prompt-snapshot off`. A stand-in for the API reproduces the
  replay with the real CLI, free on every platform, and is the test.
  Rejected: (b) no longer chaining S2 to S4, which gives up the cache the
  chain is for; (c) no change, the replay being real.
- 2026-10-22 D-181 FIXED, each commit pushed once the one before it passed
  CI on all three: item 3 6f87fe7 (1173 and 99, CI run 39789527534); item
  1 e70a24e (1174 and 99, CI run 39792259126); item 2 609aa82 (1179 and
  99, CI run 39794195360); item 4 f13f8fe (1180 and 99, CI run
  39797190525); item 5 3608168 (1181 and 99, CI run 39800079436); item 6
  a9d4a3a (1182 and 99, CI run 39808429491); item 8 3c5f85a (1183 and 99, CI run
  39810523350); item 9 c5a62fa (1184 and 99, CI run 39812417671); item 7 7b7a7dd (1186
  and 99, CI run 39814701934). Counts are unit then browser tests from
  `./verify.sh --e2e` on Windows. Item 2 as applied: only a finding
  verdict's consumers are exempt, since a file a verified verdict called
  sound cannot carry its finding, and the prompt says so, which changed
  S3's prompt. Item 4's POSIX test could not be run on this Windows
  machine; its Windows half was shown failing before the fix, and CI ran
  both. Items 7 to 9 were planned by read-only agents, each plan read
  again here before it was built; the maintainer raised the subagent cap
  to four on 2026-10-22.
- 2026-10-22 D-183 RUN (MVP 7.3, the G1 evidence on Windows): the 11-defect
  fixture reviewed by claude-fable-5[1m] through the bundled 2.1.301 on
  the maintainer's Windows 11 machine at b0deb2f, with D-182's fix, on the
  maintainer's subscription. 13 changed files, 11 candidates raised, 11
  verified, none refuted, none left open, none discarded by the quote
  check, no findings in the files that are deliberately fine; completed
  in 280.0s for $5.2976 cost-equivalent (20 in, 22,485 out, 76,160 cache
  write, 77,852 cached read tokens). The score reads 9/11: the two misses
  were each found and verified, cited where the change was made rather
  than where the key expects. silently-shortened-default was cited at
  shared-core/types.ts:7, where the default changed, naming the consumer
  that takes it implicitly; the key expects app/src/settings/prefs.ts:8.
  deleted-module-live-caller was cited at the deleted
  app/src/orders/retry.ts, naming dispatch.ts:1 and :4 as the live caller;
  the key expects app/src/orders/dispatch.ts:4. Whether a cause-site
  citation counts is the maintainer's to judge with the verdict. The
  2026-08-04 Linux fable runs on the 8-defect fixture cost $0.9616 and
  $0.9985; this run's higher cost is not explained by anything measured
  here. Evidence, git-ignored: review/2026-10-22-fg2/151004-claude-fable-5-1m/
  (events.jsonl, score.json, findings.json).
- 2026-10-22 D-184 DECIDED by the maintainer, asked together after reading
  what exists (`plans/PROOF-AND-STEPS-PLAN.md` section 2):
  1. Models: the 5.5 family is probed and added where usable, Opus 5.5 the
  recommended default; the others stay selectable with a plain line that
  accuracy may fall; Haiku is removed from the candidates and the demo
  defaults to Opus 5.5. The probes, a handful of tiny calls, may spend.
  2. Proof: a finding reaches the report only with evidence the app
  checks, a code path from trigger to failure quoted step by step, the rule
  and severity judged by the verifier, open questions kept out of the
  report unproven, and a second independent verifier on a different strong
  model, both agreeing. Rejected: the checked evidence alone, and a second
  verifier for CRITICAL only.
  3. Splitting: the profiles stay; the picker and pre-flight say what each
  model gets. Rejected: a few-rules-per-round mode, and splitting a
  full-context model's ruleset in two.
  4. Order: the G1 verdict is given on MVP 7.3's run first; the plan is
  built after, and the fixture run again on the new engine as fresh
  evidence. Rejected: building first, and planning only.
  Also said, from the code: a review stage cannot spawn subagents (Read,
  Grep and Glob only, checked after each call), and Haiku is already
  refused for a review. The smaller choices the plan raises are PG-1 to
  PG-4 there, each with a recommendation, not yet decided.
- 2026-10-22 D-185 DECIDED by the maintainer, the proof-and-steps plan's
  gates PG-1 to PG-3, each the plan's recommendation:
  1. PG-1 (a): the second verifier is the other strong family, a review on
  Opus 5.5 verified again by Fable 5.1, one on Fable by Opus 5.5, any other
  by Opus 5.5; Start is refused, saying why, when the paired model has not
  probed usable. Rejected: one verifier model chosen on Settings.
  2. PG-2 (a): an open question cannot be confirmed; it is dismissed, or
  verified again as a paid request said before it is sent, so only proven
  findings reach the report. Rejected: confirmable and listed as unproven.
  3. PG-3 (a): when both agree a finding is real but rate it differently,
  the verifier's severity stands with the finder's shown beside it; a
  verifier answering that the rule does not apply kills it. Rejected: the
  lower of the two, and treating a disagreement as unproven.
  PG-4, the steps view's mockup, is still to be shown.
- 2026-10-23 D-186 DECIDED by the maintainer ("mock plan and implement"):
  the proof-and-steps plan is built now, reversing D-184 item 4's order;
  G1 is then judged on the plan's fresh fixture run (WP-H) rather than on
  MVP 7.3's. The PG-4 mockup of the five steps, live in both themes and
  finished, is shown first, and WP-G waits on its approval. WP-H spends,
  so its go is asked before it runs.
- 2026-10-23 WP-A (proof-and-steps plan): the run view re-read the review
  only when its status changed, which a running review's does not between
  Risk and Verification, so the scan theater named Risk, stage 2 of 7,
  while S3 ran, its own log saying "Adversarial started" beneath. Shown
  with the fake CLI held in its third call; it now re-reads on each stage
  start, which the server announces only after writing it.
- 2026-10-23 D-187 DECIDED by the maintainer, each the recommendation:
  1. The picker says how each model's work is split ("the whole ruleset in
  one pass", "one pass per rule theme, N passes") with a request count by
  stage, and makes no token claim: the app cannot total tokens honestly,
  and a theme-by-theme model re-reads every file once per theme, so "more
  tokens for Fable" can be false. Rejected: a rough token line.
  2. "Accuracy may fall on this model" shows on every non-recommended
  model, probed or not. Rejected: only once probed.
  3. PG-4: the five-step mockup is approved as shown
  (https://claude.ai/artifact/Cmn1scDb2prp69XaPiS512), so WP-G may be built.
- 2026-10-23 WP-B also took out of the journey its passage on falling back
  from Extra high, which picked Haiku 4.5 as the one offered model that
  cannot run it; with Haiku retired no offered model reaches that path in
  the picker, and effortRunsOn keeps its own tests. The route test of a
  mechanical-only refusal registers its own such model.
- 2026-10-23 D-188 DECIDED by the maintainer, each the recommendation, for
  the proof-and-steps plan's WP-C to WP-E: when both verifiers prove a
  finding but rate it differently, the first verifier's severity stands,
  the second's and the finder's shown beside it; when the second verifier
  says the rule does not apply but the first proved it, the finding is an
  open question, not killed, so one verifier cannot override the other;
  a finding citing no rule is judged against the protocol's directives,
  and one they do not cover is killed. Rejected: the lower rating, and
  unproven on any severity disagreement; killing on either verifier's
  "does not apply"; leaving a finding with no rule unjudged. The paired
  models' windows needed no answer: both probed at 1M on 2026-10-23.
- 2026-10-23 D-189 BUILT (WP-C2): a verified verdict carries its proof,
  checked by the app. Choices made building it: the one top-level quotation
  is replaced by the evidence path's last step, the failure itself, so D-99's
  overlap rule moves onto it unchanged and there are not two quotations to
  disagree; guardsSearched needs at least one entry, an empty list meaning
  the hunt for a guard did not happen, which the schema refuses and the
  engine's one repair round can mend; an empty quotation is let through the
  schema to the quote check, which kills that one finding, since refused by
  the schema it failed every other finding's answer with it (as the
  quality gate's line-past-the-end finding showed). The verifier's
  severity is written to the finding and the finder's kept in
  raised_severity, the proof in proof_json (migration 0012).
- 2026-10-23 WP-D1 (proof-and-steps plan, PG-2 (a), D-185): an open
  question cannot be confirmed. The state machine no longer allows it,
  confirming one answers 409 OpenQuestionNotConfirmableError, "verification
  could not prove it, so it cannot go into the report. Dismiss it, or verify
  it again.", and the card offers only Dismiss, with no Confirm by button or
  Shift+C, and says under the verifier's note why. The state-machine and
  repository tests that allowed it were changed to the decision, not bent to
  pass: each says what it now holds and why.
- 2026-10-23 Review round R1 (over WP-A to WP-D1): retiring Haiku deleted
  its models row, and a model with no row resolves to full-context, so
  D-184's "Haiku is already refused for a review" stopped being true: a
  start naming it through the API created a full-context review. The
  start and the pre-flight now refuse a retired id in their bodies, by the
  list that retires it (moved to `lib/models/model-id.ts`), and the
  pre-flight, which held no model rule of its own, refuses an alias as the
  start does. Rejected: treating a retired id as mechanical-only, whose
  message says it is registered when it is not.
- 2026-10-23 Review round R2: WP-C2 checked a proof the verifier was never
  told the rules of. The S5 prompt still asked for one quotation, and the
  output contract it sees is the schema's JSON form, which names the
  fields but carries none of their comments, so a proof listed from the
  failure back to the trigger would have been killed as a quotation of
  other code. The prompt now says what each field holds, that the steps
  run from the trigger to the failure, the last in the cited file over the
  cited lines, and what is discarded, as 03 already said it did.
- 2026-10-23 Review round R3: WP-D1's refusal told the person to "Dismiss
  it, or verify it again", and its comments, 03 and 02 said the same or
  still allowed confirming, while verifying again (WP-D2) is not built.
  Each now says only what can be done, dismiss it; WP-D2 adds the other
  way back when it lands.
- 2026-10-23 Review round R5 to R10, the rest of the round over WP-A to
  WP-D1 (R1 to R3 above). R5: the stage-to-stage theater test restored
  the scripted answers' count only when it passed, so one failure became
  nine (measured, failure-paths alone: 9 failed against 1); it restores
  in a finally (64d021d). R6: the unproven-finding test borrows the
  usage-limit test's review, a review of its own shifting every later
  test's answers; it now picks one with nothing decided and says so when
  there is none (64d021d). R7, R8: "Finder said" had no browser test; a
  move that took Confirm away dropped the focus to the page, and a proof's
  quoted steps could not be scrolled from the keyboard (e842508). R9: the
  proof's schema refusals are tested by field, and a proof ending in
  another file has a test (0a3a3ae). R10: 02, 06, PROJECT-STATE and the
  plan brought up to the code; WP-A's `finished` and `failed` stage events
  were not sent, which its row now says, with why. R4, how a dismissed open
  question is recorded and reported, is put to the maintainer.
- 2026-10-23 D-190 DECIDED by the maintainer (review round R4, the
  recommendation): a dismissed open question is recorded apart. Its
  dismiss box asks "Why leave it out?", the finding keeps the status it
  was dismissed from (`dismissed_from`, migration 0013), and the report
  lists it under "Left out unproven" with the reason, apart from the
  dismissed, which are findings a person rejected and so evidence about
  the engine. For the same reason the scoreboard's precision counts it
  neither way. The report's "Open questions" section goes: a review
  completes only once every finding is decided, so it was always empty.
  Rows dismissed before the column read as dismissed. Rejected: the
  wording alone, which still counted an unproven finding as a false
  positive; and leaving it, with verifying again (WP-D2) the only way out.
- 2026-10-23 WP-D2 step 2 (proof-and-steps plan, PG-2 (a), D-185): an
  open question can be verified again through
  `POST /api/findings/:id/verify-again`. It asks S5 about that one finding
  in a fresh session, with a `fresh` request the checkpointing runner never
  answers from a stored reply, so a second press is a new look and is
  charged, and holds the answer to S5's checks (`verification.ts`):
  proven it can be confirmed, refuted it is killed, unsettled it stays
  open with the newer note. Refused before the CLI is asked anything for a
  finding that is not an open question, a review not awaiting decisions,
  an interactive review (its answers come from the person's own session),
  a checkout that is gone (every step would read as missing), or a second
  one of the same review in flight; refused until the page said what it
  costs (`costShown`) and, as a Start is, how it bills. Synchronous, one
  request under the stage timeout that a closed tab aborts. Rejected:
  running it as a manager job, which would need the queue and a stream
  for one question a person is waiting on. The page's button and dialog
  are step 3.
- 2026-10-23 WP-D2 step 3: an open question's card offers Verify again,
  which opens a dialog in the card saying what the request costs (one new
  request to the review's model in a fresh session, the Claude usage it
  draws and whether it bills per token, as /api/auth says, and the stage
  timeout from Settings) and sends nothing until Send request is pressed.
  Its other button is "Not now", not "Cancel", which names the review's
  own cancel. What the request found is said above the queue, since a
  refuted finding leaves it.
- 2026-10-23 Review round 2 (over D-190 and WP-D2), its verify-again
  findings on the server. F2: a verify-again ran outside the job manager,
  beside a running review, though the reviews-at-once setting exists
  because they share one usage limit; the manager now runs it, counts it
  against that setting (a review started meanwhile waits in line, and one
  is refused while a review runs), and its drain stops it on shutdown (F3).
  F1: deciding the finding being verified, or completing its review, which
  removes the checkout the verifier reads, is refused meanwhile, and so is
  deleting the review; other findings can be decided. F7: a request
  abandoned before the CLI started asks nothing. F4: a usage limit answers
  429, a timeout or cancel 503, an answer that cannot be used 502, each
  noted on the run, not 500. F5: an answer with no verdict for the finding
  is noted as such. F15: each repository's checkout is checked, not only
  the folder that holds them. Supersedes WP-D2 step 2's "rejected: running
  it as a manager job": the manager runs it, still answered synchronously.
- 2026-10-23 Review round 2, F6: a verify-again's call was recorded as an
  ordinary S5 attempt, and the Stages panel takes a stage's last attempt as
  its status, cost and time, so a one-finding call that failed painted a
  finished run's Verification red, and one that succeeded stood in for the
  run's; its seconds also pulled down S5's usual duration. A row now names
  the finding a request was about (`finding_id`, migration 0014); the
  snapshot's stages and the duration medians leave such rows out, and
  their cost stays on the review. Said in the run notes instead.
- 2026-10-23 Review round 2, the card. While a verify-again is out its
  finding cannot be dismissed nor the review completed (F1), and the dialog
  says how long it can take and that leaving the page stops it, which it
  now does (F10). A billing refusal updates what the dialog says, so the
  next Send carries it, and names "This request" (F7). The dialog takes the
  focus; Not now gives it back to Verify again and an answer to the
  finding's title (F8). The notice is one live region, mounted empty, and
  clears on a move or a decision (F9); a decision clears a stale move's
  focus (F12). A dismissed open question is badged "left out" (F13).
- 2026-10-23 Review round 2, F11: the precision tile said "nothing decided
  yet" when every decision was a finding left out unproven, which D-190
  counts neither way, and "confirmed of decided, unproven aside" was
  terse. It says "no proven finding decided yet" and "confirmed of the
  proven findings decided". F14: PROJECT-STATE counts 36 route handlers
  and names WP-E next; the plan's WP-D row is DONE with its commits.
- 2026-10-23 WP-E1 (proof-and-steps plan, PG-1 (a), D-185): the second
  verifier's model is chosen by `lib/models/pairing.ts`, Fable 5.1 for an
  Opus review and Opus 5.5 for any other, an unregistered model counting
  as any other. A headless review is refused at create as well as at
  Start, before the CLI is asked, as billing is, so a page refused leaves
  no draft; a Resume too, since a probe may have lapsed. Mode B is not
  checked yet: whether its second verifier runs in the person's session
  is WP-E2's to settle. The new-review screen reads it from the models
  it holds, not the pre-flight, so a probe counts at once, and offers a
  Probe button beside the reason, since the list folds unprobed models
  away once one is usable. Rejected: a pre-flight field for it, stale
  after a probe; checking again in prepareAndRun, which would make every
  run seed the model for no added safety (a lapsed model fails its stage,
  which can be resumed).
- 2026-10-23 WP-E2 step 2: the second verifier is a stage of its own,
  `s5b_second_verification`, after S5 and before the audit, in a fresh
  session on the paired model frozen on the review (`verifier_model`,
  migration 0015 with `findings.second_proof_json`). S5's proven findings
  are held unmarked; S5b is asked about exactly those, under S5's labels,
  not shown S5's proof; both proofs holding verifies a finding with S5's
  severity, and anything else from S5b leaves an open question naming it
  and why (D-188). With nothing proven, S5b is not asked, and a finished
  review shows the stage done. The second verifier is a required input of
  the pipeline, with no path that lets S5's proof stand alone; the
  pipeline tests of other stages run through a helper that has it agree
  by giving S5's answer again, its disagreements tested apart, and a
  service test holds a run to six calls, the sixth on the paired model.
  Rejected: an optional second verifier skipped when left out, which made
  passing the tests a way around it (the maintainer's "dont remove
  functionality to pass tests", 2026-10-23). A run is now
  six calls, so the counts its tests hold were raised by one, each for
  that reason. Mode B prints the second verifier's command on its own
  model.
- 2026-10-23 WP-E2 step 3: verifying an open question again asks both
  verifiers, as a run does: the first in a fresh session and, if it proves
  the finding, the second on the review's frozen verifier model, also
  fresh. Proven by both, it can be confirmed; anything else leaves it
  open, naming the verifier that did not agree. The dialog says so, up to
  two requests and each one's timeout; the waiting line no longer repeats
  the minutes. The card names both verifiers on a finding they proved,
  and shows the second's rating beside the first's where they differ
  (D-188).
- 2026-10-23 Review round 3 (over WP-E1 and WP-E2's three steps): the
  second verifier now reads a label as the first does ("c1" as C1), where
  an exact match left a proof both gave unread and the finding open (F1).
  A verify-again is refused before its first paid call while the second
  verifier cannot run, where the first's call was spent and the second's
  then failed (F2). Mode B is held to D-185 at create and Start as a
  headless review is, and its screen lists the second verifier: its
  command names the paired model, which WP-E1 left unchecked (F3). Start
  judges the review's frozen second verifier, which a resume runs (F4). A
  verify-again on a review from before migration 0015 freezes the
  verifier it asked, so the card names both (F5). 02, 06 and a gauge
  comment brought up to the code (F6).
- 2026-10-23 WP-F step 2 (proof-and-steps plan): the pre-flight counts
  every request a run makes, where it counted S3's rule batches alone,
  four short of every run and blind to a batch split to fit the window.
  `countRequests` divides the work as the run does, each rule batch fitted
  to the window by `fitBatch` against its own system prompt, and a test
  holds it to the adversarial requests a run actually sends on each
  profile, with and without a window that splits. It answers the total,
  each stage's count, the passes, whether a batch was split (the count is
  then an estimate), and totals per profile; `withinWindow` is now whether
  the run splits. The sweep hits it sizes are qualified, as the run's
  are; unqualified, the prompt dropped them. The second verifier's one
  request is counted, made only when the first proves a finding. 06's
  profile table said verification is batched, or per finding, on the
  narrower profiles, and decomposed splits per hunk; the code sends one S5
  request, then one S5b, on every profile, and splits by file, so the
  table now says that. The screen's "Adversarial requests by profile"
  became "Requests by profile", its numbers now every stage's.
- 2026-10-23 WP-F step 3 (D-187): each model in the picker says how its
  work is divided, "The whole ruleset in one pass.", "One pass per rule
  theme, N passes." or "Each file against the rules that apply to it, N
  passes.", N from the pre-flight once there is one, and no token claim.
  Every model not recommended says "Accuracy may fall on this model." and
  names the recommended default. The pre-flight lists requests by stage,
  says the second verifier is asked only when verification proves a
  finding and any request may need one more, and, when the window splits
  the work, how many passes became how many requests, as an estimate.
- 2026-10-23 Review round 4 (over WP-F): the pre-flight sizes the intent,
  which every adversarial prompt carries, taken when its field is left so
  the pre-flight is not asked again on every keystroke; it qualifies the
  dependency's changed symbols as the run does; it says when a file is too
  large for the window on its own, which it reported as fitting
  (`requestsOversized`, and `withinWindow` false); the per-profile totals
  say they are at the chosen model's window; and "is recommended" names
  only a model that can be picked now. RUNBOOK says why a split count is an
  estimate: the run orders files by the risk its first stage finds, which
  the pre-flight cannot know. The decomposed profile sends one file per
  request, so no window splits it; its case holds the count to the run.
  04's pre-flight line brought up to the screen.
- 2026-10-23 Review round 5 (over WP-G, a103e07 and 1a91c99), two
  read-only reviewers, each finding read again in the code before it was
  acted on. The live tally said none proven by the first verifier for the
  whole of the second verifier's stage: S5's proven findings are held for
  S5b (WP-E) and stayed candidates without a proof. The first proof is now
  written onto the held candidate, which stays a candidate until both
  prove it (`holdFirstProof`), and the card says how many are with the
  second verifier. The five live tallies were not a partition (a
  disagreement counted proven and open): they now divide what was raised,
  each finding once. A dismissed open question carrying the first proof
  showed "How it was proven" on its card; it no longer does. A retried
  call was timed once per row it wrote, its rows sharing one start: a
  call is timed once. Proven once also counts by status, for rows from
  before proofs were kept (0012); a dismissal from before its origin was
  kept (0013) cannot say, and is not counted. Whether a review had a
  second verifier is read from its own S5b rows, since verifying one
  finding again names a verifier model on an older review. The proving
  step is shown done while the audit runs when S5 proved nothing and S5b
  was never asked. Step counts say one rule, one file, one candidate. The
  findings-so-far list is a named group. The tests now assert every count
  (they asserted labels), held once in each verifier, and the step list
  is checked against `REVIEW_STAGES`. Left as it stands: a review finished
  before this round whose verifiers disagreed kept no first proof on that
  open question, so its summary counts it not proven once; no real-model
  review has run since WP-E, so only fixture runs are affected.
- 2026-10-23 D-191 DECIDED (the maintainer): a review also checks the
  design of what the branch builds, inside the proof-and-steps plan as
  WP-I, its real-model proof WP-J; "I want it part of this as this is my
  project". The branch's code runs in a throwaway copy of it, apart from
  the review worktree, which stays read-only, and only for a project that
  has turned it on; a failing test, or a screenshot graded C or D, is a
  finding, proven by both verifiers and confirmed by the person like any
  other; WP-H runs first. The plan's non-goal "executing code or tests"
  becomes "an AI stage executing anything": the read-only law for models
  stands, and the commands are run by app code. Rejected: a Docker
  container (needs Docker, slows every run, and this is a private tool);
  a report section of grades outside verification (a grade nobody proved
  is the unproven finding this plan exists to stop). Open: PG-5, how the
  screens are found, recommended the project's own e2e.
- 2026-10-23 D-192 DECIDED (the maintainer, PG-5): WP-I takes its screens
  from the project's own e2e command and grades the screenshots it saves;
  "only screenshots if it has e2e tests". Trysquare does not start a
  project's app or shoot URLs itself, and a project with no e2e command
  is reported as having its design not checked. Rejected: Trysquare
  driving the app from a list of URLs, which cannot reach a state behind a
  click or a sign-in, and doing both.
- 2026-10-23 D-193 WP-H's run, read (the proof-and-steps plan's fresh
  evidence; the G1 verdict stays the maintainer's). The fixture reviewed
  through the CLI, signed in through a subscription, on claude-opus-5-5
  with claude-fable-5-1 the second verifier, both probed at a 1,000,000
  token window: 11 candidates raised, one for each of the 11 planted
  defects, 8 proven by both verifiers, 3 open questions, none refuted, none
  discarded by the quotation check, none in the two clean files;
  $3.1545 cost-equivalent, 122 fresh input, 34,911 output, 99,816 cache
  write and 143,960 cached read tokens, 344.4s. The key scores 7/11. Of its
  four misses, two are raised where the change was made, not where the key
  looks: the shortened default at shared-core/types.ts:7, proven by both,
  its proof running from app/src/settings/prefs.ts:1 and :7-8 to the
  constant, and the deleted module at app/src/orders/retry.ts, its first
  proof running from app/src/orders/dispatch.ts:1 and :4 to the deleted
  file; MVP 7.3 showed the same of its two misses. The deleted module and
  the other two misses, the removed await and the timezone boundary, are
  the three open questions: in each
  the first verifier's proof held and the second's was refused, because
  its last step was not at the cited lines (save.ts line 5 for line 4,
  period.ts line 3 for line 2, and dispatch.ts for retry.ts). The S5
  prompt states that rule ("The last step is the failure itself, in the
  file the candidate cites"); Opus 5.5 kept it in all 11, Fable 5.1 broke
  it in 3, ending each proof at the consequence rather than the cited
  code. So the three real defects are not proven by both and cannot be
  confirmed without verifying again. The eight proven by both were read
  proof by proof: each first proof traces a path that ends at the cited
  lines; two second proofs, guard.ts and total.ts, quote only the cited
  function, a proof of where rather than of a path. A refused second
  proof is not kept, only its note. Questions for the maintainer: whether
  the proof rule should require the cited lines on the path rather than
  at its end, and whether the key should accept the change site for the
  two defects whose harm is in another file.
- 2026-10-23 D-194 DECIDED (the maintainer, from D-193): a verified
  finding's proof must pass through the cited lines, one of its steps in
  the cited file overlapping them, and may end wherever the failure shows;
  it no longer has to end there. D-99's guard stands, since a proof that
  never reaches the cited code still proves nothing about the finding,
  and the finding takes its lines from the step at the cited code. WP-H's
  second verifier ended three proofs at the harm (save.ts line 5 for the
  removed await at line 4, period.ts line 3, the dispatch.ts caller of a
  deleted module), and the old rule left those three real defects open.
  The S5 prompt, the check, the schema's comment and 03 say the new rule.
  Rejected: keeping the rule, and only rewording the prompt, which already
  said it plainly and was broken three times in eleven.
- 2026-10-23 D-195 DECIDED (the maintainer, from D-193): the fixture's key
  accepts the place a change was made, as well as where its harm shows,
  for the two defects whose change is in another file: the shortened
  default at shared-core/types.ts:7 beside the consumer prefs.ts:8, and the
  deleted module anywhere in app/src/orders/retry.ts beside its caller
  dispatch.ts:4. Both real-model runs (MVP 7.3, WP-H) cited them at the
  change with a proof running to the harm, and the key counted them
  missed. The matching is scripts/lib/demo-score.ts, tested. Scored again
  under it, WP-H's verified findings are 8/11, the three still missed being
  the three open questions D-194 addresses. Rejected: keeping the key.
- 2026-10-23 Review round 6 (over d9ec2fc, f657fd1, 3024725, 62e8b7d and
  fdfa1b4), two read-only reviewers, each finding read again in the code
  and shown failing before it was fixed. A verified finding took its lines
  from the first step at the cited lines, on a wide citation the trigger:
  it takes the last, nearest the failure, which keeps proofs that end at
  the cited lines where they were. The refusal note names each line once,
  "do not" for several. A test covers the second verifier proving through
  the cited lines and ending past them, D-193's case; it failed on the code
  before D-194. Three older bare grids took the width of their longest
  word: Show code's panes ran 21px past the card at desktop and 199px past
  a phone; the read-only findings list, the stage list and the refuted
  list, with a long quotation, error and note put in, 642px past a phone.
  Each is bounded, the paths may break, and the body wraps a word longer
  than its box (break-word, which moves no layout). The journey measures
  the code panes against the card at both widths; the cancelled review is
  measured at a phone with long text put into its snapshot. The key's
  change site is resolved in both lists of defects and tested against its
  marker. Left: the overflow helper can miss naming an absolutely placed
  element or name a fixed one; it only names, the measure is the page's.
- 2026-10-24 D-196 WP-I step 2, where and how a project's own commands
  run. The throwaway copy is a clone of the project's bare clone checked
  out at fromCommit, not a second worktree: a worktree registers itself in
  the clone, and the commands install, build and write. Hooks are off for
  the checkout, as in addWorktree. The commands run through the platform's
  shell, as typed, since "npm ci && npm test" is shell; with the person's
  environment less TRYSQUARE_*, FAKE_CLAUDE_*, CLAUDE* and ANTHROPIC_*, so
  a project's e2e cannot read the app's data directory or spend on an API
  key; each under a 20-minute limit, the whole tree killed at it or on a
  cancel (taskkill /T on Windows, the process group elsewhere), which the
  tests prove with a grandchild that must not survive. They run in S0,
  before any model is asked, one after another, the review waiting: run
  beside S1 to S4 they would save time and add a second thing to cancel
  and fail. Only server/projectrun spawns them, and a test now holds the
  three spawners to their modules. Rejected: git archive, which leaves no
  .git for a project's tooling; a closed environment list like the
  engine's, which would strip what package managers need.
- 2026-10-24 D-197 DECIDED (the maintainer): a failing test and a screenshot
  graded C or D are kept in a table of their own, check_findings, with a
  finding's lifecycle (proven, open question, confirmed, dismissed), shown
  in the confirmation queue as a group of their own, "Tests and design",
  with the log or the screenshot where a code finding shows its code, and
  in a section of their own in the report. Code findings, their ledger and
  their coverage checks are untouched. Rejected: a kind column on findings,
  which would teach every part that assumes a file and a line (coverage,
  the code pane, verify-again, the report) about rows that have neither,
  where a mistake reaches code findings too.
- 2026-10-24 Review round 7 (over 78fc2e5, fc83280, 3ceaaa9, 333a0e0 and
  fb03107), two read-only reviewers, each finding read again in the code
  and, where it could be, shown failing first. The project's commands: a
  cancel that came before one started was never heard, and it ran to its
  limit; they inherited the server's NODE_ENV=production, so a project's
  npm ci would skip the devDependencies its tests need and the app would
  call the failure proven, so NODE_ENV and Next's own variables are
  withheld; a command now ends when it exits, a background process
  holding its output given two seconds, never reported timed out after it
  exited, and on Windows never killed by a process id that may since name
  another process; a log that cannot be written no longer ends the
  server; a leftover copy is removed with retries; the copy no longer
  hardlinks the clone's objects or keeps a remote back to it; the spawn
  gate sees a dynamic import. The screens: the queue's keys no longer act
  from inside the project's checks, Complete review takes the focus when
  a check is decided last, a refused save is said in the card in its
  fields' names, the dismissal is a form with a label of its own and
  buttons named for their finding, a queue with only checks to decide
  says it has no code findings, and the review's activity log is a named
  list, which axe found once a waiting review was scanned. Tests: the
  tree-kill tests prove the grandchild existed before the kill; the e2e
  tests put the checks back whatever happens, decide every code finding
  to show Complete waits on the check alone, scan both new screens with
  axe, and photograph the off, refused, checks-only, dismissed and
  complete states; a resume through a real run keeps one check finding.
  Left: the report says nothing of check findings until step 3b-2, next;
  the lingering-child test reproduces only where a pipe outlives its
  command, Linux and macOS, which CI runs.
- 2026-10-24 D-198 Measured, with the maintainer's go, through the CLI on
  the subscription (2.1.301, the engine's own stage arguments and
  environment, effort low): can a stage with only Read, Grep and Glob read
  a screenshot saved beside the review's checkout, as WP-I step 4 needs?
  Outside the stage's working folder, no: Opus 5.5's Read of the PNG was
  denied, "you haven't granted it yet", and it said it could not see it
  ($0.0334 cost-equivalent). With `--add-dir` naming the screenshots'
  folder, yes: Opus 5.5 read it and gave its bold title exactly, "The
  tests fail on this branch." ($0.0123), and so did Fable 5.1 ($0.0815).
  So the grading stages pass `--add-dir` for that one folder, and only
  they do; the tools stay read-only. The denial also confirms that every
  other stage cannot read outside its checkout.
- 2026-10-24 D-199 WP-I step 4, the screens graded: two stages, S4b by
  the review's model under Find issues and S5c by the paired model under
  Prove each finding, as the code's verification has two. A C is a
  WARNING and a D a CRITICAL; the first grade stands when both fail it,
  as the first verifier's severity does (D-188). Eight screenshots a
  request, so one image-heavy answer stays small. The answer must grade
  every screenshot asked about once and nothing else, checked by the app,
  since a screen left out would read as one that passed. The design
  standard is read from the copy while it exists, only if it is a file
  inside it, and kept with the checks' result for a resume. The pre-flight
  counts the grading requests as none until step 5 counts them for a
  project whose e2e runs. Rejected: one stage grading and verifying at
  once, which is the self-attestation the second verifier exists to stop.
- 2026-10-24 Review round 8 (over 3d9be06, cafa2be, 88ef103, 15659ef and
  72e8f74), two read-only reviewers, one on the engine and one on the
  screens and tests, each finding read again in the code before it was
  fixed. The engine: a design finding kept its screenshot's absolute
  path, so a data directory spelled or placed differently since lost it,
  the route refused a name such as ..x.png by a prefix test, and the
  report read the row's path without the route's containment; the row
  now keeps the name the e2e gave it, resolved inside its own review's
  screenshots folder wherever it is read, a name leaving it refused
  segment by segment. A resume replayed grades given for another image
  under the same name: each image's sha256 is now in its grading prompt,
  which is the request's identity. A screen the grader could not open
  was to be graded D, so two graders failing to open it made a proven
  finding nobody had seen: each grade now says whether it was opened, and
  one that was not fails the stage, as does a C or D that says nothing of
  what is off. The screenshots copied are capped at 200 by name and 8 MiB
  each, a name with a line break or ": " (which a prompt line cannot
  carry) is left out, and each left out is said in a run note; the report
  carries screenshots whole up to 24 MiB, and names the rest. A design
  standard not a file in the branch, or cut at 50,000 characters, is said
  in a run note, and a result kept before the standard and the hashes
  were runs again. A dismissed open question from the checks was filed
  with the dismissed: it is reported left out unproven, apart (D-190).
  The screens: a screen the second grader passed is an open question as
  in the code queue, badged so, with no Confirm that did nothing, left
  out with a reason under "Why leave it out?" and reported as left out;
  Run detail said S4b, S5b and S5c passed, in green, on a review that
  never asked them, and now says each was not asked and why; the header
  said "stage N of 10" when a review may run fewer, now "of up to 10";
  the report's check cards took the critical bar whatever their severity;
  its intro said the app ran what found a graded screen; the section's
  copy said only a confirmed one reaches the report, though a dismissed
  one is listed there; the card's image had no fallback when its file is
  gone and no way to see a full-page shot whole, and the report's fell to
  a failing command's layout without its image; the alt text repeated the
  title. The five steps said "Walking the rules" while S4b graded and "0
  to prove" while S5c did, the finished funnel counted the code alone
  beside steps that counted screens, and what waits on the person left
  the checks out. The pre-flight's "one more request for each eight" read
  as none for fewer than eight. Records: request-plan.ts kept a design
  parameter nothing passed, and D-199 and 88ef103's message said step 5
  would count the grading requests before Start; it says them in words,
  since how many depends on the screenshots the e2e saves, and the plan
  counts them as none. Tests: the design e2e asserted toContainText
  ("confirmed"), which the copy satisfied whatever the badge; it numbered
  its answers from what setup wrote when it was written; it read the
  image's naturalWidth before the image had loaded; it posted confirms
  unchecked; the service test found the grader's prompt by call order;
  the refusal test passed without the stage's failed row. Each is fixed,
  and the e2e now drives an open question through to the report.
  Left: invalidating S4b asks every batch again, not only the one
  refused, which stays until a review has more than eight screens to
  measure it on; the colon and line-break names are tested on Linux and
  macOS alone, since Windows cannot name such a file. A D-105 occurrence:
  CI run 40083722008 at 15659ef failed on Windows alone, the themes
  test's dashboard navigation refused with net::ERR_NO_BUFFER_SPACE;
  re-run once, the Windows job passed.
- 2026-10-24 WP-I step 4 owed "design not checked": the plan row says a
  project with no e2e gets it in the report, never a grade, and the report
  said nothing of the design. What was examined now says, after how each
  command ended, either that the screenshots its e2e saved were graded A
  to D, or that the design was not checked and why: the project has no e2e
  command, its e2e did not run (a failed install, a cancel), or it saved
  no screenshot. Read from the result the review kept, as the commands'
  outcomes are.
- 2026-10-24 WP-I step 6a, the design fixture: a storefront of six
  static pages, built like the seeded repos by a script, whose own e2e
  photographs each at desktop and phone width. Planted: overflow (a table
  set 640px wide), low contrast (#c8c8c8 on white) and clipped text (a
  label in a box one line high), one each, beside clean screens; the
  checkout table overflows only on a phone, so one page is planted and
  clean at once. The key is held to what Chromium measures on each page,
  not written and trusted. Screenshots are of the viewport, not the full
  page, so what runs off a phone is cut off as a person sees it. The
  e2e takes a Playwright path as its argument: the fixture has no
  install, and one per review would need the network. Looking at the
  first shots found the checkout's Pay button flush against its table, a
  spacing flaw a grader could fairly mark C on a screen the key calls
  clean; tables now keep 16px below them. Rejected: committed PNGs
  copied by a fake e2e, which would grade pictures of nothing the
  fixture's code renders.
- 2026-10-24 WP-I step 6b, the design fixture reviewed end to end: one
  function builds it, adds it as a project with its checks on (its e2e
  handed this install's Playwright, its DESIGN.md the standard), reviews
  it through the job manager as the app does, and scores every
  screenshot against the key. The fake-engine test and `npm run
  demo:design` both call it, so WP-J's real run is the run the test
  proves. A planted screenshot is found only when both graders failed it,
  whatever a person decided after; one the second grader passed is
  missed, saying so. The evidence keeps every grade each grader gave,
  A and B included, from the stages' answers, beside the screenshots, so
  WP-J can read each grade against its image. The demos' sign-in check
  and model probes moved to `scripts/lib/demo-cli.ts`, unchanged, so both
  refuse alike; `demo:fixture --fake` still finds 11/11.
- 2026-10-24 D-200 WP-J, measured with the maintainer's go on CLI runs
  ("if it's through the cli and not the api, you can go crazy with the
  testing"), through the local CLI 2.1.301 signed in through the
  subscription: `npm run demo:design -- --model claude-opus-5-5` at
  1ad57f6 on Windows 11, Fable 5.1 the second grader. The fixture's e2e
  passed in 1.1s and saved 12 screenshots; S4b graded them in two
  requests and S5c the five it failed in one. Against the key: 5/5
  planted screenshots found (phone checkout overflow D, desktop and phone
  profile clipped D, desktop and phone receipt contrast C), each graded C
  or D by both; none of the 7 clean screenshots failed, 6 graded A and
  desktop orders B, its note that the rows offer no visible action, fair
  under the fixture's standard. $2.4593 cost-equivalent in 263.7s. Every
  grade was read against its screenshot here: the positions the graders
  gave (the profile button at y 165 to 209, cut at "deli...", the
  receipt's line at y 177, checkout's columns past Quantity off a phone)
  hold. The first grader put the receipt's contrast at roughly 1.8:1 and
  1.6:1; #c8c8c8 on white measures 1.67:1, so its figures are estimates,
  its grades right. The code stages raised 3 findings in the HTML and both
  verifiers proved them, which the demo did not keep: it now writes them
  to code-findings.json. One run, so no rate is claimed. Evidence in
  `review/2026-10-24-design/112623-claude-opus-5-5/` (gitignored).
- 2026-10-24 D-201 Measured, under the maintainer's go on CLI runs,
  through the local CLI 2.1.301 on the subscription with the engine's own
  stage arguments (Opus 5.5, effort low, Read, Grep and Glob, the folder
  named by `--add-dir`): does Read open a large screenshot? Each image had
  a word drawn at its top left for the model to give back. Random-noise
  PNGs of 3,282,327, 6,382,378 and 10,441,321 bytes (1100, 1500 and 1900
  pixels square) all opened, each word given right; a 1280x12000 page of
  80,019 bytes opened too, but the CLI showed it as 213x2000. $0.1451
  cost-equivalent in all. So the copy's 8 MiB cap is not a limit Read
  imposes, and stands for the report's sake; a screenshot past 2000
  pixels on a side is graded from a copy scaled to fit, which a run note
  now says with the size the graders see. One image per size, so where
  the size limit lies, if there is one under 10 MB, is not known.
- 2026-10-24 Review round 9 (over 734c12c, 8de241f, 57194da, 1ad57f6 and
  c23194e), two read-only reviewers, one on the design fixture and its
  demo and one on round 8's fixes, each finding read again in the code
  and, where it could be, shown failing first. 21 findings, none HIGH.
  The grading check: "opened" was the grader's word alone, against the
  rule that coverage is the app's to enforce; the engine now collects
  every file a stage's session opens with Read, its repair round
  included, and a grade of a screenshot never read is refused. The
  engine's event narrowing kept only the first tool call of a message, so
  a model opening eight screenshots at once would have shown one: each
  call is now its own event. The fake grader Reads what it is asked to
  grade, in one message, unless told not to. The names: the copy step
  took `c:home.png`, `..\x.png` and names with a space at either end,
  which the lookup refuses, and the review then sent "undefined" as a
  path; both now ask one rule, isScreenshotName, and the review drops any
  name the lookup would not take. The first 200 were by this machine's
  path order, so Windows graded a different 200; now by name. A
  screenshot folder committed as a link outside the branch was followed;
  it is refused, as the design standard is. Rows from before round 8,
  holding an absolute path inside their own folder, are read by the name
  it has there. Read's limits were measured (D-201), and a screenshot it
  scales is said. The report: screenshots left out were graded or "saved
  none" in its sentence, which now says some or all were left out; the
  image budget was spent with the dismissed before the left out, read
  each file whole before checking it, and counted raw bytes for base64;
  each fixed. The page: "N wait for you" left out code open questions;
  "Not asked" could show beside S4b while it ran on a resume; the
  verifying step's copy read as a requirement to grade C or D. The demo:
  a screen still waiting on the second grader was scored as one it
  passed, and a run that stopped was scored at all, both now said; a
  found screen carries what the grader said, since both failing a screen
  is not both naming its defect; a screen the key lacks is named; the
  database is closed and the data folder removed on any throw, the
  screenshots copied only when there are some; the fake's environment is
  set for the review alone; a tool path a shell would misread is refused;
  the RUNBOOK names the per-run folder. Tests: a resume after the e2e
  saved another image grades it live (failing when the image is the
  same), a grader that never Reads and one saying it could not open are
  refused through the pipeline, and the browser now drives the card whose
  image will not load, the report that does not carry an image, and the
  step that is grading the screens. Left: Mode B's terminal is not
  watched, so there the grader's word stands alone; the colon, backslash
  and edge-space names are tested on Linux and macOS alone, since Windows
  cannot name such files.
- 2026-10-24 D-202 Measured, under the maintainer's go on CLI runs: the
  code fixture again on Opus 5.5 with Fable 5.1 second, through the local
  CLI 2.1.301 on the subscription, at a14fd4a on Windows 11, the first run
  since D-194 and D-195 (`npm run demo:fixture -- --model
  claude-opus-5-5`). 11 candidates raised, all 11 proven by both
  verifiers, none refuted, no open question, no quote discarded, nothing
  raised in the files that are deliberately fine: 11/11 by the key.
  $2.7884 cost-equivalent in 346.0s. WP-H, before them, was 8 proven by
  both, 3 open questions where Fable 5.1 ended its proof off the cited
  lines, 7/11 by the key, $3.1545 in 344.4s. Every proof was read here: 6
  of the 22 end away from the cited lines but pass through them, from the
  change to where it does harm (the deleted retry.ts to dispatch.ts's
  import of it; total.ts to its test; the shared default to the consumer
  that reads it), the shape D-194 accepts; each path follows the defect.
  The unmigrated consumer was proven citing no rule. One run, so no rate
  is claimed. Evidence in `review/2026-10-24-fg2/122029-claude-opus-5-5/`
  (gitignored).
- 2026-10-24 D-203 An outside audit (finding 1, read again here) found the
  free command spending: in Windows PowerShell 5.1, npm is npm.ps1, which
  swallows a bare `--`, so `npm run demo:fixture -- --fake` reached the
  script with no arguments and ran a real review. Measured here with a
  script that prints its arguments: `npm run show -- --fake` gave none,
  and npm kept the flag as npm_config_fake; npm.cmd, a quoted '--' or a
  doubled `-- --` passed it. So the demos read their flags from the
  arguments and from npm's npm_config_ variables (a --model npm took for
  its own leaves the id as a bare argument), and a real run is one asked
  for, by `--real` or `--model`: told neither, or told both, or anything
  it cannot read, a demo says how to run it and stops, having spent
  nothing. Rejected: telling PowerShell users to quote the `--`, which the
  README's own command would still have broken; making the fake run the
  default, which would let a mistyped real request pass as a free one
  that measured nothing.
- 2026-10-24 D-204 An outside audit's finding 11, read again here and
  reproduced by a failing test before the fix: two sweep patterns of one
  rule matching the same added line seeded two sweep hits with the same
  path, line and rule. The stage's answer names a hit by those three alone
  and the recording found the first, so the second stayed pending, S3's
  reconciliation (keyed the same way) passed, and S6 refused the review
  after the whole run was spent: "1 of 2 sweep hits undispositioned", on
  every resume alike. The sweep now records one hit per rule and line,
  named by the first pattern that matched; two rules on one line are still
  two hits, each its own disposition. A review seeded with the duplicates
  before this is refused on resume by the sweep-count check, asked to start
  again, which it could not have finished anyway. Rejected: a pattern field
  in the answer, which asks the model to tell apart what it is not asked
  to judge.
- 2026-10-24 D-205 An outside audit's finding 12, read again here and
  reproduced by a failing test before the fix: a resume reused the ledger's
  seeded files and hunks, and compared only the sweep's hit count with a
  fresh read. S3 is asked about the change read now and held to the ledger
  read then, so a drift the model reported against was refused loudly as a
  hunk not in the change set, but a hunk the seeding never had and the
  answer never named was not reviewed, and the review completed covered:
  the test's resume over a parse with one more hunk completed. A resume now
  also compares the ledger's files and every hunk's index and lines with
  the fresh read, and is refused on any difference, as the sweep's count
  already was. Narrower than the audit put it: only a reading of the diff
  that changed between the first run and the resume, an app upgrade
  between them, could cause it; the diff is taken the same way each time
  (D-110).
- 2026-10-24 D-206 An outside audit's finding 14, read again here and
  reproduced by a failing test before the fix: a resume runs the pipeline
  again over replayed answers, and five run notes were written again each
  time: the risk-tagged files worked first, the rule and file pairs a
  narrowing profile left out, a batch split to fit, and the two notes on a
  prompt too large for the window. Each is now written on a review's first
  run only, as the literal-pattern and pointer notes already were; a
  resume plans the same division, since a review's model and profile are
  frozen. The quality gate's excluded-pairs test ran one review under two
  profiles and read the second run's note, a resume the app never makes;
  it now runs the narrowing profile first. Cosmetic: no coverage rested on
  the notes. Notes a resume should add, such as the checks' result being
  reused, still are.
- 2026-10-24 D-207 An outside audit's finding 13, read again here: in
  Mode B a design grade's "opened" is the grader's word alone, since the
  answer is a file a session the person runs writes, and nothing of that
  session is the app's to watch; docs/03 said so, and that a replayed
  answer was checked when it was given. The README line it cited, that the
  program checks the verifier's own work, is about code findings, whose
  quoted code is byte-compared, so it did not oversell the grades; but the
  README said nothing of the design check at all. It now has a paragraph
  on the project's own checks and the grading, saying what is watched in
  the default mode and that in Mode B the grader's word stands alone.
  No code change: Mode B has no session to watch.
- 2026-10-25 D-208 An outside audit's finding 2, read again here: an
  https address with a user and token (https://user:token@host/repo) was
  accepted, kept in the projects table, shown on the Projects list and the
  project page, and on any clone failure echoed whole into the error git's
  message became, which was stored as the clone error and served by the
  API; a refused address echoed it in its own error. Worse than the audit
  put it: the add form says the app stores no secrets, and 04 specifies
  machine credentials only, so the token address was never designed, only
  not refused. Now an http(s) address carrying any user information is
  refused at add, saying to let git sign in with its credential helper or
  an SSH key, and the refusal does not repeat it; git's error text, a
  refused address's error and every project the API serves have an
  address's credentials replaced, for a project added before. An SSH user
  (git@host, ssh://git@host) is a name, not a secret, and is taken. The
  browser test that drives the refusal also found the Projects list running
  off a phone on a long address, its grid column unbounded; bounded.
  Rejected: redacting only, which would keep storing a secret the form
  says is never stored.
- 2026-10-25 D-209 An outside audit's finding 4, read again here: WP-I
  runs a project's own install, tests and e2e as the person, through the
  shell (D-191, D-196), the largest change to the app's trust model, and
  neither SECURITY.md nor the RUNBOOK said so. SECURITY.md still called any
  execution of a reviewed repository's code in scope and serious, and its
  trust model said a review only reads; the RUNBOOK's first-review
  walkthrough never named the feature. SECURITY.md now carves the checks
  out of that item, keeping a way to run them without being turned on, or
  outside their copy, in scope, and says in its trust model what they run
  and as whom; the walkthrough has a step for them, saying the same and to
  turn them on only for a repository the person would run themselves.
