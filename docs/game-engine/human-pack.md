# Human characters pack — draft, disabled

The three original GLB files were recovered locally from the owner's separate
“3D चरित्र बनाना” Work conversation. It does **not** recover that Work session's
unpublished integration, 2D exports, motorcycle poses, or test history.

All three original binary assets are included under `private-game-assets/humans/`
(outside frontend `public/`, not a repository access-control boundary). Names, byte sizes and SHA-256 identities are pinned in
`humanPack.ts`; they were not regenerated, substituted or optimized. The originals
also remain in the owner's Library. This is a disabled integration draft, not
a validated or activated feature.

The existing new-3D-game asset seed invokes the pack. It remains unavailable
unless all of the following are satisfied:

1. A separately reviewed code change records approved image, likeness and
   commercial game/source redistribution rights in `HUMAN_PACK_RIGHTS_REVIEW`.
   It is currently **false** with no evidence. These assets are **not CC0**.
2. `AGENTV3_HUMAN_PACK=on` and the authenticated owner UID appears in the
   comma-separated `AGENTV3_HUMAN_PACK_OWNER_ALLOWLIST`. Both are unset by default.
3. A separate engineering review approves an atomic no-overwrite installation
   and actual runtime acceptance. `HUMAN_PACK_INTEGRATION_REVIEW` is currently **false**.
   Changing only the rights record or environment cannot activate this scaffold.
4. The new 3D game's plan or bounded prompt inference requires a human/character or Human pack.

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
- Human preparation now follows external scenery preparation and combines results;
  it no longer replaces scenery/vehicle acquisition or their manifests. Human files
  use a separate namespace. A human failure does not claim success or discard scenery.
- Human intent supports explicit terms and bounded implicit genres (battle royale,
  third-person shooter, team sports), with no-human exclusions and a trusted
  `needsHuman` plan override. This is not universal semantic intent detection.
  The optional structured plan field is not yet wired to every caller.
- A source audit found the persistence adapter has no atomic create-only operation.
  The independent engineering gate remains false until that is resolved.
  Multiple-file persistence is not transactional. Failures can leave partial
  additive files. The normal new-project guard remains mandatory.
- No public activation, merge, deployment or billing change is authorized by
  this draft. Env flags alone do not grant rights.
- The initial draft was published without tests at the owner’s request. The owner
  subsequently authorized local validation. Focused tests discovered that all three
  originals use `KHR_materials_specular`, rejected by the existing strict GLB policy.
  The originals and validator are unchanged. Tests now verify this fail-closed blocker,
  exact hashes, and disabled gates; they do not assert successful asset acceptance.
  Full local CI and browser/mobile acceptance remain pending.
- Provenance: these are AI-assisted files recovered from the owner’s Work conversation,
  not evidence that the owner personally created or holds redistribution rights.
- Activation additionally requires separately reviewed extension compatibility and
  real rendering acceptance. Do not strip extensions from originals or weaken the
  general untrusted-asset policy to bypass this blocker.
- Before release: rights review; final-tree static/automated checks; actual
  3D browser/mobile rendering, load failure/cancel/retry/teardown and export/
  restore; owner-isolation and existing-project preservation; no double human;
  data/file race review and final integration review.

Rights evidence is kept in the server review record, never interpolated into a public generated-game notice.

No secret key or private identity data is recorded here.

An already prepared external human is preserved rather than installing a second competing human. The owner-pack precedence policy still needs explicit integration before activation.

## Bounded compatibility review in progress

An exact-SHA-pinned adapter now accounts for the originals’ scalar-only
`KHR_materials_specular` metadata in a temporary validation projection. It never
changes persisted/rendered original bytes and does not broaden the global policy.
Denim passes that structural path; Cap and Leather still fail the unchanged
geometry-work budget. These failures are explicit compatibility blockers, not
passing asset acceptance. All activation gates remain false; no automatic
substitution, geometry-budget increase or model conversion is performed.
Independent security review and full validation remain outstanding.

Independent review also found the runtime Docker image does not copy
`private-game-assets/`; production packaging is therefore an additional activation
blocker. The directory name is not a confidentiality control: repository readers
can access committed models. No claim of private GitHub asset storage is made.

## Owner-authorized optimization copies

The owner clarified these supplied characters differ substantially from real people.
Names alone are not evidence of exact likeness or a legal conclusion. Existing rights
review gates remain unchanged pending an appropriate recorded review.

Separate copies under `private-game-assets/humans/optimized/` simplify only Textile
and Leather triangle indices, using meshoptimizer 0.22.0 (MIT), locked boundaries
and relative-error ceiling 0.0005. The original files are untouched. All face, skin,
hair, texture image, skeleton, weight and animation buffer data remains byte-identical.
Triangles: Cap 62,424 → 57,328; Leather 60,650 → 56,496; Denim 59,568 → 55,528.
File savings are modest, roughly 24–31 KB each, not a large compression claim.
The runtime still selects originals and all activation gates remain false; these
copies are review artifacts, not an activated substitution. Their structural budget
checks do not establish visual/animation/mobile acceptance.

Reproduce from repository root with Node and a separately installed pinned
`meshoptimizer@0.22.0` tool package:
`node scripts/optimizeRecoveredHumans.mjs /path/to/meshoptimizer/meshopt_simplifier.module.js`
No application runtime dependency is added. The generated report records hashes and
measured geometry error; browser/mobile comparison remains required before selection.
