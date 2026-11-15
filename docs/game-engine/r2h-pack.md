# R2H original pack recovery — draft, disabled

The three original GLB files were recovered locally from the owner's separate
“3D चरित्र बनाना” Work conversation. It does **not** recover that Work session's
unpublished integration, 2D exports, motorcycle poses, or test history.

**The original binary assets are NOT included in this draft PR.** Binary publication
through the available connector could not be completed. The required destination
is `private-game-assets/r2h/` (outside `public/`). The owner's Library retains
`R2H_01_Cap.glb`, `R2H_02_Leather.glb`, and `R2H_03_Denim.glb` from the
“3D चरित्र बनाना” Work conversation. Retrieve those originals, not replacements.
Their exact byte sizes and SHA-256 identities are pinned in `r2hPack.ts`.
They were not regenerated or optimized. This PR is an incomplete, disabled
integration scaffold, not a ready-to-use character feature.

The existing new-3D-game asset seed invokes the pack. It remains unavailable
unless all of the following are satisfied:

1. A separately reviewed code change records approved image, likeness and
   commercial game/source redistribution rights in `R2H_RIGHTS_REVIEW`.
   It is currently **false** with no evidence. These assets are **not CC0**.
2. `AGENTV3_R2H_CHARACTERS=on` and the authenticated owner UID appears in the
   comma-separated `AGENTV3_R2H_OWNER_ALLOWLIST`. Both are unset by default.
3. The new 3D game's prompt explicitly requests a human/character or R2H.

The selected character is stable per workspace. Existing/imported/reopened
projects are not migrated. Before any handoff the normal GLB structural and
sandbox render gates still run, exact bytes are durably saved/read back, and
the model is copied to the generated game's content-addressed asset path.
The existing local asset loader provides lifecycle/animation handling.
The architect receives a real asset path and integration instructions, not
an assurance that final gameplay has already passed.

## Honest limits / release blockers

- Original files contain Idle and Walk only. No riding, combat, jump, facial,
  2D, or photorealistic quality guarantee is made.
- This optional branch currently selects the approved human pack instead of
  external scenery acquisition for that seed; do not enable without deciding
  the combined-catalogue behavior and acceptance contract.
- Multiple-file persistence is not transactional. Failures can leave partial
  additive files. The normal new-project guard remains mandatory.
- No public activation, merge, deployment or billing change is authorized by
  this draft. Env flags alone do not grant rights.
- The owner requested **no tests** for this work. No lint/typecheck/unit/full
  CI/browser/mobile tests were run on this draft. Reading GLB metadata and
  preserving file hashes is not gameplay validation.
- Before release: rights review; final-tree static/automated checks; actual
  3D browser/mobile rendering, load failure/cancel/retry/teardown and export/
  restore; owner-isolation and existing-project preservation; no double human;
  data/file race review and final integration review.

No secret key or private identity data is recorded here.
