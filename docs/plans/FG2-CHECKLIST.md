# Founder gate FG-2 (gate G1): does the pipeline work, and is a finding worth reading?

Status: READY FOR THE MAINTAINER, prepared 2026-07-31. The smoke runs below
were executed 2026-08-04 with the maintainer's go; what is left is the
verdict itself. Evidence in `review/2026-08-04-fg2/`: `haiku/` (refused at
S3, D-57), `fable-1/` (refused at S3 on a product bug fixed the same day,
D-58), `fable-2/` (clean 8/8, no finding texts, predates the capture fix),
`122319-claude-fable-5-1m/` (clean 8/8 with `findings.json`, the run to
judge). Known duplication to read past: S4 re-raises the deleted side of
modifications, so the nine distinct findings appear as eighteen rows (D-59).

Two different questions live in this gate, and conflating them is the main way
it could be answered wrongly.

**Does the machinery work?** Answered already, and for free. The plumbing
carries a correct review from a branch pair to an exported report without
losing anything, and it refuses to finish when it cannot account for the
change set.

**Is the review any good?** Not answered, and not answerable without spending
real usage on a real model. Nothing below decides it for you. The fake run
cannot judge prompt quality, because the answers are the fixture's own.

## What has been proven without spending anything

Run it yourself in about a second:

```
npm run demo:fixture -- --fake
```

Captured 2026-07-31 into `review/2026-07-31-fg2/`:

```
Built the fixture: 8 planted defect(s), 2 file(s) that are deliberately fine.
...
  8/8 planted defect(s) found.
  No findings in the files that are deliberately fine.
  outcome            completed
  discarded quotes   0 (cited code that was not there)
  open questions     0
```

That establishes the pipeline carries a correct review intact, and no more.

Alongside it, and also free:

- 572 unit and integration tests, including a browser journey that walks the
  whole app from an empty state to an exported report in both themes.
- The engine quality gate, which also runs the opposite case: a reviewer that
  invents a finding has it discarded by the quotation check rather than
  reported.

## What you are being asked to judge

Run the smoke yourself when you are ready to spend a little:

```
npm run demo:fixture                                  # haiku, cheapest
npm run demo:fixture -- --model claude-fable-5[1m]    # the real question
```

Each run writes its own directory under `review/<date>-fg2/`, named by time
and model, holding the score, the full event log, and every finding's text
(`findings.json`). The haiku run is a plumbing smoke against a real model and
is not a quality claim (D-18); haiku's findings do not represent the product.

Judge these, in this order:

1. **Found and missed.** How many of the eight planted defects the model
   found, and which it missed. A miss is more interesting than a hit: the
   manifest says exactly what was there to find.
2. **False positives.** Findings raised in `src/utils/format.ts` or
   `README.md`, which are deliberately correct. A review that cries wolf is
   worse than one that misses.
3. **Discarded quotes.** Findings killed because they cited code that was not
   at those lines. A non-zero count means the model fabricated, and the app
   caught it; a large count means the prompts need work.
4. **Are the findings readable?** Open the run's `findings.json`. Each
   finding gives file, lines, issue, comment, mechanism and the quoted code.
   The comment is meant to be plain language someone who did not write the
   code can follow, with the code quoted separately. If it reads like a
   machine restating the diff, that is a prompt problem worth naming.
5. **What it cost.** Tokens split into fresh and cached, cost equivalent, and
   wall time, printed at the end of every run.

## What a verdict looks like

- **Pass:** the pipeline is sound and the findings are worth a person's time.
  Record it in `GATES.md` with the evidence directory, and M3 continues.
- **Pass with prompt work:** the machinery is right and the findings are weak.
  Name what was weak; prompt changes go through T18's rule, which is that the
  fake quality gate runs first and the real model runs after.
- **Fail:** something in the pipeline is wrong. That is a real result and the
  plan says so; it is not a reason to keep going.

The verdict is yours. Nothing in this repository will mark this gate passed on
its own, and no run of the fake can.
