import { runWatchedStream, type WatchdogLimits } from '../Router/streamWatchdog';

/** Fixed chat has twelve positions, not twelve independent full request deadlines.
 * Reserve an equal first-token opportunity for every remaining position. Once
 * text commits, no other provider may answer, so only the total deadline applies.
 * This is chat-local: Pro/App Builder watchdogs are deliberately unchanged.
 */
export function chatAttemptLimits(limits: WatchdogLimits, deadlineAtMs: number, remainingPositions: number, now = Date.now()): WatchdogLimits {
  const remainingMs = Math.max(1, deadlineAtMs - now);
  return { firstTokenMs: Math.min(limits.firstTokenMs, Math.max(1, Math.floor(remainingMs / Math.max(1, remainingPositions)))),
    idleMs: Math.min(limits.idleMs, remainingMs), hardCapMs: Math.min(limits.hardCapMs, remainingMs) };
}

/** An SDK ignoring AbortSignal must not keep a cancelled user's request waiting.
 * Keep physical occupancy with the original promise (the runtime owns that), but
 * stop observing and suppress its late chunks immediately. The underlying promise
 * remains observed, including a late rejection. No second provider is dispatched
 * by this helper and cancellation is not a provider failure.
 */
export async function watchChatAttempt(
  run: (chunk: (text: string) => void) => Promise<unknown>,
  onChunk: (text: string) => void,
  limits: WatchdogLimits,
  signal: AbortSignal,
) {
  return runWatchedStream(async chunk => {
    signal.throwIfAborted();
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new Error('Chat request cancelled'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return run(text => { if (!signal.aborted) chunk(text); }); }), cancelled]);
    } finally { signal.removeEventListener('abort', abort); }
  }, onChunk, limits);
}
