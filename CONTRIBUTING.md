# Contributing to Trysquare

Contributions are welcome, including bug reports, design criticism, and code.
This document explains how the project is organised and what a change needs
before it can be merged.

Please read it before opening a pull request. The standards here are stricter
than most projects of this size, for a reason: this is a tool whose entire
value is that its output can be trusted, so the code that produces that output
has to be held to the same bar.

## Before you start

The project is in early development and is built in a fixed order. Work
packages, their dependencies, and what is done so far are in
[docs/plans/BUILD-PLAN.md](docs/plans/BUILD-PLAN.md), and the current state of
the code is in [docs/PROJECT-STATE.md](docs/PROJECT-STATE.md).

If you are planning anything beyond a small fix, please open an issue first so
we can agree on the approach. This avoids two people building the same thing,
and it avoids you writing something that conflicts with a design decision
already recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Setting up

```bash
git clone https://github.com/Poolchaos/Trysquare.git
cd Trysquare
npm install
./verify.sh
```

You need Node 22 or newer and git. You only need Claude Code installed if you
are working on the review engine itself; the test suite uses a fake engine so
that tests run without consuming anyone's model usage.

## The gate

```bash
./verify.sh
```

This runs lint, format check, typecheck, house style, the private-material
check, the nothing-hidden-from-git check, and the unit tests. Add `--build` if
you touched anything that affects the build, and `--e2e` if you touched UI or
pipeline behaviour.

The end-to-end run needs a browser, once per machine. CI does the same, and
chromium only, because a second engine would double the run for no question it
answers:

```bash
npx playwright install --with-deps chromium
```

Two traps that are not your fault when you hit them. An interrupted Playwright
run can leave a server holding port 3100, and the next `--e2e` then fails
saying the port is in use; kill it and re-run, because reusing an existing
server is refused on purpose (it would not have the fake engine in its
environment). And a production build can rewrite `tsconfig.json`, which the
format gate then fails on; run `npm run format` and go again.

**A pull request is not ready until `./verify.sh` exits zero.** Please run it
without piping the output into anything that would swallow the exit code.

The gate is deliberately strict about a few things that are easy to get wrong:

- A step that prints a runtime error but still exits zero fails the gate.
- A step that hangs fails the gate rather than blocking forever.
- House style is machine-checked, not a matter of taste. See below.

## What a good pull request looks like

**One change per pull request.** Small and reviewable beats comprehensive.
Unrelated fixes belong in their own branch, however tempting it is to bundle
them.

**Evidence, not assertion.** If you say something works, show what you ran and
what it printed. If you fix a bug, the pull request should make clear how you
confirmed the old behaviour was wrong and the new behaviour is right. A test
that passes without exercising your change does not count as proof.

**Fix the bug, never the test.** If a test fails, that is a signal to
investigate, not to adjust the assertion. Weakening or deleting a test to make
a build pass will be treated as a defect in the change.

**Keep the docs true.** If your change makes a statement in `docs/` wrong,
correcting it is part of your change, not a follow-up. Stale documentation is
treated as a bug here.

**No new dependencies without a reason.** Say in the pull request why an
existing dependency or the standard library will not do.

## House style

These are enforced by `scripts/check-style.mjs`, which the gate runs, so they
are not opinions you need to argue about:

- No em dashes. Use periods, commas, or hyphens.
- No emojis in code, documentation, or user-facing strings.

Formatting is handled by Prettier (`npm run format`). TypeScript runs in strict
mode with `noUncheckedIndexedAccess`, so indexed access is possibly undefined
and you have to handle it.

## Architectural rules

A few constraints are load-bearing and a pull request that breaks them will be
asked to change, even if it works:

- **Never write into a reviewed repository.** Clones are bare and review
  worktrees are read-only. There must be no code path that modifies code under
  review.
- **The model's tool allowlist stays read-only.** Widening it is a design
  decision that belongs in `docs/DECISIONS.md`, not a convenience in a patch.
- **Coverage is enforced by code.** Anything that decides whether a hunk,
  sweep hit, or deletion was handled must be a program check. Do not replace a
  program check with a prompt instruction.
- **Layering.** `src/lib/` is pure and does no I/O. Only `src/server/gitops`
  spawns git, only `src/server/engine` spawns the CLI, and all database access
  goes through repositories.
- **Never depend on `rg`.** It is not a binary on every machine. Use `grep` or
  Node.

## Commits

Write a clear message that explains why, not just what. Please do not add
authorship trailers such as `Co-Authored-By` or "generated with" lines.

Stage files by explicit path rather than `git add -A`, so that nothing
unintended is swept into a commit. This matters more than usual here, because
the repository is designed to sit alongside private working material in
`docs/private/`, which is gitignored.

## Reporting bugs and security issues

For ordinary bugs, please open an issue with what you did, what you expected,
and what happened, including the exact command and its output.

For anything with security implications, see [SECURITY.md](SECURITY.md) rather
than opening a public issue.

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers this project.
