# Game graphics — hero object inventory and quality levels (Phase 2, 2026-10-05)

Every object in a NavBharatAI 3D game is built by code in `src/server/lib/Game3DGenerator.ts`. The generated app writes these modules to `src/game/three/`. Nothing is downloaded, so a published game can never lose a model file.

This file lists what each hero object is today, measured from the geometry the generated app runs (`tests/aHeroObjectIsNotABox.test.ts`). It does not record what anyone hoped for.

## Quality levels

These levels adapt the four levels in the admin's Phase 2 brief to how this engine actually works.

| Level | What it means | Example |
|---|---|---|
| **L0 — placeholder** | Primitive boxes or spheres stacked to stand in for an object. Only the scale is right. | The car, human and animals on `main` before Phase 2 |
| **L1 — silhouette** | Built from the object's own outline and proportions: a profile, a lathe or tapered limbs. It reads as the object from any angle at game distance. | Every hero object in `lite` |
| **L2 — detailed procedural** | L1 plus secondary detail you notice up close: door seams, rims with spokes, eyes, ears, horns, generated surface textures and reflections. | Every hero object in `real` |
| **L3 — authored or generated mesh** | A sculpted, scanned or AI-generated model (GLB) with its own UVs and textures. | **Not available.** See "What L3 needs" below. |

## The inventory

Triangle and mesh counts are per object (one mesh is one draw call). Before Phase 2, the human had one detail tier only.

| Object | Builder | Before | Now: lite | Now: real | Triangles lite / real | Meshes lite / real | What identifies it |
|---|---|---|---|---|---|---|---|
| Car | `createCar` | L0: four boxes and a box cabin (208 / 1,644 tris) | L1 | L2 | 1,532 / 4,688 | 17 / 27 | Extruded side profile (nose, bonnet, windscreen rake, roof, boot). Wheel wells cut into the sill. Glass greenhouse on a shoulder, framed by A/B/C pillars. Mirrors, sills, lathed tyres, spoked rims, glowing head and tail lights. Real tier adds door seams, handles, grilles, plate and dark well liners. |
| Human | `createHumanoid` | L0: box limbs, box head, box of hair (156 tris, 13 meshes, top of head at 1.66 m for a 1.8 m figure) | L2 (one tier) | L2 | 5,282 | 16 | Torso lathed with waist, chest and shoulders. Tapered capsule limbs. Round shoulders and hands with a thumb. Visible neck. Egg-shaped head with jaw, nose, ears, eyes and a hair cap. Shoes with heel and toe. The crown lands at the requested height. |
| Dog | `createAnimal({kind:'dog'})` | L0 (same box rig as every kind) | L1 | L2 | 2,214 / 5,848 | 17 / 17 | Short barrel body, snout, upright ears, paws, tail carried up |
| Cow | `createAnimal({kind:'cow'})` | L0 | L1 | L2 | 2,272 / 5,512 | 20 / 20 | Deep barrel on shorter legs, zebu hump (an Indian cow), horns, side ears, a tail ending in a tuft |
| Horse | `createAnimal({kind:'horse'})` | L0 | L1 | L2 | 2,092 / 4,916 | 18 / 18 | Long neck carried high, mane, long legs, hooves, long hair tail |
| Deer | `createAnimal({kind:'deer'})` | L0 | L1 | L2 | 2,362 / 5,412 | 18 / 18 | Slender legs, small head held up, big ears, branching antlers, white scut |
| Motorcycle, bicycle | `createMotorcycle`, `createBicycle` | Not re-audited in Phase 2 | — | — | — | — | Built 2026-08 to real proportions (wheelbase, raked forks, spokes). Not changed here. |
| Tree, house, road, river, mountain, desert | `createTree` … | Fixed in Phase 1 (#3554) | — | — | — | — | Not changed in Phase 2 |

For scale, a scene of 10 real-tier cars and 20 humans costs about 150,000 triangles in about 590 draw calls. That is comfortable on a desktop. On a mid-range phone it is near the budget, which is why a plain "3D game" uses lite by default.

## What every Phase 2 object guarantees (locked by tests)

`tests/aHeroObjectIsNotABox.test.ts` locks the following guarantees. Running it against the old builders fails 12 of its 14 cases.

- **Car**
  - The body is an extrusion, not a box.
  - Over each axle the body starts above the top of the tyre, so the tyre sits in a well.
  - The bonnet is at least 0.45 m below the roof.
  - The glass is narrower than the body.
  - It is about 4.3 × 1.8 × 1.45 m and its tyres touch y = 0.
- **Human**
  - It contains no box.
  - The crown is within 3% of the requested height.
  - The soles are on the ground.
  - The eyes face +Z.
  - All 13 named joints are present and the walk still moves the legs.
- **Animals**
  - None contains a box.
  - The top of the head lands exactly on `ANIMAL_HEIGHT`.
  - Hooves and paws are on the ground.
  - The four kinds have measurably different outlines. The old rig was one box animal at four sizes.
- **No lathed part folds through itself.** The cow's short, thick neck did fold during development and rendered as a flat disc. The fix caps each end at 45% of the part's length. Removing it fails the test.
- **Cost:** lite is lighter than real for every object, and draw calls stay at or below 28 (real) and 22 (lite).

## Performance tiers and the phone

- **`lite`** is the default and the phone profile. It uses no texture maps and fewer segments, and it keeps the same silhouettes.
- **`real`** is chosen when the user asks for realism. It adds texture maps, clearcoat paint, bevel segments and secondary detail.
- Small parts that share a material are **baked into one mesh**: pillars, mirrors, seams, spokes, facial features and antlers. That is why the redesigned car draws in fewer calls (27) than the old box car (29).
- One merge helper (`mergeGeometries` in `surfaces.ts`) serves world, objects and humanoid. It replaces the copy that lived in `world.ts`.

## Not built, and why

- **AssetProvider abstraction and asset manifest.** With exactly one provider (procedural code), an abstraction layer would be speculative structure with nothing behind it. It becomes worth building the day a second provider exists, such as a GLB service or a CC0 library. Until then the fallback order below is the design.
- **Fallback hierarchy (the design to follow when L3 arrives):**
  1. a validated, cached GLB (L3);
  2. procedural `real` (L2);
  3. procedural `lite` (L1).

  A failed or slow asset service must never leave a blank game. The procedural builders are the floor.

## What L3 needs

L3 needs one of the following, and both are decisions for the admin:

- **GPU-generated meshes.** This means new GPU infrastructure and a licence review of the model weights. See `open-source-license-audit.md`.
- **A curated CC0 model library.** CC0 is free to use, but the library needs curation and hosting.

Neither is required to stop shipping L0 boxes. That was the purpose of Phase 2.

## How to see it

The benchmark renders the same scene, camera, lighting and renderer for BEFORE and AFTER:

- a car;
- a motorcycle and a bicycle;
- a walking human;
- a dog, a cow, a horse and a deer;
- a tree;
- a tiled house.

It shoots views from the side, from behind (the chase view), close-ups of the human and the animals, and the whole line.
