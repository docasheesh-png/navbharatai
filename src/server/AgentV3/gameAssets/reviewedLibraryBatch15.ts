import type { ReviewedAsset } from './providers';

/**
 * Owner-authorized community model (2026-11-24): an original, low-poly GLB authored from the owner's
 * exterior and floor-plan reference. CC BY 4.0 credit is carried into each game's attribution file.
 * The build script recreates the exact packaged GLB deterministically; no third-party model is embedded.
 */
export const REVIEWED_LIBRARY_BATCH_15: readonly ReviewedAsset[] = [
  {
    provider: 'github',
    id: 'modern-house-h01',
    revision: 'c74250694078d5cf8b1615acfd04c3c6945d79adb2a46c0cb040637d51cf34dd',
    sourceUrl: 'https://github.com/docasheesh-png/navbharatai',
    downloadUrl: 'https://github.com/docasheesh-png/navbharatai',
    packaged: true,
    sha256: 'c74250694078d5cf8b1615acfd04c3c6945d79adb2a46c0cb040637d51cf34dd',
    bytes: 67900,
    libraryCategory: 'building',
    subjects: ['house', 'modern house'],
    animations: [],
    height: 5.12,
    yaw: 0,
    downloadOrigins: ['https://github.com'],
    review: {
      reviewer: 'NavBharatAI asset admission',
      evidenceRevision: 'c74250694078d5cf8b1615acfd04c3c6945d79adb2a46c0cb040637d51cf34dd',
      freeDownload: true
    },
    license: {
      spdx: 'CC-BY-4.0',
      evidenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
      reviewedAt: '2026-11-24',
      author: 'NavBharatAI project owner (reference rights holder)',
      attribution: 'Indian Modern House H01. Based on the reference image supplied by the NavBharatAI project owner; 3D adaptation authored for NavBharatAI. Attribution: NavBharatAI project owner. Licensed under CC BY 4.0.',
      commercial: true,
      redistributeInGame: true,
      redistributeSource: true
    }
  }
];
