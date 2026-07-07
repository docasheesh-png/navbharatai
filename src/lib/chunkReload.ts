// Stale-chunk (dynamic-import) failure detection + one-time reload recovery.
//
// A new deployment content-hashes Vite's lazy chunks, so a tab opened BEFORE the deploy requests an old
// chunk URL that no longer exists → "Failed to fetch dynamically imported module" → a blank screen or a
// dead feature. The fix is to reload once (which pulls the fresh index + new chunk URLs). This module
// centralizes (1) the pure message predicate that recognises such a failure, and (2) the pure decision
// of whether we may reload now (guarded so a genuinely-broken build can never loop).

const CHUNK_ERROR_PATTERNS = [
  'importing a module script failed', // Safari
  'dynamically imported module', // Chrome "failed to fetch …" + Firefox "error loading …"
  'error loading chunk',
  'loading chunk', // webpack-style "Loading chunk N failed"
  'chunkloaderror',
  'unable to preload css',
];

/** True when an error message indicates a stale/missing dynamic import (chunk) — i.e. a reload can fix it. Pure. */
export function isChunkLoadError(message: unknown): boolean {
  const msg = String((message as { message?: unknown })?.message ?? message ?? '').toLowerCase();
  if (!msg) return false;
  return CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Decide whether to reload NOW for a stale chunk. Pure. Reloads when we have not already reloaded for this
 * (the flag is cleared once the app successfully mounts, so each deploy gets one fresh recovery), OR when
 * the last reload was long enough ago that a retry is worth it — but never within the cooldown, so a build
 * that stays broken after a reload can never spin in a reload loop.
 */
export function shouldReloadForStaleChunk(now: number, lastReloadAt: number | null, cooldownMs = 30_000): boolean {
  if (!lastReloadAt) return true;
  return now - lastReloadAt > cooldownMs;
}
