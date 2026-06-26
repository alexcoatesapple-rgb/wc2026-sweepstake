---
name: release-cut
description: >-
  Cut a World Cup 2026 Sweepstake release / ship a batch — the version-bump ritual. Use
  when finishing a batch and the user says "ship it", "cut a release", "bump the
  version", "merge this", or when a verified feature/fix batch is ready to land.
  It runs the fixed sequence: branch → conventional commits → version bump →
  docs/memory update → no-fast-forward merge with a versioned merge message. Use
  this instead of improvising so nothing (version, CURRENT_STATE.md, the merge
  format, memory index) gets skipped. Only run when work is already verified
  (session-closeout) and the user has asked to ship.
---

# Release cut

A "release" is shipping a verified batch to the main branch with a clean,
revertable history and a bumped version. Follow the pattern exactly so history
stays readable and any single change stays revertable.

> ⚠️ Know what "ship" means here: **push to `main`, which makes Netlify auto-build and deploy to production.** If pushing the main branch
> auto-deploys to production, treat every push as a deploy — pre-flight and
> confirm before pushing. Never push on your own initiative.

**Only run this when the work is already verified** (see session-closeout) and the
user has asked to ship.

## Versioning
- Version lives in `package.json` (`version`).
- **patch**: bug-fix batch, no new surface.
- **minor**: new feature/surface.
- Bump as part of the release commit. (If the project has no versioning, skip the
  bump and just keep the clean-history + docs/memory steps.)

## Commit & merge convention
Work happens on a branch off the main branch, then merges back with `--no-ff`:

```
# conventional commits on the branch:
feat(<area>): <what>
fix(<area>): <what> (audit B7)

# then a no-ff merge commit naming the version + a one-line summary:
git checkout main
git merge --no-ff <branch> -m "Merge <batch> (vX.Y.Z): <summary>"
```

- Branch names: `feat/<slug>`, `fix/<slug>`.
- Risk-lane items (Supabase persistence (the `sweepstake` table writes and the cross-sweep result broadcast)) = **one isolated commit each**, individually
  revertable. Safe-lane items can be grouped.
- End commit-message bodies with the `Co-Authored-By` trailer.

## The sequence
1. Confirm the batch is verified (preview-seen; risk-surface checks clean). If not,
   stop — run closeout first.
2. Branch off the main branch if not already on one.
3. Commit the work (conventional messages; one commit per risk-lane item).
4. Bump the version in `package.json` (`version`) (patch vs minor).
5. Update **CURRENT_STATE.md** with what shipped under this version.
6. If this batch came from a backlog doc (an audit / plan doc), update its status
   banner — mark items shipped with the version.
7. Update **memory**: the relevant memory file + index line (absolute date).
8. `git checkout main` → `git merge --no-ff <branch> -m "Merge … (vX.Y.Z): <summary>"`.
9. **Pre-flight before any push** (if pushing auto-deploys): survey the full
   unpushed set, confirm nothing not-ready would go live, LOUD-STOP if it would.
   Push only if the user asked.

## Don't
- Don't push without explicit go-ahead.
- Don't squash risk-lane items together — keep them individually revertable.
- Don't skip the version bump or the CURRENT_STATE.md/memory update — future sessions
  and the changelog depend on them.
