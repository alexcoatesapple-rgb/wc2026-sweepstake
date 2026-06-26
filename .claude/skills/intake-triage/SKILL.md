---
name: intake-triage
description: >-
  Turn a raw idea/notes dump into a triaged, scoped, lane-sorted plan for
  World Cup 2026 Sweepstake. Use whenever the user pastes a messy list of
  ideas/fixes/notes (an ad-hoc list pasted into chat, notes to self) and says "scope this out", "triage
  these", "here's my notes", "what should we build", or hands over a pile of
  mixed items to sift. This is the FRONT DOOR upstream of batch-orchestrator: it
  classifies every item into a route/lane, dedups against what already shipped,
  scores impact/effort/reversibility, flags the dangerous and the sensitive
  LOUDLY, then STOPS and presents a recommended batch to green-light. It does not
  build or ship.
---

# Intake / triage

The bottleneck is **intake**: turning a pile into correctly-sorted, scoped,
safe-to-run work without losing or mis-filing anything. This is not a
generate-ideas tool — the diverging already happened, offline. Assumes the
**wc2026-sweepstake-conventions** base.

> Read the dump → classify every item → dedup → scope & score → STOP and present
> the recommended batch. The owner green-lights what runs. You do not build.

## Reading the dump (exploit its structure)

Ideas here arrive **ad hoc** — an informal list pasted into chat, a few notes or
messages to yourself, not a tracker or issue board. There's no fixed format, so
read for intent and impose the structure below yourself. Common structure:
- **Markers** that separate done from live (e.g. an `All above covered - DD/MM`
  line). The live work is only the tail below the last marker — don't re-scope
  what's above it.
- **Mixed item types in one pile** — features, bugs, copy, UX, meta-rules for the
  agent, external notes. They route to different places. Misfiling is the main
  failure mode.
- **Self-flagged scope risk** — phrases like "needs scoping", "mockup first",
  "needs to be irrefutable" are hard gates the owner set. Preserve them.

## Stages

**0 · Capture.** Isolate the live items. Flatten to one line each: what / where (if
known) / any owner flag. Don't sort or solve yet.

**1 · Triage (the only expensive thinking step).** High effort, repo access. For
each item assign a **route** (table below), **dedup** against shipped work
(CURRENT_STATE.md / memory), and attach a **flag** if any. Too vague to route → mark
`NEEDS-DETAIL` and ask, don't guess.

**2 · Scope & score.** For in-scope items, score **impact**, **effort**, and
**lane** (safe vs risk). Group into **recommended batch** (ship now) vs **defer**
vs **quarantine** (sensitive — see flags).

**3 · STOP and present.** Output one compact, lane-sorted table (recommended batch
first). The skill ends here. Do not start building.

**4 · Hand off (only on green-light).** Route chosen items to the right skill.

## Routing taxonomy

| Item looks like | Route to | Lane |
|---|---|---|
| Several mixed in-scope items to ship together | **batch-orchestrator** | mixed |
| UI / copy / presentational / client-side only | safe lane of **batch-orchestrator** | safe |
| One safe new metric / data-capture / feature shape | **feature-expansion** (cheapest reversible shape) | safe |
| Touches the Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) | **supabase-change** | risk |
| An explicit bug / "X not working" | **structured-audit** or direct fix | by cause |
| A rule for the agent/project ("always warn me about money") | CLAUDE.md / config / memory — **not a feature** | meta |
| External / partner / meeting notes | flag **maybe-out-of-scope**, don't auto-pull in | defer |

When unsure which lane, treat as **risk lane**. Watch for risk items hiding as
"simple" work.

## Flags — surface these LOUDLY, they are the point

- **💰 MONEY / VALUES — CAPS, top of output.** Anything that could cost money or
  cut against the project's stated values/principles. Never bury it in a table row.
- **🔬 SENSITIVE → QUARANTINE.** Items needing a sourcing/disclaimer/legal gate
  (health claims, anything that must be "irrefutable"). Pull out of the batch.
- **✏️ MOCKUP-FIRST.** Owner wants a mockup before building. Route to a mockup step.
- **♻️ ALREADY SHIPPED / DUPLICATE.** Matches a memory/state entry. Drop it.
- **❓ NEEDS-DETAIL.** Too vague. Ask one sharp question; don't guess.

## Output shape

```
💰 MONEY / VALUES FLAGS   ← caps, first, even if "none"
🔬 QUARANTINE (sensitive) ← pulled out, with the gate they need

RECOMMENDED BATCH (ship now)
| # | item | route | lane | impact | effort | flag |

DEFER (real, not this round)   | # | item | route | why deferred |
DROPPED (shipped / dup / oos)  | # | item | reason |
NEEDS-DETAIL (one question each)
```

Keep it tight. The owner is scanning to green-light, not reading prose.

## Don't

- Don't build or ship — stop at the presented plan.
- Don't re-scope anything already marked done.
- Don't misfile a meta-rule (a rule for the agent) as a feature.
- Don't batch a sensitive item with ordinary work — quarantine it.
- Don't bury a money/values risk. Don't guess on a vague item.
