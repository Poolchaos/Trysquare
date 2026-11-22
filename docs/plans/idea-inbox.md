# Idea inbox

New ideas that arrive mid-task land here as one dated line each. They are not
expanded, researched, or built until the active gate passes and they are
pulled deliberately.

- 2026-07-30: Send a finished report to someone by email. Note when pulling
  this: a report embeds quoted source code, so emailing it sends the reviewed
  code somewhere, which the README currently says does not happen, and SMTP
  means storing a credential, which SECURITY.md says the app never does.
  Consider the no-credential route first (export the report and hand it to the
  user's own mail client) with real SMTP as a clearly labelled opt-in.
- 2026-08-04: retag unmigrated-consumer from rule 4 (index signature, which
  the Prefs interface does not have) to a rule that names the class, possibly
  a new rule 15.
- 2026-08-04: a risk-tagged variant of the quality gate, so the risk-first
  ordering is exercised with non-empty tags somewhere outside the pipeline
  tests.
- 2026-10-17: the probe's candidate models (fable-5, opus-5, sonnet-5,
  haiku-4-5) trail the bundled CLI 2.1.301's own model table, which lists
  fable-5-1, opus-5-5, sonnet-5-5 and haiku-5-5 (found during 4.7, D-122).
  Read again in D-177 from the bundled binary. Whether to add them, and
  which become the recommended defaults, is the maintainer's call: each
  needs a probe to show this account can use it, and a probe spends. BUILT
  2026-10-23 (D-184): the 5.5 models and Fable 5.1 are in the probe's list,
  Opus 5.5 and Fable 5.1 recommended, Haiku retired.
- 2026-10-17: the CLI 2.1.301 swapped claude-opus-4-1-20250805 for
  claude-opus-5-5 without a word (D-123), so a review on a retired model id
  would record a model it did not run.
- 2026-10-18: a write inside a submodule's directory, which a review's
  checkout leaves empty, is not reported by git status, so the end-of-review
  worktree check cannot see it (D-130); list those directories at checkout and
  require them still empty.
- 2026-10-18: with Caps Lock on, the queue's j, k, d and e arrive as capitals
  and do nothing, and a g arrives as G and jumps to the bottom (found while
  fixing Shift+C under Caps Lock, review of 5.5 to 5.7); decide whether the
  letter keys should ignore case.
- 2026-10-18: the file context route refuses a bad query with code "Error",
  where every other route's refusal of its input says "Invalid", and a
  missing path reads "expected string, received null" rather than its own
  "path is required" (found by the D-139 sweep of the id routes).
- 2026-10-20: the shutdown control in e2e/shutdown.spec.ts found its CLI
  gone two seconds after its server's SIGKILL, once, on macOS (CI run
  39420099693, D-148). Not root-caused; since 4aa31fa a recurrence says how
  the CLI ended. Read that note when it comes, and fix the cause.
- 2026-10-21: the checkout's check of every tracked file (7b4a586) has a
  600 s ceiling on git hash-object, measured only up to 3,436 files in
  489 ms, a private working tree on the maintainer's Windows machine
  (D-153, D-154); measure it on a large repository and size the
  ceiling, or make it scale with the file count.
- 2026-10-21: a review put in line is asked about the CLI as it is queued,
  not again as it leaves the queue, whose launch is synchronous, so a
  sign-in changed while it waits runs unchecked (D-163 item 4).
- 2026-10-21: the probe route asks nothing of the CLI's billing; Settings
  says it above Models as it opens, unless that check failed (D-163
  item 11).
- 2026-10-22: whether a managed (policy) settings file survives
  `--setting-sources ""`. D-170 measured user settings only. If it does, a
  headless check could still name an apiKeyHelper or a provider, and the
  notice's "set in your Claude Code settings: remove it there" would send
  the person to a file they may not own (D-173 item 8). Measuring it means
  writing a machine-wide policy file, which governs the maintainer's own
  Claude Code too, so it waits for the maintainer.
  READ in D-175 from the 2.1.306 binary, and in D-177 from the bundled
  2.1.301: it survives, the policy tier being added to whatever
  `--setting-sources` allows, and the notice now names a managed policy.
  Still unmeasured, for the same reason.

