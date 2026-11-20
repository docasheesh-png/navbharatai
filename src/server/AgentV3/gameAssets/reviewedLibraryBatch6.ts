import type { ReviewedAsset } from './providers';

/**
 * Library batch 6 (2026-11-20): the admin's own Quaternius downloads — Ultimate Gun Pack and Realistic Car Pack.
 * CC0 1.0 per the License.txt in each archive and the pack pages on quaternius.com (checked 2026-11-20). Neither pack has a
 * GLB, so each model was converted offline (OBJ+MTL -> GLB) and ships PACKAGED in the server image as
 * assets/game-models/<sha256>.glb; `evidenceRevision` is the sha256 of the source archive. The library had no firearm before.
 */
export const REVIEWED_LIBRARY_BATCH_6: readonly ReviewedAsset[] = [
  {
    "provider": "quaternius",
    "id": "q6-car-sedan",
    "revision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87",
    "sourceUrl": "https://quaternius.com/packs/cars.html",
    "downloadUrl": "https://quaternius.com/packs/cars.html",
    "packaged": true,
    "sha256": "3c9f8f0d9ed09d78ab39a8e4c635a290c7a1f778da1774575fc7d8005b47531a",
    "bytes": 162876,
    "libraryCategory": "vehicle-land",
    "subjects": [
      "sedan",
      "family car",
      "car"
    ],
    "animations": [],
    "height": 1.18,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87b9923b4773d471f161d2bdc7",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/cars.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-car-sedan: Quaternius, Realistic Car Pack (Nov 2018) (NormalCar1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-car-hatchback",
    "revision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87",
    "sourceUrl": "https://quaternius.com/packs/cars.html",
    "downloadUrl": "https://quaternius.com/packs/cars.html",
    "packaged": true,
    "sha256": "fe65b41c878887b3b7ef04b40f79aa6c05c9fd7c34e9af9d3bbfd20a9f5e94bc",
    "bytes": 172336,
    "libraryCategory": "vehicle-land",
    "subjects": [
      "hatchback",
      "small car",
      "car"
    ],
    "animations": [],
    "height": 1.15,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87b9923b4773d471f161d2bdc7",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/cars.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-car-hatchback: Quaternius, Realistic Car Pack (Nov 2018) (NormalCar2.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-car-suv",
    "revision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87",
    "sourceUrl": "https://quaternius.com/packs/cars.html",
    "downloadUrl": "https://quaternius.com/packs/cars.html",
    "packaged": true,
    "sha256": "30b6b36fd6b6ff5191bf5d522aafab277b79158d8a4ff32cbd5ed653130588d1",
    "bytes": 179872,
    "libraryCategory": "vehicle-land",
    "subjects": [
      "suv",
      "car"
    ],
    "animations": [],
    "height": 1.53,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87b9923b4773d471f161d2bdc7",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/cars.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-car-suv: Quaternius, Realistic Car Pack (Nov 2018) (SUV.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-car-sports",
    "revision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87",
    "sourceUrl": "https://quaternius.com/packs/cars.html",
    "downloadUrl": "https://quaternius.com/packs/cars.html",
    "packaged": true,
    "sha256": "b13e044d1ff64f906db7a0cbd17d9c4cedf84b67e86ce54ca7b4f2c787d520c1",
    "bytes": 169032,
    "libraryCategory": "vehicle-land",
    "subjects": [
      "sports car",
      "car"
    ],
    "animations": [],
    "height": 1.16,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87b9923b4773d471f161d2bdc7",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/cars.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-car-sports: Quaternius, Realistic Car Pack (Nov 2018) (SportsCar.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-car-coupe",
    "revision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87",
    "sourceUrl": "https://quaternius.com/packs/cars.html",
    "downloadUrl": "https://quaternius.com/packs/cars.html",
    "packaged": true,
    "sha256": "b2ad93eab52e6cbff85017bb89ae6b57087a1c0f551dc2511b499d96436bd833",
    "bytes": 173324,
    "libraryCategory": "vehicle-land",
    "subjects": [
      "coupe",
      "sports car",
      "car"
    ],
    "animations": [],
    "height": 1.2,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87b9923b4773d471f161d2bdc7",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/cars.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-car-coupe: Quaternius, Realistic Car Pack (Nov 2018) (SportsCar2.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-car-police",
    "revision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87",
    "sourceUrl": "https://quaternius.com/packs/cars.html",
    "downloadUrl": "https://quaternius.com/packs/cars.html",
    "packaged": true,
    "sha256": "862512cf75437eefd416fb00f712caab68062d042fed901e6afb3fbc422a3500",
    "bytes": 178404,
    "libraryCategory": "vehicle-land",
    "subjects": [
      "police car",
      "cop car",
      "car"
    ],
    "animations": [],
    "height": 1.24,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87b9923b4773d471f161d2bdc7",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/cars.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-car-police: Quaternius, Realistic Car Pack (Nov 2018) (Cop.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-car-taxi",
    "revision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87",
    "sourceUrl": "https://quaternius.com/packs/cars.html",
    "downloadUrl": "https://quaternius.com/packs/cars.html",
    "packaged": true,
    "sha256": "3c059a600f7b7e2c8591ab33c04ed4dec5f5f70455a53ca44992457c2cd7ba12",
    "bytes": 179296,
    "libraryCategory": "vehicle-land",
    "subjects": [
      "taxi",
      "car"
    ],
    "animations": [],
    "height": 1.31,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "af8f45d6e2135cc53870e5d0882cc41ca329bd87b9923b4773d471f161d2bdc7",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/cars.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-car-taxi: Quaternius, Realistic Car Pack (Nov 2018) (Taxi.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-assault-rifle",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "3deae2937d2a3282c97c159bac60ebccdc6e5f8e52d44dcb42259879c73e8f39",
    "bytes": 61416,
    "libraryCategory": "weapon",
    "subjects": [
      "assault rifle",
      "rifle",
      "gun"
    ],
    "animations": [],
    "height": 0.36,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-assault-rifle: Quaternius, Ultimate Gun Pack (AssaultRifle_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-carbine",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "fc8c997308f4be71a28c93f79c3e1c7c0358163d15e74ad443f76b243b00e6df",
    "bytes": 121836,
    "libraryCategory": "weapon",
    "subjects": [
      "carbine",
      "assault rifle",
      "rifle",
      "gun"
    ],
    "animations": [],
    "height": 0.29,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-carbine: Quaternius, Ultimate Gun Pack (AssaultRifle2_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-bullpup",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "db5cf7a7a91460bc502e41a6390aa974ac5d77dc40e766d212e0ebafa008b882",
    "bytes": 135784,
    "libraryCategory": "weapon",
    "subjects": [
      "bullpup rifle",
      "rifle",
      "gun"
    ],
    "animations": [],
    "height": 0.21,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-bullpup: Quaternius, Ultimate Gun Pack (Bullpup_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-pistol",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "8a4101d33612d4db829f0a81a7ce130d9ecad1f83e0656c3b3125de3dc448ecd",
    "bytes": 57192,
    "libraryCategory": "weapon",
    "subjects": [
      "pistol",
      "handgun",
      "gun"
    ],
    "animations": [],
    "height": 0.13,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-pistol: Quaternius, Ultimate Gun Pack (Pistol_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-pistol-heavy",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "77fe9056b6179d9f13916dd50458df038386d79f47872a3ea9c04a022e70dce1",
    "bytes": 72476,
    "libraryCategory": "weapon",
    "subjects": [
      "heavy pistol",
      "pistol",
      "handgun",
      "gun"
    ],
    "animations": [],
    "height": 0.14,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-pistol-heavy: Quaternius, Ultimate Gun Pack (Pistol_3.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-revolver",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "39685151a7fc2083a31ac18f1c6a2b6eb32900c50d492fde8ec4410a0f8ea953",
    "bytes": 47228,
    "libraryCategory": "weapon",
    "subjects": [
      "revolver",
      "handgun",
      "gun"
    ],
    "animations": [],
    "height": 0.12,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-revolver: Quaternius, Ultimate Gun Pack (Revolver_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-shotgun",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "393c1cf504b002544976d4448d73aa989a8f15d4fdc5fe0ac4f3cf587b32b467",
    "bytes": 60172,
    "libraryCategory": "weapon",
    "subjects": [
      "shotgun",
      "gun"
    ],
    "animations": [],
    "height": 0.18,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-shotgun: Quaternius, Ultimate Gun Pack (Shotgun_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-sawed-off",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "9d5c7ceee60a8a207464b744a753d8212cebaa2ec1477da0afffd436b7211b4e",
    "bytes": 50304,
    "libraryCategory": "weapon",
    "subjects": [
      "sawed off shotgun",
      "shotgun",
      "gun"
    ],
    "animations": [],
    "height": 0.17,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-sawed-off: Quaternius, Ultimate Gun Pack (Shotgun_SawedOff.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-sniper",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "2352c0e9fff384a2123bdd7e0efe2b6e28e0d233d46296c2e2aa0887907cb705",
    "bytes": 71832,
    "libraryCategory": "weapon",
    "subjects": [
      "sniper rifle",
      "rifle",
      "gun"
    ],
    "animations": [],
    "height": 0.24,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-sniper: Quaternius, Ultimate Gun Pack (SniperRifle_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-sniper-tactical",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "b86ed955cbb049c498bbb32d2289098097aa7a7d6e4c5f6ea404f764ce3c621e",
    "bytes": 70256,
    "libraryCategory": "weapon",
    "subjects": [
      "tactical sniper",
      "sniper rifle",
      "rifle",
      "gun"
    ],
    "animations": [],
    "height": 0.25,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-sniper-tactical: Quaternius, Ultimate Gun Pack (SniperRifle_4.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-smg",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "218c7fe102bfd39476a5033a64bcc88f4b89b4ffc8a682f011c0b2f480b9525a",
    "bytes": 55900,
    "libraryCategory": "weapon",
    "subjects": [
      "smg",
      "gun"
    ],
    "animations": [],
    "height": 0.28,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-smg: Quaternius, Ultimate Gun Pack (SubmachineGun_1.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "quaternius",
    "id": "q6-gun-smg-compact",
    "revision": "b5915df0f3971ad91bbba402f31fa530098a9b7c",
    "sourceUrl": "https://quaternius.com/packs/ultimategun.html",
    "downloadUrl": "https://quaternius.com/packs/ultimategun.html",
    "packaged": true,
    "sha256": "76631b9cdb78b01a8fb7fd52dc75427728559ab1af8df80d517ad34b9d7b7ceb",
    "bytes": 77128,
    "libraryCategory": "weapon",
    "subjects": [
      "compact smg",
      "smg",
      "gun"
    ],
    "animations": [],
    "height": 0.23,
    "yaw": 0,
    "downloadOrigins": [
      "https://quaternius.com"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "b5915df0f3971ad91bbba402f31fa530098a9b7c5ea85c1b104aad23528ee453",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://quaternius.com/packs/ultimategun.html",
      "reviewedAt": "2026-11-20",
      "author": "Quaternius",
      "attribution": "q6-gun-smg-compact: Quaternius, Ultimate Gun Pack (SubmachineGun_3.obj). CC0 1.0 Universal. Offline conversion OBJ+MTL -> GLB (obj2gltf 3.2.0), dedup + weld (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  }
];
