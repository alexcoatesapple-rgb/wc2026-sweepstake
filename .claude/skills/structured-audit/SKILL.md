---
name: structured-audit
description: >-
  Run a structured, read-only audit of World Cup 2026 Sweepstake — bug sweep / review pass.
  Use when the user asks to "sweep for bugs", "audit the code", "find bugs", "do a
  review pass", "what's broken", or wants a systematic pass over the risky parts
  before shipping. Produces a findings doc in a fixed format (BUGS / IMPROVEMENTS
  / QUICK WINS / Verified-clean, severity-tagged), then optionally ships the safe,
  reversible subset as a verified batch. Use this rather than an ad-hoc read so
  the severity taxonomy and findings format stay consistent. Has a read-only
  UNATTENDED mode (audit + write doc only) for scheduled/nightly runs.
---

# Structured audit

A sweep is a **read-only audit first**, then (optionally, attended) a **safe batch
ship**. Nothing changes at audit time — the audit is the deliverable; fixing is a
separate, verified pass. This separation keeps the audit honest and the fixes
isolated and revertable.

## Phase 1 — Audit (read-only, change nothing)

Go deep where bugs hide, lighter on presentational code. Coverage priority:
1. **Scoring & elimination** — `teamMatchPts`, `buildStats`, `koWinner` in
   `App.jsx`. The leaderboard is the product; an off-by-one here is the worst bug.
   Check group vs KO branches, clean-sheet/red-card maths, live-vs-finished
   elimination, and the `groupWinners` bonus.
2. **Persistence & cross-sweep broadcast** — `saveSweep`, `commit`,
   `addResultsToAll`, `autoSyncFromESPN`. The merge/flip logic, the `espn_` vs
   `imp_`/`m…` overwrite gate, and the silent fan-out write to *other* sweeps.
3. **ESPN ingest & mapping** — `netlify/functions/fixtures.js`, `apiTeamId`,
   `apiRoundToStage`, `API_TEAM_MAP`. Unmapped teams/rounds dropped silently;
   round derived from notes not slug.
4. **Parsers** — `parseDrawTable`, `parseResultsText` (regex, dashes, pens,
   reds, dedupe).
5. **Lighter pass** — the view components and the canvas share-image renderer.

Watch especially for this project's known bug classes (from wc2026-sweepstake-conventions'
golden rules + risk reference). Generic classes worth always checking:
- **Boundary gaps** — a cross-boundary access that should go through the guarded path.
- **Non-atomic multi-step writes** — partial-failure corruption.
- **Read-modify-write races** — two clients lose updates.
- **Silent failures** — an error logged then rendered as "empty" instead of "failed".
- **Idempotency** — operations that duplicate on re-run.
- **Convention drift** — a golden rule quietly violated (e.g. date handling, the
  data-layer boundary, a sync mirror).

## Phase 2 — Write the findings doc

Save as `AUDIT_<date>.md` in the repo (or the project's established name, e.g.
`BUG_SWEEP_<date>.md`). Use this structure and severity tags exactly:

```
# Audit — <date> (v<current>)
> Status banner — updated as fixes ship.

(One paragraph on coverage.)

## BUGS
### B1 — <title> (HIGH | MEDIUM | LOW[, systemic])
<what, with file:line links>, impact, fix.

## IMPROVEMENTS / OPTIMISATIONS
- I1 — <non-bug refactor/perf/clarity>, with file:line.

## QUICK WINS
- QW1 — <small, safe, high-value one-liner fix>.

## Verified clean / not a bug
- <thing checked that turned out fine — records the negative so it isn't re-checked>
```

Severity: **HIGH** = data loss / boundary breach / broken core flow; **MEDIUM** =
wrong-but-recoverable / edge-case; **LOW** = cosmetic / defensive. Tag `systemic`
when it recurs across files. Always include "Verified clean" — recording what's
*not* broken is as valuable as the bugs.

## UNATTENDED mode (scheduled / nightly)

When run on a schedule with no human present: **do Phase 1 + Phase 2 only, then
STOP.** Write the findings doc and surface it (commit to a branch / open a draft
PR / leave the doc) — **never fix, ship, push, deploy, or touch the live system.**
No verification tools that need a live session are assumed available; the audit is
static and read-only. The human reviews the digest and green-lights any fix in a
normal attended session.

## Phase 3 — Ship the safe subset (ATTENDED only)

Triage findings into the two lanes:
- **Safe + reversible** (QWs, app-only fixes) → fix together, verify, ship as one
  patch version.
- **Risk lane** (Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast)) → hand each to **supabase-change**, one
  isolated commit + version each.
- Defer the rest; leave them in the doc with the status banner updated.

Then cut the release(s) via **release-cut**. Update the status banner and memory so
the open backlog is always current.