- 2026-10-22 Unexplained, Windows only so far: the e2e web server died
  partway through 3 of 13 local runs during the D-174 item 2 work (two
  `./verify.sh --e2e` gates and the standalone run straight after one),
  the rest of the suite then failing on connection refused, nothing on
  stderr. Not reproduced since: 10 standalone runs passed, 4 of them with
  signal, exit and uncaught-error tracing in the server that recorded only
  its start. Not leftover unit-test processes (none lingered, and unit then
  e2e passed). Next occurrence: trace again before guessing at a cause.
  Again on Windows CI, 2026-10-23, run 39910556621 at 14594de: for 30
  seconds the server answered none of one test's API requests (the trace
  holds the page and its scripts, no API response), then answered the next
  test in 0.8 s; macOS and Linux passed. Re-run to see if it recurs.
  Again locally, 2026-10-25, in a `./verify.sh --e2e` gate started in
  the background (so not the shell's 600-second move, blamed for the same
  death earlier that day): the server stopped during "the scan theater
  counts the findings while the second verifier works", nothing on stderr
  and no crash in the Windows event log; the test alone, and the gate run
  again on the same tree, passed. Four gates since ran with a preloaded
  trace in the server (start, a 2-second heartbeat, signals, exit code and
  the caller of process.exit, uncaught errors) and none lost it.
  The local deaths EXPLAINED 2026-10-28: another project's e2e runner on
  this machine frees its own ports before it starts, 3100 among them, by
  ending the node process listening there with `taskkill /F /T`; the
  traced server's last heartbeat was 06:29:51Z and that runner's
  emulators started 06:30:10Z. The suite now serves on 3417. The CI
  stall of 2026-10-23 is a different symptom on a machine with no such
  runner, and stays open.
- 2026-10-22: the preflight route (src/app/api/reviews/preflight/route.ts)
  and the review service (src/server/review/service.ts) still fetch a
  linked pair's clones one after the other, as review creation did until
  D-181 item 7; and a failed fetch's error does not say which repository
  it was.
- 2026-10-25: a launch token, as Jupyter has: the server prints a one-time
  URL holding a secret when it starts, and every page and API call needs it,
  kept in a cookie after the first visit, so another account on a shared
  machine cannot call the API as the person (D-215). Every e2e test would
  have to open the app through it.
- 2026-11-03: rules in the app: add one rule, remove one rule, edit a rule's
  text, and delete a single ruleset. Today only on/off and severity change in
  the app, the rest by re-importing the document with replace, and a
  ruleset is deleted only by Settings' delete-everything (maintainer asked).
  `COMPLETION-PLAN.md` CG-5. Planned in `plans/RULES-IN-APP-PLAN.md`;
  deleting one ruleset BUILT 2026-11-21 (RA-1, D-266), and editing a
  rule's text (RA-2, D-267), adding a rule (RA-3, D-268) and removing one
  (RA-4, D-269) the same day.
- 2026-11-03: a memory guard for a project's own commands. Only a 20-minute
  limit bounds them now; one large project's e2e, measured at 20.7 GB on the
  maintainer's machine, could exhaust a colleague's laptop. Needs a free-memory reading
  measured on macOS before a floor is set on it (and on Windows, if it is
  looked after again: D-232). `COMPLETION-PLAN.md` CG-5.
- 2026-11-03: a project's ruleset from its own repository (maintainer's
  choice): a path such as docs/review-protocol.md, like the design standard,
  imported on each fetch, so a colleague who adds the project gets its
  rules. The file reaches that project's repository through its own PR.
  `COMPLETION-PLAN.md` CG-5.
- 2026-11-03: directive bodies on a ruleset page still show their markdown
  raw, where a rule's text is formatted (D-227).
- 2026-11-03: suspected, not measured: an open process directive on a
  ruleset page is a scroll box (max-h-64 overflow-auto) a keyboard cannot
  reach, the axe failure the rule text hit the same day; no test opens one.
  `COMPLETION-PLAN.md` CP-6. MEASURED and FIXED 2026-11-17: a browser test
  opened a thirty-step directive and found 282 px of it behind the box's
  own scroll and axe's `scrollable-region-focusable`; the box now shows the
  directive whole.
