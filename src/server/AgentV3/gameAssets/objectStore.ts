import * as admin from 'firebase-admin';
import { workspaceAssetBucketName } from '../../lib/workspaceAssetStorage';
import type { AssetObjectStore } from './assetCache';

/** Reuse the existing private bucket; no public ACL, new bucket, credential or infrastructure mutation. */
export function gameAssetObjectStore(): AssetObjectStore {
  const file = (key: string) => {
    const bucket = workspaceAssetBucketName();
    if (!bucket || !/^game-assets-public-cc\/v1\/[a-f0-9]{64}\.glb$/.test(key)) throw new Error('Asset cache storage unavailable');
    return admin.storage().bucket(bucket).file(key);
  };
  return {
    async read(key, maxBytes) {
      const stream = file(key).createReadStream({ validation: 'crc32c' });
      const timer = setTimeout(() => stream.destroy(new Error('Asset cache read timed out')), 10_000);
      timer.unref();
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maxBytes) throw new Error('Cached asset exceeds budget');
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks, size);
      } catch (e) {
        if ((e as { code?: number }).code === 404) return null;
        throw e;
      } finally { clearTimeout(timer); stream.destroy(); }
    },
    async write(key, bytes, contentType) {
      // Immutable content address: concurrent workers may write identical bytes, never project data.
      await file(key).save(Buffer.from(bytes), { resumable: false, validation: 'crc32c', contentType, timeout: 10_000,
        metadata: { cacheControl: 'private, max-age=31536000, immutable' } });
    },
  };
}
