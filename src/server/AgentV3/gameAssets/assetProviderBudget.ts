import { BoundedCache } from '../../lib/boundedCache';

// One release catalogue admits at most 64 assets × 4 origins, plus the fixed metadata API.
// Bounded state has no TTL that could silently expire a provider's longer Retry-After interval.
const nextRequest = new BoundedCache<string, number>({ maxEntries: 512 });

/** Reserve at most one queued request per origin; a longer cooldown falls back immediately. */
export function assetProviderPermit(origin: string, signal: AbortSignal): Promise<void> | undefined {
  signal.throwIfAborted();
  const now = Date.now(); const delay = Math.max(0, (nextRequest.get(origin) ?? 0) - now);
  if (delay > 1000) throw new Error('Provider rate limit');
  nextRequest.set(origin, now + delay + 1000);
  if (!delay) return undefined;
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('Provider request cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Never shorten a valid server cooldown; excessive numeric values fail closed for this process. */
export function assetRetryDeadline(value: string | null, now = Date.now()): number {
  let deadline = now + 60_000;
  if (value && /^\d+$/.test(value)) {
    const seconds = Number(value);
    deadline = now + Math.max(1, seconds) * 1000;
  } else if (value && /[A-Za-z]/.test(value)) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) deadline = Math.max(now + 1000, date);
  }
  return Number.isSafeInteger(deadline) ? deadline : Number.MAX_SAFE_INTEGER;
}

export function recordAssetProviderResponse(origin: string, response: Response): void {
  if (response.status !== 429 && response.status !== 503) return;
  nextRequest.set(origin, Math.max(nextRequest.get(origin) ?? 0, assetRetryDeadline(response.headers.get('retry-after'))));
}
