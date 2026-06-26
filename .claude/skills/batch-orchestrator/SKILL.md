---
name: batch-orchestrator
description: >-
  Run a BATCH — a grab-bag of mixed, unrelated fixes/features that ship together
  — on World Cup 2026 Sweepstake. Use when the user says "run a batch", "I've got a bunch
  of updates to do", "work through this plan doc", "ship these together", or
  hands over a list of mixed items. This is the ORCHESTRATOR for multi-item work:
  triage once → split into a safe lane and a risk lane → run each at the right
  cost → verify → ship, delegating the risk lane to supabase-change,
  verification to session-closeout, and shipping to release-cut. For a SINGLE
  item, skip this and use the specific skill directly; to FIND the items first
  via an audit, use structured-audit.
---

# Batch orchestrator

A batch is a **mixed grab-bag** — unrelated items that just ship together. It is
*not* one pipeline; it is N independent tasks.

> Triage once → split into two lanes → run each at the right cost → verify each →
> ship in revertable commits.

The expensive thinking happens **once**, at triage. Everything after is cheap
execution or a small isolated chain. Assumes the **wc2026-sweepstake-conventions** base.

## Hard rules

1. **Sensitive surfaces stay single-vendor.** Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast), secrets, real
   user data → never paste into a free/external model. Privacy boundary > convenience.
2. **Free external models = non-sensitive only** — UI/copy/pure-frontend
   cross-checks. That's where they save primary-model usage.
3. **Match effort to the step, not the batch.** Triage = high (max if long/ambiguous).
   Safe edits = low. Risk-lane plan = max. Keep the directional words in the prompt.
4. **Effort before chains.** Only the ~2–3 risky items get the full chain.
5. **Flag-and-stop on execution.** An execution pass makes *only* the specified
   change. Anything wrong or underspecified → stop and flag, don't "improve" it.
6. **Done = verified.** Nothing ships until seen working (that bar is **session-closeout**).

## The two lanes

| | **Safe lane** | **Risk lane** |
|---|---|---|
| What | UI / copy / styling / client-side logic | Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) |
| Count | the majority | ~2–3 per batch |
| Route | one low–med-effort pass | scope → **plan (max)** → build → **self-review (high)** |
| Free models? | yes, cross-check OK | **no — single-vendor end to end** |
| Commits | grouped logically | **one item per commit**, isolated & revertable |
| Verify | preview the change | preview **+** the risk-surface checks |
| Driven by | this skill | the **supabase-change** protocol |

When unsure which lane an item is in, treat it as **risk lane**.

## Stages

**0 · Capture.** Flatten every item to one line: what, where, why. Don't sort or
solve. (If the items aren't known yet, that's a **structured-audit**, not this.)

**1 · Triage — the only expensive thinking step.** High effort. For each item
decide its **lane**, write the **spec** (file(s) → change → one-line why) and the
**acceptance** check. Surface conflicts and hidden risk-lane items. Too vague →
`NEEDS-DETAIL`, ask. Output one checklist doc — **`BATCH_<YYYY-MM-DD>_PLAN.md`**,
safe items first then risk — the source of truth every later stage ticks against.
→ prompt **[P1]**.

**2 · Safe lane — cheap, high-volume.** Low–med effort. Work safe items straight
off the plan, fully-specified + flag-and-stop; batch several per session. A new
tracked-metric / data-capture item? decide its shape via **feature-expansion**
(cheapest reversible mechanism) — that keeps it in the safe lane. Commit in logical
groups. → **[P2]**; optional non-sensitive cross-check → **[P4]**.

**3 · Risk lane — one item at a time, single-vendor.** Each runs the
**supabase-change** protocol with the effort chain on top:
scope (default) → plan (max) → build (default) → self-review (high). Each risky
item = its own commit. → **[P3a–P3d]**.

**4 · Verify — the "done" bar.** This is **session-closeout**. Per item: seen
working in preview, logs/checks clean. Risk-lane also runs the risk-surface checks.
Tick the plan item only once seen working. Never ask the user to check manually.

**5 · Ship — only when the user says so.** This is **release-cut**. Safe lane → a
few grouped commits; risk lane → one commit each. **Don't commit or push until asked.**

## Don't

- Don't run a whole batch as one chain — triage exists to split cheap from careful.
- Don't squash risk-lane items together — keep each individually revertable.
- Don't send sensitive code to a free model.
- Don't mark an item done before it's verified.

Copy-paste prompts for every stage live in
[references/prompts.md](references/prompts.md).
