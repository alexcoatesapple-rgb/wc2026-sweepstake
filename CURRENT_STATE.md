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

- Working-tree changes to `netlify/functions/fixtures.js` and `src/App.jsx`
  (live-score sync work — uncommitted as of harness setup, 2026-06-26).

## Known gotchas

See `wc2026-sweepstake-conventions` golden rules + `references/domain-risk.md`.
