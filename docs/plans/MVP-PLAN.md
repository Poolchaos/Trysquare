# MVP plan

Status: RATIFIED 2026-10-16 (D-86). Written 2026-10-16.

Inputs: `AUDIT-2026-10-16.md` (finding IDs used below) and
`AUDIT-2026-10-16-GLM.md`. Scope answers given by the maintainer on
2026-10-16 are D-85.

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done, commit
only when asked.

Definition of done for every work package:

- One WP per branch/diff; no batching.
- `./verify.sh` exits 0, run unpiped. From WP 1.1 on, that gate is trusted;
  before it, it is not (T1).
- The real flow is driven at runtime, not just typechecked.
- Every doc the WP makes stale is updated in the same diff.
- The WP row below is marked DONE with the commit hash, in the same session.
- Open decisions are asked, or the WP is scoped so the decision is not needed
  yet. Do not guess.

Work top to bottom through unblocked items without asking; skip blocked items
until their input lands, never wait on them.

Platform rule for this plan: a WP that touches a path, a spawn, a shell
string or a file handle is proven on Windows locally and on all three OSes
once WP 3.6 has landed the CI matrix.

Interim proof rule, until `./verify.sh` can go green on Windows: the
maintainer's machine is red for the known causes in
`AUDIT-2026-10-16.md` section 2, so a WP is proven by (1) `./verify.sh
--build --e2e` green in CI on `ubuntu-latest` for the pushed commit, (2)
the WP's own tests run and passing locally on Windows, and (3) the local
Windows unit run showing no failure that is not already in the audit's
taxonomy, with its failure count recorded in the WP's DONE note. The rule
retires once the local gate goes green, and the DONE note of that WP says
so.

## 1. Goal and non-goals

**Goal.** The maintainer runs real reviews of their own branches on their
Windows machine, reliably and without surprise spend, and the same tree is
proven green on Linux, Windows and macOS. It stays a free tool: no hosted
service, no paid dependency, the user's own Claude subscription through the
local CLI.

**MVP exit criteria**, each measured, none asserted:

1. `./verify.sh --build --e2e` exits 0 on the maintainer's Windows machine
   and on `ubuntu-latest`, `windows-latest` and `macos-latest` in CI.
2. A fresh clone installs with the documented commands and no flags beyond
   them, on all three CI runners.
3. `npm run demo:fixture -- --fake` passes on all three CI runners.
4. A real-engine run on the 11-defect fixture, on Windows, with the CLI
   version the README names, and the maintainer's G1 verdict on it.
5. The maintainer completes one real review of their own branch on Windows
   and gives the G2 verdict.
6. Every high-severity audit finding in scope is DONE; `npm audit` reports no
   critical or high advisory in production dependencies.

**Non-goals for the MVP** (public release is a later milestone, D-85):
WP-G completion moment, WP-K queue phone layout, WP-L my branches,
multi-ruleset reviews, more than one dependency, emailing reports, an npm or
npx package, a desktop shell, public-facing README polish beyond accurate
install and requirements.

## 2. Work packages

Phases run in order because each one is what proves the next: a gate that
can lie (phase 1) proves nothing; a framework upgrade (phase 2) changes the
ground every later WP stands on; nothing on Windows can be driven until
phase 3; and a real model run (phase 7) is only worth its usage once the
engine fixes in phase 4 have landed.

