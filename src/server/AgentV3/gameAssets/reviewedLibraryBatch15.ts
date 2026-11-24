import type { ReviewedAsset } from './providers';

/**
 * Public community contribution admitted 2026-11-24.
 * The contributor confirmed ownership of the supplied reference image and authorized free public in-game use.
 * This GLB includes furnished interior room geometry and an architectural stairway; it does not include engine-native
 * collision proxies, a baked NavMesh, interactive door animation, PBR texture images, or character controller logic.
 */
export const REVIEWED_LIBRARY_BATCH_15: readonly ReviewedAsset[] = [
  {
    provider: 'github',
    id: 'navbharatai-indian-modern-house',
    revision: '9c44dbe95ac738ab812061d8f280391495633e3a',
    sourceUrl: 'https://github.com/docasheesh-png/navbharatai/blob/main/assets/game-models/da971c0cacfc1b068d73b19a0506b0789f7833a78fddc1d0b30f6783335fb049.glb.gz',
    downloadUrl: 'https://github.com/docasheesh-png/navbharatai/blob/main/assets/game-models/da971c0cacfc1b068d73b19a0506b0789f7833a78fddc1d0b30f6783335fb049.glb.gz',
    packaged: true,
    packagedCompression: 'gzip',
    sha256: 'da971c0cacfc1b068d73b19a0506b0789f7833a78fddc1d0b30f6783335fb049',
    bytes: 90072,
    libraryCategory: 'building',
    subjects: ['indian house', 'modern indian house', 'duplex house', 'walkable house', 'modern house'],
    animations: [],
    height: 9.47,
    yaw: 0,
    downloadOrigins: ['https://github.com'],
    review: {
      reviewer: 'NavBharatAI asset admission',
      evidenceRevision: 'da971c0cacfc1b068d73b19a0506b0789f7833a78fddc1d0b30f6783335fb049',
      freeDownload: true
    },
    license: {
      spdx: 'CC-BY-4.0',
      evidenceUrl: 'https://github.com/docasheesh-png/navbharatai/blob/main/assets/game-models/indian-modern-house-LICENSE.txt',
      reviewedAt: '2026-11-24',
      author: 'NavBharatAI Community Contributor (reference image owner)',
      attribution: 'Reference image: NavBharAI community contributor (owner-confirmed); 3D conversion: NavBharatAI. Licensed CC BY 4.0.',
      commercial: true,
      redistributeInGame: true,
      redistributeSource: true
    }
  }
];
