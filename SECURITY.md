# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub's advisory form:
<https://github.com/Poolchaos/Trysquare/security/advisories/new>

Include what you did, what happened, and why you believe it is a security
issue. A proof of concept helps. You will get an acknowledgement, and the fix
and disclosure will be handled in the advisory.

This is a small project maintained by one person, so please allow reasonable
time for a response.

## What is in scope

Trysquare runs entirely on your own machine. There is no server, no account
system, and no telemetry. That rules out whole categories of vulnerability, but
it leaves some that matter:

- **Code execution from a reviewed repository.** Trysquare clones and reads
  repositories that may be untrusted. Anything that lets a reviewed repository
  execute code, escape its worktree, or write outside the data directory is in
  scope and serious.
- **Prompt injection from reviewed content.** A repository under review could
  contain text crafted to manipulate the model, for example to suppress
  findings or to try to widen its own permissions. Trysquare is designed to
  limit the blast radius by giving review stages a read-only tool allowlist and
  by not loading a reviewed repository's own agent configuration. Ways around
  those controls are in scope.
- **Writes into a reviewed repository.** The app must never modify code under
  review. Any path that does is a bug of the highest severity.
- **Leaking your code or review results off the machine.** Any unexpected
  outbound transmission is in scope.
- **Exposure of credentials.** The app relies on the credentials your Claude
  Code CLI already holds and should never read, copy, or log them.

## What is out of scope

- Vulnerabilities in Claude Code, Node, or other upstream software. Report
  those to the relevant project.
- Advisories in development-only dependencies that are not reachable from the
  running application. Known accepted ones are recorded in
  [docs/DECISIONS.md](docs/DECISIONS.md) with the reasoning.
- Anything that requires an attacker to already control your machine or your
  user account.

## A note on the trust model

Reviewing a repository means reading whatever is in it. Treat a review of an
untrusted repository with the same caution as opening it in your editor. If you
find a way that reading a repository turns into something more than reading, we
want to hear about it.