- 2026-11-17: a directive's label on a ruleset page shows its section key
  as stored ("prime_directive: The Prime Directive", "philosophy: ..."),
  seen in `review/2026-11-17-e2e/*-ruleset-directive-open.png`. CP-10.
  FIXED the same day: the label says the section in words
  (`src/lib/rulesets/sections.ts`).
- 2026-11-17: four of the entries above (rules in the app, the memory
  guard, a project's own ruleset, the process directive) stood under Retired
  until the audit of this day found them there, and the directive-bodies
  line was the tail of a built entry. The Windows-only entries in this
  list (the CI stall of 2026-10-23, the e2e server's death) are parked: no
  work goes into them while Windows is not looked after (D-232).
- 2026-11-18: counts are written "review(s)", "file(s)", "branch(es)" in
  about seventy places, on screens, in run notes and in the report (seen
  while grading WP-L's shots; the project page's branch lines now say the
  real plural). One helper, and each line read again.
- 2026-11-18: a refused CLI path on Settings is shown with its storage key
  ("claudePath: holds a control character"), as the emails were until
  WP-L's grade. `refusedAs` in `api/settings/route.ts` is the way to name
  it as its card does.
- 2026-11-18: a project's "fetched" time and the reviews list's time are
  the stored UTC time cut to the minute, shown with no zone: 06:04 at 08:04
  in the maintainer's (seen in WP-L's shots). Dates cut the same way can be
  a day off near midnight.
- 2026-11-18: on `windows-latest` alone, CI run 44251352949 failed "the
  confirmation queue has no accessibility violations" in the light theme,
  30 seconds waiting for an element that did not come; the run before it
  passed that test there on the same browser code. Parked with the other
  Windows entries (D-232).
- 2026-11-19: only the picker keeps a review to a model a fresh probe
  vouches for. `POST /api/reviews` takes any full model id, and Start does
  not ask either; the second verifier alone is refused on the server
  (D-244). Should the server refuse the review's own model too?
  DECIDED 2026-11-20 (D-254): no, a probe is a paid request.
- 2026-11-19: the report of a `decomposed` review says each hunk was
  accounted for and names the profile, and nothing of the rule and file
  pairs left out; the pre-flight and a run note carry their count (the
  thirteenth grader, for Complete). Should the report say it too?
  DECIDED 2026-11-20 (D-255): yes. BUILT the same day, beside the line
  that each hunk was accounted for.
- 2026-11-19: the report's count of files read outside the change is the
  model's own list (D-247). Count it from the Read calls the engine sees
  in a headless session instead, and say which it is for an interactive
  review? DECIDED 2026-11-20 (D-256): no, it stays the model's account.
- 2026-11-19: the report's token line gives fresh input, cached read and
  output, and leaves out cache-write tokens, which the review page shows
  (the fifteenth grader). Add them to the line? DECIDED 2026-11-20
  (D-257): yes. BUILT the same day.
- 2026-11-19: the dashboard's Needs you says "waiting 2m ago" and "waiting
  just now" (`src/app/page.tsx`, seen in `light-dashboard.png`); "waiting
  2m" would read right. A browser test holds the present words.
  DECIDED 2026-11-20 (D-258): "waiting 2m". BUILT the same day.
- 2026-11-20: only the Windows job failed in CI run 44684645272 at eedc356
  (Ubuntu and macOS passed): `tests/server/projectrun/run.test.ts`, "is
  stopped at its time limit, with everything it started", "expected true to
  be false". The change it ran on does not touch that test or what it
  tests. Recorded and left (D-246); cause not looked at.
- 2026-11-20: only the Windows job failed in CI run 44704221453 at 3085f87
  (Ubuntu and macOS passed), on a commit that changed records alone:
  `e2e/themes.spec.ts`, "Projects, the model picker and the CLI card say
  what the code does, on a phone too", dark theme, 60 seconds waiting for
  the project's link in `main`, "element(s) not found". Recorded and left
  (D-246); cause not looked at.
- 2026-11-20: only the Windows job failed in CI run 44797222893 at 3b3d3b2
  (Ubuntu and macOS passed): `e2e/failure-paths.spec.ts`, "a pre-flight
  that says it would refuse leaves the other reasons beside Start", a
  click that met the test's 120 seconds. The change it ran on does not
  touch that test. The runs before and after it, 44795459803 at d9c3baa
  and 44792451743 at b830c0e, passed on Windows. Recorded and left
  (D-246); cause not looked at.
- 2026-11-20: only the Windows job failed in CI run 44811014735 at 8b889a2
  (Ubuntu and macOS passed), on a commit that changed records alone:
  `e2e/failure-paths.spec.ts`, "a new review starts on the model used
  last, while a probe vouches for it", a click that met the test's 120
  seconds. Recorded and left (D-246); cause not looked at.
- 2026-11-20: the reviews list says "0 of 10 confirmed" of a review whose
  page says "0 of 9 decided": the list's ten counts a finding verification
  refuted, which nobody can confirm (`findingTallies`,
  `server/db/repositories/findings.ts`), and the dashboard's Recent the
  same. Seen grading `last-run-list-light.png`. Not fixed: should the
  lists count what the queue holds? DECIDED 2026-11-20 (D-253): yes.
  BUILT the same day: the reviews list, Recent and Projects count what a
  person can decide, the killed apart.
- 2026-11-20: at 390px the dashboard's Recent table breaks the status
  badge over three lines ("AWAITING / YOUR / DECISION"), in a table that
  scrolls sideways anyway. Seen grading `last-run-recent-phone.png`.
  DECIDED 2026-11-20 (D-258): one line. BUILT the same day; it measured
  56px tall before, by the test.
- 2026-11-20: a run of under a second reads "took 0s", and 0s in the
  Duration tile and the lists, where a step of the same length says "under
  a second" (`src/app/reviews/[id]/page.tsx`, `elapsedBetween`). Only the
  fake engine is that fast; a waiting review shows it since D-248.
  DECIDED 2026-11-20 (D-258): "under a second". BUILT the same day, in
  the one function that words a run's time (D-249).
- 2026-11-20: the dashboard's Needs you says "Nothing is waiting on you"
  while a review is paused at the usage limit, interrupted or failed, each
  of which goes on only when a person presses Resume. 04 has Needs you list
  reviews awaiting a decision, so the line is as designed; whether a review
  waiting on a Resume belongs there is the maintainer's. Seen grading
  `dashboard-paused-at-limit-light.png`, where the pause is said only by
  the status chips and the bar. DECIDED 2026-11-20 (D-259): it belongs
  there, to build. BUILT 2026-11-21: each such row says the stop and the
  button, "paused at the usage limit: Resume once it clears" for a pause,
  since a Resume pressed before the limit clears pauses again.
- 2026-11-20, a question for the maintainer: the dashboard's "Invention
  rate" counts every finding the quotation check killed, and that check
  also kills a proof that quotes true code off the lines the finding
  cites, which is not an invention (the seventeenth grade, AE14). Rename
  the tile, or count only a quotation that matched nothing? The name is
  D-68's, so it is left. DECIDED 2026-11-20 (D-252): renamed "Proofs
  discarded", the count unchanged. BUILT the same day.
- 2026-11-20: the audit stage asks no model, and two tables still carry an
  entry for it that is never read: its output shape
  (`lib/review/stage-schemas.ts`) and its instruction, "Summarise what was
  reviewed and what was found, for the report" (`lib/rulesets/compose.ts`).
  Typing both by `ModelStage` would drop them. DECIDED 2026-11-20
  (D-260): yes. BUILT the same day: `ModelStage` sits beside `ReviewStage`
  in `lib/domain/enums.ts`, and a stage request carries one.
- 2026-11-20: the top bar's links and the underlined text buttons are
  shorter than the 40px the other controls keep (04 section 4 says so now;
  the seventeenth grade, AE22). Whether they should be taller is open,
  and the session's to decide once their heights are measured (D-251).
- 2026-11-20: two shots of the Stages card sit low on it,
  `stages-two-requests-light.png` by 3 pixels and `-phone.png` by 10, the
  card's top border on row 3 and row 10 and its lower border cut, on two
  runs alike; `-dark.png` between them, and `stages-not-asked` in all
  three, have the border on row 0 (`shootAll`, `e2e/failure-paths.spec.ts`,
  which measures the card and then clips the whole page). The card moved
  between the measure and the shot, after a scroll to the top and after
  the phone's resize, on a review waiting on a person. NOT root-caused:
  whether the page shifts there or the helper measures too soon is not
  known.
- 2026-11-19: two shots show figures that do not agree, seen while grading
  and not yet traced to the page or to how the test stages its data.
  `verify-again-light.png`: "0 of 9 decided" beside 9 proven by both and 6
  open questions of 10 raised. `review-finished-clean-light.png`: "No
  candidates raised" beside "1 hunk(s) were accounted for only by findings
  that verification refuted". To root-cause before anything else is built
  on those screens.
  TRACED 2026-11-20: both were how the browser test staged its answer, not
  the page. The first showed verified findings as open questions and left
  each its second proof, which the server writes only as it verifies one
  (`markVerified`), and no finding goes from verified to open. The second
  emptied the findings and left the fixture's count of hunks resting on
  refuted ones, its verification requests under "Nothing to prove" and a
  completion time on a review still waiting. Each staging now gives what
  the server can, and each test asserts the figures agree
  (`e2e/failure-paths.spec.ts`).

## Retired

Kept so the record of what was captured, and where it went, survives. Removing
the line entirely would lose the trail.

- 2026-10-17 parseUnifiedDiff read the empty line after a diff's final
  newline as one more context line of the last hunk. DONE 2026-10-25, each
  hunk stopped at its declared counts (D-219).
- 2026-10-22 README's three screenshots were last taken in c09b2ad on
  2026-08-25. DONE 2026-10-25, re-shot from the browser suite and the
  README's claim about them corrected (D-212).
- 2026-10-23 (maintainer) A review that also runs the project's tests and
  photographs its screens, grading the design A to D. PULLED the same day
  into the proof-and-steps plan as WP-I and WP-J (D-191).
- 2026-07-31 Reasoning effort is per review (low/medium/high/max, default
  high). BUILT in commit f91c208, the same commit that filed this line, so it
  was a note rather than an idea. The fact about the CLI accepting exactly
  four levels lives where it is needed, in the comment at
  `src/lib/engine/command.ts`.
- 2026-07-31 The new-review screen needs a text area for the author
  description and a usage panel showing cached versus fresh tokens. BUILT in
  commit 935145a. One detail in the original line was wrong: the usage panel
  belongs on the review screen, not the new-review screen, because there is
  nothing to count before a review has run.
- 2026-10-20: the D-107 test in tests/server/review/service.test.ts
  ("completes, and says the checkout was already changed") failed once
  under the fast gate's load, git reporting the CRLF checkout clean.
  ROOT-CAUSED in D-150, git's racy-clean rule, and fixed in 9759785, which
  ages the D-107 checkouts' index.
- 2026-10-21 The maintainer's call: whether the new-review screen shows,
  before Start, that the CLI's sign-in bills per token, and as a passive line
  or a step to acknowledge (D-160 item 3). DECIDED in D-161: a strict notice
  before Start, not a block; built in dd51866, and made a refusal until shown
  by 34ebb52 (D-162).
- 2026-10-21 The CLI's check runs `auth status` with the person's
  settings loaded, and reviews run with `--setting-sources ""`, so the
  check can name an apiKeyHelper or a provider a settings file sets
  that no review uses, or miss one. Unmeasured; read from the 2.1.301
  binary's auth-method code only. So for those two every reader says may
  cost: a headless review and a probe, which read no settings, and an
  interactive review's commands, which read user settings only (D-164
  item 8, D-165 items 3, 8 and 9), until it is measured. `auth status`
  takes only --json and --text; whether a --setting-sources before it
  reaches it needs the real CLI run.
  MEASURED and BUILT in D-170: `--setting-sources` before `auth` reaches
  it, and each check now asks as its reader reads.
