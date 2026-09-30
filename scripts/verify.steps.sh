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

# Through corepack, which honors package.json's packageManager pin; a bare
# `pnpm` on PATH can be whatever a Node version manager left behind.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM=(corepack pnpm run)

step "typecheck" "${PNPM[@]}" typecheck
step "lint" "${PNPM[@]}" lint
# three and R3F stay out of the initial module graph (D-047); the walk starts
# at index.html's module scripts and treats dynamic import() as the lazy boundary.
step "ssr-boundary" "${PNPM[@]}" check:ssr
step "build" "${PNPM[@]}" build
# Committed GLBs match their Blender sources (D-034); no Blender needed.
step "assets" "${PNPM[@]}" assets:check

# Deterministic delivery signals (fol-00p): per-neighborhood GLB byte+tri
# allowance plus shell/canvas JS gz caps, checked on exact local bytes —
# network-independent by construction, a stand-in for timing budgets until
# there's more town. Allowance set 2026-09-30 from cortico at 1.82 MB /
# 171,540 tris, shell 70 KB / canvas 360 KB gz: one more hero fragment fits,
# whole-town breadth trips the gate. Runs in every lane: it needs only
# public/assets, the manifest, and dist/, no browser, seconds at most.
# The program lives in scripts/budget.mjs so `pnpm budget` by hand runs
# exactly what the gate runs.
step "budget" node scripts/budget.mjs

# The signals, like the test count below: "ok" alone can't tell a 1.8 MB
# neighborhood from a 5 MB one.
if [ -f "$LOGS/budget.log" ]; then
  grep "^budget: " "$LOGS/budget.log" | sed -e 's/^/        /'
fi

# The suite is the slow lane: probe_step runs it everywhere but --quick, where
# it skips loudly instead of vanishing silently.
# --run: Vitest watches when stdin is a terminal, and the gate would never exit.
probe_step "tests" "${PNPM[@]}" test --run

  # Vitest's summary line, e.g. "Tests  12 passed (12)" — "ok" alone can't tell
  # a green suite from one that ran nothing. Mode-guarded: under --quick the
  # step above skips and any log left is from an older run.
  if [ "$mode" != "--quick" ] && [ -f "$LOGS/tests.log" ]; then
    grep -oE "[0-9]+ (passed|tests?)[^.]*" "$LOGS/tests.log" | tail -1 | sed -e 's/^/        /'
  fi

if [ "$mode" = "--full" ]; then
  # Needs a browser: route smoke tests and the golden-hour / night captures,
  # written to /tmp/fol-*.png where scripts/review.sh collects them.
  # The HTML report would otherwise open and block on the first failure.
  step "e2e" env PW_TEST_HTML_REPORT_OPEN=never "${PNPM[@]}" test:e2e
fi
