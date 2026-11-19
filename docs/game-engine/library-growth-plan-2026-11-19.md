# Game library growth plan (admin request 2026-11-19)

Admin aim: when a user builds a game, NavBharatAI ships the best game for the least platform cost.
Ready-made models cost no AI generation, so a larger licensed library is the cheapest quality lever.

## What popular 3D games need (12 reference titles: battle royale, open-world city, endless runner, racing, sandbox)
| Group | Subjects |
|---|---|
| People | man, woman, child, elder, soldier, police, doctor, farmer/villager, zombie, robot, knight, ninja |
| Animals | dog, cow, horse, cat, elephant, tiger, monkey, deer, camel, goat, eagle/bird, fish, snake, chicken |
| Land vehicles | car, motorbike, scooter, auto-rickshaw, bus, truck, tractor, train, jeep, police car, ambulance, tank, bicycle |
| Air/water vehicles | aeroplane, helicopter, drone, parachute, boat, ship, jet-ski, submarine |
| Water | river, drain, sea, lake, waterfall, pond, well, canal, pool, dam |
| Terrain | mountain, desert, jungle, snow, beach, valley, cave, island, farmland, swamp |
| Roads | paved road, dirt road, highway, lane, bridge, railway track, footpath, flyover, crossing, tunnel, runway, ramp |
| Buildings | house, apartment, shop, temple, school, hospital, police station, fuel station, factory, warehouse, hut |
| Vegetation | trees (neem, peepal, palm, pine), bush, grass, flowers, bamboo, cactus, rocks, logs |
| Street props | streetlight, traffic light, bench, bin, fence, barrier, signboard, pole |
| Weapons/gear | pistol, rifle, shotgun, sniper, knife, grenade, helmet, vest, medkit, ammo box |
| Pickups | coin, magnet, jetpack, shield, booster, key, loot crate |
| Sky/effects | sun, moon, cloud, rain, fog, fire, smoke, explosion, splash, dust |
| Audio | UI, weapon, engine, footsteps, music |

No title's names, characters, art or maps are copied; this is a list of generic subject classes.

## State on 2026-11-19
`OBJECT_CATALOG` already specifies 100 subjects in 20 categories covering almost all of the above. Only 47
are real reviewed models. Largest gaps: animals (fox and eagle only), motorbike/boat/aeroplane/helicopter
models, firearms, audio.

## Admin decisions (2026-11-19)
1. **Storage budget, not a count.** The 64-entry cap was 64 x 5 MiB = 320 MiB. It is now a 320 MiB byte budget
   (`CATALOGUE_STORAGE_BUDGET_BYTES`); a reviewed entry declares its exact `bytes`, an undeclared one counts as 5 MiB.
2. **Licences: CC0-1.0, CC-BY-4.0, MIT.** CC-BY and MIT must carry their notice; MIT ships its full permission
   notice in `ATTRIBUTION.txt`. Unlicensed, NC, SA, GPL and ripped commercial-game assets stay refused.
3. **White label.** Users see "NavBharatAI Library"; the licence record stays admin/legal evidence and in the
   exported ATTRIBUTION.txt that the licence itself requires. "Re-logo as our own" is not done to MIT/CC-BY assets.

## Sources checked from the cloud session
| Source | Licence | Reachable | Content |
|---|---|---|---|
| KayKit City Builder Bits (GitHub) | CC0 | yes | 8 buildings, 5 cars, 6 road pieces, street props |
| KayKit Medieval Hexagon (GitHub) | CC0 | yes | river/coast/road hex tiles, castles, mills, bridges, wells, fences |
| KayKit Furniture / Prototype / Halloween / Space Base (GitHub) | CC0 | yes | interiors, crates, barrels, coins, doors, targets |
| KayKit Skeletons (GitHub) | CC0 | yes | animated enemies, axes, crossbows, shields |
| Kenney Starter Kits (GitHub) | MIT | yes | racing trucks, motorcycle, track, platformer, blasters |
| Quaternius (website) | CC0 | pages yes; downloads are Google Drive folders | animated animals, nature, shooter kit, city |
| kenney.nl / poly.pizza | CC0 | refuse automated clients (403) | not scraped; no User-Agent spoofing |

## Open items
- Non-GitHub sources (Quaternius Drive) are not immutable pinned URLs; the runtime downloader only trusts
  pinned `raw.githubusercontent.com` revisions. They need a NavBharatAI-hosted, hash-pinned copy (own bucket) with
  the same admission, which is a separate design step.
- Every new model still passes the existing admission: source/licence hashes, GLB validation, headless render,
  seed and cache checks (`library-admission-2026-11-13.md`). No unverified model is listed.