### Phase 1: a gate that can be trusted

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 1.1 | T1: scan step output without a pipe that SIGPIPE can break (a temp file or here-string into `grep`). Exercise both failure branches once, as 05 section 1 requires, including a marker on line 1 of output over 100KB. | - | DONE e95b87d 2026-10-16: verify.sh scans with a here-string and self-checks the scan at 300KB on every run (0.16s). Through the extracted `run()`: markers first and last caught at 10 to 10,000 lines, 20 of 20 at 3,000; clean output passes; the old pipe scan swapped back in fails the self-check. Local Windows unit run unchanged at 257 failed, all in the audit taxonomy. |
| 1.2 | T4: `check-nothing-hidden` and `check-no-private` fail rather than exit 0 when they could not check. | - | DONE 475afe4 2026-10-16: nothing-hidden exits 2 on any git failure other than git being absent or no repository (both kept as decided 2026-08-03); no-private exits 2 when git lists no files, reports a file it could not read instead of skipping it, and matches the home directory in its native, forward-slash and Git Bash forms, case-blind on Windows. Each branch driven by hand, five cases. |
| 1.3 | T3 test side: the DB helper closes SQLite before deleting; `paths.test.ts` expects the platform's own separators (the product is correct, the test asserted POSIX); the mode-only fixture sets the bit with `git update-index --chmod=+x` instead of `chmod`, so it exists on every OS. | - | DONE 6575bdf 2026-10-16: local Windows unit run 257 failed to 50 failed (504 passed, 178 skipped); the 50 are all W1 and W3. The API-route suites that open a database through the runtime are still blocked behind W3 and are checked for the same EBUSY when 3.3 unblocks them. |
| 1.4 | W5: establish why npm 10.9.2 runs `node-gyp rebuild` for better-sqlite3 13.0.2 despite `"gypfile": false`, and whether npm 11 does. Then apply MG-2. | MG-2 after measurement | DONE 0f4d35c 2026-10-16: root cause is the lockfile dropping `gypfile`, measured on npm 10.9.2 and 11.21.1; MG-2 resolved as D-87, better-sqlite3 ^12.11.1. A clean `npm ci` with no flags exits 0 on this machine; build passes; Windows unit run unchanged at 50 failed. |

### Phase 2: security and framework

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 2.1 | S2: upgrade next to the release that clears every next advisory (`>=16.3.8` on 2026-10-16; re-run `npm audit` at the time) and clear the remaining audit items. Full `--build --e2e` proof. | - | DONE 397f5de 2026-10-16: next and eslint-config-next 16.3.8, vitest 4.1.12, sharp override 0.35.5, transitive nanoid, source-map-js, js-yaml and brace-expansion updated. Production audit 0; full audit 13 to 5, the dev-only braces chain accepted in D-89. The new lint rule flagged three `window.location.href` redirects, now `router.push`, each driven in Chromium against `next start` on Windows. Windows unit run unchanged at 50 failed. |
| 2.2 | S1 part one: `dev` and `start` bind `127.0.0.1` explicitly. | - | DONE 52247b7 2026-10-16: `npm run start -- --port 3202` on Windows listened on 127.0.0.1 only (`Get-NetTCPConnection`); 127.0.0.1 and localhost answered 200, the LAN address 192.168.56.1 was refused. `npm run dev -- --port 3203` likewise listened on 127.0.0.1 only. Playwright reaches its server on 127.0.0.1 as before. Found on the way: `next dev` under an agent writes into `CLAUDE.md` (D-90, RUNBOOK). |
| 2.3 | S1 part two: a request guard for `/api`: Host must be loopback; mutating methods need a same-origin Origin (or none) and `Content-Type: application/json`; the client sends that header. Reproduce the 2026-10-16 cross-origin POST and show it refused. | - | DONE cf6fff6 2026-10-16: `src/proxy.ts` over the pure `lib/http/request-guard.ts`. Host must be loopback on every request; API requests with Sec-Fetch-Site `cross-site` or `same-site` are refused; mutations carrying an Origin must match the Host. The Content-Type rule was dropped: browsers send Origin on every non-GET request, so the Origin rule already covers every request a page can forge, and a Content-Type rule would only have broken curl. 32 unit tests, 9 of which fail with the Origin check removed. Against `next start` on Windows: the 2026-10-16 text/plain POST with a foreign Origin, a wipe-all DELETE from a foreign Origin, Host `evil.example` on an API and a page route, and a cross-site GET all 403; same-origin, no-Origin and localhost requests pass; the browser delete flows still work. |

