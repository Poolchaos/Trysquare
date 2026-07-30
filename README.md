# Trysquare

A local code reviewer that reads a git branch the way a careful senior engineer
would, and refuses to hand you a finding it cannot prove.

A try square is the tool a woodworker holds against a joint to find out whether
it is genuinely square, rather than merely looking square. That is the whole
idea here. An AI can produce a review that reads well and is quietly wrong: a
line number that drifted, a bug that a guard clause upstream already handles, a
file it never opened. Trysquare is built so those failures are caught by the
program rather than trusted away.

## Status

Early development, and the honest summary is short: **the review pipeline is
not built yet.**

What exists today is the foundation. The project scaffold runs, the quality
gate (`./verify.sh`) is in place and its failure modes are proven rather than
assumed, and the design is specified in detail in [docs/](docs/). One of twelve
work packages is complete.

There is no usable review functionality yet. If you came here looking for a
tool to run today, it is not ready. If you came to read the design or to
contribute, everything you need is in [docs/](docs/) and
[docs/plans/BUILD-PLAN.md](docs/plans/BUILD-PLAN.md).

## The idea

Most AI review tools ask a model to look at a diff and report what it finds.
That produces two failure modes that are hard to notice: the model skips things
without telling you, and it reports things that are not true.

Trysquare is designed around the assumption that both will happen.

**Bookkeeping is code, not judgment.** Building the list of changed files and
hunks, running the mechanical pattern sweeps, tracking which hunks have been
dealt with, and checking cited line numbers are all done by the program. The
model is asked for judgment, and only judgment.

**Nothing is allowed to be silently skipped.** Every hunk, every sweep hit, and
every deletion has to end the review either attached to a finding or explicitly
cleared with a reason. A review cannot reach the report while anything is
undispositioned. This is enforced by a coverage ledger in the database, not by
asking the model nicely.

**Every finding is verified by someone who did not write it.** Candidate
findings go to a second pass in a fresh session with no access to the reasoning
that produced them. Its job is to open the file, quote the actual lines, and
try to kill the finding: is the code really there, does the mechanism really
hold, is there a guard upstream that already handles it. Then the program
checks the verifier's own work, byte-comparing the quoted code against the file
at the cited lines. A finding with a line number that does not match dies
regardless of how confident anything was about it.

**A human decides what counts.** Surviving findings are presented for you to
confirm or dismiss with a reason. Only what you confirm reaches the report.

**Reviewed code is never modified.** Projects are cloned bare, reviews run in
detached worktrees pinned to a commit, and the model gets a read-only tool
allowlist. There is no code path that writes into a repository under review.

## How it will work

You add a project by git URL and it is cloned locally. You pick the branch to
review, the branch to compare against, and which rulesets to apply. Rulesets
come in three tiers that compose: rules that apply to any code, rules for a
particular technology, and rules specific to one project.

The review then runs as a sequence of stages, mirroring a rigorous manual
review: build the change inventory, classify risk, understand the code
including the files it calls into, hunt adversarially against the rule
database, review deletions as first-class changes, verify every candidate
finding, and audit coverage before producing anything.

Two details worth knowing. Reviews can span two repositories at once, for the
common case where an app and a package it consumes are changed together and a
type change in the package is only dangerous at the consumer. And the way work
is divided between requests adapts to the model you pick, because a model with
a large context window can hold an entire rule set at once and a smaller one
cannot. What never adapts is coverage: weaker models get more, smaller
requests, never a shortened rule set.

## Requirements

- Node 22 or newer
- git
- [Claude Code](https://claude.com/claude-code) installed and signed in

Trysquare drives the `claude` CLI that is already on your machine, using
whatever credentials it already holds. It ships no model of its own and has no
account system, no server of its own, and no telemetry.

Be clear about what that does and does not mean. Reviewing code with a model
means sending code to that model: when a review runs, the diff, the contents of
the files involved, and your rulesets are sent to Anthropic by the Claude Code
CLI, under whatever terms and plan you already have with them. That is inherent
to the tool doing its job, not an extra. What Trysquare adds is that nothing
goes anywhere else: no Trysquare service, no analytics, no third party. Your
projects, review history, and findings are stored only in a local SQLite
database and files under your own home directory.

## Running it

```bash
npm install
npm run dev
```

That serves the app on <http://localhost:3000>. At present it renders a
placeholder page: see Status above.

## Development

```bash
./verify.sh              # the gate: lint, format, types, house style, tests
./verify.sh --build      # adds a production build
./verify.sh --e2e        # adds end-to-end tests
```

"Verified" in this project means exactly one thing: `./verify.sh` exited zero.
The script checks each step's exit status separately from its output and also
scans that output for runtime error markers, because a step that prints a stack
trace and still exits zero is a failure. A step that hangs is a failure too,
not something to wait out.

The gate's own failure paths have been deliberately triggered and observed to
fire. A gate that has never failed is assumed broken until proven otherwise,
and the first version of this one did in fact pass a violation it should have
caught.

## Documentation

The design is written down before it is built, and the documents are kept
current rather than written once.

| Document | What it covers |
| --- | --- |
| [docs/00-BRIEF.md](docs/00-BRIEF.md) | What the app is meant to be |
| [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) | Topology, layering rules, on-disk layout, engine adapter |
| [docs/02-DATA-MODEL.md](docs/02-DATA-MODEL.md) | Schema, state machines, coverage invariants |
| [docs/03-REVIEW-PIPELINE.md](docs/03-REVIEW-PIPELINE.md) | The review stages and what is code versus judgment |
| [docs/04-UI-DESIGN.md](docs/04-UI-DESIGN.md) | Screens, states, accessibility |
| [docs/05-TESTING.md](docs/05-TESTING.md) | Test strategy and the seeded-bug quality gate |
| [docs/06-MODELS-AND-PROFILES.md](docs/06-MODELS-AND-PROFILES.md) | Model discovery and how the pipeline adapts to model capability |
| [docs/plans/BUILD-PLAN.md](docs/plans/BUILD-PLAN.md) | Work packages, milestones, current progress |
| [docs/PROJECT-STATE.md](docs/PROJECT-STATE.md) | What is actually built right now |

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how the
work is organised and what a change needs before it can be merged. The short
version: keep changes small, make `./verify.sh` pass, and show evidence that
what you claim works actually works.

## Licence

[MIT](LICENSE).

## Not affiliated with Anthropic

This is an independent project. It is not made by, endorsed by, or affiliated
with Anthropic. It runs the Claude Code CLI on your own machine under whatever
plan you already have, and "Claude" and "Anthropic" are trademarks of Anthropic
PBC, used here only to say what the tool talks to.
