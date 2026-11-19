# Game library librarian
This is an index over the existing object catalogue and reviewed model catalogue, not a second asset store.
Use the existing object_spec tool with library_query and optional category/animation. Empty query lists the category summary and bounded results. Existing object/objects calls retain prepared-local-model priority.

## Evidence levels
- specification-only: dimensions and modeling guidance, no ready bytes.
- code-recipe: an existing builder recipe, not a pre-rendered model.
- requires-admission: reviewed model metadata; existing download/license/hash/GLB/render/persistence admission still required.
- local-model-prepared: reported only for a successful actual seed and its matching model outcome.
- placement/gameplay: always pending until the existing finished-game tests prove them.
Device certification is not measured. Admission resource ceilings are validation limits, not a guaranteed FPS or performance class.

## Boundaries
The original index-only change acquired no new assets. The separately described successor below acquired quarantined candidates, not an activated map or audio pack. Empty maps/audio categories honestly report that no ready-made files are indexed. Existing procedural terrain and effects are unaffected.
A model of a house is not a functional interior. Search does not certify collision, navigation, doors, stairs, animations, controls or final scene performance.
The actual game seed hands the builder the prepared/missing checklist. Existing admission, runtime placement and game playtests remain authoritative. No rollout environment defaults, providers or prices change.

## Remaining work
Curate and license additional content; measure device-specific scene budgets; acquire test evidence for complete playable scenes; add map metadata only when real reusable map files and rights exist. This patch does not complete those steps or promise universal game generation.

## Successor scope: explicit requirements and actual asset candidates
`object_spec.library_plan` accepts the game prompt, up to 16 explicit subject/role/animation requirements, and known WebGL2 capability. It preserves explicit requirements before optional existing genre scenery. Unknown device capability uses conservative planning ceilings and remains **unmeasured**; known missing WebGL2 reports unsupported 3D and offers a separate 2D decision. These are not FPS promises or a target-device test.

Eleven new CC0 candidate models were actually downloaded from two official immutable KayKit pack revisions: four animated characters, two cars, two road tiles and three city props. Source/resource/license hashes and derived bytes/triangle/clip measurements are in `docs/game-engine/asset-candidates/2026-11-13-batch.json`. All passed existing GLB validation after existing bounded preprocessing. The 11 derived files total 2,038,360 bytes. **Not activated**: Chromium render proof was blocked by Unix socket EPERM in this environment, including a permitted escalation. They are quarantined outside the runtime catalogue; this preserves existing admission standards. `scripts/review-game-library-candidates.mjs` reproducibly downloads and verifies individual source/license/resource bytes, never runs automatically.

No new finished maps, weapons, sound effects or nature/building packs were acquired in this batch. Existing catalogue content remains available under its prior rules. Official Kenney UI Audio and Impact Sounds pages explicitly list CC0 and are useful next candidates, but this implementation has not acquired or admitted their bytes. Road pieces are not complete maps. Character animations are model-specific clips, not a universal retargeted animation library.

## Follow-on admission: quarantine superseded, not a deployment claim
The eleven acquired candidates subsequently passed permitted headless-shell rendering, normal acquisition/cache and actual builder-seed checks, plus a bounded local production artifact. Their initial quarantine record is historical. See `game-engine/library-admission-2026-11-13.md` for reproducible commands and exact limits. This candidate adds them to reviewed metadata without enabling rollout flags; final CI/merge and live availability remain separate.

## 2026-11-19: storage budget and MIT
The 64-model count cap became a 320 MiB storage budget (same ceiling, measured in bytes; undeclared sizes count
as 5 MiB). MIT joins CC0 and CC-BY-4.0, with the full MIT notice shipped in `ATTRIBUTION.txt`. No new models were
added by this change. Growth plan, subject list and source survey: `game-engine/library-growth-plan-2026-11-19.md`.

## 2026-11-19: library batch 2 (50 models, 97 total)
Fifty CC0 (KayKit) and MIT (Kenney Starter Kit) models were derived from pinned sources and each admitted LIVE: download
through the production transport, production acquisition engine, Chromium render/motion proof and durable-cache restore.
Evidence: `game-engine/library-batch-2026-11-19.md`, `asset-candidates/2026-11-19-admission.json`. The librarian lists
them automatically through `REVIEWED_GAME_ASSETS`.
