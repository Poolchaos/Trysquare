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
- 2026-08-04: retag unmigrated-consumer from rule 4 (index signature, which
  the Prefs interface does not have) to a rule that names the class, possibly
  a new rule 15.
- 2026-08-04: a risk-tagged variant of the quality gate, so the risk-first
  ordering is exercised with non-empty tags somewhere outside the pipeline
  tests.
- 2026-08-04: the seeded fixture produces zero sweep hits, so the gate's
  pendingSweepHits === 0 and the whole sweep-disposition path are vacuous on
  this fixture; plant a sweepable pattern.
- 2026-08-04: scripts/demo-fixture.ts scores every defect against
  app/<file>, so a future shared-core defect would score MISSED forever;
  qualify by the defect's repo when one is added.
- 2026-08-04: clearHunk demands a reason while the sweep-clear guard does
  not; align the two or record why they differ.
- 2026-08-04: the run screen's usage panel omits cache-creation tokens,
  which reviews.usage_cache_creation_tokens accumulates; surface it.
- 2026-08-04: S3 ruleCode arrives from real models as prose ("Rule 11")
  where the ruleset speaks bare codes ("11"); normalise or validate at the
  stage boundary (observed in both clean fable runs, D-59).