- 2026-10-21 The maintainer's call: whether check-no-private's remaining
  literal markers (the private product, package and project names) move to
  hashes as the working-tree names did (D-157): it would stop the gate's own
  file naming them, at the cost of the patterns' reach and of a list no
  reader can review, with history keeping every literal regardless.
  DECIDED in D-169, BUILT in D-171.
- 2026-08-04: S3 ruleCode arrives from real models as prose ("Rule 11")
  where the ruleset speaks bare codes ("11"); normalise or validate at the
  stage boundary (observed in both clean fable runs, D-59).
  BUILT in daca225 (2026-08-17): src/lib/review/rule-codes.ts reads a
  prose code back to the ruleset's own.
- 2026-10-20: the maintainer passed on a colleague's note about Claude Code's
  built-in skills. Proposed: /security-review once before anything goes
  external, after 7.2; /code-review read-only (never --fix) as a second
  reviewer in a review round, once it is known to keep to one subagent;
  not /simplify, which applies its own changes; the third-party grill
  plugin only with the maintainer's OK. DECIDED in D-169: /security-review
  after 7.2 and /code-review read-only, as proposed; neither /simplify nor
  grill.
- 2026-11-03: each rule's context on the ruleset page. BUILT the same day:
  a rule's title opens to its text from the document, formatted (D-227).
  Left open, and listed above: directive bodies still show their markdown
  raw.
