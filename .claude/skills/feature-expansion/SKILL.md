---
name: feature-expansion
description: >-
  Decide the implementation/storage SHAPE before building a new feature, tracked
  metric, or data-capture in World Cup 2026 Sweepstake. Use when the task is "add a <X>
  tracker", "log <something>", "track <X> over time", or "add a new
  section/modality". It enforces the project default: reach for the cheapest
  reversible mechanism (a new field on the per-sweep JSON `state` blob) first, and escalate to the risk lane
  (supabase-change) only when the data genuinely needs it — so new features
  ship in the fast safe lane instead of dragging in a risky change by reflex.
---

# Feature expansion — cheapest reversible shape first

The decision that keeps work in the **safe lane** is made *before* you build: what
**shape** does this feature's data/state take? The bias is strongly toward the
cheapest reversible mechanism, because a risk-lane change (Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast)) is
slow and expensive to get right, while the cheap mechanism ships in one pass.

So the first question on any new data-capture feature is **storage shape**, not UI.

## The cheap reversible mechanisms (reach here first)

1. **A new field on the per-sweep `state` object.** The whole sweep is one JSON
   blob persisted in `sweepstake.data` via `saveSweep`. A new tracker, setting, or
   metric is almost always just another key on `state` — no new table, no schema
   change, no migration. Read it off `state`, write it via `commit({ ...state, … })`.
   Default to a sensible value when the key is absent (old rows won't have it) —
   see how `state.scoring` falls back to `DEFAULT_SCORING`.
2. **`localStorage`** (`wc26_known_sweeps` is the existing example) — for pure
   device-local / view state that is NOT part of the shared sweep (which browser
   has seen which sweep, a UI preference). Never the place for sweep data.

Escalate to **supabase-change** only when the data genuinely can't live on the blob
— e.g. it needs its own table, a new RLS rule, or cross-row integrity. That's rare
here; almost everything is a field on the blob.

## Build flow
1. **Classify the data.** A tracked value over time → the generic store. A
   preference/UI toggle → device-local. Genuinely relational / cross-boundary /
   needs its own access rules → only *then* the risk lane.
2. **Add/ reuse the data-layer function** (correct return shape, error tag,
   identity resolution) — or reuse the generic write/read helpers directly.
3. **Build the component** in the project's existing style (no new framework, no
   new nav system). Gate it by mode/role if it's mode-specific.
4. **Verify in preview**, then close out / ship.

## When a real risk-lane change IS justified
Escalate to **supabase-change** only when the data genuinely can't fit the
cheap shape — i.e. it needs its **own access/RLS rules**, **foreign keys**,
**uniqueness constraints**, or **cross-boundary/cross-tenant access**. Those are
real structural needs. A simple per-user value or log is not — keep it cheap.

## Decision shortcut
- New per-user value/score over time → generic store (a new field on the per-sweep JSON `state` blob).
- New per-device preference/toggle → device-local.
- Needs own access rules / FKs / uniqueness / cross-boundary → risk lane via
  **supabase-change**.
