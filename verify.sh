#!/usr/bin/env bash
#
# The single gate. "Verified" in any doc, commit, or status message means
# exactly one thing: ./verify.sh exited 0.
#
# Two rules this script exists to enforce:
#   1. All gates run in one command, so none can be quietly skipped.
#   2. A step that prints a runtime error but still exits 0 is a failure.
#      Output is captured and scanned for the markers below; harness errors
#      are never dismissed as noise. A hang is a failure, not a wait.
#
# Usage: ./verify.sh [--build] [--e2e]

set -uo pipefail
cd "$(dirname "$0")" || exit 1

WITH_BUILD=0
WITH_E2E=0
for arg in "$@"; do
  case "$arg" in
    --build) WITH_BUILD=1 ;;
    --e2e) WITH_E2E=1 ;;
    *)
      echo "unknown flag: $arg" >&2
      echo "usage: ./verify.sh [--build] [--e2e]" >&2
      exit 2
      ;;
  esac
done

# Deliberately narrow. A gate that cries wolf gets ignored.
ERROR_MARKERS='SyntaxError|ReferenceError|TypeError:|ERR_MODULE_NOT_FOUND|Cannot find module|Unhandled [Ee]rror|Unhandled [Rr]ejection|FATAL ERROR|node-gyp rebuild failed'

STEP_TIMEOUT="${VERIFY_STEP_TIMEOUT:-900}"
FAILED=()

# GNU timeout is not on macOS; Homebrew's coreutils names it gtimeout, and
# Perl ships with the system. Exit 124 means "timed out" whichever runs it,
# because the hang branch below reads that code.
with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
  else
    # A watchdog that outlives the command, rather than an alarm set before
    # exec: under Git Bash's Perl the alarm did not survive exec (measured
    # 2026-10-16, a 3s sleep under a 1s limit exited 0).
    # The command runs in its own process group and the whole group is
    # signalled, as GNU timeout does: a grandchild left holding the output
    # pipe kept $(...) waiting after the child was killed (an 8s background
    # sleep under a 2s limit took 8s; measured 2026-10-17).
    perl -e '
      my $limit = shift;
      my $pid = fork();
      exit 127 unless defined $pid;
      if ($pid == 0) { setpgrp(0, 0); exec @ARGV or exit 127; }
      local $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 2; kill "KILL", -$pid; exit 124; };
      alarm $limit;
      waitpid($pid, 0);
      alarm 0;
      exit(($? & 127) ? 128 + ($? & 127) : $? >> 8);
    ' "$seconds" "$@"
  fi
}

run() {
  local name="$1"
  shift
  echo
  echo "--- ${name} ---"
  local output status
  output=$(with_timeout "$STEP_TIMEOUT" "$@" 2>&1)
  status=$?
  printf '%s\n' "$output"

  if [ "$status" -eq 124 ]; then
    echo "GATE FAILED: ${name} timed out after ${STEP_TIMEOUT}s (a hang is a failure)"
    FAILED+=("$name (timeout)")
    return
  fi
  if [ "$status" -ne 0 ]; then
    echo "GATE FAILED: ${name} exited ${status}"
    FAILED+=("$name (exit ${status})")
    return
  fi
  if has_error_marker "$output"; then
    echo "GATE FAILED: ${name} exited 0 but printed a runtime error marker"
    FAILED+=("$name (error in output despite exit 0)")
    return
  fi
  echo "ok: ${name}"
}

# A here-string, not `printf | grep -q`: grep -q exits at its first match,
# printf then dies of SIGPIPE, and under pipefail the pipeline reports that
# death, so a marker early in a large output read as a pass. Measured
# 2026-10-16: unflagged from about 100KB up, in 20 runs of 20.
has_error_marker() {
  grep -Eq "$ERROR_MARKERS" <<<"$1"
}

# The scan proves itself on every run, at the size that once broke it: a gate
# that cannot see an error is silent in exactly the way it exists to prevent.
check_scanner() {
  local filler marker='TypeError: scanner self-check'
  printf -v filler '%*s' 300000 ''
  if ! has_error_marker "${marker}"$'\n'"${filler}" ||
    ! has_error_marker "${filler}"$'\n'"${marker}" ||
    has_error_marker "${filler}"; then
    echo "GATE FAILED: the error-marker scan failed its own self-check"
    FAILED+=("marker scan self-check")
  fi
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "GATE FAILED: required tool '$1' is not on PATH"
    FAILED+=("missing tool: $1")
    return 1
  fi
}

# A missing tool must fail loudly. `rg` is deliberately not used anywhere in
# this gate: it is a shell function from an editor integration on this
# machine, not a binary, so it does not exist in a non-interactive script.
require_tool node
require_tool npm
# The git layer's tests, the seeded fixture, and the e2e setup all shell out
# to git. Without this, a missing git surfaces as an opaque test failure, and
# the nothing-hidden gate skips itself rather than failing.
require_tool git

check_scanner

run "Lint" npm run --silent lint
run "Format check" npm run --silent format:check
run "Type check" npm run --silent typecheck
run "House style" node scripts/check-style.mjs
run "No private material" node scripts/check-no-private.mjs
run "Nothing hidden from git" node scripts/check-nothing-hidden.mjs
run "Unit tests" npm run --silent test

# The browser suite starts its server with `npm run start`, which serves
# whatever was last built. Without a build first, --e2e passes against stale
# output: green, and blind to the change being verified. That is the false
# positive this project refuses, so asking for e2e asks for the build.
if [ "$WITH_E2E" -eq 1 ] && [ "$WITH_BUILD" -eq 0 ]; then
  echo "note: --e2e builds first, because the browser suite serves the built output."
  WITH_BUILD=1
fi

if [ "$WITH_BUILD" -eq 1 ]; then
  run "Production build" npm run --silent build
fi
if [ "$WITH_E2E" -eq 1 ]; then
  run "End to end" npm run --silent e2e
fi

echo
if [ ${#FAILED[@]} -ne 0 ]; then
  echo "FAILED: ${#FAILED[@]} gate(s)"
  for f in "${FAILED[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

# The pass message states what it did not prove.
SKIPPED=""
[ "$WITH_BUILD" -eq 0 ] && SKIPPED="${SKIPPED} no production build;"
[ "$WITH_E2E" -eq 0 ] && SKIPPED="${SKIPPED} no e2e;"
if [ -n "$SKIPPED" ]; then
  echo "VERIFIED: all gates passed (${SKIPPED% } run ./verify.sh --build --e2e before shipping)."
else
  echo "VERIFIED: all gates passed, including build and e2e."
fi
exit 0