- 2026-11-21: the Delete ruleset card loses the keyboard focus when Delete
  is pressed and again at Keep it, the button pressed being taken off the
  page. Remove rule (RA-4) puts the focus on Keep it and back on the
  control; the card could do the same.
- 2026-11-21: a sweep row is any table row whose first cell holds a
  pattern in backticks, and every number in its second cell is taken as a
  rule's code (`parseSweepTable`), so a row reading "radix 10" gives rule
  10 a pattern. Narrowing it changes what an imported document means:
  check the maintainer's protocol first.
- 2026-11-21: the sweep table edited in the app, so a rule's code can
  change and a removed rule's rows go with it (D-271 holds both back).
- 2026-11-21: no `color-scheme` is declared, so native checkboxes, selects
  and scrollbars are drawn for the light theme on the dark one. Declaring
  it changes every screen's dark shots. RA-6's two radios declare their own.
- 2026-11-21: a ruleset with no directive is given to a model with an
  empty `# Protocol` section (`composeSystemPrompt`). Leaving the heading
  out changes a prompt, so it wants a measured run.
- 2026-11-21: the ruleset's page says the export holds every rule,
  switched off or not, and not that a severity changed with the picker is
  left out of it (review round 19; README says it). Done 2026-11-21
  (D-287).
- 2026-11-21: with no ruleset stored, the new-review picker ("No rulesets
  imported yet", "Import a ruleset first"), a draft review ("import one")
  and the dashboard's first line name importing alone; a ruleset is also
  started with no document (RA-6). Done 2026-11-21 (D-285).
- 2026-11-22: only the Windows job failed in CI run 44932086480 at d5a3d45
  (Ubuntu and macOS passed): `e2e/journey.spec.ts`, "a report's last line
  names every ruleset its review ran with", 5 seconds waiting for the
  footer on a page still at "Loading...". The run's trace has one script
  chunk of the review page refused with net::ERR_NO_BUFFER_SPACE, so the
  page never hydrated: the loopback fault Windows CI has shown before
  (D-104, D-105). The three runs before it, from 59c7496 where the test
  was added, passed on Windows. Recorded and left (D-246).
- 2026-11-22: the count beside a ruleset in the Rules picker opens that
  ruleset in the same tab, and New review's choices (branch, model,
  intent, ticks) go with the page. The refusal for a shared number sends
  a person there to renumber (review round 25).
