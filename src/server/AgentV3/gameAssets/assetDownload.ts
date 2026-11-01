import { publicOnlyInit } from '../../lib/ssrfGuard';
import { ASSET_LIMITS, type AssetCandidate } from './assetPolicy';

/** Exact URL authorities reviewed by the catalogue curator, not domains supplied by a game prompt. */
export function assetDownloadUrl(raw: string, allowedOrigins: ReadonlySet<string>): URL {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || !allowedOrigins.has(u.origin)) {
    throw new Error('Asset download origin is not authorized');
  }
  return u;
}

/** Stream bounded bytes; reject redirects, archives, encoded HTTP bodies and unbounded downloads. */
export async function downloadGameAsset(
  candidate: AssetCandidate,
  allowedOrigins: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const url = assetDownloadUrl(candidate.downloadUrl, allowedOrigins);
  const response = await fetch(url, publicOnlyInit({
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { 'User-Agent': 'NavBharatAI-AssetEngine/1.0 (+https://navbharatai.com)', 'Accept-Encoding': 'identity' },
  }));
  const encoding = response.headers.get('content-encoding');
  const length = response.headers.get('content-length');
  if (!response.ok || !response.body || (encoding && encoding !== 'identity') || (length && (!/^\d+$/.test(length) || Number(length) > ASSET_LIMITS.bytes))) {
    await response.body?.cancel();
    throw new Error('Asset response rejected');
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ASSET_LIMITS.bytes) throw new Error('Asset exceeds byte budget');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (!size || (length && Number(length) !== size)) throw new Error('Asset truncated');
  return Buffer.concat(chunks, size);
}
