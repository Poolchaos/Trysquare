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

Trysquare runs entirely on your own machine. Its only server listens on
127.0.0.1, and there is no account system and no telemetry. That rules out
whole categories of vulnerability, but it leaves some that matter:

- **Code execution from a reviewed repository.** Trysquare clones and reads
  repositories that may be untrusted. Anything that lets a reviewed repository
  execute code, escape its worktree, or write outside the data directory is in
  scope and serious. The one exception is a project's own checks, which run
  its install, tests and e2e only when you have turned them on for that
  project and given the commands; see the trust model below. A way for them
  to run without that, or outside their throwaway copy, is in scope.
- **Prompt injection from reviewed content.** A repository under review could
  contain text crafted to manipulate the model, for example to suppress
  findings or to try to widen its own permissions. Trysquare is designed to
  limit the blast radius by giving review stages a read-only tool allowlist and
  by not loading a reviewed repository's own agent configuration. Ways around
  those controls are in scope.
- **Writes into a reviewed repository.** The app must never modify code under
  review. Any path that does is a bug of the highest severity.
- **Leaking your code or review results off the machine.** Any unexpected
  outbound transmission by the app is in scope; what a project's own checks
  do, once you turn them on, is that project's code (see the trust model).
- **Reaching the app from a web page.** A page in your browser can address
  127.0.0.1 directly or rebind its own domain to it. The server refuses
  requests addressed to anything but this machine and API requests sent by
  another site. A way past that, a request the app acts on that a page you
  merely visited sent, is in scope and serious.
- **Exposure of credentials.** The app relies on the credentials your Claude
  Code CLI and your git already hold, and should never read, copy, or log
  them. It refuses a repository address carrying a password or token (and,
  on http or https, any user name, which can be a token), and takes one
  held by a project added before that out of every project and git error
  it serves. Run notes written before then may still hold one.

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

Turning on a project's own checks is the exception, and a deliberate one: each
review of that project then runs the commands you gave, through the system
shell (cmd.exe on Windows, /bin/sh elsewhere) and as you, in a throwaway copy of
the branch under review. The branch's own code runs with your privileges, as it
would if you ran its tests yourself: it can read your files and credentials,
including the ones above, and reach the network. The app withholds only its own
and Claude's environment variables from it. So turn the checks on only for a
repository you would run yourself. They are off for every project until you
turn them on, and the New review pre-flight names the commands before Start.
