# World Cup 2026 Sweepstake — Skills Reference

Project skills that auto-load in Claude Code for this repo. They encode the
project's conventions and your workflow so every session starts knowing the setup
and follows the same playbook. You don't invoke them by hand — they trigger on what
you ask. This doc is the at-a-glance map.

> Instantiated from **HarnessKit**. See `METHOD.md` for the methodology behind
> these. Delete any skill below that this project doesn't need.

## Which skill for what (quick lookup)

| You're about to… | Skill that fires |
|---|---|
| Sort / scope a raw notes dump of mixed ideas | `intake-triage` (front door — triage, then hands off) |
| Run a grab-bag batch of already-specced items | `batch-orchestrator` (the orchestrator) |
| Touch **any** code in this repo | `wc2026-sweepstake-conventions` (foundation — loads first) |
| Add a tracker / metric / new logged data | `feature-expansion` (pick the cheap shape first) |
| Change the Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast) | `supabase-change` |
| Audit the code / find bugs before shipping | `structured-audit` |
| Wrap up, verify, and tidy before stopping | `session-closeout` |
| Ship a batch / bump the version / merge | `release-cut` |

If unsure, just describe the task normally — the right skill triggers on its own.

## How they fit together

```
            ┌─────────────────────────────┐
            │  wc2026-sweepstake-conventions  │  ← foundation, every session
            └──────────────┬──────────────┘
                           │ informs all of:
   ┌───────────────┬───────┴───────┬────────────────┐
   ▼               ▼               ▼                ▼
 intake-        structured-    supabase-change   (any coding
 triage         audit              │                   task)
   │               │ risk items    │
   └──────────────►├───────────────┘
                   │ verified work
                   ▼
            session-closeout ──► release-cut ──► main
```

- `intake-triage` sits **upstream of everything**: raw dump → recommended batch,
  then hands chosen items to `batch-orchestrator` (or directly to the right skill).
  It stops at the plan — it never ships.
- `batch-orchestrator` triages a mixed grab-bag into safe/risk lanes and runs each
  at the right cost.
- `feature-expansion` decides a new feature's storage shape *before* building —
  defaults to the cheapest reversible mechanism, escalating to
  `supabase-change` only when the data genuinely needs it (this is what keeps
  most features in the safe lane).
- `supabase-change` is the risk-lane protocol, per item.
- `structured-audit` is how you *find* the work when it isn't known yet (and the
  engine for any scheduled/nightly review).
- `session-closeout` precedes `release-cut` — verify and tidy, then ship.

## The golden rules (cheat-sheet)

The heart of `wc2026-sweepstake-conventions` — worth knowing by heart:

1. All Supabase access via the four helpers (`loadByPin` / `loadById` /
   `saveSweep` / `deleteSweep`) — never `supabase.from(...)` in a component.
2. `saveSweep` overwrites the whole `data` blob — spread the latest state, never
   write partial (no server merge; last write wins).
3. Result identity = `stage` + unordered team pair; ESPN home/away may be flipped.
4. Result `id` prefix gates auto-sync: `espn_…` is overwritable, `imp_…`/`m…`
   (human-entered) is never touched by auto-sync.
5. `API_TEAM_MAP` / `apiRoundToStage` mirror `TEAMS` / `STAGE` — unmapped team is
   silently dropped.
6. ESPN season slug ≠ round (round = competition notes only).
7. Live matches score but never eliminate.
8. Row `id` IS the view PIN; organiser PIN gates editing.

## Maintenance

You don't maintain these on a schedule. Principles don't rot, and factual lists
self-correct because the skills point at the live system/code. The **only** trigger
to edit a skill is when a session *changes a convention* or *surfaces a new durable
gotcha/primitive* — and `session-closeout` catches that automatically. So the suite
keeps itself current.

## Where things live

```
.claude/skills/
├── README.md                          ← this file
├── wc2026-sweepstake-conventions/
│   ├── SKILL.md
│   └── references/
│       ├── domain-core.md             ← core architecture, patterns, sync traps
│       └── domain-risk.md             ← the risk surface: model, safe patterns, catalogue
├── intake-triage/SKILL.md
├── batch-orchestrator/
│   ├── SKILL.md
│   └── references/prompts.md          ← copy-paste stage prompts
├── feature-expansion/SKILL.md         ← cheapest-shape-first decision gate
├── supabase-change/SKILL.md
├── structured-audit/SKILL.md
├── session-closeout/SKILL.md
└── release-cut/SKILL.md
```
