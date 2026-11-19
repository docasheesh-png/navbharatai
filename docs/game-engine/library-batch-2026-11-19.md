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

## Batches 4 and 5 (same day): 112 more, 259 total (+6.6 MB)
Source: Kayque Rotondo's (with Cláudia Dias Roxinol on three kits) CC0 kits on GitHub — `scitizia-pessoas-64`,
`kit-fauna-ameacada-lowpoly`, `kit-cidade-lowpoly`, `kit-props-brasil-lowpoly`, `kit-predios-brasil-lowpoly`. Provenance
evidence: each repository contains the Blender scripts that generate its models, a CC0 LICENSE and a CITATION.cff.
- Batch 4 (60): 13 rigged people with idle/walk/run (`parado`/`andar`/`correr`), 7 everyday vehicles, boat / canoe / jetty,
  ~39 animals. **Animals are static**: a "walking dog" still gets the procedural dog, never a still model or a fox.
- Batch 5 (52): public buildings, commerce, industry, energy, nature, farm, street items, dirt-road / zebra-crossing tiles
  and a road bridge.
- Admission: 60/60 and 52/52 (`asset-candidates/library-batch-{4,5}-admission.json`).
- Prompt guards: "Pac-Man", "cricket bat", "day night cycle", "river bank", "game mechanics", "log in", "service worker"
  and "ice cream cone" pull no model.

## Measured sizes for the older 47 entries
`scripts/library/measureCatalogueBytes.mts` fetched each through the production transport, matched its pinned hash and
recorded `bytes`: 7.6 MB in total, instead of the 235 MiB worst case. The whole library now declares about 22 MB of its
320 MiB budget. A census test requires a measured size on every entry.

## Rejected source (owner decision pending)
`Vuena/free-game-assets-mega-starter-cc0` declares CC0 and contains rigged characters and animals, but nothing in the
repository evidences authorship beyond the uploader's statement. Not used.
