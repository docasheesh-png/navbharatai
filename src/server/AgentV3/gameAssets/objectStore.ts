import { isDiscoverySubject } from './discoveryPolicy';
import * as admin from 'firebase-admin';
import { workspaceAssetBucketName } from '../../lib/workspaceAssetStorage';
import type { AssetObjectStore } from './assetCache';

/** Reuse the existing private bucket; no public ACL, new bucket, credential or infrastructure mutation. */
export function gameAssetObjectStore(): AssetObjectStore {
  const index = (key: string) => isDiscoverySubject(/^game-assets-public-cc\/discovered\/v1\/([a-z]+)\.json$/.exec(key)?.[1] ?? '');
  const file = (key: string) => {
    const bucket = workspaceAssetBucketName();
    if (!bucket || !(/^game-assets-public-cc\/v1\/[a-f0-9]{64}\.glb$/.test(key) || index(key))) throw new Error('Asset cache storage unavailable');
    return admin.storage().bucket(bucket).file(key);
  };
  return {
    async read(key, maxBytes) {
      maxBytes = Math.min(maxBytes, index(key) ? 65536 : 5 * 1024 * 1024);
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
      if (bytes.length > (index(key) ? 65536 : 5 * 1024 * 1024) || contentType !== (index(key) ? 'application/json' : 'model/gltf-binary')) throw new Error('Asset cache write budget/type');
      // Content-addressed models are immutable; the bounded private discovery pointers are replaceable.
      await file(key).save(Buffer.from(bytes), { resumable: false, validation: 'crc32c', contentType, timeout: 10_000,
        metadata: { cacheControl: index(key) ? 'private, no-store' : 'private, max-age=31536000, immutable' } });
    },
  };
}
