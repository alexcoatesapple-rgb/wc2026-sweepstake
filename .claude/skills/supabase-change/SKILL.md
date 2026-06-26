---
name: supabase-change
description: >-
  Plan-first protocol for RISKY changes to World Cup 2026 Sweepstake's Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) —
  the expensive-to-get-wrong surface where a mistake silently corrupts or wipes a
  live sweep, or clobbers other sweeps via the broadcast. Not a security surface
  (no signup; trusted users) — the risk is DATA LOSS. Use this skill BEFORE editing
  when a task touches those writes, or anything destructive/irreversible to live
  sweep data. The rule is scope → plan → build → review → verify, never edit-first.
  Pairs with wc2026-sweepstake-conventions' risk reference.
---

# supabase-change — plan before you touch

This is the **risk lane**. The cost of a mistake is corrupted or wiped live sweep
data (there's no staging DB and no backups), so the rule is **scope → plan → build
→ review → verify**, never
edit-first. Read wc2026-sweepstake-conventions' `references/domain-risk.md` for the
underlying patterns; this skill is the *procedure* that wraps them.

## When this applies

Any change touching Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast), or any operation that reads/writes real user
data, is irreversible, or could cost money. **If unsure whether a change is
risk-lane, treat it as risk-lane.** Pure presentational / client-side changes are
the safe lane — single session, just verify.

## The protocol

### 1. Scope (read the LIVE state first)
Do **not** trust the schema/config docs — they may be stale. Read reality:
- The current state of the surface you're about to change (live schema, live
  config, live routing — via whatever tool reads the real system).
- Identify what's already decided vs the genuine open decisions.

### 2. Plan (write it down before editing)
An ordered plan with an acceptance check per step and a one-line rationale for each
non-obvious call. Explicitly call out:
- **Boundary safety:** which identity/scope check guards every new access. A
  cross-boundary operation goes through the sanctioned guarded path (see the risk
  reference), **never** by widening the boundary rule.
- **Reversibility:** the change must be additive and reversible. No destructive
  operation on live data without an explicit data-migration plan.
- **Atomicity:** multi-step writes that could corrupt on partial failure go in a
  single transaction, not a client-side multi-step sequence.

For genuinely risky changes, get a max-effort plan and a high-effort adversarial
self-review (primed to assume a flaw exists). **Never paste Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) code,
secrets, or real data into a free/external model** — privacy boundary.

### 3. Build
- Additive + reversible. New guarded primitive → include all the required
  boilerplate (see the risk reference).
- **Show the exact change before applying it.**
- Keep the change behind the project's data/logic layer; don't scatter it.

### 4. Apply + verify (the "done" bar)
- Apply via the sanctioned mechanism.
- Run the risk-surface checks (security/perf lints, logs) — confirm no new warnings.
- Verify the user-facing flow against reality, not the docs.

### 5. Record
- Mirror the change into the schema/config doc (doc follows reality, never leads).
- One isolated, revertable commit, so this single change can roll back cleanly.
- Update CURRENT_STATE.md; bank a memory note + update the risk reference catalogue if
  a new primitive or gotcha emerged.

## Red flags — stop and rethink

- A new access rule that omits the identity/scope predicate (grants too broadly).
- A direct cross-boundary read/write that should go through the guarded path.
- A destructive operation against live data.
- A multi-step write to related state with no transaction.
- A change that depends on widening a constraint elsewhere, where forgetting it
  fails **silently** (the dangerous class — see the risk reference).
