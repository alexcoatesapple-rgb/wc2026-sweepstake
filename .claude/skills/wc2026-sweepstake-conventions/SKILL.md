---
name: wc2026-sweepstake-conventions
description: >-
  Conventions, architecture, and gotchas for World Cup 2026 Sweepstake (at
  "/Users/alexcoates/Documents/wc2026-sweepstake"). Use this skill at the START of any coding, debugging,
  feature, schema, or config work in this repo, even when not explicitly asked —
  it carries the stack, the golden rules, and the recurring-mistake list so the
  session starts already knowing the setup. If a task touches this project's
  code or its Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast), consult this first.
---

# World Cup 2026 Sweepstake — conventions

> FOUNDATION skill. Loads first, every session. Keep it small: stack + golden
> rules + pointers. Heavy detail lives in `references/`, loaded only when the task
> touches that area — don't load all references up front.

A web app for running a World Cup 2026 office/friends sweepstake. An organiser
creates a sweep, players are randomly assigned teams across tiered bands, and the
app tracks results, scores each player, and renders a live leaderboard + shareable
matchday graphics. Multiple independent sweeps coexist, each reached by a PIN.

## Stack (what's actually here)

- **React 18 + Vite** single-page app. Almost everything lives in one file —
  `src/App.jsx` (~3k lines): team/result parsing, scoring, every view, and the
  canvas share-image renderer. `src/supabase.js` is the only other logic module;
  `src/main.jsx` just mounts.
- **Persistence: Supabase**, a single `sweepstake` table. Each row is
  `{ id, data (a JSON blob holding the whole sweep state), updated_at }`. The
  public anon key is committed in `src/supabase.js` (safe — RLS governs access).
  No login/auth: access is PIN-based — the row `id` is the view PIN; an organiser
  PIN gates editing.
- **One Netlify function**, `netlify/functions/fixtures.js`, proxies the ESPN
  scoreboard API (no key) for live/finished scores.
- **Device memory** via `localStorage` key `wc26_known_sweeps` (the sweeps this
  browser has opened).
- **Hosting: Netlify** (static `dist` + functions). **Push to `main` auto-deploys
  to production.**
- **Deliberate omissions — do NOT add:** no router (phase is `useState`), no
  TypeScript, no CSS framework (styling is one inline `<Styles/>` CSS string), no
  test framework, no state-management lib (plain `useState`), no component-per-file
  split. Match the single-file, hand-rolled style of the file you're in.

## The golden rules (where the recurring bugs come from)

The short list of invariants that, when broken, cause this project's repeat bugs.
Internalise them before touching code. Keep it to 5–8 — if everything is a golden
rule, nothing is.

1. **All Supabase access goes through the four storage helpers** in `App.jsx` —
   `loadByPin`, `loadById`, `saveSweep`, `deleteSweep`. Components never call
   `supabase.from(...)` directly. There is exactly one table: `sweepstake`.
2. **`saveSweep` upserts the ENTIRE `data` blob** — there is no server-side merge.
   Always build the next state by spreading the latest (`commit({ ...state, … })`);
   never write a partial object or you wipe fields. Writes are last-write-wins.
3. **A result's identity is `stage` + the unordered team pair.** Every dedupe/merge
   keys on that, never on score or team order. ESPN home/away can be flipped vs the
   stored `teamA`/`teamB` — handle the flip when updating an existing result.
4. **The result `id` prefix encodes provenance and gates auto-sync.** `espn_…` =
   machine-synced, may be overwritten by an ESPN refresh; `imp_…` / `m…` =
   human-entered and must NEVER be overwritten by auto-sync. Preserve the prefix;
   don't regenerate ids on edit.
5. **The ESPN→internal lookup tables must stay in sync with the canonical data.**
   `API_TEAM_MAP` mirrors `TEAMS` (ESPN name → team id); `apiRoundToStage` maps
   ESPN round text → `STAGE` id. An unmapped team is **silently dropped**
   (`return []`) — add the mapping whenever you touch teams/stages.
6. **The ESPN season slug is NOT the round.** Round comes only from competition
   notes (see `netlify/functions/fixtures.js`). Never derive stage from the slug.
7. **Live (in-progress) matches score provisionally but must not eliminate teams.**
   Only finished, non-`live` knockout results set elimination in `buildStats`.
8. **Row `id` IS the view PIN** (one indexed lookup); the organiser PIN gates
   editing. Don't break the `id === viewPin` invariant or the legacy `data->>pin`
   fallback in `loadByPin`.

## Workflow expectations

- **Smallest change that works.** This is a live project — match the style of the
  file you're in; don't refactor adjacent code into the diff.
- **One item vs a batch?** Single item → the specific skill (**feature-expansion**
  to pick a new feature's shape; **supabase-change** for risk-surface work).
  A grab-bag of mixed items shipping together → start with **batch-orchestrator**,
  which triages into safe/risk lanes.
- **Verify before declaring done** (see **session-closeout**). For risk-surface
  changes, verify against the live system, not the docs.
- **Risky surface?** Plan first, then apply (see **supabase-change**).
- **After a meaningful change**, update CURRENT_STATE.md and bank any non-obvious
  durable fact to memory.

## Reference files (load on demand)

> These two are a starting split (core vs risk). Add or split references as the
> project's surface warrants — e.g. a separate migrations/ops or integrations
> reference. Keep each one loaded only when its area is in play.

- [references/domain-core.md](references/domain-core.md) — the core architecture:
  the data/logic layer, the main modules, the patterns to match.
- [references/domain-risk.md](references/domain-risk.md) — the Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast)
  in depth: the model, the safe patterns, the catalogue of existing primitives,
  the traps that fail silently.
