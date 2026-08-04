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
- 2026-08-03 DEFERRED (U3 to U12): the seeded fixture does not yet delete a
  whole file, so the quality gate exercises the deletion path only through the
  pipeline tests, which use a real deleting patch. Adding it needs a deletion
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
