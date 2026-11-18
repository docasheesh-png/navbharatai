# Requested world composition (optional Athree recipe input)

The user's intent is automatic generation from their request, not only a preset catalog. This increment accepts a bounded structured request on the existing generate_athree_map recipe. The builder derives supported parameters from the user's prompt and wires createRequestedWorld into its existing lifecycle. The helper constructs the seed-based world and original modules at runtime. It is not universal text-to-object modeling.

## Safety and limits
- Existing AGENTV3_ATHREE_MAP flag and athreeMapIntent decision remain mandatory; no activation change.
- Size 1–100 km, signed 32-bit seed; >100 km fails rather than promising unvalidated support.
- Default recommended target is phone. Active visual object budgets: phone 16, mid 32, desktop 64.
- Objects: human, dog, cow, horse, deer, goat, tiger, car, motorcycle. Factory geometry is original procedural, not scanned photorealism.
- Unsupported properties, object kinds, duplicate groups and excess budgets fail closed.
- Safe dry, gently sloped spawn checks; placement failures are returned, not hidden.
- Existing source must be identical or absent. Additive-only writer forbids automatic kit refresh. Existing imported/edited projects are not replaced.
- Read errors propagate; final source readback is checked. Existing actuator read/write is not an atomic transaction. Partial new files may remain after failure; inspect before retry.
- A scaffold manifest is required. Incompatible existing Three versions require review; dependency failure/busy status is not runnable success.
- Resource ownership is captured before scene exposure. Disposal continues over event-listener failures; later attached foreign resources are not destroyed. Shared material caches remain with their existing global owner.
- Scene assets and adapter lifetime are caller-owned; call returned dispose. Visual modules do not implement vehicle physics, navigation, multiplayer or combat.
- No billing activation, fake delay, remote model fetching or image generation.
- No claims of 100+ distinct completed maps, 1000km runtime worlds or certified mobile FPS. Browser/mobile acceptance and full CI remain release requirements.

## Integration
run_recipe accepts input.composition on generate_athree_map:
seed, profile, widthKm, quality, rivers, vegetation, and objects [{kind,count}].
The generated requestedWorld module returns composition, placement issues and dispose.
Call composition.update with world player position/time/delta; use composition.map for camera/terrain/physics integration.
A generated helper is not proof that every caller wired it correctly. Verify the final game loop and teardown.

Reconciled against ec304f4 (#4214), which adds native Athree roads and driving APIs. Those existing modules are preserved. These optional generic visual adapters do not replace native vehicle physics; select the native Athree driving API when a request needs driving.

Reconciled against 6920f248 (#4215): reuse the native `include`/request selector for every composition; omitted optional renderers stay omitted. Conflicting vegetation/visible-river requests fail rather than silently adding modules. Core terrain data remains the native implementation. Run composition before standalone model recipes in a fresh project; existing differing model sources remain protected, not refreshed. Selected core/roads-only compositions are covered by real runtime tests.

## Explicit exclusions
The bounded English/Hinglish/Hindi module selector honors common prefix/postfix exclusions and coordinated lists; explicit exclusions win conflicts. Model-provided include cannot override them. This is bounded phrase parsing, not complete language understanding. Omitted modules with no explicit exclusion retain historical core-data behavior. Explicit road/river exclusions additionally disable their world data/carving in the generated map facade; caller options cannot silently re-enable them. Vehicle exclusions also reject car/motorcycle composition objects. Explicit sea exclusion removes ocean and fallback plane visuals, but sea-level terrain/biome data remains; no dry-land-only guarantee. Existing-project differing sources still refuse additive installation.

## Draft release hold (2026-11-15)
The owner requested stopping tests and publishing a draft. The preceding tree passed scoped gates,
build/bundle, an unchanged normal boot retry and 11 local Firestore drills; its full coverage run was
stopped (exit 130), not passed. The subsequent atomic creation changes and new regressions have static
review only: exact final-tree tests are not run. GitHub CI and deployment are not claimed.
Composition now requires atomic exclusive source creation before mutations, preserving competing source
files. Linux O_TMPFILE/procfs support on a real E2B sandbox is unverified; unsupported backends fail closed.
Dependency manifest changes and multi-file additions are not transactional. Browser/mobile acceptance
remains unverified. This is bounded library composition, not arbitrary missing-object generation,
photorealism certification, or a 1000 km world implementation. Do not merge or enable before acceptance.

### Static reconciliation with map kinds/sizes (#4229)
The native map path retains upstream archetype selection and 1–1000 km terrain sizing. This is not
certification of density, realism or device performance at those sizes. Bounded object composition
retains its 1–100 km contract; its width is authoritative for generated MAP_OPTIONS and an explicit
conflicting size_km is refused before writes. Requested archetype style remains selected. Explicit
module exclusions are applied after MAP_OPTIONS and runtime options, so roads/rivers cannot be
re-enabled by map defaults. This combined draft has static review only; no tests run by owner instruction.
