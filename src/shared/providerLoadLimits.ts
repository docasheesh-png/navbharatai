/** Flexible provider load-test limits (owner t116u, 2026-10-29: "0 to 10 lakh, jab chahe jitna chahe test kare").
 * The admin picks any attempts/concurrency from 1 up to LOAD_ABSOLUTE_MAX (10,00,000). Ops can lower the
 * ceiling per deployment with PROVIDER_LOAD_MAX_ATTEMPTS / PROVIDER_LOAD_MAX_CONCURRENCY (never raise it
 * above the absolute max). Spend is NOT loosened: every attempt still reserves maxAttemptNanoUsd against
 * totalBudgetNanoUsd before dispatch, so the budget — not these numbers — is the binding limit. */
export const LOAD_ABSOLUTE_MAX = 1_000_000;
/** Firestore transactions allow 500 writes; one wave writes N items + wave doc + batch doc. Larger
 * concurrency is reached by several parallel waves (lanes), each claiming at most this many attempts. */
export const LOAD_WAVE_MAX_CLAIM = 400;
/** Upper bound on parallel wave lanes the admin UI opens at once (400 x 2500 = 10 lakh in flight). */
export const LOAD_MAX_LANES = 2500;
export function clampLoadLimit(raw: unknown, fallback = LOAD_ABSOLUTE_MAX): number {
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isSafeInteger(n) || n < 1) return fallback;
  return Math.min(n, LOAD_ABSOLUTE_MAX);
}
const env = (k: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[k] : undefined);
export function loadMaxAttempts(): number { return clampLoadLimit(env('PROVIDER_LOAD_MAX_ATTEMPTS')); }
export function loadMaxConcurrency(): number { return clampLoadLimit(env('PROVIDER_LOAD_MAX_CONCURRENCY')); }
/** Parallel advance lanes needed to keep `concurrency` attempts in flight. */
export function loadLanes(concurrency: number): number {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) return 1;
  return Math.min(LOAD_MAX_LANES, Math.ceil(concurrency / LOAD_WAVE_MAX_CLAIM));
}
