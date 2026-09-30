---
name: principal-review
description: Review a span of work (a day, a milestone, a branch) as a principal engineer, inline, against the spec, the decisions and where the project is headed, and report prioritized findings. Use when asked to review what was done, audit recent work, or run "that kind of review" again.
---

# Principal review

`agentic-review` checks one diff with fresh eyes. This is the other kind of
review: one reader holding the whole plan and the whole span of code at once, so
it catches what a diff-scoped reviewer can't. That means a checkbox claiming more
than the decision log says, a design that works for one asset and breaks at
town scale, or a gate that measures the wrong thing. That's why it runs
**inline**. Don't hand it to subagents unless asked, because the value is the
cross-reference.

## 1. Scope and budget

- **Span:** default to the work since the newest file in `docs/reviews/`. The
  user may name a day, a range or a branch instead.
  ```bash
  git log --since="<start>" --format='%h %ad %s' --date=format:%H:%M
  git diff <first>~1..HEAD --stat -- . ':!.beads'
  ```
- **Budget:** if the user gave a usage cap, keep to it. Check in *before*
  exceeding it, never after. A day of work (~3–4k changed lines) fits in well
  under 20% of 5h when you read diffs rather than whole files.

## 2. Read the goals before the code

- The docs CLAUDE.md lists under "Read before working": the spec's milestone
  checklist, the decision entries made in the span, the art direction.
- The span's handoff notes (`harness/handoffs/`) and the ledger (`bd list`).
- Run the gate (`scripts/verify.sh`). A red gate is finding zero.

## 3. Read the code, by subsystem

- Read every source diff in the span (`git diff <range> -- src <pipeline dirs>`).
  Skim harness scripts unless they're the point.
- Open whole files only where a diff's correctness depends on its surroundings,
  for example what a batching matrix does in the shader or who else writes a
  uniform.
- Check what the docs claim against the code. Is every ticked checkbox actually
  done? Does a decision's "measured" number measure what it says?
- Look at the latest captures (golden hour and night, `/tmp/fol-*.png`). Beauty
  is the success test, so the pixels are evidence too.

## 4. The lens

Hunt for:
- **Bugs**, each with a concrete failure scenario.
- **Gotchas**: the project's known traps, plus platform ones such as input
  events that fire twice or program recompiles.
- **Inefficiencies**, both frame cost and iteration speed. A cache key that
  forces a full rebuild counts.
- **System design against where the project is headed.** Read the next
  milestone and ask what breaks at its scale. Mark these *latent*: correct
  today, wrong soon.

Also name what's working well and should be repeated, and any other feedback
that matters, including process (for example, how much of the span went to
tooling).

## 5. Report

- Put the verdict first, then **P1** (fix before or during the next piece of
  work), **P2** (settle before it scales), **P3** (small cleanups), then
  what's working, then other feedback.
- Each finding gets a `file:line` link, the scenario, and the fix in a sentence.
- Say plainly what you did **not** read. Never imply you reviewed code you only
  inferred from a decision entry.
- A finding that contradicts a decision entry is raised with the user, never
  acted on (CLAUDE.md).
- End by offering to file the findings.

## 6. When the user says file them

1. Create one bead per finding. Put slice-scoped ones under the active epic
   with `--parent`, polish under the polish epic. Wire the dependencies:
   `bd dep add X Y` means *X depends on Y*. Verify the direction with
   `bd show`, because `--deps blocks:` reads backwards.
2. Write the review to `docs/reviews/YYYY-MM-DD-code-review.md`, the same
   findings with each bead id beside it and the span's commit range in the
   header.
3. Fold "what's working" into CLAUDE.md's "Patterns worth repeating". Merge
   with what's there instead of appending duplicates, and keep it short
   because it loads every session.
4. Run `bd export --include-memories -o .beads/issues.jsonl`, then
   `scripts/context.py bless` if a skill or CLAUDE.md changed, then the gate,
   then commit with a bead id.
