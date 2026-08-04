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

run() {
  local name="$1"
  shift
  echo
  echo "--- ${name} ---"
  local output status
  output=$(timeout "$STEP_TIMEOUT" "$@" 2>&1)
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
  if printf '%s' "$output" | grep -Eq "$ERROR_MARKERS"; then
    echo "GATE FAILED: ${name} exited 0 but printed a runtime error marker"
    FAILED+=("$name (error in output despite exit 0)")
    return
  fi
  echo "ok: ${name}"
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

run "Lint" npm run --silent lint
run "Format check" npm run --silent format:check
run "Type check" npm run --silent typecheck
run "House style" node scripts/check-style.mjs
run "No private material" node scripts/check-no-private.mjs
run "Nothing hidden from git" node scripts/check-nothing-hidden.mjs
run "Unit tests" npm run --silent test

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
