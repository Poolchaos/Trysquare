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