- 2026-11-22: in a new review's branch picker, a branch chosen and then
  hidden by Mine or by the text filter stays the branch to review, and
  nothing on the screen says which it is (D-296).
- 2026-11-22: two things the nineteenth grader derived by reading and
  did not run (AG4, AG5). A review resumed after its project's checks
  were switched off drops the check findings, and the report may still
  read the kept result file and say the tests failed with no finding
  listed (`src/server/review/report-input.ts:37-71`,
  `src/server/review/service.ts:401-407`). And the scan's first line
  stands through the whole of a project's checks, up to 20 minutes each,
  since run notes reach the feed only at a stage's lifecycle. Neither is
  reproduced.
- 2026-11-22: an interactive stage's row records the path of a log file
  that only a headless stage writes, so a timed-out interactive stage
  names a file that is not there; and an answer it refuses writes no
  failed stage row, the failure standing in a run note alone (the
  twenty-first grade, AI5; `src/server/review/service.ts:861`,
  `src/server/review/checkpointing-runner.ts:163, 252-286`). Open.
- 2026-11-22: the "Your turn" card gives the command for both shells as
  one block with no copy button, and names the stage by its id.
  And it gives the PowerShell command before the bash one on a Linux
  machine (seen in `review/2026-11-22-e2e/interactive-your-turn-focused-light.png`).
