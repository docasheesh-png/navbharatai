import { createHash } from 'node:crypto';
import { ASSET_LIMITS, candidateMatches, validateGlb } from './assetPolicy';
import type { AssetCache, AssetManifestEntry } from './assetEngine';
import { validateCatalogue, type ReviewedAsset } from './providers';

export interface AssetObjectStore {
  read(key: string, maxBytes: number): Promise<Uint8Array | null>;
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
const PREFIX = 'game-assets-public-cc/v1/';
export function assetCacheKey(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid asset hash');
  return `${PREFIX}${hash}.glb`;
}

/** Shared cache holds ONLY approved public catalogue bytes, never a user's private project uploads. */
export function createDurableAssetCache(store: AssetObjectStore, catalogue: readonly ReviewedAsset[]): AssetCache {
  validateCatalogue(catalogue);
  const approved = new Set(catalogue.map(c => c.sha256));
  return {
    async find(requirement) {
      // No unbounded listing and no mutable metadata authority: the reviewed release catalogue is the index.
      return catalogue.filter(c => candidateMatches(c, requirement)).slice(0, 8).map(candidate => ({
        schema: 1, candidate, sha256: candidate.sha256, path: `public/game-assets/${candidate.sha256}.glb`,
        model: { bytes: 0, triangles: 0, animations: [] },
      } satisfies AssetManifestEntry));
    },
    async read(hash) {
      if (!approved.has(hash)) return null;
      const bytes = await store.read(assetCacheKey(hash), ASSET_LIMITS.bytes);
      if (!bytes || bytes.byteLength > ASSET_LIMITS.bytes || createHash('sha256').update(bytes).digest('hex') !== hash) return null;
      validateGlb(bytes);
      return bytes;
    },
    async put(entry, bytes) {
      if (!approved.has(entry.sha256) || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Unapproved cache write');
      validateGlb(bytes);
      await store.write(assetCacheKey(entry.sha256), bytes, 'model/gltf-binary');
    },
  };
}
