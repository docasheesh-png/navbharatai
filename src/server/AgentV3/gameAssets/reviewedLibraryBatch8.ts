import type { ReviewedAsset } from './providers';

/**
 * Library batch 8 (2026-11-20): KayKit Adventurers Character Pack 2.0 by Kay Lousberg, the admin's own download — CC0 1.0 per
 * the License.txt in the archive. Models the library did not have: a bowman (the pack's Ranger) with 15 clips from the pack's
 * Rig_Medium animation files (idle, walk, run, jump, hit, die, throw, pick up, interact, use), and 15 props — bow, arrow,
 * arrow bundle, quiver, dagger, greatsword, battle axe, round and spiked shields, magic staff and wand, spellbook, book, mug,
 * smoke bomb. Converted offline and PACKAGED in the server image (assets/game-models/<sha256>.glb); `evidenceRevision` is the
 * archive's sha256. The pack's knight/mage/barbarian/rogue are already in the library from KayKit's public 1.0 repository.
 */
export const REVIEWED_LIBRARY_BATCH_8: readonly ReviewedAsset[] = [
  {
    "provider": "kaykit",
    "id": "k8-arrow",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "af74b241a5265472508d25923432cb1d1ce0c710aa02654b7c58c664c9fac00d",
    "bytes": 17260,
    "libraryCategory": "weapon",
    "subjects": [
      "arrow"
    ],
    "animations": [],
    "height": 0.083,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-arrow: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (arrow_bow). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-arrow-bundle",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "167232b1632c346927eea48f868241805ba366a2bba7ea9a806ffd3a8d85117a",
    "bytes": 29976,
    "libraryCategory": "weapon",
    "subjects": [
      "arrow bundle"
    ],
    "animations": [],
    "height": 0.8,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-arrow-bundle: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (arrow_bow_bundle). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-bow",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "dac8d35bf603c308bf7e37034ff1e20431240ad4e8e001f43980139828699dbd",
    "bytes": 64116,
    "libraryCategory": "weapon",
    "subjects": [
      "bow"
    ],
    "animations": [],
    "height": 0.091,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-bow: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (bow_withString). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-quiver",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "5b9d8321fcaf08c4234b29e8b9d65d779ce9aa58d12173682189dc85f2074840",
    "bytes": 30276,
    "libraryCategory": "weapon",
    "subjects": [
      "quiver"
    ],
    "animations": [],
    "height": 0.6,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-quiver: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (quiver). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-dagger",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "54f4cfe479a60e93e385a5d728cdababf3a12958a35fe46ec5cec95e15f174ad",
    "bytes": 24048,
    "libraryCategory": "weapon",
    "subjects": [
      "dagger"
    ],
    "animations": [],
    "height": 0.35,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-dagger: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (dagger). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-greatsword",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "5c526033368e9e42721a48272ab5edd178464289c0a1acda4b5a3f29c8a4c156",
    "bytes": 34208,
    "libraryCategory": "weapon",
    "subjects": [
      "greatsword"
    ],
    "animations": [],
    "height": 1.4,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-greatsword: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (sword_2handed). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-battle-axe",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "be5829071e1e84425021282938ca8ad136e87c0e40825b24652c9cf5545ca26c",
    "bytes": 37764,
    "libraryCategory": "weapon",
    "subjects": [
      "battle axe"
    ],
    "animations": [],
    "height": 1.0,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-battle-axe: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (axe_2handed). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-round-shield",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "f4007aa8a1f55a07d0ecf1a260e833af4d629a5bfd67831e406a458fcaccaa95",
    "bytes": 26064,
    "libraryCategory": "weapon",
    "subjects": [
      "round shield"
    ],
    "animations": [],
    "height": 0.7,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-round-shield: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (shield_round_color). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-spiked-shield",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "37880b5b72d6cebd7820b102751ff5fc97e32e4be18b029df2baccf4aefd22a3",
    "bytes": 35772,
    "libraryCategory": "weapon",
    "subjects": [
      "spiked shield"
    ],
    "animations": [],
    "height": 0.75,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-spiked-shield: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (shield_spikes_color). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-magic-staff",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "a3b50f1c850e66377a35ea5afff01acf5904936e82650aecbc9cea75f58b767f",
    "bytes": 34680,
    "libraryCategory": "weapon",
    "subjects": [
      "magic staff"
    ],
    "animations": [],
    "height": 1.7,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-magic-staff: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (staff). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-magic-wand",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "5750532a96ee3b85910756f70eee404c54cc51c9d12500af16b7f3c823e06e14",
    "bytes": 22052,
    "libraryCategory": "weapon",
    "subjects": [
      "magic wand"
    ],
    "animations": [],
    "height": 0.35,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-magic-wand: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (wand). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-spellbook",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "20dbf18f19485746cde37cd5230b1b4c56c31198da7e97e7ef780290cd475459",
    "bytes": 31248,
    "libraryCategory": "collectible",
    "subjects": [
      "spellbook"
    ],
    "animations": [],
    "height": 0.24,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-spellbook: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (spellbook_open). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-book",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "648a41c2a06cf0fdb1a1671684b3600c0260249ca9dc48df83a0969a7d78ed00",
    "bytes": 30648,
    "libraryCategory": "collectible",
    "subjects": [
      "book"
    ],
    "animations": [],
    "height": 0.25,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-book: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (spellbook_closed). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-mug",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "b035bfcd60170d14bc6e31dd39b4b77475dfb21ba5e94b68ab578e3427dc8bf7",
    "bytes": 31576,
    "libraryCategory": "interior",
    "subjects": [
      "mug"
    ],
    "animations": [],
    "height": 0.15,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-mug: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (mug_full). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-smoke-bomb",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "8ed1e59628fa29ca6bd9a035ce92b09869b78fc6b05ef9835a5e27d14f8eb84d",
    "bytes": 27856,
    "libraryCategory": "weapon",
    "subjects": [
      "smoke bomb"
    ],
    "animations": [],
    "height": 0.15,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-smoke-bomb: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (smokebomb). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    }
  },
  {
    "provider": "kaykit",
    "id": "k8-bowman",
    "revision": "abe48f4763fba0896bab486ee9e6d08ca6b5b388",
    "sourceUrl": "https://kaylousberg.itch.io/",
    "downloadUrl": "https://kaylousberg.itch.io/",
    "packaged": true,
    "sha256": "4d41eb0c14ecab446a383e5e454e411e51fb709c6f9f638329c389cb3b386d7b",
    "bytes": 807272,
    "libraryCategory": "character",
    "subjects": [
      "bowman",
      "cartoon archer"
    ],
    "animations": [
      "Death_A",
      "Hit_A",
      "Idle_A",
      "Interact",
      "PickUp",
      "Spawn_Ground",
      "Throw",
      "Use_Item",
      "Jump_Full_Short",
      "Jump_Idle",
      "Jump_Land",
      "Jump_Start",
      "Running_A",
      "Walking_A",
      "Walking_B"
    ],
    "height": 1.6,
    "yaw": 0,
    "downloadOrigins": [
      "https://kaylousberg.itch.io"
    ],
    "review": {
      "reviewer": "NavBharatAI asset admission",
      "evidenceRevision": "abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479",
      "freeDownload": true
    },
    "license": {
      "spdx": "CC0-1.0",
      "evidenceUrl": "https://kaylousberg.itch.io/",
      "reviewedAt": "2026-11-20",
      "author": "Kay Lousberg",
      "attribution": "k8-bowman: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (Ranger + Rig_Medium General and MovementBasic clips). CC0 1.0 Universal per the License.txt in the archive (sha256 abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479; \"free to use in personal, educational and commercial projects\"). Offline conversion glTF+bin+texture -> GLB (gltf-transform 4.5.1).",
      "commercial": true,
      "redistributeInGame": true,
      "redistributeSource": true
    },
    "animationRoles": {
      "idle": "Idle_A",
      "walk": "Walking_A",
      "run": "Running_A",
      "jump": "Jump_Full_Short",
      "hit": "Hit_A",
      "die": "Death_A",
      "throw": "Throw",
      "pickup": "PickUp",
      "interact": "Interact",
      "use": "Use_Item"
    }
  }
];
