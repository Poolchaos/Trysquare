# Email a review's result plan

Status: IN BUILD: the addresses on Settings are kept (EM-2a, 2026-11-21);
its sender is blocked on the maintainer (section 4). Written 2026-11-20,
for D-251's scope (CP-12): "it should do it's thing and email a user their
response". Planned under the architecture standard: problem, platform,
options, pre-mortem, an independent review. That review signed off on no
option. The maintainer answered part of section 4 the same evening (CG-E1
below); what does not depend on the sending account is built first.

## 0. How to work this plan (non-negotiable)

This document is written for an AI driver to execute work package by work
package. It plans; it does not code. All `CLAUDE.md` rules apply on top of
this plan, in particular: one feature at a time, prove before done. A
session commits and pushes before it hands over (`SESSION-HANDOVER.md`).

Definition of done for every work package:

- One WP per diff; no batching.
- `./verify.sh --e2e` exits 0, run unpiped, and every test a WP adds is
  first shown failing.
- No test sends a real message: the mailer in tests is a stand-in that
  records what it was handed, as `fake-claude.mjs` stands in for the CLI.
- Anything a person sees is shot and graded A to D.
- The README and `SECURITY.md` change in the same diff as the first code
  that can send.
- The WP row below is marked DONE with the commit hash, in the same session.

No real message is sent by an AI session: a send to an outside address is
the maintainer's to make or to approve, each time.

## 1. Goal and non-goals

**The problem.** A person starts a review of a branch and leaves the
machine. When the review has a result, a person they named should have it
in their inbox without anyone returning to the app.

**Constraints.** The app runs on one person's machine, with no hosted part
and no account of its own. Today nothing leaves the machine through the
app's own code but what the CLI sends the model and what git fetches
(README), and the app holds no credential of its own (`SECURITY.md`). A
result quotes the reviewed code, which may be private. Linux first, then
macOS (D-245).

**Today's numbers.** Messages sent: none. One person, one review at a time
by default, a recorded real run taking 275 to 346 seconds (`GATES.md`):
a few messages a day at most, tens at ten times that. A message's size is
not measured (spike S4).

**Decided by the session (D-264), reversible by the maintainer:**

- Which result is mailed is chosen as a review is started. "When I have
  completed it" mails the report, and is the default. "As the run ends"
  mails what the run found: the findings two verifiers proved, the open
  questions apart, and first of all the words that no person has decided
  any of it. The review still waits for its decisions, and completing it
  mails the report too. The README's "Only what you confirm is reported as
  a finding" changes with that second kind, in the same diff.
