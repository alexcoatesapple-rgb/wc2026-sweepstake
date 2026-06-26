# WC2026 Sweepstake — project instructions

This repo uses the **HarnessKit** skill suite in `.claude/skills/`. The foundation
skill `wc2026-sweepstake-conventions` loads first and carries the stack, golden
rules, and pointers — read it before touching code. The blocks below are the
always-on guardrails (they must fire without being "triggered").

---

## Push / deploy protocol

**On this repo, `git push` to `main` = a live production deploy** (Netlify
auto-builds and deploys `dist` + functions on every push to `main`). Treat every
push to `main` as a deploy. Do it only when explicitly asked — never on my own
initiative.

**Before any deploy, run a pre-flight and report it BEFORE acting:**
1. **Survey the full state** — what exactly would go out (all unpushed commits +
   working tree), not just the change in front of you.
2. **Check nothing is at odds** — scan for anything that should NOT go live yet:
   half-finished work, dead/owner-gated features, debug code, commits that
   contradict each other.
3. **🛑 LOUD STOP if the deploy would ship something not-ready.** Halt and say so
   in CAPS before doing anything. Being "ahead" of production is NOT a reason to ship.
4. **If unsafe to ship wholesale, present the safest path — don't ship.** Recommend
   one (hold / ship a safe subset on a branch / confirm dormant code is inert),
   then wait for the call.
5. **Irreversible changes are separate from deploys.** Supabase **RLS/policy
   changes** and **`deleteSweep` / destructive `saveSweep` writes** hit production
   the moment they run — there is no staging DB. Never conflate "code shipped" with
   "data change applied."

**Preview before deploying:** leave a running `vite` preview of the exact tree that
will ship and give a clickable link to eyeball it.

## Money / values guardrails

**Any action that could cost money or egregiously violate the project's intent gets
a LOUD, ALL-CAPS warning BEFORE it happens, then an explicit pause for
confirmation.** Format: `⚠️ STOP — THIS WILL [cost / expose / break] …`, then the
specifics, then wait. This covers:

- **Cost** — enabling anything with a recurring or per-use charge: a paid Supabase
  tier, a paid Netlify tier/add-on, or any third-party API that bills. (The ESPN
  proxy is currently free and keyless — keep it that way unless flagged.)
- **Exposure** — putting a not-ready feature in front of real users via a deploy:
  dead buttons or half-built flows that ship to the live site.
- **Data loss** — anything that could wipe or corrupt a live sweep: a partial
  `saveSweep`, a stale cross-sweep broadcast, or a `deleteSweep`. There's no
  staging DB and no backups. See
  `wc2026-sweepstake-conventions/references/domain-risk.md` before touching these.

> Security/access control is deliberately NOT a concern here — no signup, trusted
> users (owner + friends/family), public anon key by design. Don't add auth or
> harden PINs. No values/principles doc exists; the bar is the project's plain
> intent: a fair, non-destructive, free-to-run sweepstake.