### Phase 3: runs on Windows, Linux and macOS

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 3.1 | W1, E3: one CLI resolver in `server/engine`, used by stages, probes, auth and Mode B. Order: `TRYSQUARE_CLAUDE_PATH`, then a saved setting (lands in 6.1), then PATH search honouring PATHEXT on Windows. A `.js`/`.mjs` target runs as `process.execPath <script>`, which also makes the fake CLI portable. `.cmd`/`.bat` are refused by name (no shell). Synchronous spawn throws become `StageFailedError("spawn")` and close the log stream. | - | DONE 2026-10-16: `src/server/engine/cli.ts`, used by stages, probes and auth; Mode B's printed command moves to it in 3.7, the saved setting in 6.1. A `.cmd` is not refused outright: npm's shim names the program it launches, so the resolver reads the last quoted `%dp0%` path and runs that, refusing only a batch file that names none. Proving it on Windows exposed the E6 race: a stopped stage rejected while its process still held the worktree, EBUSY on delete. Stages now settle on the process's exit, SIGTERM escalates to SIGKILL after 5s, and a stage gives up waiting 5s later. 16 resolver tests over npm's real shim texts, Windows and POSIX rules on every OS; the nvm `node.exe` case fails if the parser takes the first match. The real `claude.exe` resolved from PATH and `auth status` read through the app: signed in, subscription. Windows unit run 50 failed to 0 failed, 602 passed; 10 suites still stop at setup on W3. |
| 3.2 | W2: the system prompt moves to `--system-prompt-file` in the run directory. Measure the full command length on the real protocol before and after. | MG-3 | TODO |
| 3.3 | W3, W7: the URL validator accepts Windows absolute paths (`C:\`, `C:/`, UNC refused or accepted by explicit decision in the WP); dynamic imports of paths go through `pathToFileURL`. | - | TODO |
| 3.4 | T2: e2e setup never deletes a directory the server already opened. The run directory is decided at config load (which precedes `webServer`), cleaned there, and named for the run. | 3.1, 3.3 | TODO |
| 3.5 | W4: credential helper behaviour per MG-4, proven with a private HTTPS repository on Windows. | MG-4 | TODO |
| 3.6 | T5: CI matrix `ubuntu-latest`, `windows-latest`, `macos-latest`, each running plain `npm ci`, `./verify.sh --build --e2e` and `npm run demo:fixture -- --fake`. Fix what macOS finds before marking DONE. | 1.4, 3.1-3.4 | TODO |
| 3.7 | W6, E7: Mode B fixed (D-85). Files keyed by stage, batch and attempt; an answer carries the request's id so a stale file is refused by name; the launch instruction uses the resolver, the read-only flag set (`--tools Read,Grep,Glob --setting-sources user --strict-mcp-config`), `--system-prompt-file`, and no prompt in argv; one instruction per shell (PowerShell, POSIX). Driven by hand on Windows and recorded. | 3.1, 3.2 | TODO |

### Phase 4: engine correctness

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 4.1 | The audit areas nobody finished (AUDIT section 10): pipeline invariant bypasses, quotation-check inputs (CRLF, tabs, unicode, deleted side, renames), state-machine races, SSE listener leaks, old-database migration, hostile git inputs. Read-only pass; each confirmed finding becomes a WP row in this table before 4.2 starts. | Phase 3 | TODO |
| 4.2 | E1: measure whether a chained stage runs under its own system prompt on the current CLI, then apply MG-5. The measurement spends usage. | MG-5, maintainer go on spend | TODO |
| 4.3 | E4: an indeterminate probe leaves availability unknown, as decided. | - | TODO |
| 4.4 | E5: model ids are checked against the alias law at review creation and at stage launch. | - | TODO |
| 4.5 | E6: `drain()` wired to process shutdown; a stage with no parsed `init` fails closed. (The SIGTERM to SIGKILL escalation and settling on exit landed in 3.1.) A cancel that lands after a stage started but before its process spawned is not seen by that stage, which then runs to completion; the 2026-07-30 W4 decision says the stage in flight completes, and `service.test.ts` holds that, so changing it needs its own decision entry first. A 3.1 line that killed such a stage was reverted for that reason (d2070a7, CI run 38926549014). | 3.1 | TODO |
| 4.6 | E8: the env scrub removes only the variables measured to trigger the CLI's nested-session refusal; user configuration passes through. | 3.1 | TODO |
| 4.7 | E9: add `xhigh` if the CLI version named in MG-3 accepts it, measured without a paid call. | MG-3 | TODO |

### Phase 5: spend safety and error handling

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 5.1 | U1: Cancel asks first and reports a failed cancel. | - | TODO |
| 5.2 | U2: Enter in the branch filter never submits. | - | TODO |
| 5.3 | U3: an empty budget field is refused, not saved as 0; removing the ceiling takes an explicit 0. | - | TODO |
| 5.4 | U4: the queue's keyboard handler leaves Enter and Space alone on interactive elements. | - | TODO |
| 5.5 | U5 per MG-6. | MG-6 | TODO |
| 5.6 | A1, A7: typed not-found errors map to 404, illegal transitions to 409; complete reports success when the review completed and names the cleanup failure separately. | - | TODO |
| 5.7 | A2, U6: a duplicate URL is a 409 naming the existing project; a failed clone can be opened, retried and deleted. | - | TODO |
| 5.8 | A3, A8: settings validate every key against an own-property lookup before writing any, in one transaction; confirm and start reject invalid bodies. | - | TODO |
| 5.9 | A4, A5: link DELETE is scoped to its project and 404s on an unknown link; importing over an existing name requires an explicit replace and the UI asks. | - | TODO |
| 5.10 | A6: the two routes go through repositories. | - | TODO |
| 5.11 | U7: a draft review can be started from its screen. | - | TODO |
| 5.12 | U8: SSE reconnects with backoff and the feed resumes; the theater shows the dropped-stream notice. | - | TODO |
| 5.13 | U9, U10: every initial fetch has an error state carrying the server's message; project detail draws before `git fetch` returns. | - | TODO |
| 5.14 | U11, U12: the new-review traps and the focus gaps. | - | TODO |

### Phase 6: Claude connect

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 6.1 | Settings gains the CLI path (the first non-numeric setting key), the resolved path and version, and distinct states: not found, cannot run (with the real error), signed out, per-token billing, subscription. E2. | 3.1 | TODO |
| 6.2 | The new-review screen runs the free checks (resolve, `--version`, `auth status`) before Start and blocks with the reason. | 6.1 | TODO |
| 6.3 | Signed out: show the exact `<resolved path> auth login` command for the user's shell. Nothing stores a token. | 6.1, MG-7 | TODO |

### Phase 7: decided work, records, verdicts

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 7.1 | D1 per MG-8: build D-51 project editing, the last-used model default, and the T19 dead-export gate, one diff each. | - | TODO |
| 7.2 | R1 records pass: PROJECT-STATE, RUNBOOK and README name the supported OSes, the minimum CLI version and how to check sign-in; 06-MODELS re-verified against the current CLI; the stale plan rows and inbox misfiles named in both audits; the volatile "proven on this machine" fact moves out of `CLAUDE.md` into docs. | Phases 1-6 | TODO |
| 7.3 | Fresh real-engine run on the 11-defect fixture on Windows, evidence captured, for the G1 verdict. Spends usage. | Phases 3-4, maintainer go | TODO |
| 7.4 | The maintainer's own real review on Windows, for the G2 verdict. Spends usage. | 7.3 | TODO |

## 3. Decision gates (maintainer)

Each gate lists the options with a recommendation. None is assumed; a gate is
resolved only by an entry in `docs/DECISIONS.md`.

- **MG-1: how this plan sits in the gate ledger. RESOLVED (a), D-86.** G1 is AWAITING VERDICT,
  and every WP here sits beyond it. (a) Re-scope G1 to "working pipeline on
  Linux, Windows and macOS", give its verdict at 7.3, keep G2 as written,
  and make G3 the public release after the MVP. (b) Give the G1 verdict now
  on the 2026-08-04 evidence and run this plan under G2. Recommended: (a).
  The 2026-08-04 runs predate five pipeline changes and CLI 2.1.301's
  snapshot default (E1), so a verdict on them judges a pipeline that no
  longer exists.
- **MG-2: install on npm 10. RESOLVED, D-87: better-sqlite3 ^12.11.1.** (a) Require npm 11 if it
  installs cleanly. (b) Pin a better-sqlite3 version whose install works on
  npm 10 without a toolchain. (c) Document `--ignore-scripts`. Recommended:
  decide on the measurement; (c) is rejected in advance because it silently
  skips every other package's scripts too.
- **MG-3: minimum CLI version.** `--system-prompt-file` and
  `--system-prompt-snapshot` are accepted by 2.1.301; whether 2.1.71 has
  either is unknown. (a) Require the oldest version proven to have both,
  checked by the resolver at `--version`. (b) Feature-detect per flag.
  Recommended: (a); one version line in the README is checkable, a matrix
  of feature probes is not.
- **MG-4: private HTTPS clones on Windows.** (a) Keep `GIT_CONFIG_NOSYSTEM`
  and forward only the system `credential.helper` value. (b) Drop
  NOSYSTEM and pin the keys that matter (`core.autocrlf=false` and the
  others found in 3.5). (c) SSH only, documented. Recommended: (a); it
  changes one key and leaves the line-ending protection intact.
- **MG-5: chained stages and the system-prompt snapshot** (after 4.2
  measures). (a) Pass `--system-prompt-snapshot off` on chained calls.
  (b) Stop chaining S2 to S4. (c) No change, if measured harmless.
  Recommended: (a) if the replay is real; chaining is there for cache reuse.
- **MG-6: the bare `c` shortcut.** (a) Require Shift+C. (b) Keep `c` and add
  an undo for the last decision until the review completes. (c) Remove the
  shortcut. Recommended: (a); it adds no reversal state to a record whose
  premise is that each decision was deliberate.
- **MG-7: login.** (a) Show the command for the user to run. (b) Spawn
  `auth login` from the server. Recommended: (a). Whether the login flow
  runs without a terminal is unverified, and (b) would need a decision
  entry against the read-only spawn law in any case.
- **MG-8: decided but unbuilt** (D1). RESOLVED, D-86: build all three. Build or retire each of D-51, the
  last-used model default, and the dead-export gate. No recommendation
  until the maintainer says which they miss.
- **MG-9: macOS evidence. RESOLVED (a), D-86.** (a) CI on `macos-latest` is the proof, and the
  README says so. (b) A person also drives it on a Mac. Recommended: (a)
  unless a Mac is available.
- **MG-10: CI cost. RESOLVED 2026-10-16, no decision needed.** The
  unauthenticated GitHub API returned `visibility: public` for
  Poolchaos/Trysquare, and GitHub's Actions billing page reads "GitHub
  Actions usage is free for self-hosted runners and for public repositories
  that use standard GitHub-hosted runners". The three-OS matrix costs
  nothing while the repository stays public and uses standard runners;
  larger runners are charged even on public repositories, so 3.6 uses none.

## 4. Review cadence

A structured review pass after every 3-4 completed WPs and before anything
goes external. Findings numbered and fixed before new WPs start. Fixed
points: after phase 1 (the gate itself), after phase 3 (before CI is
trusted on three OSes), and before 7.3 (before usage is spent).
