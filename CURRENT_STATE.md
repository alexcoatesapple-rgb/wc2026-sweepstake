# Current state — WC2026 Sweepstake

> Living state doc. Update on any meaningful feature/fix/version change (see the
> `session-closeout` skill). One source of truth for "what's shipped and what's in
> flight" — keep it short.

**Version:** 1.2.0 (`package.json`)
**Host:** Netlify — push to `main` auto-deploys to production.

## What works today

- Multi-sweep: create a sweep, random tiered draw, PIN-based access (row id = view
  PIN, organiser PIN gates editing). Device remembers opened sweeps.
- Results: manual paste/import (`parseResultsText`) + live ESPN auto-sync
  (`autoSyncFromESPN` via the `fixtures` Netlify function). New results broadcast to
  all sweeps remembered on the device.
- Scoring/leaderboard (`buildStats`), live provisional scoring, matchday report
  card, shareable canvas image. Admin overview, rename, expand-all leaderboard.
- Knockout **Bracket** tab (v1.2.0): full two-sided knockout tree (R32→Final + 3rd
  place). R32 seeded from the live `/standings` feed; the 8 third slots from
  `R32_THIRD_COMBO` (FIFA Annexe C) / ESPN R32 override. Every later slot
  propagates from match winners (`resolveBracketTree` + `KO_FLOW`, losing
  semi-finalists → 3rd place), only from FINISHED matches. Empty slots read
  "Winner Mxx". Pure/derived — no Supabase, no new persisted state. Layout is a
  `space-around` flex tree, horizontally scrollable on mobile.

## Recently shipped

- **v1.2.0 — Full knockout tree** — expanded the R32-only bracket to the whole
  two-sided tree (R16/QF/SF/Final/3rd). `KO_FLOW` + `resolveBracketTree` propagate
  winners (and SF losers → 3rd place) from results; only finished matches advance.
  Resolver validated in a scratchpad sim (propagation, pens, live-no-advance);
  build / `npm test` (34) / live preview desktop+mobile. Known: a pens game ESPN
  can't resolve stalls that branch until the organiser enters the pens winner.
  2026-06-27.
- **v1.1.0 — Knockout bracket (Bracket tab)** — see "What works today". Came out of
  a brainstorm on auto-filling the R32 as groups finish. Deliberately did **not**
  transcribe all 495 Annexe C rows: one realised `R32_THIRD_COMBO` row + ESPN
  override. Verified build / `npm test` (34) / fix sim / live preview. 2026-06-27.
- **Auto group winners + exits (#3)** — `standings.js` + `deriveFromStandings` /
  `mergeDerived` / `autoSyncStandings`; group winners (rank 1) + group-stage exits
  (ESPN `advanced`) for completed groups, broadcast to remembered sweeps.
- **Scoring regression test (#4)** — `scripts/check-scoring.mjs` (`npm test`), 34
  assertions.
- **Pre-deploy audit** — `AUDIT_2026-06-26.md`: fixed B1 (premature sticky 3rd-place
  elimination). Deferred: read amplification on load (I1), CJS-in-ESM warning (I2).

## Known gotchas

See `wc2026-sweepstake-conventions` golden rules + `references/domain-risk.md`.
