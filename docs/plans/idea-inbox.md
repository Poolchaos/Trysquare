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
- 2026-07-31 Reasoning effort is per review (low/medium/high/max, default high). No tier exists between high and max: the CLI accepts only those four.
