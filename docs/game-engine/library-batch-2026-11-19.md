# Library batch 2: fifty licensed models (2026-11-19)

Admin request: a much larger NavBharatAI game library so a game costs less to build and looks better.
The catalogue grows from 47 to 97 reviewed models (+4.96 MB served, ~100 KB per model).

## What was added (one subject per model; aliases cover plurals, Hindi and Spanish)
| Category | Models |
|---|---|
| vehicle-land | motorcycle (Kenney), 3 trucks (Kenney) |
| terrain | road junction / T-junction / crossing / curved tiles (KayKit City); race track straight / corner tiles and finish line (Kenney); mountain, hill (KayKit Medieval) |
| character | 4 skeleton enemies with Idle/Walking_A/Running_A (KayKit Skeletons); flying enemy (Kenney) |
| weapon | axe, crossbow, sword, shield (KayKit Skeletons); 2 blasters (Kenney) |
| collectible | 2 coins, coin block, flag |
| interior | bed, sofa, armchair, chair, stool, table, lamp, cabinet, shelf (KayKit Furniture) |
| vegetation | cactus, tree grove |
| building | castle, market, tavern, church, watermill, tower, barracks, bridge (KayKit Medieval) |
| street-prop | fence, bench, dustbin |

Licences: KayKit = CC0-1.0 (pack LICENSE.txt). Kenney Starter Kits = MIT (repo LICENSE); the copyright line is the
entry's `attribution`, and the full MIT notice ships in the game's `ATTRIBUTION.txt`.

## How it was produced and proved
1. `node --import tsx scripts/library/buildLibraryBatch.mts <clones>` — refuses a clone not at the pinned revision or with
   local changes, checks the licence file, derives each GLB with the production functions (gltf bundle / GLB resource
   bundle / compaction / clip selection), validates it, and writes `reviewedLibraryBatch2.ts` with exact `bytes`.
2. `node --import tsx scripts/library/admitLibraryBatch.mts <work> <playwright index.mjs>` — for every entry: LIVE download
   of source + resources from raw.githubusercontent.com through `downloadReviewedAsset`, the production acquisition engine,
   a real Chromium (SwiftShader WebGL) render proof with texture check and visible pixels, motion proof for every
   animation role, then a second acquisition that must come from the durable cache. Results:
   `asset-candidates/2026-11-19-admission.json`; `tests/libraryBatch2.test.ts` refuses any entry without a matching
   admitted record.

## Code changes that came with it
- `SOURCE_RECORD_LIMIT` (clip selection) 10,000 → 16,384: the skeletons carry 10,941 accessors (95 clips); the 5 MiB source
  ceiling still bounds the work.
- Prompt matching (`assetPlan.ts`): new aliases; phrase exclusions so "feature flag", "stock market" and "shield powerup" do
  not pull a model. Tile subjects are literal, so a bare "road" or "river" keeps the procedural terrain.

## Limits (honest)
- Rollout is still governed by `AGENTV3_EXTERNAL_GAME_ASSETS`; this change sets no environment value.
- Render proof is software rendering at a phone-sized viewport, not FPS on a real phone. A scene using many models at once
  still has to pass the normal draw-call ceiling and game playtest.
- Medieval buildings are decorative: no enterable interiors. Tiles are pieces, not finished maps.
- Still missing (needs non-GitHub CC0 sources and a NavBharatAI-hosted pinned copy): animals beyond fox/eagle, boats,
  aeroplanes, helicopters, realistic firearms, audio.

## Batch 3 (same day): fifty more, 147 total (+2.78 MB)
Food (burger, meal, stew, tomato, carrot, potato, onion, cheese, vegetable crate), kitchen (oven, fridge, stove, cooking
pot, frying pan, round table, counter), graveyard (pumpkin, jack-o-lantern, gravestone, grave, coffin, skull, dead tree,
autumn tree, lantern, crypt, iron fence, cemetery gate), sci-fi base (lander, space rover, wind turbine, solar panel, base
module, landing pad, cargo container, drill rig), Kenney town (fountain, garage, two small houses), medieval extras
(blacksmith, mine entrance, archery range, sawmill, pine forest, boulder, water lily), prototype door, stairs and pallet.
Sources: KayKit Restaurant / Halloween / Space Base / Medieval / Prototype (CC0), Kenney City Builder (MIT).
Build: `buildLibraryBatch.mts <clones> 3`; admission: `admitLibraryBatch.mts <work> <playwright> "" "" 3` gave 50/50 admitted
(`asset-candidates/library-batch-3-admission.json`). KayKit Dungeon was skipped: it ships FBX/OBJ only, no glTF.
