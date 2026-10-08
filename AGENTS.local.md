# Project additions to the harness contract

Read this alongside `AGENTS.md` and `CLAUDE.md`. Add guidance specific to this
project here, such as which verification lane to run before a release.
The harness installs this file once and never compares or overwrites it.

## Wrap-up order: all ledger writes, then export, then verify

Beads move in every session, so by wrap-up the export on disk never matches
the live ledger — and the gate's first check fails, forcing the whole gate to
run twice (once to learn the export is stale, once after regen). Worse, every
`bd` write after the export (including `bd close`) re-dirties it, so the
committed export is stale before the ink dries. Do every ledger write first —
claim, note, close, remember — and let the export be the last one:

  bd close <id> --reason "<what happened>"   # all bd writes first
  bd export --include-memories -o .beads/issues.jsonl
  scripts/verify.sh
  git add ... && git commit                  # "Closes <id>" resolves on closed beads

No `bd` writes between the export and the commit. If the gate fails, reopen
(`bd update <id> --status open`), fix, and redo the sequence from the export —
never commit a tree the gate hasn't seen, and never write the ledger after it.
