# Core architecture (reference — load when touching the main code)

Almost the whole app is `src/App.jsx` (~3k lines). Read the relevant section
before editing; don't assume a helper lives elsewhere — it almost certainly
doesn't.

## Layout (top of `App.jsx`, roughly in order)

- **Constants / canonical data** — `TIERS`, `TEAMS` (+ `TEAM` lookup by id),
  `STAGES` (+ `STAGE` lookup), `DEFAULT_SCORING` / `SCORING_LABELS`,
  `API_TEAM_MAP`, the API-mapping helpers. These are the source of truth the rest
  of the file keys off.
- **Pure helpers** — `parseDrawTable`, `parseResultsText`, `findTeamId`,
  `apiTeamId`, `apiRoundToStage`, `apiFixturesToPasteText`, `shuffle`, `runDraw`,
  `koWinner`, `teamMatchPts`, `buildStats`, `generateCommentary`, and the canvas
  helpers (`rrect`, `hline`, `wrapText`, `buildShareCanvas`). All pure — no React,
  no Supabase.
- **Storage layer** — `loadByPin`, `loadById`, `pinExists`, `saveSweep`,
  `deleteSweep` (the only code that calls `supabase.from(...)`), plus the
  localStorage helpers `loadKnownSweeps` / `rememberSweep` / `forgetSweep`.
- **`App()`** — the root component. Holds top-level state (`state`, `sweepId`,
  `phase`, `tab`, `saveStatus`, `unlocked`, `known`) and the orchestration
  functions: `openSweep`, `commit`, `addResultsToAll`, `autoSyncFromESPN`,
  `refresh`, `tryUnlock`, `goHome`. **There is no router** — `phase`
  (`landing` / `admin` / `setup` / `reveal` / `main`) is the navigation.
- **View components** (same file): `Landing`, `AdminView`, `Splash`,
  `SetupScreen`, `DrawReveal`, `Main`, `HowItWorks`, `TableView`, `ShareModal`,
  `ErrorBoundary`, `Styles`, etc.

## The `state` object (the whole sweep, one JSON blob)

Everything about a sweep is one plain object, persisted as `sweepstake.data`. Key
fields: `name`, `viewPin`, `organiserPin`, `parts` (players: `{id, name}`),
`assignments` (`{playerId: [teamId,…]}`), `teamsPer`, `results` (array of match
objects), `eliminated`, `groupWinners`, `scoring` (overrides over
`DEFAULT_SCORING`). New features are almost always a new key here (see
`feature-expansion`). Tolerate absent keys — old rows won't have them (e.g.
`scoring` falls back to `DEFAULT_SCORING`).

A **match/result object**: `{ id, stage, teamA, teamB, scoreA, scoreB, redsA,
redsB, pensWinner, at, live? }`. `stage` is a `STAGE` id (`GROUP`, `R32`, `R16`,
`QF`, `SF`, `THIRD`, `FINAL`). The `id` prefix tells you provenance (golden rule
4): `espn_…` auto-synced, `imp_…` pasted import, `m…` manually typed.

## The core patterns to match

- **Storage functions** are `async`, query the single `sweepstake` table, and
  return a normalized `{ id, state }` (or `null` / a boolean) — never raw Supabase
  rows. Errors degrade quietly (`maybeSingle`, `try/catch`, `return null`); they
  don't throw to the UI.
- **State changes go through `commit(next)`** in `App()` — it sets state, calls
  `saveSweep`, manages the save-status indicator, and refreshes the remembered
  name. Don't call `saveSweep` directly from a component; build `next` by spreading
  current state and hand it to `commit`.
- **Scoring is centralized** in `teamMatchPts` (one team in one match) and
  `buildStats` (the whole leaderboard, elimination, ranks). UI reads what these
  return; it never recomputes points inline.
- **Tolerant parsing**: `parseResultsText` accepts hyphen/en/em dashes
  (`[-–—]`), `#`/`/` comment lines, optional pens and reds, and dedupes. Match its
  leniency if you extend the format.

## The mirror / sync traps (edits that look done but aren't)

- **`API_TEAM_MAP` ↔ `TEAMS`.** ESPN sends display names; `apiTeamId` maps them to
  internal team ids via `API_TEAM_MAP`. Add a team to `TEAMS` and forget the map
  entry → ESPN results for that team are **silently dropped** (`return []` in
  `autoSyncFromESPN`). Update both.
- **`apiRoundToStage` ↔ `STAGE`.** ESPN round text → internal `STAGE` id. A round
  string it doesn't recognize mis-stages or drops the result.
- **`fixtures.js` ↔ the ingest in `App.jsx`.** The Netlify function shapes the
  ESPN payload (`statusState`, `round` from notes, red-card counts);
  `autoSyncFromESPN` consumes that exact shape. Change one side, change the other.
- **Two paths write results**: `parseResultsText` (manual/import) and
  `autoSyncFromESPN` (machine). They share the `addResultsToAll` merge — keep the
  identity rule (stage + unordered pair) and the `espn_`-only overwrite gate intact
  in both, or you get duplicates or silently-reverted manual fixes.
