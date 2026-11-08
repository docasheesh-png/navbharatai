import { BoundedCache } from '../lib/boundedCache';
/** Process-local terminal observations, never a quality score or an all-instance SLO.
 * No messages, user IDs, provider error text or credentials are retained. */
export type ChatOutcome = 'complete' | 'partial' | 'refused' | 'cancelled' | 'failed';
type Counts = Record<ChatOutcome, number>;
const empty = (): Counts => ({ complete: 0, partial: 0, refused: 0, cancelled: 0, failed: 0 });
const WINDOW_MS = 15 * 60_000;
type FailureReason = 'authentication' | 'rate-limit' | 'quota' | 'timeout' | 'network' | 'upstream' | 'policy' | 'unavailable' | 'interrupted' | 'unknown';
function failureReason(error: unknown): FailureReason {
  const value = error as { code?: unknown; status?: unknown } | null;
  const code = value && typeof value.code === 'string' ? value.code : '';
  if (code === 'AUTH' || value?.status === 401 || value?.status === 403) return 'authentication';
  if (['QUOTA_EXHAUSTED', 'INSUFFICIENT_QUOTA'].includes(code)) return 'quota';
  if (code === 'RATE_LIMIT' || value?.status === 429) return 'rate-limit';
  if (code === 'TIMEOUT' || value?.status === 408 || value?.status === 504) return 'timeout';
  if (code === 'NETWORK') return 'network';
  if (typeof value?.status === 'number' && value.status >= 500 && value.status <= 599) return 'upstream';
  if (['SAFETY_REFUSAL', 'POLICY_BLOCKED', 'STRICT_FREE_CAPABILITY_UNAVAILABLE'].includes(code)) return 'policy';
  return 'unknown';
}
// Six allowlisted surfaces and ten failure categories per minute, at most sixteen minutes.
// The common cache gives a hard size bound even across wall-clock changes; recording is O(1).
const buckets = new BoundedCache<number, { surfaces: Map<string, Counts>; failures: Partial<Record<FailureReason, number>> }>({ maxEntries: 16 });
const surfaces = new Set(['navbharat', 'free', 'professional', 'sda', 'doctor']);
function record(surface: string, outcome: ChatOutcome, reason?: FailureReason) {
  const now = Date.now();
  const minute = Math.floor(now / 60_000), key = surfaces.has(surface) ? surface : 'other';
  let bucket = buckets.get(minute, now);
  if (!bucket) {
    bucket = { surfaces: new Map(), failures: {} };
    buckets.set(minute, bucket, now, (minute + 1) * 60_000 + WINDOW_MS - now);
  }
  let counts = bucket.surfaces.get(key);
  if (!counts) bucket.surfaces.set(key, counts = empty());
  counts[outcome]++;
  if (reason) bucket.failures[reason] = (bucket.failures[reason] ?? 0) + 1;
}
export function getChatOutcomeObservation() {
  const counts = empty(); const bySurface: Record<string, Counts> = {};
  const current = buckets.entries();
  for (const [, bucket] of current) for (const [surface, values] of bucket.surfaces) {
    const total = bySurface[surface] ??= empty();
    for (const state of Object.keys(counts) as ChatOutcome[]) { counts[state] += values[state]; total[state] += values[state]; }
  }
  const failureReasons: Partial<Record<FailureReason, number>> = {};
  for (const [, bucket] of current) for (const key of Object.keys(bucket.failures) as FailureReason[]) failureReasons[key] = (failureReasons[key] ?? 0) + (bucket.failures[key] ?? 0);
  return { failureReasons, scope: 'this-process-universal-router-calls' as const, windowMinutes: 15, counts, bySurface };
}
export function resetChatOutcomeObservationForTests() { buckets.clear(); }
/** Observe all route selections at one boundary; preserve returns/errors and never retry. */
export async function observeChatOutcome<T extends { ok: boolean; reason?: string; content?: string }>(
  surface: string, signal: AbortSignal | undefined, run: () => Promise<T>, visibleText?: () => boolean,
): Promise<T> {
  try {
    const result = await run();
    const visible = visibleText ? visibleText() : !!result.content?.trim();
    const state: ChatOutcome = signal?.aborted || result.reason === 'aborted' ? 'cancelled'
      : result.reason === 'stalled' ? visible ? 'partial' : 'failed'
      : result.ok && visible ? 'complete' : visibleText && visible ? 'partial' : 'failed';
    record(surface, state, state === 'partial' ? 'interrupted' : state === 'failed' ? result.reason === 'no-provider' ? 'unavailable' : 'unknown' : undefined); return result;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const refused = typeof code === 'string' && ['SAFETY_REFUSAL', 'POLICY_BLOCKED', 'STRICT_FREE_CAPABILITY_UNAVAILABLE'].includes(code);
    record(surface, signal?.aborted ? 'cancelled' : visibleText?.() ? 'partial' : refused ? 'refused' : 'failed', signal?.aborted ? undefined : refused ? 'policy' : failureReason(error));
    throw error;
  }
}
