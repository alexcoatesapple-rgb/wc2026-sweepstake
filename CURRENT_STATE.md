# Current state — WC2026 Sweepstake

> Living state doc. Update on any meaningful feature/fix/version change (see the
> `session-closeout` skill). One source of truth for "what's shipped and what's in
> flight" — keep it short.

**Version:** 1.1.0 (`package.json`)
**Host:** Netlify — push to `main` auto-deploys to production.

## What works today

- Multi-sweep: create a sweep, random tiered draw, PIN-based access (row id = view
  PIN, organiser PIN gates editing). Device remembers opened sweeps.
- Results: manual paste/import (`parseResultsText`) + live ESPN auto-sync
  (`autoSyncFromESPN` via the `fixtures` Netlify function). New results broadcast to
  all sweeps remembered on the device.
- Scoring/leaderboard (`buildStats`), live provisional scoring, matchday report
  card, shareable canvas image. Admin overview, rename, expand-all leaderboard.
- Knockout **Bracket** tab (v1.1.0): auto-filling Round of 32. Winners &
  runners-up lock from the live `/standings` feed as each group ends; the 8
  third-place slots fill from `R32_THIRD_COMBO` (FIFA Annexe C, set once the
  qualifying thirds are known) and/or self-heal from ESPN R32 fixtures (ESPN
  authoritative). `R32_BRACKET` + `resolveBracket` are pure/derived — no Supabase,
  no new persisted state. Pre-kickoff fixtures show no score.

## Recently shipped

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
