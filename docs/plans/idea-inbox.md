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
- 2026-08-04: S3 ruleCode arrives from real models as prose ("Rule 11")
  where the ruleset speaks bare codes ("11"); normalise or validate at the
  stage boundary (observed in both clean fable runs, D-59).
- 2026-10-17: parseUnifiedDiff reads the empty line after a diff's final
  newline as one more context line of the last hunk (src/lib/git/diff.ts,
  the `line === ""` branch), so that hunk holds one line more than its
  header declares; stop each hunk at its declared counts.
- 2026-10-17: the probe's candidate models (fable-5, opus-5, sonnet-5,
  haiku-4-5) trail the bundled CLI 2.1.301's own model table, which lists
  fable-5-1, opus-5-5, sonnet-5-5 and haiku-5-5 (found during 4.7, D-122).
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
- 2026-10-20: the maintainer passed on a colleague's note about Claude Code's
  built-in skills. Proposed: /security-review once before anything goes
  external, after 7.2; /code-review read-only (never --fix) as a second
  reviewer in a review round, once it is known to keep to one subagent;
  not /simplify, which applies its own changes; the third-party grill
  plugin only with the maintainer's OK.
- 2026-10-21: the checkout's check of every tracked file (7b4a586) has a
  600 s ceiling on git hash-object, measured only up to 3,436 files in
  489 ms, a private working tree on the maintainer's Windows machine
  (D-153, D-154); measure it on a large repository and size the
  ceiling, or make it scale with the file count.

## Retired

Kept so the record of what was captured, and where it went, survives. Removing
the line entirely would lose the trail.

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
