# Project additions to the harness contract

Read this alongside `AGENTS.md` and `CLAUDE.md`. Add guidance specific to this
project here, such as which verification lane to run before a release.
The harness installs this file once and never compares or overwrites it.

## Wrap-up order: all ledger writes, then push, then export, then verify

Beads move in every session, so by wrap-up the export on disk never matches
the live ledger — and the gate's first check fails, forcing the whole gate to
run twice (once to learn the export is stale, once after regen). Worse, every
`bd` write after the export (including `bd close`) re-dirties it, so the
committed export is stale before the ink dries. Do every ledger write first —
claim, note, close, remember — push the ledger, and let the export be the last
ledger read:

  bd close <id> --reason "<what happened>"   # all bd writes first
  scripts/ledger-push.sh                     # Dolt ref + regen; itself a bd write, so before the export
  bd export --include-memories -o .beads/issues.jsonl
  scripts/verify.sh
  git add ... .beads/issues.jsonl && git commit   # every bead commit carries a fresh export;
                                                  # "Closes <id>" resolves on closed beads

No `bd` writes between the export and the commit. If the gate fails, reopen
(`bd update <id> --status open`), fix, and redo the sequence from the export —
never commit a tree the gate hasn't seen, and never write the ledger after it.

The push is best-effort, never blocking: it needs the network and the Dolt
remote, and two sessions pushing at once can lose a race the retry won't win.
On failure, retry once (`bd dolt pull` first if the remote moved), then commit
anyway and say so in the handoff note — the local ledger plus the committed
export preserve everything but machine-loss redundancy, and `--check` keeps
nagging until a later push lands it.
