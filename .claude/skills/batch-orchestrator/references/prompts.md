# Batch-orchestrator prompts

Copy-paste prompts for each stage. Set the effort dial as noted *and* keep the
directional words in the prompt — the prose aims, the dial sets the budget. Replace
`World Cup 2026 Sweepstake` / `/Users/alexcoates/Documents/wc2026-sweepstake` / `Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast)` on instantiate.

## [P1 — Triage] · high effort (max if the list is long/ambiguous)
```
You are triaging a batch of mixed updates for World Cup 2026 Sweepstake (/Users/alexcoates/Documents/wc2026-sweepstake).
Stack: React 18 + Vite SPA, one file (src/App.jsx); Supabase single `sweepstake` table (JSON blob per row, RLS, anon key); one Netlify function proxying ESPN; localStorage device memory; no router/TS/CSS-framework/tests.
You have repo access — inspect code/config as needed.

Raw item list:
<paste the Stage-0 list>

For EACH item, decide and record:
  - LANE: "safe" (UI/copy/client logic) or "risk" (touches Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast))
  - SPEC: the exact change — file(s), what to do, why (one line of intent)
  - ACCEPTANCE: how I'll know it's done (what to see)
  - Risk items only: what's already decided vs the genuine open calls

Think carefully — surface conflicts and risk-lane items hiding as "simple" changes.
If an item is too vague to spec, mark it NEEDS-DETAIL and ask me — don't guess.
Output a single markdown checklist, BATCH_<today>_PLAN.md, safe items first then risk.
```

## [P2 — Safe-lane execute] · low–medium effort
```
CONTEXT (decided — do not change):
  World Cup 2026 Sweepstake. Stack: React 18 + Vite SPA, one file (src/App.jsx); Supabase single `sweepstake` table (JSON blob per row, RLS, anon key); one Netlify function proxying ESPN; localStorage device memory; no router/TS/CSS-framework/tests. Files in /Users/alexcoates/Documents/wc2026-sweepstake.

Work these safe-lane items from the plan doc, in order:
  <paste the safe items: file → change → why → acceptance>

RULES: Pure execution. Make only these changes. Do not refactor adjacent code,
rename, or add features. If anything looks wrong or underspecified, FLAG AND STOP
— don't fix it. After each item, tell me the acceptance check to run.
```

## The risk-lane chain (P3a–P3d) — this IS the supabase-change protocol
Run one item at a time, **single-vendor**. Never paste Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) code,
secrets, or real user data into a free or external model.

### [P3a — Scope] · default effort
```
Scope this risk-lane item before we plan it. Read the relevant LIVE state of the
Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) in context — do not trust possibly-stale docs.

Item: <paste from plan doc>

Return: the scoped problem, the options considered and rejected (with why), what's
already decided, and the genuine open decisions. Do not implement.
```

### [P3b — Plan] · max effort
```
Here is the scoped problem and the options already considered and rejected:
  <paste P3a output>

STILL OPEN (your call): <the genuine decisions>
ALREADY DECIDED (don't reopen): <constraints, chosen direction>

Surface conflicts, find the flaws. Produce an ordered plan an executing model can
follow, with an acceptance criterion per step and a one-line rationale for each
non-obvious choice. This touches a sensitive surface — call out every
boundary/reversibility/atomicity risk explicitly.
```

### [P3c — Build] · default effort
```
CONTEXT (decided — do not change): World Cup 2026 Sweepstake. Files in /Users/alexcoates/Documents/wc2026-sweepstake.

GOAL: <one line>
CHANGES, in order:
  1. <file> → <change> — why: <intent> — acceptance: <check>

RULES: Pure execution. Make only these changes. Do not refactor, rename, or add
features. If anything looks wrong or underspecified, FLAG AND STOP. For any
risk-surface change, show me the exact change before applying it.
```

### [P3d — Self-review] · high effort (single-vendor — never a free model here)
```
Review the change just made for logic errors, security gaps, and weak reasoning.
Assume at least one significant flaw exists — your job is to find it. This touches
Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast), so weight security and data-exposure risk heavily. Do not praise
or summarise. List problems only, ordered by severity. Then run the risk-surface
checks for regressions.
```

## [P4 — Free cross-check] · external free model · NON-SENSITIVE items only
```
Review the following UI/frontend code for logic errors and weak reasoning. Assume
at least one significant flaw exists — find it. List problems only, ordered by
severity, no praise or summary.
<paste non-sensitive snippet>
```
**Never** paste Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) code, secrets, or real user data here.
