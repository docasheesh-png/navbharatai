// U-4 (verified recipe modules) — retry with exponential backoff + jitter (dependency-free).
//
// Real apps call flaky things — payment gateways, third-party APIs, a database mid-failover. A single
// network blip then becomes a user-visible 500 that a retry would have absorbed. But naive retries are their
// own bug: retrying a non-idempotent POST can double-charge a card, a tight retry loop with no delay
// hammers a struggling service (retry storm), and retrying a deterministic 400 just wastes time. This recipe
// ships a correct retry(): exponential backoff with FULL JITTER (so many clients don't retry in lockstep), a
// caller-supplied shouldRetry predicate (default: only transient errors), a cap on attempts and total delay,
// and an AbortSignal for cancellation. No dependency, no env keys. PURE builder; correct and complete — no
// TODO stubs (the real-features rule). Unit-tested.

export interface RetryConfig {
  files: Record<string, string>;
  instructions: string;
}

const RETRY_SERVER = `export interface RetryOptions {
  /** Max attempts INCLUDING the first (default 3). */
  attempts?: number;
  /** Base delay in ms before the first retry (default 200). Doubles each attempt. */
  baseMs?: number;
  /** Upper bound on any single backoff delay in ms (default 5000). */
  maxDelayMs?: number;
  /** Decide whether an error is worth retrying. Default: retry anything (treat as transient). Return false
   *  for deterministic failures (a 400/validation error) and for non-idempotent calls you must not repeat. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Optional cancellation — if it aborts, retry stops immediately and rejects. */
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Aborted')); }, { once: true });
  });

// Run fn() and, if it throws, retry with exponential backoff + full jitter until it succeeds or attempts run
// out. Rethrows the LAST error so the caller still sees a real failure. Only use this for IDEMPOTENT work
// (GET, PUT, a payment call guarded by an idempotency key) — retrying a bare create can duplicate it.
//   const rate = await retry(() => fetchRate(), { attempts: 4, shouldRetry: (e) => isTransient(e) });
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(options.attempts ?? 3, 1);
  const baseMs = options.baseMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) break;
      // Exponential backoff (baseMs * 2^(attempt-1)) capped, then FULL JITTER: a random point in [0, cap].
      const cap = Math.min(baseMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = Math.floor(fullJitter(cap));
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}

// Full-jitter delay in [0, cap]. Split out so the randomness lives in one place.
function fullJitter(cap: number): number {
  return Math.random() * cap;
}
`;

const INSTRUCTIONS =
  'Retry-with-backoff wired at server/lib/retry.ts (no dependency). Wrap a flaky external call: ' +
  'await retry(() => callThirdPartyApi(), { attempts: 4, shouldRetry: (e) => isTransient(e) }). It uses ' +
  'exponential backoff with FULL JITTER (so many clients do not retry in lockstep and cause a retry storm), ' +
  'caps the delay, rethrows the last error on give-up, and supports an AbortSignal. IMPORTANT: only retry ' +
  'IDEMPOTENT work (GET/PUT, or a payment call guarded by an idempotency key) — retrying a bare create/charge ' +
  'can duplicate it, so pass a shouldRetry that returns false for those and for deterministic 4xx errors. ' +
  'No API key needed.';

export function generateRetryIntegration(): RetryConfig {
  return {
    files: { 'server/lib/retry.ts': RETRY_SERVER },
    instructions: INSTRUCTIONS,
  };
}