- Where a result goes is set in the app (the maintainer, 2026-11-20:
  "users should be able to configure what email it should go to in the
  app"): addresses kept on Settings, one of them the default, and the
  address picked or typed for a review beside Start. It is never read
  from a repository: a commit's author is whoever wrote the commit.
- The message is sent from a mailbox set up for this alone (the
  maintainer: "we can setup an email on my account or something"), so a
  password that leaks reaches that mailbox and nothing else of his.
  Recommended path, to be graded again at EM-0: the app sends to that
  mailbox's server itself (B), the password given in the server's
  environment, never stored, kept from every process the app starts.
- One message per review and kind, to one address. Nothing retries by
  itself. A send that fails is said on the review's page and in Needs you.

**Non-goals.** Mail to several people. A mail-sending company's API,
unless both other paths die (S6). Signing in to a provider with OAuth,
which needs an app registered with that provider.

## 2. The options, and how the reviewer graded them

The packet the reviewer was given named four, without a preference. Its
grades, A to F by the standard's rubric, 2026-11-20:

| Gate | A: the machine's mail program (`sendmail`) | B: the app speaks SMTP (nodemailer) | C: a mail company's API | D: by hand (`mailto:`) |
| --- | --- | --- | --- | --- |
| Platform fit | B | C | C | A |
| Right-sized | A | A | C | A |
| Failure modes surfaced | C | C | C | D |
| Secure and compliant | C | D | D | A |
| Operable | C | B | C | C |
| Costed | C | C | F | B |
| Evidenced and current | C | C | C | B |

Sign-off: none. Its refusal, word for word: "I would refuse to sign off on
this until the maintainer has named the mail account or server the
messages go through, a timeboxed spike has put one real message from the
candidate path into an outside inbox from this machine and from a Mac with
the failed case visible to the app, the packet says which of the two
result states is mailed, and it shows how the credential every working
path needs (in /etc/dma/auth.conf for A, in the server's environment for
B) is kept from the git, Claude CLI and project-check processes the app
starts."

What it found, that changes the options:

- A does not remove the credential, it moves it: a mail agent that relays
  needs a password in its own file (`/etc/dma/auth.conf` here), set by
  root. Without a relay a laptop delivers directly, and Google's rules for
  anyone sending to Gmail (SPF or DKIM, a valid PTR record, TLS) mean such
  mail "might be marked as spam or rejected"
  (https://support.google.com/a/answer/81126, read by the reviewer
  2026-11-20). `dma` retries from 5 minutes and gives up after 5 days
  (upstream `dma.h`), the bounce going to a local mailbox.
- B is a password sign-in to a third party, the rubric's D, unless the
  server is the maintainer's own or gives a send-only credential.
  Microsoft 365 turns password sign-in for sending off by default at the
  end of December 2026
  (https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835,
  post of 2026-01-27). Personal Gmail limits a day to 500 messages
  (https://support.google.com/mail/answer/22839), Workspace to 2,000
  (https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app),
  and an app password needs 2-Step Verification and "aren't recommended"
  (https://support.google.com/mail/answer/185833); all read 2026-11-20.
  `nodemailer` is 10.6.1, MIT-0, no dependencies, Node 20 or later
  (https://registry.npmjs.org/nodemailer/latest, 2026-11-20).
- On this machine: `/usr/sbin/sendmail` is `dma` 0.13, on Linux Mint 22.3;
  its configuration is readable by root and group `mail` only; its queue
  is empty and `mailq` is readable by the user. The reviewer inferred from
  file dates that no relay credential is set. Node's core has no mail
  module.

Added to the pre-mortem from its review: accepted by the server and filed
as spam; the password inherited by git, the CLI or a project's own
commands; the password sitting in a `.env` file because Next.js loads
those; a local program changing the server's host in Settings; which
sender address a provider allows; the quoted code holding a secret; no
`sendmail` on a colleague's machine.

## 3. Work packages

| WP | Scope | Blocked on | Status |
| --- | --- | --- | --- |
| S1 | Spike, the maintainer's: one message from this machine's `sendmail` to an outside inbox of his, as it is set up today (section 4). Kill: not in the inbox within 10 minutes without a credential added under `/etc/dma`. | the maintainer | TODO |
| S3 | Spike, with his go: the server he names, through `nodemailer` in a scratch folder: `verify()`, one send with `requireTLS`, one wrong password. Kill: Microsoft 365, or only the account's own password. | CG-E1 | TODO |
| S4 | Spike, the session's: the fixture's report built as the message (text and HTML parts), its bytes measured against the named server's size limit, cited. No send. | - | MEASURED 2026-11-21, the named server's limit open until CG-E1. The report the browser suite exports for the seeded fixture on the fake engine, 8 confirmed findings (`e2e/journey.spec.ts`, read from that run's `data/exports/`): 3,401 bytes as markdown, 6,180 as HTML, 9,581 for both parts, about 13 KB once base64 adds a third, before headers. Every SMTP server must take a message of at least 64K octets (RFC 5321 section 4.5.3.1.7, https://www.rfc-editor.org/rfc/rfc5321.txt, read 2026-11-21), so this report is about a fifth of the least a server may allow. Not measured: a paid run's report, whose findings a model words at greater length; no paid run's evidence is on this machine (`GATES.md`). So size does not shape the message at this scale, and EM-1 does not wait on the limit; a provider's own limit is cited once it is named. |
| S5 | Spike, the session's: what a child process inherits. | - | DONE 2026-11-20, read in the code: the CLI gets a closed list (`buildChildEnv`, `lib/engine/command.ts`), so no other variable reaches it; a project's own commands lose every `TRYSQUARE_` variable (`projectCommandEnv`, `lib/projects/command-env.ts`); git gets the server's whole environment (`gitEnv`, `server/gitops/run.ts`), so a mail password would reach git, the person's credential helpers and any global hook. EM-3 names the password `TRYSQUARE_`, takes it out of git's environment and holds all three by a test. |
| EM-0 | The decision: the path, from S1 to S5, graded again by a fresh reviewer, logged in `DECISIONS.md`. Fallback order: B on a server that gives a send-only credential or is his own; then A with a relay he sets as root; then S6, one mail company researched in full. | S1, S3, S4, S5 | TODO |
| EM-1 | The message, pure: subject, text and HTML from a report, and the as-the-run-ends kind with its first lines. Header values refused on a line break. The same whichever path sends it. Lands in the same diff as its first caller in `src/` (EM-3): the dead-export gate fails a module only its tests reach (`scripts/check-dead-exports.mjs`), found 2026-11-21. | S4 | TODO |
| EM-2 | Where results go, on Settings: the addresses kept, one the default, each checked as one address with no line break; a card that says plainly that no mail account is set up yet and nothing is sent, until EM-3. The record: the address and the kind on a review, a send's row written before the attempt (review, kind, address, state, the mailer's words), at most one automatic send per key. A stored address is deleted with its review and from Settings by hand. | - | PART 2026-11-21 (D-286). Built, as EM-2a: the addresses on Settings, in a card that says no mail account is set up yet and nothing is sent. The `resultAddresses` setting keeps up to ten, one a line, the first the default (`lib/settings/result-addresses.ts`); a line that is not one address (a name with it, two in one, a line break, no domain) is refused in words beside the field, the text kept as typed. Still TODO, as EM-2b: the record on a review, the address and the kind and a send's row, which needs a migration and is built with the sender it serves (EM-3). |
| EM-3 | The sender module, the only code that sends, behind one seam with a stand-in for tests; the password, if the path has one, read as a message is sent, never stored, never passed to a child (taken out of git's environment, S5), cut from every error. The RUNBOOK says to give it in the shell that starts the server: Next.js also reads a `.env` file in the app's folder, and the app cannot tell which a variable came from, so that file is named as the place not to keep it. Settings: the path's status and "send a test message". `npm run doctor` gets a line. | EM-1, EM-2 | TODO |
| EM-4 | The screens: the address and the kind beside Start, with the words that the result quotes the code; the send's state on the review's page; a failed send in Needs you. README, `SECURITY.md`, RUNBOOK (the three failures) in the same diff. | EM-3 | TODO |
| EM-5 | The maintainer's own proof: a real review, left alone, in his inbox. | EM-4 | TODO (maintainer) |
| S2 | macOS: what `sendmail` is there and the same send, on a colleague's Mac. After Linux is done (D-245). | EM-5 | TODO |

## 4. Decision gates (maintainer)

- **CG-E1: which mail account or server the app may send through.**
  PART-ANSWERED 2026-11-20: a mailbox of his, set up for this. Still to
  know: its provider (Gmail, Outlook, his own domain), since each takes a
  different sign-in (an app password with 2-Step Verification on Gmail;
  Microsoft turns password sign-in for sending off by default at the end
  of December 2026).
- **CG-E2: S1, a real message.** He runs it, since it sends mail from his
  machine to an address of his:

  ```bash
  TO='<an outside address of yours>'
  printf 'To: %s\nSubject: trysquare relay test\n\nSent by this machine.\n' "$TO" | /usr/sbin/sendmail -i -- "$TO"; echo "exit $?"
  mailq
  ```

  Then: did it arrive, in the inbox or in spam, and what `mailq` printed.
- **CG-E3: the second kind of message** (as the run ends, undecided
  findings), decided by the session in D-264. His to reverse.

## 5. Review cadence

A fresh reviewer grades the options again at EM-0, and a structured review
pass runs after EM-3 and before EM-5.
