# The risk surface in depth (reference — load before risk-lane work)

The risk surface here is **data loss** — the writes to the single `sweepstake`
table. This is NOT a security surface: there's no signup, the users are the owner
plus friends and family, and access control is deliberately not a concern (don't
treat RLS/the public anon key as a threat to defend). The one thing that's hard to
undo is **clobbering a sweep's state**: a bad write silently corrupts or wipes a
sweep, and one path fans a write out to *other* sweeps on the device.

## The model

- **One table, `sweepstake`.** Each row: `{ id (PK, = the view PIN), data (JSON
  blob = the entire sweep state), updated_at }`. No relational structure — the
  whole sweep is one document.
- **Access is the public anon key** (committed in `src/supabase.js`, intentionally).
  No login. PINs (row `id` = view PIN; `organiserPin` gates editing in the UI) are
  soft convenience gates for "which sweep / can I edit", **not security** — don't
  harden them or add auth.
- **Why a mistake is expensive:** `saveSweep` is an `upsert` of the *entire* `data`
  blob with no server-side merge. A partial or stale write silently destroys
  fields. And `addResultsToAll` deliberately writes to **every other sweep
  remembered on this device** — a bug there corrupts sweeps the user didn't even
  open this session. There's no staging DB and no backups; the live row is it.

## The safe pattern

- **Always write through `commit` / `saveSweep`, building `next` by spreading the
  latest state** (`{ ...state, results: … }`). Never construct a fresh object with
  only the fields you changed.
- **Reads via `loadByPin` / `loadById`** only. The cross-sweep broadcast in
  `addResultsToAll` re-loads each other sweep fresh from the server, merges, and
  saves it back — never write a sweep from stale in-memory state you didn't just
  load.
- **Respect the overwrite gate**: auto-sync (`updateExisting: true`) only corrects
  results whose `id` starts with `espn_`. Human-entered results (`imp_…` / `m…`)
  are never overwritten. Keep that check on any new merge path.

## Verifying for real

- **Verify against a throwaway sweep in the running app**, not against the schema
  in your head. Paste a result, refresh, confirm scores/elimination land — and that
  a *manual* result survives an ESPN auto-sync.
- **Before any destructive or broad write** (`deleteSweep`, a `saveSweep` that
  drops fields, the cross-sweep broadcast), prove on a disposable sweep first that
  the *other* fields and *other* sweeps are untouched. Data loss is the whole risk.

## Catalogue of existing primitives

- `loadByPin(pin)` — id lookup, then legacy `data->>pin` fallback → `{id, state}`.
- `loadById(id)` — direct id lookup → `{id, state}`.
- `pinExists(pin)` — boolean, used at setup to avoid PIN collisions.
- `saveSweep(id, state)` — `upsert` of the whole blob + `updated_at` → boolean.
- `deleteSweep(id)` — hard delete by id.
- `commit(next)` (in `App()`) — the sanctioned state-write wrapper.
- `addResultsToAll(newResults, {updateExisting})` — merge into current sweep AND
  broadcast brand-new results to every other remembered sweep.
- `autoSyncStandings()` — derive group winners + group-stage exits from ESPN
  standings and broadcast them to every remembered sweep (loads each fresh first,
  so it never clobbers results). Uses the pure `mergeDerived` (additive union —
  never clears a manual flag) and `deriveFromStandings` (completed groups only).

When you add a privileged path or change RLS, add a line here on the way out
(closeout).

## Traps that fail silently

- **Partial `saveSweep`** — writing `{ id, data: { results } }` instead of spreading
  full state wipes every other field. No error; the sweep just loses data.
- **Stale broadcast** — saving another sweep from in-memory state rather than a
  fresh `loadById` clobbers concurrent changes. Always re-load before merging.
- **Dropped overwrite gate** — letting auto-sync overwrite non-`espn_` results
  silently reverts an organiser's manual correction on the next refresh.
- **RLS too wide** — a policy that grants the anon role more than intended leaks or
  lets anyone overwrite any sweep, and nothing in the UI surfaces it.
- **Unmapped team** (`return []` in `autoSyncFromESPN`) — a real result never lands
  and no one is told. Cross-check `API_TEAM_MAP` when scores look missing.
