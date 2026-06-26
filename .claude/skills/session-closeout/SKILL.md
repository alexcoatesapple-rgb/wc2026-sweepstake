---
name: session-closeout
description: >-
  Closing checklist for a World Cup 2026 Sweepstake work session — run it when wrapping up
  a change, before declaring something done, or when the user says "that's it",
  "we're done", "ship it", or asks to commit. It enforces the habits that
  compound: verify the change actually works, run a review on the diff, bank
  durable facts to memory + CURRENT_STATE.md, flag follow-ups, and keep the skills
  self-current. Use proactively whenever a unit of work is finishing so nothing
  rots — don't wait to be asked. Not for mid-task; this is end-of-session.
---

# Session closeout

The cheapest compounding investment is the 60 seconds at the end of a session: a
verified change keeps the codebase solid, and a banked fact makes the next session
start smarter. Skipping closeout is how regressions and re-explained context
accumulate.

Run the relevant items below when a unit of work is finishing. Skip what doesn't
apply.

## 1. Verify — "done" means seen working
Nothing counts as done until observed working.
- Run the change and confirm the expected behaviour + clean logs/console.
- Capture proof (a snapshot/screenshot/log line) for anything user-facing.
- If a risk-surface flow changed: run the risk-surface checks for regressions.
- Never ask the user to "check it manually" — verify and show proof.

## 2. Review the diff
- Run `/code-review` (or an adversarial self-review) on the change before committing.
- Confirm conventions held (see wc2026-sweepstake-conventions' golden rules): the data-layer
  boundary, any sync mirror, the risk-surface scoping.

## 3. Bank durable facts
Memory and CURRENT_STATE.md load into future sessions — write to them while the
context is fresh.
- **CURRENT_STATE.md** — update for any meaningful feature/fix/version change.
- **Memory** — save a fact only if it's *non-obvious* and not already in the repo
  (a new gotcha, a decision + its why, a constraint not derivable from code).
  Convert relative dates to absolute. Don't save what git/code already records.
- **Keep the skills self-current.** If this session *changed a convention* or
  *surfaced a new durable gotcha/primitive/pattern* — not just shipped a routine
  feature — update the relevant skill in `.claude/skills/`, not only memory. A new
  rule → wc2026-sweepstake-conventions; a new guarded primitive → the risk reference
  catalogue; a new silent-failure trap → the golden rules. Routine features don't
  need a skill edit (the skills point at the live system for specifics on purpose).
  **This is the only maintenance the suite needs** — done as a side-effect here.

## 4. Flag follow-ups
- Note anything out-of-scope you noticed (dead code, a stale doc, missing coverage,
  a confirmed-real TODO) rather than letting it expand the current change. If
  there's an open backlog doc, add it there.

## 5. Ship (only when the user says so)
- Don't commit/push unless asked. If on the main branch, branch first.
- Conventional-commit message; end the body with the Co-Authored-By trailer.
- If this finishes a shippable batch/version, hand off to **release-cut**.

## The 20-second version
Verify → `/code-review` → update CURRENT_STATE.md + bank any non-obvious fact →
flag follow-ups → stop (commit only if asked).
