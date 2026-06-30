# Current state — WC2026 Sweepstake

> Living state doc. Update on any meaningful feature/fix/version change (see the
> `session-closeout` skill). One source of truth for "what's shipped and what's in
> flight" — keep it short.

**Version:** 1.3.3 (`package.json`)
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

- **v1.3.3 — Auto-resolve knockout penalty shootouts** — fixes pens ties that were
  mis-stored as **group games with no winner** (the "edit every sweep by hand" pain).
  Two stacked bugs: (1) the `fixtures` proxy read ESPN's `"X advance N-N on
  penalties"` NOTE as the round → no KO keyword → defaulted GROUP; it now folds
  `season.slug` (`"round-of-32"`) + notes (minus the pens annotation) so the real
  round is found wherever ESPN hides it. (2) No pens winner was derived; new
  `apiPensWinner` reads ESPN's per-competitor `shootoutScore` (now forwarded by the
  proxy) and sets `pensWinner` for a level KO tie (`Number`-coerced — a string
  compare would mis-rank a 10-9 shootout). `mergeInto` now matches `espn_` results by
  their stable event id and **corrects the stage in place** (GROUP→R32), so
  already-broken live sweeps **self-heal on the next sync** — clearing the phantom
  group-draw points, no manual editing. Human `imp_`/`m…` results stay untouchable
  (golden rule #3). Verified: build / `npm test` (49) / live production-window ESPN
  feed (Paraguay + Morocco pens correct) / two independent reviews (one real bug —
  the string compare — found and fixed). Golden rule #6 updated (the slug DOES carry
  the KO round). Known edge: a sweep where you *added a new* R32 row but left the
  stale GROUP row behind won't fully self-heal — delete the extra row once. 2026-06-30.
- **v1.3.2 — Predictions: enter anytime, per-tie write-once** — replaced the global
  "lock the whole bracket at first R32 kick-off" rule (which slammed the entry window
  shut the moment the first knockout game started — the bug that prompted this).
  Entry is now open whenever the R32 is seeded; each tie freezes on its own —
  `frozen = that game kicked off || the player has SAVED a pick for it` (write-once;
  confirm-on-save; 🔒 cue on saved-but-unplayed ties; you can never pick a game that
  already kicked off). **Late-entry feeder fallback:** `resolvePredictionTree` falls
  back to who ACTUALLY advanced for an already-decided feeder a player never picked,
  so one missed game no longer kills a whole branch above it. **Read-only peek:**
  split identity (`myId`) from viewing (`viewing`; `me = viewing || myId`; `isMine`)
  — clicking a leaderboard name PEEKS read-only, so you can't accidentally edit/save
  over someone else's bracket. **Merge-on-save:** `savePrediction` now merges picks
  (never drops one saved on another device — safe under write-once). Champion column
  gated until all R32 have kicked off (no strategy leak). Verified: build / `npm test`
  (40, +late-entrant feeder case) / app boots clean; reviewed via a 4-lens
  adversarial pass (5 findings fixed). 2026-06-28.
- **v1.3.1 — Predictions polish** — save button moved to a sticky bottom bar
  (`.pred-savebar`); `savePrediction` only updates in-memory state on a successful
  write (a failed save no longer shows as saved); save-button label no longer reads
  "Saved" before anything is saved; **click any leaderboard name to load that
  player's bracket** (`viewPlayer` → `chooseMe`, scrolls up). Honour-system caveats
  left as-is by choice: pre-lock you can view/edit any name; viewing persists the
  device's remembered name. Verified build + `npm test` (39). Deployed (superseded by
  v1.3.2's entry-model rework). 2026-06-28.
- **v1.3.0 — Predictions tab + bracket zoom** — players fill in the blank knockout
  bracket (winner of every R32→Final tie), saved against their existing player name
  (`state.predictions[playerId].picks`, honour system — no auth). Opens once the R32
  is seeded (groups complete), auto-locks at first R32 kick-off. Weighted
  round-advancement scoring (`PREDICTION_WEIGHTS`: R32 1 / R16 2 / QF 3 / SF 5 / 3rd
  1 / Final 8) → live "percentage right" leaderboard; others' picks hidden until
  lock. `resolvePredictionTree` = pure sibling of `resolveBracketTree` (propagates
  *picks* not results); `scorePrediction` diffs predicted vs actual winners.
  Concurrency-safe `savePrediction` (re-reads the row fresh, merges only its own
  `predictions[me]` key — never spreads stale in-memory state, so it can't clobber
  another predictor or an auto-synced result). New `scripts/check-predictions.mjs`
  (5 assertions) wired into `npm test`. Bundled the bracket **zoom-to-fit** controls
  (−/Fit/＋, auto-scale, scroll/pan) that the Predictions UI reuses. Verified: build
  / `npm test` (39) / app boots clean (no console errors). Deployed; lock model later
  reworked in v1.3.2. The interactive tab needs a loaded sweep (real PIN) to exercise.
  2026-06-28.
- **v1.2.0 — Full knockout tree** — expanded the R32-only bracket to the whole
  two-sided tree (R16/QF/SF/Final/3rd). `KO_FLOW` + `resolveBracketTree` propagate
  winners (and SF losers → 3rd place) from results; only finished matches advance.
  Resolver validated in a scratchpad sim (propagation, pens, live-no-advance);
  build / `npm test` (34) / live preview desktop+mobile. Known: a pens game ESPN
  can't resolve stalls that branch until the organiser enters the pens winner
  (auto-resolved from ESPN's `shootoutScore` in v1.3.3). 2026-06-27.
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
