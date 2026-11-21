import type { ReviewedAsset } from './providers';

/**
 * Library batch 9 (2026-11-20): Quaternius Farm Animal Pack (June 2018), the admin's own download — CC0 1.0 per the pack page
 * ("7 farm animals, each with their own animations … free to use in personal and commercial projects"). The library's farm
 * animals stood still; these MOVE: cow, horse and zebra idle/walk/run/jump/die, llama, pig, sheep and pug idle/jump. The pack
 * ships FBX only, so each was converted offline in a sandboxed Chromium with three.js's own FBXLoader + GLTFExporter, and is
 * PACKAGED in the server image. The cow and horse also answer "cow"/"horse": a request with a walk or run picks these.
 */
export const REVIEWED_LIBRARY_BATCH_9: readonly ReviewedAsset[] = [
  {
    "provider": "quaternius",
    "id": "q9-cow",
    "revision": "b4bc5f209368cafc21962934e7d676cf1cfb1f74",
    "sourceUrl": "https://quaternius.com/packs/farmanimal.html",
    "downloadUrl": "https://quaternius.com/packs/farmanimal.html",
    "packaged": true,
    "sha256": "aa686039538e0efab42d7df0b5a417d89f52c08b5e2bb499e13a298950ecfbda",
    "bytes": 275780,
    "libraryCategory": "animal",
    "subjects": [
      "farm cow",
      "cow"
    ],
    "animations": [
      "WalkSlow",
      "Death",
      "Jump",
      "Idle",
      "Walk",
      "Run"
    ],
    "animationRoles": {
      "idle": "Idle",
      "walk": "Walk",
      "run": "Run",
      "jump": "Jump",
      "die": "Death"
    },
    "height": 1.4,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/farmanimal.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q9-cow: Quaternius, Farm Animal Pack (June 2018, Cow.fbx; archive sha256 b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e). CC0 1.0 Universal per the pack page (\"free to use in personal and commercial projects\"). Offline conversion FBX -> GLB in a sandboxed Chromium with three.js 0.180 FBXLoader + GLTFExporter (materials made opaque: the loader misread their opacity as 0; triangles regrouped one group per material), then gltf-transform 4.5.1 dedup/weld/resample.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q9-horse",
    "revision": "b4bc5f209368cafc21962934e7d676cf1cfb1f74",
    "sourceUrl": "https://quaternius.com/packs/farmanimal.html",
    "downloadUrl": "https://quaternius.com/packs/farmanimal.html",
    "packaged": true,
    "sha256": "3fa84ddfe2aff8a44c99f7b7f7356431766f06c14bfd81407917246eb4bed102",
    "bytes": 254340,
    "libraryCategory": "animal",
    "subjects": [
      "farm horse",
      "horse"
    ],
    "animations": [
      "WalkSlow",
      "Death",
      "Jump",
      "Idle",
      "Walk",
      "Run"
    ],
    "animationRoles": {
      "idle": "Idle",
      "walk": "Walk",
      "run": "Run",
      "jump": "Jump",
      "die": "Death"
    },
    "height": 1.6,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/farmanimal.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q9-horse: Quaternius, Farm Animal Pack (June 2018, Horse.fbx; archive sha256 b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e). CC0 1.0 Universal per the pack page (\"free to use in personal and commercial projects\"). Offline conversion FBX -> GLB in a sandboxed Chromium with three.js 0.180 FBXLoader + GLTFExporter (materials made opaque: the loader misread their opacity as 0; triangles regrouped one group per material), then gltf-transform 4.5.1 dedup/weld/resample.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q9-zebra",
    "revision": "b4bc5f209368cafc21962934e7d676cf1cfb1f74",
    "sourceUrl": "https://quaternius.com/packs/farmanimal.html",
    "downloadUrl": "https://quaternius.com/packs/farmanimal.html",
    "packaged": true,
    "sha256": "c9268b10277d2b45b98125fb7d3dffde4a666ca6b7bbd3a4276f648470bb6af6",
    "bytes": 339304,
    "libraryCategory": "animal",
    "subjects": [
      "zebra"
    ],
    "animations": [
      "WalkSlow",
      "Death",
      "Jump",
      "Idle",
      "Walk",
      "Run"
    ],
    "animationRoles": {
      "idle": "Idle",
      "walk": "Walk",
      "run": "Run",
      "jump": "Jump",
      "die": "Death"
    },
    "height": 1.4,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/farmanimal.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q9-zebra: Quaternius, Farm Animal Pack (June 2018, Zebra.fbx; archive sha256 b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e). CC0 1.0 Universal per the pack page (\"free to use in personal and commercial projects\"). Offline conversion FBX -> GLB in a sandboxed Chromium with three.js 0.180 FBXLoader + GLTFExporter (materials made opaque: the loader misread their opacity as 0; triangles regrouped one group per material), then gltf-transform 4.5.1 dedup/weld/resample.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q9-llama",
    "revision": "b4bc5f209368cafc21962934e7d676cf1cfb1f74",
    "sourceUrl": "https://quaternius.com/packs/farmanimal.html",
    "downloadUrl": "https://quaternius.com/packs/farmanimal.html",
    "packaged": true,
    "sha256": "b82d28c971718a7f29402672653d83c5334829bf702b4a6ecf4d21b93dc6f1ca",
    "bytes": 149356,
    "libraryCategory": "animal",
    "subjects": [
      "llama"
    ],
    "animations": [
      "Jump",
      "Idle"
    ],
    "animationRoles": {
      "idle": "Idle",
      "jump": "Jump"
    },
    "height": 1.8,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/farmanimal.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q9-llama: Quaternius, Farm Animal Pack (June 2018, Llama.fbx; archive sha256 b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e). CC0 1.0 Universal per the pack page (\"free to use in personal and commercial projects\"). Offline conversion FBX -> GLB in a sandboxed Chromium with three.js 0.180 FBXLoader + GLTFExporter (materials made opaque: the loader misread their opacity as 0; triangles regrouped one group per material), then gltf-transform 4.5.1 dedup/weld/resample.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q9-pig",
    "revision": "b4bc5f209368cafc21962934e7d676cf1cfb1f74",
    "sourceUrl": "https://quaternius.com/packs/farmanimal.html",
    "downloadUrl": "https://quaternius.com/packs/farmanimal.html",
    "packaged": true,
    "sha256": "3bd4ac86370e9b953358a5f867be9eb5a77e6d90d3877d3a36db32d7cdad8b0f",
    "bytes": 135768,
    "libraryCategory": "animal",
    "subjects": [
      "pig"
    ],
    "animations": [
      "Jump",
      "Idle"
    ],
    "animationRoles": {
      "idle": "Idle",
      "jump": "Jump"
    },
    "height": 0.9,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/farmanimal.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q9-pig: Quaternius, Farm Animal Pack (June 2018, Pig.fbx; archive sha256 b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e). CC0 1.0 Universal per the pack page (\"free to use in personal and commercial projects\"). Offline conversion FBX -> GLB in a sandboxed Chromium with three.js 0.180 FBXLoader + GLTFExporter (materials made opaque: the loader misread their opacity as 0; triangles regrouped one group per material), then gltf-transform 4.5.1 dedup/weld/resample.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q9-sheep",
    "revision": "b4bc5f209368cafc21962934e7d676cf1cfb1f74",
    "sourceUrl": "https://quaternius.com/packs/farmanimal.html",
    "downloadUrl": "https://quaternius.com/packs/farmanimal.html",
    "packaged": true,
    "sha256": "c51e9b183b3a5525116a0295972805ad834c53fcc754c0f4a45c46a063f88489",
    "bytes": 141668,
    "libraryCategory": "animal",
    "subjects": [
      "sheep"
    ],
    "animations": [
      "Jump",
      "Idle"
    ],
    "animationRoles": {
      "idle": "Idle",
      "jump": "Jump"
    },
    "height": 0.9,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/farmanimal.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q9-sheep: Quaternius, Farm Animal Pack (June 2018, Sheep.fbx; archive sha256 b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e). CC0 1.0 Universal per the pack page (\"free to use in personal and commercial projects\"). Offline conversion FBX -> GLB in a sandboxed Chromium with three.js 0.180 FBXLoader + GLTFExporter (materials made opaque: the loader misread their opacity as 0; triangles regrouped one group per material), then gltf-transform 4.5.1 dedup/weld/resample.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q9-pug",
    "revision": "b4bc5f209368cafc21962934e7d676cf1cfb1f74",
    "sourceUrl": "https://quaternius.com/packs/farmanimal.html",
    "downloadUrl": "https://quaternius.com/packs/farmanimal.html",
    "packaged": true,
    "sha256": "e2ef349cce616084d0ee21c455346aaca28eabcc352e0ca16aad3fbf3d4121d0",
    "bytes": 128680,
    "libraryCategory": "animal",
    "subjects": [
      "pug"
    ],
    "animations": [
      "Jump",
      "Idle"
    ],
    "animationRoles": {
      "idle": "Idle",
      "jump": "Jump"
    },
    "height": 0.35,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/farmanimal.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q9-pug: Quaternius, Farm Animal Pack (June 2018, Pug.fbx; archive sha256 b4bc5f209368cafc21962934e7d676cf1cfb1f746a363086cd9f45c4385db70e). CC0 1.0 Universal per the pack page (\"free to use in personal and commercial projects\"). Offline conversion FBX -> GLB in a sandboxed Chromium with three.js 0.180 FBXLoader + GLTFExporter (materials made opaque: the loader misread their opacity as 0; triangles regrouped one group per material), then gltf-transform 4.5.1 dedup/weld/resample.",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  }
];
