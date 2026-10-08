# Project additions to the harness contract

Read this alongside `AGENTS.md` and `CLAUDE.md`. Add guidance specific to this
project here, such as which verification lane to run before a release.
The harness installs this file once and never compares or overwrites it.

## Wrap-up order: export before verifying

Beads move in every session, so by wrap-up the export on disk never matches
the live ledger — and the gate's first check fails, forcing the whole gate to
run twice (once to learn the export is stale, once after regen). Settle the
ledger, regen the export, then verify:

  bd export --include-memories -o .beads/issues.jsonl
  scripts/verify.sh
