# Current state — WC2026 Sweepstake

> Living state doc. Update on any meaningful feature/fix/version change (see the
> `session-closeout` skill). One source of truth for "what's shipped and what's in
> flight" — keep it short.

**Version:** 1.0.0 (`package.json`)
**Host:** Netlify — push to `main` auto-deploys to production.

## What works today

- Multi-sweep: create a sweep, random tiered draw, PIN-based access (row id = view
  PIN, organiser PIN gates editing). Device remembers opened sweeps.
- Results: manual paste/import (`parseResultsText`) + live ESPN auto-sync
  (`autoSyncFromESPN` via the `fixtures` Netlify function). New results broadcast to
  all sweeps remembered on the device.
- Scoring/leaderboard (`buildStats`), live provisional scoring, matchday report
  card, shareable canvas image. Admin overview, rename, expand-all leaderboard.

## In flight / uncommitted

- **Auto group winners + exits (#3)** — new `netlify/functions/standings.js` proxies
  ESPN group standings; `deriveFromStandings` + `mergeDerived` (App.jsx) turn that
  into group winners (rank 1) and group-stage exits (ESPN `advanced` flag), only for
  *completed* groups. `autoSyncStandings()` broadcasts them to every remembered
  sweep on load. Manual toggles remain as override (merge is additive). Also added
  the `"Bosnia-Herzegovina"` alias to `API_TEAM_MAP`. Logic verified against live
  ESPN; browser E2E of the function still pending (needs `netlify dev` / deploy
  preview). Uncommitted as of 2026-06-26.
- **Scoring regression test (#4)** — `scripts/check-scoring.mjs` (run via `npm
  test`) exercises the real `koWinner` / `teamMatchPts` / `buildStats` from
  `App.jsx`; 27 assertions, all passing. App code untouched (no extraction).

## Known gotchas

See `wc2026-sweepstake-conventions` golden rules + `references/domain-risk.md`.
