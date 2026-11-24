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
    revision: '67502c880f8889f6e8237d45205bf9d996e79f8b2284eaf60573c8868b775f85',
    sourceUrl: 'https://github.com/docasheesh-png/navbharatai',
    downloadUrl: 'https://github.com/docasheesh-png/navbharatai',
    packaged: true,
    sha256: '67502c880f8889f6e8237d45205bf9d996e79f8b2284eaf60573c8868b775f85',
    bytes: 68572,
    libraryCategory: 'building',
    subjects: ['house', 'modern house'],
    animations: [],
    height: 5.12,
    yaw: 0,
    downloadOrigins: ['https://github.com'],
    review: {
      reviewer: 'NavBharatAI asset admission',
      evidenceRevision: '67502c880f8889f6e8237d45205bf9d996e79f8b2284eaf60573c8868b775f85',
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
