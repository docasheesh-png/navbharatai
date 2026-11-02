import { assetProviderPermit, recordAssetProviderResponse } from './assetProviderBudget';
import { createHash } from 'node:crypto';
import { bundleGltf } from './gltfBundle';
import { bundleGlbResources } from './glbResourceBundle';
import { compactGlb } from './assetOptimize';
import { selectGlbAnimations } from './assetAnimationSelection';
import { ASSET_LIMITS } from './assetPolicy';
import { BoundedCache } from '../../lib/boundedCache';
import { publicOnlyInit } from '../../lib/ssrfGuard';
import { downloadGameAsset } from './assetDownload';
import type { ReviewedAsset, ProviderJsonTransport } from './providers';

const pending = new BoundedCache<string, Promise<Uint8Array>>({ maxEntries: 4 });

/** Public immutable catalogue downloads only; never coalesce private/authenticated requests. */
export async function downloadReviewedAsset(candidate: ReviewedAsset, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const key = `${candidate.provider}:${candidate.sha256}`;
  let transfer = pending.get(key);
  if (!transfer) {
    if (pending.size >= 4) throw new Error('Asset downloader is at capacity');
    transfer = (async () => {
      const deadline = AbortSignal.timeout(15_000);
      const origins = new Set(candidate.downloadOrigins);
      const bytes = await downloadGameAsset(candidate, origins, deadline);
      if (candidate.format !== 'gltf' && candidate.format !== 'glb-resources') {
        if (!candidate.optimization) return bytes;
        if (createHash('sha256').update(bytes).digest('hex') !== candidate.sourceSha256) throw new Error('Optimization source/version mismatch');
        if (candidate.optimization === 'animation-selection-v1') return selectGlbAnimations(bytes, candidate.sourceSha256!, candidate.retainedAnimations ?? []);
        if (candidate.optimization !== 'compact-v1') throw new Error('Optimization source/version mismatch');
        return compactGlb(bytes).bytes;
      }
      if (createHash('sha256').update(bytes).digest('hex') !== candidate.sourceSha256) throw new Error('glTF source hash mismatch');
      const resources = new Map<string, Uint8Array>(); let size = bytes.byteLength;
      for (const r of candidate.resources ?? []) {
        deadline.throwIfAborted();
        const resource = await downloadGameAsset({ ...candidate, downloadUrl:r.url }, origins, deadline);
        size += resource.byteLength;
        if (size > ASSET_LIMITS.bytes || createHash('sha256').update(resource).digest('hex') !== r.sha256) throw new Error('glTF resource hash/budget mismatch');
        resources.set(r.path, resource);
      }
      const glb = candidate.format === 'glb-resources' ? bundleGlbResources(bytes, resources) : bundleGltf(bytes,resources);
      return candidate.optimization === 'compact-v1' ? compactGlb(glb).bytes : glb;
    })();
    pending.set(key, transfer);
    void transfer.finally(() => pending.delete(key)).catch(() => {});
  }
  const bytes = await transfer;
  signal.throwIfAborted();
  return bytes;
}

export const polyHavenTransport: ProviderJsonTransport = {
  async get(url, signal) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://api.polyhaven.com' || !/^\/(info|files)\/[a-z0-9_]+$/.test(parsed.pathname) || parsed.search || parsed.username || parsed.password || parsed.hash) throw new Error('Unapproved metadata endpoint');
    const permit = assetProviderPermit(parsed.origin, signal);
    if (permit) await permit;
    const r = await fetch(url, publicOnlyInit({ redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      headers: { 'User-Agent': 'NavBharatAI-AssetEngine/1.0 (+https://navbharatai.com)', 'Accept-Encoding': 'identity' } }));
    recordAssetProviderResponse(parsed.origin, r);
    if (!r.ok || !r.body || (r.headers.get('content-encoding') && r.headers.get('content-encoding') !== 'identity')) {
      await r.body?.cancel(); throw new Error('Provider unavailable');
    }
    const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > 1024 * 1024) throw new Error('Provider metadata exceeds budget');
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  },
};
