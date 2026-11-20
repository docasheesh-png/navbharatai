import type { ReviewedAsset } from './providers';

/**
 * Library batch 7 (2026-11-20): the library's first clothed, fully animated characters, from three of the admin's own
 * Quaternius packs (Universal Base Characters, Modular Character Outfits - Fantasy, Universal Animation Library), all
 * CC0 1.0 per the licence file in each archive and the pack pages (checked 2026-11-20). They share one 65-joint rig, so
 * each model is one body head + one outfit + 16 animation clips, assembled offline and PACKAGED in the server image as
 * assets/game-models/<sha256>.glb. `evidenceRevision` is the outfit archive's sha256; the other two are in `attribution`.
 * New subjects only (villager, ranger, archer, hunter …), so an existing "man"/"woman" request keeps its current model.
 * Indian look by default (skin tone, black hair, a white kurta-like shirt, red for the village woman), set only as material colour
 * factors, so every part stays changeable by name in a game's assetCustomizations.ts: materials Skin, Hair, Eyes, Clothes;
 * nodes Head, Hair, Eyebrows, Eyes, Body, Arms, Legs, Feet/Boots, and on the rangers Hood, Pauldron(s), Arms_Bracer, Body_Belt_1/2.
 */
export const REVIEWED_LIBRARY_BATCH_7: readonly ReviewedAsset[] = [
  {
    "provider": "quaternius",
    "id": "q7-villager-man",
    "revision": "c3468b18871cc8c8f05ab14df7712baf22cb9f38",
    "sourceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "downloadUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "packaged": true,
    "sha256": "2db4ad18412b2b0706cf01fb8db52a715ee2e42a451f2a11e708f49cf9db2d7b",
    "bytes": 3201096,
    "libraryCategory": "character",
    "subjects": [
      "villager",
      "peasant",
      "village man"
    ],
    "animations": [
      "Idle_Loop",
      "Walk_Loop",
      "Jog_Fwd_Loop",
      "Sprint_Loop",
      "Jump_Start",
      "Jump_Loop",
      "Jump_Land",
      "Crouch_Idle_Loop",
      "Crouch_Fwd_Loop",
      "Pistol_Idle_Loop",
      "Pistol_Aim_Neutral",
      "Pistol_Shoot",
      "Pistol_Reload",
      "Death01",
      "Hit_Chest",
      "Driving_Loop"
    ],
    "animationRoles": {
      "idle": "Idle_Loop",
      "walk": "Walk_Loop",
      "run": "Sprint_Loop",
      "jog": "Jog_Fwd_Loop",
      "jump": "Jump_Loop",
      "crouch": "Crouch_Fwd_Loop",
      "aim": "Pistol_Idle_Loop",
      "shoot": "Pistol_Shoot",
      "reload": "Pistol_Reload",
      "die": "Death01",
      "hit": "Hit_Chest",
      "drive": "Driving_Loop"
    },
    "height": 1.82,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q7-villager-man: Quaternius — Superhero_Male_FullBody head (Universal Base Characters, zip sha256 fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40) + Hair_SimpleParted; outfit Male_Peasant (Modular Character Outfits - Fantasy, zip sha256 c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70); 16 clips from UAL1 (Universal Animation Library, zip sha256 cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724). All CC0 1.0 Universal (quaternius.com/packs/universalbasecharacters.html, modularcharacteroutfitsfantasy.html, universalanimationlibrary.html). Assembled offline on the shared 65-joint rig (gltf-transform 4.5.1): body cut to the head under the outfit; an Indian look (skin tone, black hair, outfit colours) set as material colour factors; parts named Skin, Hair, Eyes, Clothes; textures 512 px; keyframes resampled.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q7-villager-woman",
    "revision": "c3468b18871cc8c8f05ab14df7712baf22cb9f38",
    "sourceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "downloadUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "packaged": true,
    "sha256": "7f562cec9ad1edfd9f2060ff3dd37b0e2f286eb4cc5a41eea3cb7a3e473df849",
    "bytes": 3224296,
    "libraryCategory": "character",
    "subjects": [
      "village woman",
      "villager",
      "peasant"
    ],
    "animations": [
      "Idle_Loop",
      "Walk_Loop",
      "Jog_Fwd_Loop",
      "Sprint_Loop",
      "Jump_Start",
      "Jump_Loop",
      "Jump_Land",
      "Crouch_Idle_Loop",
      "Crouch_Fwd_Loop",
      "Pistol_Idle_Loop",
      "Pistol_Aim_Neutral",
      "Pistol_Shoot",
      "Pistol_Reload",
      "Death01",
      "Hit_Chest",
      "Driving_Loop"
    ],
    "animationRoles": {
      "idle": "Idle_Loop",
      "walk": "Walk_Loop",
      "run": "Sprint_Loop",
      "jog": "Jog_Fwd_Loop",
      "jump": "Jump_Loop",
      "crouch": "Crouch_Fwd_Loop",
      "aim": "Pistol_Idle_Loop",
      "shoot": "Pistol_Shoot",
      "reload": "Pistol_Reload",
      "die": "Death01",
      "hit": "Hit_Chest",
      "drive": "Driving_Loop"
    },
    "height": 1.78,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q7-villager-woman: Quaternius — Superhero_Female_FullBody head (Universal Base Characters, zip sha256 fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40) + Hair_Long; outfit Female_Peasant (Modular Character Outfits - Fantasy, zip sha256 c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70); 16 clips from UAL1 (Universal Animation Library, zip sha256 cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724). All CC0 1.0 Universal (quaternius.com/packs/universalbasecharacters.html, modularcharacteroutfitsfantasy.html, universalanimationlibrary.html). Assembled offline on the shared 65-joint rig (gltf-transform 4.5.1): body cut to the head under the outfit; an Indian look (skin tone, black hair, outfit colours) set as material colour factors; parts named Skin, Hair, Eyes, Clothes; textures 512 px; keyframes resampled.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q7-ranger-man",
    "revision": "c3468b18871cc8c8f05ab14df7712baf22cb9f38",
    "sourceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "downloadUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "packaged": true,
    "sha256": "570395448b81cac13b4db41114340f836fa8ba0f15e7b99e5b5086fe68f70609",
    "bytes": 4196404,
    "libraryCategory": "character",
    "subjects": [
      "ranger",
      "archer",
      "hunter"
    ],
    "animations": [
      "Idle_Loop",
      "Walk_Loop",
      "Jog_Fwd_Loop",
      "Sprint_Loop",
      "Jump_Start",
      "Jump_Loop",
      "Jump_Land",
      "Crouch_Idle_Loop",
      "Crouch_Fwd_Loop",
      "Pistol_Idle_Loop",
      "Pistol_Aim_Neutral",
      "Pistol_Shoot",
      "Pistol_Reload",
      "Death01",
      "Hit_Chest",
      "Driving_Loop"
    ],
    "animationRoles": {
      "idle": "Idle_Loop",
      "walk": "Walk_Loop",
      "run": "Sprint_Loop",
      "jog": "Jog_Fwd_Loop",
      "jump": "Jump_Loop",
      "crouch": "Crouch_Fwd_Loop",
      "aim": "Pistol_Idle_Loop",
      "shoot": "Pistol_Shoot",
      "reload": "Pistol_Reload",
      "die": "Death01",
      "hit": "Hit_Chest",
      "drive": "Driving_Loop"
    },
    "height": 1.82,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q7-ranger-man: Quaternius — Superhero_Male_FullBody head (Universal Base Characters, zip sha256 fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40); outfit Male_Ranger (Modular Character Outfits - Fantasy, zip sha256 c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70); 16 clips from UAL1 (Universal Animation Library, zip sha256 cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724). All CC0 1.0 Universal (quaternius.com/packs/universalbasecharacters.html, modularcharacteroutfitsfantasy.html, universalanimationlibrary.html). Assembled offline on the shared 65-joint rig (gltf-transform 4.5.1): body cut to the head under the outfit; an Indian look (skin tone, black hair, outfit colours) set as material colour factors; parts named Skin, Hair, Eyes, Clothes; textures 512 px; keyframes resampled.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q7-ranger-woman",
    "revision": "c3468b18871cc8c8f05ab14df7712baf22cb9f38",
    "sourceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "downloadUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
    "packaged": true,
    "sha256": "284e236e7b1b216767a331ee9eb1b3d7b4a9d1ec7b830628e73576cf7f61fe55",
    "bytes": 4440212,
    "libraryCategory": "character",
    "subjects": [
      "female ranger",
      "female archer",
      "ranger",
      "archer",
      "hunter"
    ],
    "animations": [
      "Idle_Loop",
      "Walk_Loop",
      "Jog_Fwd_Loop",
      "Sprint_Loop",
      "Jump_Start",
      "Jump_Loop",
      "Jump_Land",
      "Crouch_Idle_Loop",
      "Crouch_Fwd_Loop",
      "Pistol_Idle_Loop",
      "Pistol_Aim_Neutral",
      "Pistol_Shoot",
      "Pistol_Reload",
      "Death01",
      "Hit_Chest",
      "Driving_Loop"
    ],
    "animationRoles": {
      "idle": "Idle_Loop",
      "walk": "Walk_Loop",
      "run": "Sprint_Loop",
      "jog": "Jog_Fwd_Loop",
      "jump": "Jump_Loop",
      "crouch": "Crouch_Fwd_Loop",
      "aim": "Pistol_Idle_Loop",
      "shoot": "Pistol_Shoot",
      "reload": "Pistol_Reload",
      "die": "Death01",
      "hit": "Hit_Chest",
      "drive": "Driving_Loop"
    },
    "height": 1.8,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/modularcharacteroutfitsfantasy.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q7-ranger-woman: Quaternius — Superhero_Female_FullBody head (Universal Base Characters, zip sha256 fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40) + Hair_Long; outfit Female_Ranger (Modular Character Outfits - Fantasy, zip sha256 c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70); 16 clips from UAL1 (Universal Animation Library, zip sha256 cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724). All CC0 1.0 Universal (quaternius.com/packs/universalbasecharacters.html, modularcharacteroutfitsfantasy.html, universalanimationlibrary.html). Assembled offline on the shared 65-joint rig (gltf-transform 4.5.1): body cut to the head under the outfit; an Indian look (skin tone, black hair, outfit colours) set as material colour factors; parts named Skin, Hair, Eyes, Clothes; textures 512 px; keyframes resampled.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  }
];
