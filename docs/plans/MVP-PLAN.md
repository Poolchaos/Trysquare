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
| 3.1 | W1, E3: one CLI resolver in `server/engine`, used by stages, probes, auth and Mode B. Order: `TRYSQUARE_CLAUDE_PATH`, then a saved setting (lands in 6.1), then PATH search honouring PATHEXT on Windows. A `.js`/`.mjs` target runs as `process.execPath <script>`, which also makes the fake CLI portable. `.cmd`/`.bat` are refused by name (no shell). Synchronous spawn throws become `StageFailedError("spawn")` and close the log stream. | - | DONE d2070a7, 3c7819d 2026-10-16: `src/server/engine/cli.ts`, used by stages, probes and auth; Mode B's printed command moves to it in 3.7, the saved setting in 6.1. A `.cmd` is not refused outright: npm's shim names the program it launches, so the resolver reads the last quoted `%dp0%` path and runs that, refusing only a batch file that names none. Proving it on Windows exposed the E6 race: a stopped stage rejected while its process still held the worktree, EBUSY on delete. Stages now settle on the process's exit, SIGTERM escalates to SIGKILL after 5s, and a stage gives up waiting 5s later. 16 resolver tests over npm's real shim texts, Windows and POSIX rules on every OS; the nvm `node.exe` case fails if the parser takes the first match. The real `claude.exe` resolved from PATH and `auth status` read through the app: signed in, subscription. Windows unit run 50 failed to 0 failed, 602 passed; 10 suites still stop at setup on W3. |
| 3.2 | W2: the system prompt moves to `--system-prompt-file` in the run directory. Measure the full command length on the real protocol before and after. | MG-3 | DONE ec0bcfd 2026-10-16: each stage call writes its system prompt beside its transcript (`<stage>.system-prompt.<id>.md`) and passes the file; probes keep their 60-character prompt inline. Measured on the sample protocol: the S3 system prompt is 15,093 characters, and the command line went from 15,270 characters to 299, counted as each argument plus 3 for quoting and separators with a 117-character prompt path; it no longer grows with the ruleset. (Re-measured with the real output contract in the D-93 review; the first figure, 11,206 to 299, used a stub contract and did not say so.) the real protocol is not on this machine. MG-3 resolved as D-91: the engine refuses a CLI below 2.1.301 by name, tested by a fake playing 2.1.71, which spawns nothing. The real CLI reads the file: a missing one fails with "System prompt file not found", spending nothing. Windows: `./verify.sh --e2e` exited 0, 787 unit and 41 browser tests. |
| 3.3 | W3, W7: the URL validator accepts Windows absolute paths (`C:\`, `C:/`, UNC refused or accepted by explicit decision in the WP); dynamic imports of paths go through `pathToFileURL`. | - | DONE d1b3277 2026-10-16: drive paths and the backslash relative forms are accepted; UNC paths, `//host` and `file://` URLs with a host are refused, because opening a share makes Windows offer the user's credentials to that host over SMB. Project names split on backslashes too. Imports in the demo and e2e setup go through `pathToFileURL`. The 10 suites that stopped at setup then ran; four failed teardown on the runtime's open database, so `closeRuntime()` closes it, and the demo closes its own. Windows: `./verify.sh --build` exited 0 with 776 passed and 6 skipped, the first green run there; `npm run demo:fixture -- --fake` exited 0, 11 of 11 found, clean files clean. |
| 3.4 | T2: e2e setup never deletes a directory the server already opened. The run directory is decided at config load (which precedes `webServer`), cleaned there, and named for the run. | 3.1, 3.3 | DONE 4ef99dd 2026-10-16: the first load of `e2e/setup.ts` creates a fresh `trysquare-e2e-*` directory, sweeps earlier ones, and records it in `TRYSQUARE_E2E_ROOT`, which workers and the web server inherit; global setup no longer deletes anything. Windows: `./verify.sh --build --e2e` exited 0, 776 unit and 41 browser tests, the first full green there; a second `npm run e2e` passed 41 again and swept the first run's directory. The interim proof rule in section 0 retires here: the local gate is green. |
| 3.5 | W4: credential helper behaviour per MG-4, proven with a private HTTPS repository on Windows. | MG-4 | DONE 28dce93 2026-10-16: the runner reads `git config --system --get-all credential.helper` once and forwards those values, in order, through `GIT_CONFIG_COUNT`, after any the user already passes that way; system config stays off, so `core.autocrlf` does not come back (asserted). Only the helper is forwarded, as decided: per-URL credential keys such as Git for Windows' `usehttppath` for Azure DevOps are not. Proven with `ls-remote` on one of the maintainer's private GitHub repositories over HTTPS: through the app runner it listed 1 branch; with the old environment it failed with "Authentication failed". Windows: `./verify.sh --e2e` exited 0, 792 unit and 41 browser tests. |
| 3.5b | D-92, added 2026-10-16 at the maintainer's request that the app install and use a local CLI, never the API: `@anthropic-ai/claude-code` 2.1.301 becomes an exact dependency; the resolver prefers its platform binary over PATH; `npm run claude -- <args>` runs the same CLI for sign-in. | - | DONE 2026-10-16: with nothing on PATH and no `TRYSQUARE_CLAUDE_PATH`, the running app answered `/api/auth` through the bundled CLI: signed in, subscription, the same `~/.claude` the VS Code extension uses. `npm run claude -- --version` printed 2.1.301; `auth status` read the same sign-in. Production audit still 0. 31 resolver tests, including the bundled-first order and the per-platform package names the CLI's own installer uses. Windows: `./verify.sh --e2e` exited 0, 799 unit and 41 browser tests. |
| 3.6 | T5: CI matrix `ubuntu-latest`, `windows-latest`, `macos-latest`, each running plain `npm ci`, `./verify.sh --build --e2e` and `npm run demo:fixture -- --fake`. Fix what macOS finds before marking DONE. | 1.4, 3.1-3.4 | DONE 29e3370, 268d918 2026-10-16: matrix with `fail-fast: false`, Git Bash on Windows, evidence uploaded per platform. verify.sh no longer depends on GNU `timeout`, absent on macOS: it falls back to `gtimeout`, then a Perl fork-and-wait watchdog (an alarm set before exec did not survive exec under Git Bash's Perl; measured). The first matrix run, 38953382312 at 29e3370, passed Ubuntu and Windows and failed two macOS unit tests, both wrong assumptions in tests (fixed 268d918). 268d918's message names that run as 39015577221, which is wrong; 38953382312 is the run. Run 38954795087 at 268d918: all three platforms green, each with 808 unit tests passing and 6 skipped, 41 browser tests, and the fake demo finding 11 of 11. |
| 3.7 | W6, E7: Mode B fixed (D-85). Files keyed by stage, batch and attempt; an answer carries the request's id so a stale file is refused by name; the launch instruction uses the resolver, the read-only flag set (`--tools Read,Grep,Glob --setting-sources user --strict-mcp-config`), `--system-prompt-file`, and no prompt in argv; one instruction per shell (PowerShell, POSIX). Driven by hand on Windows and recorded. | 3.1, 3.2 | PART 2026-10-16: done in code; the hand-drive is owed (folded into 7.4). Each call writes `<stage>[-b<n>]-<id>-prompt.md`, `-system.md` and expects `-output.json`, all named by a fresh id, so a stale file is never read rather than refused by content. (Changed by the D-95 review: a fresh id meant a resumed stage asked again at a new path, so an answer saved after a timeout was never read; files are now named by a hash of the question, a refused answer is moved aside, and the timeout message says to save and resume.) The command, for PowerShell and for bash or zsh, runs the resolved CLI from the worktree with `--add-dir` for the exchange folder, the read-only flag set, `--system-prompt-file`, and `--` before a one-sentence prompt naming the question file; no prompt text in argv. Mode B still starts no process, as PROJECT-STATE records: it resolves the CLI without running it and states the 2.1.301 requirement instead of checking it, a version check having been tried and withdrawn for spawning. Tests: batch 2 waits for its own answer with batch 1's on disk; an earlier attempt's answer is ignored; the bash and PowerShell commands each reached a stand-in CLI with every argument and the working directory intact, spaces and quotes included; the service suite runs a whole Mode B review from files. A person running one stage in a real session on Windows has not happened: it needs a terminal and spends usage. Windows: `./verify.sh --e2e` exited 0, 814 unit and 41 browser tests. |

### Phase 4: engine correctness

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 4.1 | The audit areas nobody finished (AUDIT section 10): pipeline invariant bypasses, quotation-check inputs (CRLF, including worktrees a user's global `core.autocrlf=true` converts (D-93), tabs, unicode, deleted side, renames), state-machine races, SSE listener leaks, old-database migration, hostile git inputs. Read-only pass; each confirmed finding becomes a WP row in this table before 4.2 starts. | Phase 3 | DONE 2026-10-17: a separate read-only audit, each finding proven by a run unless marked otherwise, gave sixteen findings, now rows 4.8 to 4.23 below. It also closed the item D-93 carried here: with a global `core.autocrlf=true` the worktree gets CRLF, `git status` stays clean, and the quote check matches. |
| 4.2 | E1: measure whether a chained stage runs under its own system prompt on the current CLI, then apply MG-5. The measurement spends usage. | MG-5, maintainer go on spend | TODO |
| 4.3 | E4: an indeterminate probe leaves availability unknown, as decided. | - | DONE 2026-10-16: `recordProbeOutcome` in the model repository records an indeterminate probe as its message only; the verdict and its time stand. Driven through `next start`: a model probed available through a CLI that answers, then probed through a CLI path that does not exist, came back indeterminate and still `available=true` with the same probe time, the missing-CLI message recorded. Three repository tests, one per outcome. |
| 4.4 | E5: model ids are checked against the alias law at review creation and at stage launch. | - | DONE 2026-10-17: one positive rule in `lib/models/model-id.ts`, an id carries `claude-` and a version number after it, replaces the list of bare family names, so `sonnet[1m]`, `opusplan` and `claude-fable` are refused as well as `opus`; older ids that put the version first still pass. Applied at registration, at review creation (a 400 naming the id and why), and at stage launch, where a stored alias is refused before anything spawns (the fake records no call). Windows: `./verify.sh --e2e` exited 0, 833 unit and 41 browser tests. |
| 4.5 | E6: `drain()` wired to process shutdown; a stage with no parsed `init` fails closed. (The SIGTERM to SIGKILL escalation and settling on exit landed in 3.1.) A cancel that lands after a stage started but before its process spawned is not seen by that stage, which then runs to completion; the 2026-07-30 W4 decision says the stage in flight completes, and `service.test.ts` holds that, so changing it needs its own decision entry first. A 3.1 line that killed such a stage was reverted for that reason (d2070a7, CI run 38926549014). | 3.1 | PART 2026-10-17: `drain(SHUTDOWN)` stops every run and leaves its review interrupted, resumable, with its worktree, instead of cancelled; SIGTERM and SIGINT call it from `instrumentation-node.ts`, and its aborts run before its first await, so each stage CLI is signalled before Next's own handler exits. Tested through the manager with a CLI that hangs. A stage whose CLI never sends an init event now fails as invalid output instead of passing the read-only check on an empty tool list; tested with a fake that skips it. Not driven: the signal path itself, because on Windows a SIGTERM to Node is TerminateProcess and runs no handler (children die with the parent there), so it needs a POSIX run. The cancel-before-spawn window stays as the W4 decision has it for a person's cancel; for a shutdown the stage now starts nothing (955b85b, D-95). Windows: `./verify.sh --e2e` exited 0, 835 unit and 41 browser tests. |
| 4.6 | E8: the env scrub removes only the variables measured to trigger the CLI's nested-session refusal; user configuration passes through. | 3.1 | TODO |
| 4.7 | E9: add `xhigh` if the CLI version named in MG-3 accepts it, measured without a paid call. | MG-3 | TODO |
| 4.8 | HIGH. A deleted file's base content is written to `bundle/base/<slug>/<path>` with the path as git gave it (`gitops/bundle.ts:115-121`). A tree entry named `..\..\..\..\escaped.txt` passes git and, on Windows, `path.join` writes the blob outside the data directory; enough `..` reaches a Startup folder. Every path from a diff is checked before any read or write: no `..` segment, no backslash, not absolute, and the resolved target inside its root. | - | DONE 2026-10-17: two layers. The diff parser refuses a path that is empty, absolute, names a drive, holds a backslash or NUL, or has an empty, `.` or `..` segment (`lib/git/repo-path.ts`), so the review stops with the path named before anything touches the disk; and every read or write that joins a diff or model path onto a directory goes through `insideRoot` (`lib/paths.ts`), which refuses a result outside it. One read was missed and found by the D-95 review: the file-context route joined a finding's path onto the worktree directly, and served a file outside it for an S4 finding whose path climbed out; contained since, with a test. Tests build the two attacks with git plumbing (a deleted entry named with backslashes, and a tree entry named `..`) and drive the real `buildBundle`; with both layers removed both fail. Windows: `./verify.sh --e2e` exited 0, 857 unit and 41 browser tests. |
| 4.9 | HIGH. A U+2028 or U+2029 in a hunk header fails `HUNK_HEADER` (`lib/git/diff.ts:112`, `.` does not match them), and the hunk's lines are dropped: the review completes with `totalHunks 0` over a file that added `eval(input)`. The header parses whatever the function context holds, and a line starting `@@` that still does not parse fails the review instead of vanishing. | - | DONE 2026-10-17: the header regex takes the `s` flag, so the scope text can hold U+2028 or U+2029, and a line starting `@@ ` that still does not parse fails the parse by name. Tested on real git output with each character in the scope line: the hunk keeps all its lines, including the added `eval(input)`; against the old parser both fail. A check that each hunk holds the lines its header declares was tried and dropped, because a dozen hand-written test patches declare counts git would never emit. The reason first given for dropping it, that in git output only a missed header could lose lines, was false: the D-95 review found a hunk line starting `--- ` or `+++ ` (a removed `-- comment`, an added `++ x`) was read as a file header, dropped from the hunk, or renamed the file. Headers are now read only before a file's first hunk; tested on real git output both ways. Windows: `./verify.sh --e2e` exited 0, 860 unit and 41 browser tests. |
| 4.10 | HIGH. Coverage can be met by a finding that examined nothing: a finding outside every hunk counts for hunk 0 (`pipeline.ts:970`), a sweep hit marked finding attaches to any finding in the file (`pipeline.ts:941-949`), and coverage still holds after verification kills that finding. A finding covers only the hunk containing it, a sweep hit only a finding on its line, and S6 counts only findings that survived. | - | DONE 2026-10-17: D-96 and D-97. A finding accounts for the hunks its line range overlaps and no other; one elsewhere in a changed file is kept but accounts for nothing. A sweep hit called a finding needs a finding whose range contains its line, or the stage is refused. The S3 prompt states both rules. Tests: a finding at line 11 standing in for a hunk at lines 3 to 9, and a hit at line 2 claimed by a finding at line 3, both passed the old code and are refused now; a range reaching into a hunk from above still accounts for it, and a finding in a file outside the change set is still refused. Windows: `./verify.sh --e2e` exited 0, 879 unit and 41 browser tests. The third part was decided by the maintainer as D-97: a hunk or hit whose every finding was refuted stays accounted for and is said. The coverage report counts them, the statement of what was examined in the report and on the page gives the count, and the run detail lists every refuted finding with its reason. Tests: a hunk whose one finding was killed counts once, a hunk with one finding killed and one standing counts nothing while the hit on the killed one counts; the journey refutes one scripted finding and finds the sentence above the fold, the finding and its reason under Run detail, and the count, not the finding, in the exported report. The HTML report and the page now print the markdown's own sentence, which had drifted (with no sweep hits the HTML said 0 were each dispositioned). Windows: `./verify.sh --e2e` exited 0, 892 unit and 41 browser tests. |
| 4.11 | MEDIUM. S4 finding paths are not reconciled against the ledger (`pipeline.ts:521-534`): `app/../../outside-secret.txt` was verified with its contents quoted into the report. The reads are contained since 4.8 and the D-95 fixes, so such a finding is now killed as unreadable; what remains is reconciling S4 paths so a finding outside the change set is refused at the stage, not left for verification. | 4.8 | DONE 2026-10-17: D-98, which corrects this row: S4 must keep a finding outside the change set, since the dependent of removed code usually is one (the seeded deleted-module-live-caller). What it refuses, striking the answer, is a path that cannot name a file in the review: unsafe by the 4.8 rule, in no repository of the review, or naming a repository and no file. The service passes the repositories it checked out. Tests: the audit path app/../../outside-secret.txt, an unknown repository and a bare repository name are refused and fail the old code; a file outside the change set, and a file in a linked repository that changed nothing, are kept. The service passing its repositories is covered by the type, not by a test: no fixture has a linked repository without changes. Windows: `./verify.sh --e2e` exited 0, 897 unit and 41 browser tests. |
| 4.12 | MEDIUM. A verdict's line range is not tied to its candidate's, and the finding is moved to it (`pipeline.ts:629, 641-646`): a candidate at line 500 was verified by quoting line 1. A verdict must overlap the candidate's range, or it is killed. | - | DONE 2026-10-17: D-99. A verified verdict whose lines miss the candidate's is killed with both ranges named, counted with the quotation-check kills, and the finding keeps its own lines; one that overlaps may still correct the range. The S5 prompt says so. Tests: a finding at line 2 verified by an exact quotation of line 1 passed the old code and is killed now; a quotation of lines 2 to 3 for a candidate at line 2 is still verified and keeps the corrected range. Windows: `./verify.sh --e2e` exited 0, 902 unit and 41 browser tests. |
| 4.13 | MEDIUM. A finding in a deleted file is always killed, because the quote check reads only the worktree (`pipeline.ts:621-626`), so the class the deletion stage exists for cannot survive verification. Quotes on the deleted side are checked against the base contents. | - | DONE 2026-10-17: D-106. The quotation of a finding in a deleted file is checked against the bundle's copy of it; S4 sees that copy with numbered lines, and S5 gets it in the prompt, since S5 reads only the worktree: once per file, in a deletedFiles map beside the candidates (D-110; first once per candidate, which a review found grew the prompt by the whole file for every finding). Tests: a finding at line 2 of a deleted file, quoted exactly, was killed as unreadable and is verified now; a wrong quotation is still killed, by the quotation check; both prompts carry the numbered lines. Windows: `./verify.sh --e2e` exited 0, 915 unit and 41 browser tests. |
| 4.14 | MEDIUM. A repository whose `.gitattributes` renormalises committed CRLF files shows ` M` in `git status` straight after checkout, so `assertWorktreeClean` (`worktree.ts:242-245`) fails every such review at the end, after all stages are paid, and again on every resume. The check compares against the status recorded at checkout, not against a clean status. | - | DONE 2026-10-17: D-107. The baseline holds the status at checkout and a hash of each file it names, so a rewrite of an already-changed file still fails; it is kept outside the worktree, and a worktree without one is checked out again. Reproduced with `* text eol=lf` over a CRLF commit (`text=auto` does not trigger it). Tests on real git: a fresh checkout reads ` M crlf.txt` and the strict check refuses it; against its baseline it passes, and a rewrite of that file or a new file fails. A whole review of such a repository failed at the end on the old code and completes now, noting the changed checkout; a write to the file during the run still fails it. Windows: `./verify.sh --e2e` exited 0, 921 unit and 41 browser tests. |
| 4.15 | MEDIUM. A user's global `diff.external` replaces the diff with tool output, the parser finds no `diff --git`, and the review covers nothing (`repo.ts:131-145`); `diff.noprefix` would mangle top-level `a/` and `b/` folders. The diff is taken with `--no-ext-diff`, explicit prefixes and no colour, and a change set that parses empty while the commits differ is refused. | - | DONE 2026-10-17: D-108. The diff is taken with --no-ext-diff, --no-textconv and --src-prefix=a/ --dst-prefix=b/ (not --default-prefix, which git added in 2.41; the explicit flags work on far older git, and no minimum git version is recorded), and refused unless it names exactly the files `git diff --name-only` lists, which also catches a diff that lost only some files. The bundle and the preflight both read it that way. Tests on real git under a global config with diff.external, noprefix and mnemonicPrefix: the diff is git's own and every changed file comes through; without the flags both tests fail. A mismatch in either direction is refused by name. Windows: `./verify.sh --e2e` exited 0, 926 unit and 41 browser tests. |
| 4.16 | MEDIUM. Seeding the ledger is not one transaction (`ledger.ts:55-92, 165-189`), and resume skips seeding if any ledger file exists (`pipeline.ts:194`), so a crash between files and sweep hits loses the hits silently. Seeding becomes one transaction. | - | DONE 2026-10-17: D-109. Files, hunks and sweep hits are seeded in one transaction, after the sweep has run, and a resume over a ledger whose hit count differs from the sweep's stops by name instead of reading the missing hits as a clean sweep. Tests: a hit the database refuses leaves nothing behind, and the test fails with the transaction removed; a ledger with its files and no hit stops the resume. Windows: `./verify.sh --e2e` exited 0, 929 unit and 41 browser tests. |
| 4.17 | MEDIUM. Two verdicts for one candidate throw `IllegalTransitionError` outside `rejecting()` (`pipeline.ts:603-616`), so the stored S5 answer replays and fails on every resume. Duplicate refs are refused at reconciliation, which invalidates the checkpoint. | - | DONE 2026-10-17: D-112. Two verdicts for one candidate, by the candidate the label resolves to, refuse the S5 answer inside the check that strikes it. Tests: C1 twice, and C1 with c1, were each an illegal transition left checkpointed and are refused with the answer struck now; a verdict for no candidate still leaves its candidate an open question. Windows: `./verify.sh --e2e` exited 0, 937 unit and 41 browser tests. |
| 4.18 | LOW-MEDIUM. A second server on the same data directory marks the first one's running review interrupted (`manager.ts:93`), and two can migrate at once. One server per data directory, enforced by a lock. | - | DONE 2026-10-17: D-113. server.lock names the server's process and is taken before the database opens; a dead or unreadable holder is taken over, a live one refuses, and the refused server prints why and exits 1. Tests: a fresh lock, re-taking one's own, a live holder refused by name, a dead holder and a cut-short file taken over, release leaving a newer holder's lock alone, and the runtime refusing before the database file exists. Driven for real: two production servers on one directory (the first kept answering, the second exited 1 naming it), next dev working with the lock, and next build not opening the data directory. Windows: `./verify.sh --e2e` exited 0, 944 unit and 41 browser tests. |
| 4.19 | LOW. `start()` on a review that cannot run returns "running" and fails later (`manager.ts:123-139`). It is judged before the claim. | - | TODO |
| 4.20 | LOW. The events stream for an unknown review gives 500, not 404 (`stream.ts:170`). Folded into 5.6. | 5.6 | TODO |
| 4.21 | LOW. The quote check kills some valid quotes: a BOM file quoted across lines, NFD text quoted in NFC, tab against space indentation when nested (`quote-match.ts:25-45, 61`). None lets a wrong quote pass. | - | TODO |
| 4.22 | LOW. A tag with a branch's name wins in `rev-parse` and `merge-base` (`repo.ts:94-107`), which can fake the merged signal. Branch names are resolved as `refs/heads/`. | - | TODO |
| 4.23 | LOW. Smaller gaps: confirm and dismiss do not check the review's status; SSE ignores backpressure; the symbol-verdict backing check accepts loose path matches (`pipeline.ts:895-898`); raising `maxConcurrentReviews` starts nothing until a run ends; LFS content and submodule pointers are passed over unrecorded. Each fixed or recorded as accepted. | - | TODO |
| 4.24 | LOW-MEDIUM. Found while fixing the D-103 review: the scoreboard's invention rate and the demo's "discarded quotes" count every killed finding, including those verification refuted on judgment, while both are labelled as kills by the quotation check (`scoreboard.ts:127-172`, `page.tsx:275-281`, `demo-fixture.ts:329`). Count only mechanical kills, which needs the kind of kill recorded on the finding. | - | TODO |
| 4.25 | MEDIUM. Found in the D-110 review: a typechange (a symlink becoming a file, or the reverse) parses as a deleted file and an added file at one path. The ledger holds two rows the pipeline can only ever find the first of (`ledgerFiles.find` by path), so every review of such a change fails at S6 after every stage is paid for; and the deleted side's base copy is keyed by the same path, so a finding in the new file is quote-checked against the old link target. Reproduced. | - | TODO |
| 4.26 | LOW. Found in the D-110 review: the end-of-review worktree check reads `git status` without `--ignored`, so a write to a gitignored path is not caught. Reproduced. | - | TODO |
| 4.27 | LOW. Found in the D-110 review: the diff parser trims trailing spaces from `---` and `+++` paths, so a file named `notes ` is read as `notes`. Since D-108 such a change set is refused rather than reviewed under the wrong name. Reproduced. | - | TODO |

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
| 6.1 | Settings gains the CLI path (the first non-numeric setting key), the resolved path and version, and distinct states: not found, cannot run (with the real error), signed out, per-token billing (a warning, not a block, D-92), subscription. E2. | 3.1, 3.5b | TODO |
| 6.2 | The new-review screen runs the free checks (resolve, `--version`, `auth status`) before Start and blocks with the reason. | 6.1 | TODO |
| 6.3 | Signed out: show the command to run, `npm run claude -- auth login` from the project directory (3.5b), and a configured path's own command when one is set. Nothing stores a token. | 6.1, MG-7 | TODO |

### Phase 7: decided work, records, verdicts

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| 7.1 | D1 per MG-8: build D-51 project editing, the last-used model default, and the T19 dead-export gate, one diff each. | - | TODO |
| 7.2 | R1 records pass: PROJECT-STATE, RUNBOOK and README name the supported OSes, the minimum CLI version and how to check sign-in; 06-MODELS re-verified against the current CLI; the stale plan rows and inbox misfiles named in both audits; the volatile "proven on this machine" fact moves out of `CLAUDE.md` into docs. | Phases 1-6 | TODO |
| 7.3 | Fresh real-engine run on the 11-defect fixture on Windows, evidence captured, for the G1 verdict. Spends usage. | Phases 3-4, maintainer go | TODO |
| 7.4 | The maintainer's own real review on Windows, for the G2 verdict, plus one stage run by hand in Mode B from the printed command (owed by 3.7). Spends usage. | 7.3 | TODO |

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
- **MG-3: minimum CLI version. RESOLVED (a), D-91: 2.1.301.** `--system-prompt-file` and
  `--system-prompt-snapshot` are accepted by 2.1.301; whether 2.1.71 has
  either is unknown. (a) Require the oldest version proven to have both,
  checked by the resolver at `--version`. (b) Feature-detect per flag.
  Recommended: (a); one version line in the README is checkable, a matrix
  of feature probes is not.
- **MG-4: private HTTPS clones on Windows. RESOLVED (a), D-91.** (a) Keep `GIT_CONFIG_NOSYSTEM`
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
