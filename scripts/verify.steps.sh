# Your project's gate steps: build, test, smoke — whatever proves the work.
# Sourced by scripts/verify.sh, which defines `step`, `mode`, `LOGS`, and the
# pass/fail footer around this file, so use those rather than redefining them.
#
# This file is yours. The harness installs it once and never compares or
# overwrites it — `harness update` stays silent about it, and scaffolding fixes
# still arrive in scripts/verify.sh. Keep every check going through `step
# <name> <cmd...>`: it swallows the log and prints one line, which is the whole
# point of the gate.

# The app's gate: types, lint, the production build, then the unit tests.
# Every command is a package.json script, so `pnpm <name>` by hand runs exactly
# what the gate runs.

step "typecheck" pnpm -s typecheck
step "lint" pnpm -s lint
step "build" pnpm -s build

if [ "$mode" != "--quick" ]; then
  # --run: Vitest watches when stdin is a terminal, and the gate would never exit.
  step "tests" pnpm -s test --run

  # Vitest's summary line, e.g. "Tests  12 passed (12)" — "ok" alone can't tell
  # a green suite from one that ran nothing.
  if [ -f "$LOGS/tests.log" ]; then
    grep -oE "[0-9]+ (passed|tests?)[^.]*" "$LOGS/tests.log" | tail -1 | sed -e 's/^/        /'
  fi
fi

if [ "$mode" = "--full" ]; then
  # Needs a browser: route smoke tests and the golden-hour / night captures,
  # written to /tmp/fol-*.png where scripts/review.sh collects them.
  # The HTML report would otherwise open and block on the first failure.
  step "e2e" env PW_TEST_HTML_REPORT_OPEN=never pnpm -s test:e2e
fi
