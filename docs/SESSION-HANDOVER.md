# Session limit and handover

How an AI session on this repository knows it is full, what it writes before
it ends, and how the next one picks the work up. The rule is `CLAUDE.md`
section 10; this is its procedure. Decided 2026-11-17 (D-230).

## The limit

A session's context stops at 500,000 tokens. The handover starts at 450,000,
so that writing it ends inside the limit.

The context is measured, never estimated:

```bash
node scripts/session-context.mjs
```

It prints the context the session's newest request was sent with (the input
tokens read fresh, written to the cache and read from it), from the
transcript Claude Code keeps of the session, and says `HANDOVER DUE` at
450,000. It exits 0 below that point, 1 at or past it, and 2 when it could
not measure, which is never read as "not full".

What the figure is not: a count of everything the session has spent. Each
request sends the whole context again, so the spend is far larger; the limit
is on how much one session holds.

Run it:

- before starting each change (step 1 of the per-change loop);
- after any step that read or wrote a lot: a long file, a gate's output, a
  subagent's report;
- before answering "is there room for this?".

The meter runs only when a session runs it. Nothing stops a session that
does not: wiring it in as a Claude Code hook, so the reading arrives unasked,
is not built (D-230).

## When a handover is written

1. **The meter says `HANDOVER DUE`.** Start nothing new, write the handover,
   and tell the maintainer to run /clear.
2. **The next change will not fit before 450,000.** Before starting a
   change, set what is left against what changes of its kind have taken by
   the meter. A change the meter says cannot be finished is not begun: the
   handover is written in its place, and the maintainer is told to run
   /clear. On 2026-11-17 a session stopped at 423,523 on this ground; the
   change it left read 89,343 before and 188,187 after in the next.
3. **The work asked for is finished, or the session is blocked.** Write the
   handover, and say that no /clear is needed yet.
4. **The maintainer asks for one.**

## The procedure

In order, and before the reply that ends the session:

1. **Stop at a safe point.** Finish the step in hand or undo it. Nothing is
   left half-edited, and no gate is left running: stop what was started.
2. **Bring the records up to date.** What this session made true or untrue
   goes into `PROJECT-STATE.md`, `GATES.md`, `DECISIONS.md` and the plan rows,
   as it would for any change. The handover never holds the only copy of a
   durable fact.
3. **Commit and push.** The gate green first, staged by explicit path, as
   for any commit. A handover is never written over uncommitted or unpushed
   work (the maintainer, 2026-11-17: "always commit and push before a
   session handover"), so this one commit and push needs no asking. A change
   not fit to push is finished or undone first, never pushed broken. The
   next push still waits for this one's CI, so the handover names the run.
4. **Archive the last handover.** Move `.claude/handover/HANDOVER.md`, if
   there is one, to `.claude/handover/archive/<its date>-<the first eight
   characters of its session id>.md`.
5. **Write `.claude/handover/HANDOVER.md`** from the template below. Every
   line in it is something this session checked. What it could not check is
   said as not checked.
6. **Measure again** and put the reading in the handover.
7. **Say it**, as the last lines of the reply:
   - at the limit, or with a next change that will not fit: "Handover
     needed. Run /clear, then start the new session with: Read
     .claude/handover/HANDOVER.md and continue."
   - otherwise: the reading, that the handover is written, and that no
     /clear is needed yet.

Nothing is started after those lines.

## Where it lives, and why

`.claude/handover/` is ignored by git (`.gitignore`). A handover is one
person's work in flight on one machine: a question waiting on them, the next
step, the trap the last session fell into. It is not a record of the project, and two
people's sessions would overwrite each other's in a tracked file. What must
outlive the machine goes into `docs/`, in step 2.

## Starting from a handover

A new session reads `CLAUDE.md`, then `.claude/handover/HANDOVER.md`, then
the rest of the fresh session ritual (`CLAUDE.md` section 9). The handover
says what was in flight when it was written; the working tree, the records
and the gate say what is true now. Where they disagree, check, and say which
was wrong.

## Template

The shape is the one the maintainer's own handover tooling checks and loads
at a session's start, so one file serves a machine with that tooling and one
without. Under 120 lines; point to files and lines, never paste code.

````markdown
---
status: pending
session: <this session's id>
written: <ISO time with offset>
branch: <git branch>
---

STATUS: <CONTINUE | DONE | BLOCKED>

# Handover: <one-line title of the work>

## Goal

What the work is for and what done means, two or three lines.

## Current state

What works now and how that was proven: the gate (`./verify.sh`, with which
flags, how it ended, at which commit), the last push and its CI run, the
session's context by the meter. Nothing is uncommitted; if something is,
why.

## Next steps

1. The exact first action: file, function, command.

## Read first

- `path:lines`: why it matters.

## Files touched

- `path`: what changed, and the commit.

## Decisions and why

- The decision: the reason; who decided, if the maintainer did.

## Gotchas, do not redo

- Dead ends already tried, traps, what looks wrong and is right.

## Verify

```bash
<commands that prove the current state>
```
````

`STATUS` is one of three. `CONTINUE`: work remains, and Next steps says
what. `DONE`: the goal is met, and Next steps lists only what the maintainer
should check. `BLOCKED`: nothing can move without the maintainer; add a
`## Blocked on` section with the question, what it blocks, and what happens
if it is not answered. A session that starts from the handover changes
`status: pending` to `status: consumed`.
