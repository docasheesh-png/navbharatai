import type { ReviewedAsset } from './providers';

/**
 * Public community contribution admitted 2026-11-24.
 * Original reference photograph ownership and public free in-game distribution permission confirmed by contributor.
 * The GLB is a self-contained, untextured architectural blockout; it does not include the showcase's claimed PBR textures,
 * interiors, loot system, collision mesh, or LOD variants.
 */
export const REVIEWED_LIBRARY_BATCH_15: readonly ReviewedAsset[] = [
  {
    provider: 'github',
    id: 'navbharatai-indian-modern-house',
    revision: '4fe9aced7253205cce5e7b2a4aaa79f4c715d48f',
    sourceUrl: 'https://github.com/docasheesh-png/navbharatai/blob/main/assets/game-models/6ecefba90f495971fe9e6111f8e3698d0a9b129ba74f37d693c44a96968c662b.glb.gz',
    downloadUrl: 'https://github.com/docasheesh-png/navbharatai/blob/main/assets/game-models/6ecefba90f495971fe9e6111f8e3698d0a9b129ba74f37d693c44a96968c662b.glb.gz',
    packaged: true,
    packagedCompression: 'gzip',
    sha256: '6ecefba90f495971fe9e6111f8e3698d0a9b129ba74f37d693c44a96968c662b',
    bytes: 40172,
    libraryCategory: 'building',
    subjects: ['indian house', 'modern indian house', 'duplex house', 'modern house'],
    animations: [],
    height: 4.47,
    yaw: 0,
    downloadOrigins: ['https://github.com'],
    review: {
      reviewer: 'NavBharatAI asset admission',
      evidenceRevision: '6ecefba90f495971fe9e6111f8e3698d0a9b129ba74f37d693c44a96968c662b',
      freeDownload: true
    },
    license: {
      spdx: 'CC-BY-4.0',
      evidenceUrl: 'https://github.com/docasheesh-png/navbharatai/blob/main/assets/game-models/indian-modern-house-LICENSE.txt',
      reviewedAt: '2026-11-24',
      author: 'NavBharatAI Community Contributor (original reference photo owner)',
      attribution: 'Original reference photo: NavBharatAI community contributor (owner-confirmed); 3D conversion: NavBharatAI. Licensed CC BY 4.0.',
      commercial: true,
      redistributeInGame: true,
      redistributeSource: true
    }
  }
];
