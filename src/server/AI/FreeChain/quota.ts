/** Conservative, bounded quota arithmetic. No provider call may happen before admission. */
export const DEFAULT_QUOTA_SAFETY_MARGIN = 0.9;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const ROLLING_DAY = 'rolling24h';

export interface QuotaLimits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
  neuronsPerDay?: number;
  /** A conservative, rounded-up maximum for this physical call, never measured usage. */
  neuronsPerRequest?: number;
}
export interface QuotaScope {
  provider: string;
  model: string;
  timeZone: string;
  /** Set to the same value for models sharing an account-wide request/token allowance. */
  quotaScope?: string;
}
export interface QuotaReservationInput extends QuotaScope {
  inputTokens: number;
  outputTokens: number;
  limits: QuotaLimits;
  safetyMargin?: number;
}
export type QuotaReason = 'allowed' | 'cooldown' | 'rpm' | 'rpd' | 'tpm' | 'tpd' | 'neuronsPerDay'
  | 'invalid_quota' | 'store_unavailable' | 'store_corrupt';
export interface QuotaDecision { allowed: boolean; reason: QuotaReason; resetAt: number }
export interface QuotaUsage { rpm: number; rpd: number; tpm: number; tpd: number; neuronsPerDay: number }
export interface DayWindow { key: string; startAt: number; resetAt: number }
export interface QuotaBucket extends DayWindow { requests: number; tokens: number; neurons: number }
export interface QuotaLedger {
  version: 1;
  timeZone: string;
  minutes: QuotaBucket[];
  days: QuotaBucket[];
  updatedAt: number;
}
export class FreeChainDataError extends Error {}

export function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function checkedAdd(a: number, b: number): number {
  const total = a + b;
  if (!nonnegativeInteger(a) || !nonnegativeInteger(b) || !nonnegativeInteger(total)) throw new FreeChainDataError('Invalid counter');
  return total;
}
export function validTime(now: number): void {
  if (!nonnegativeInteger(now) || now > 8_000_000_000_000_000) throw new FreeChainDataError('Invalid clock');
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  if (typeof timeZone !== 'string' || !timeZone.trim() || timeZone.length > 128) throw new FreeChainDataError('Missing timezone');
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (formatters.size >= 32) formatters.clear();
    formatters.set(timeZone, value);
  }
  return value;
}
export function civilDayKey(now: number, timeZone: string): string {
  validTime(now);
  const parts = formatter(timeZone).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/** Finds actual timezone boundaries, not midnight + 24h. Handles 23/25-hour DST days. */
export function civilDayWindow(now: number, timeZone: string): DayWindow {
  const key = civilDayKey(now, timeZone);
  const sameDay = (at: number) => civilDayKey(at, timeZone) === key;
  let left = Math.max(0, now - 36 * HOUR_MS), right = now;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sameDay(mid)) right = mid; else left = mid + 1;
  }
  const startAt = left;
  left = now; right = now + 36 * HOUR_MS;
  if (sameDay(right)) throw new FreeChainDataError('Unresolved timezone boundary');
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sameDay(mid)) left = mid + 1; else right = mid;
  }
  return { key, startAt, resetAt: left };
}
export function dailyWindow(now: number, timeZone: string): DayWindow {
  validTime(now);
  if (timeZone !== ROLLING_DAY) return civilDayWindow(now, timeZone);
  const startAt = Math.floor(now / HOUR_MS) * HOUR_MS;
  // Keep the entire oldest hour. This may delay recovery by <1h, never over-admit.
  return { key: String(startAt), startAt, resetAt: startAt + 25 * HOUR_MS };
}
function minuteWindow(now: number): DayWindow {
  const startAt = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  // A boundary burst must not spend two complete RPM allowances in one rolling minute.
  return { key: String(startAt), startAt, resetAt: startAt + 2 * MINUTE_MS };
}
function validBucket(raw: unknown): raw is QuotaBucket {
  if (!raw || typeof raw !== 'object') return false;
  const b = raw as QuotaBucket;
  return typeof b.key === 'string' && nonnegativeInteger(b.startAt) && nonnegativeInteger(b.resetAt)
    && b.resetAt > b.startAt && nonnegativeInteger(b.requests) && nonnegativeInteger(b.tokens) && nonnegativeInteger(b.neurons);
}
/** Missing documents are new counters; malformed existing documents are NEVER zero counters. */
export function readQuotaLedger(raw: unknown, now: number, timeZone: string): QuotaLedger {
  dailyWindow(now, timeZone); // Validate timezone even for an empty ledger.
  if (raw === undefined) return { version: 1, timeZone, minutes: [], days: [], updatedAt: now };
  const data = raw as QuotaLedger;
  if (!data || data.version !== 1 || typeof data.timeZone !== 'string' || !nonnegativeInteger(data.updatedAt) || data.updatedAt > now
    || !Array.isArray(data.minutes) || data.minutes.length > 2 || !data.minutes.every(validBucket)
    || !Array.isArray(data.days) || data.days.length > 25 || !data.days.every(validBucket)
    || [...data.minutes, ...data.days].some(b => b.startAt > now)) throw new FreeChainDataError('Malformed quota ledger');
  if (data.minutes.some(b => b.startAt % MINUTE_MS !== 0 || b.key !== String(b.startAt) || b.resetAt !== b.startAt + 2 * MINUTE_MS)
    || (data.timeZone === ROLLING_DAY && data.days.some(b => b.startAt % HOUR_MS !== 0 || b.key !== String(b.startAt) || b.resetAt !== b.startAt + 25 * HOUR_MS))) {
    throw new FreeChainDataError('Malformed quota window');
  }
  if (data.timeZone !== ROLLING_DAY) {
    // A corrupted shortened civil reset must not release a full daily allowance early.
    // Civil ledgers have exactly one active calendar bucket, unlike rolling hourly ledgers.
    try {
      formatter(data.timeZone);
      if (data.days.length > 1) throw new Error('Multiple civil days');
      for (const bucket of data.days) {
        const expected = civilDayWindow(bucket.startAt, data.timeZone);
        if (bucket.key !== expected.key || bucket.startAt !== expected.startAt || bucket.resetAt !== expected.resetAt) throw new Error('Civil boundary mismatch');
      }
    } catch { throw new FreeChainDataError('Malformed civil quota window'); }
  }
  const minutes = data.minutes.filter(b => b.resetAt > now);
  const days = data.days.filter(b => b.resetAt > now);
  if (data.timeZone !== timeZone && (minutes.length || days.length)) throw new FreeChainDataError('Active quota timezone changed');
  // Duplicate bucket identities would make updates ambiguous and must not be silently normalized.
  if (new Set(minutes.map(b => b.key)).size !== minutes.length || new Set(days.map(b => b.key)).size !== days.length) {
    throw new FreeChainDataError('Duplicate quota bucket');
  }
  return { version: 1, timeZone, minutes, days, updatedAt: data.updatedAt };
}
export function quotaUsage(ledger: QuotaLedger): QuotaUsage {
  const sum = (buckets: QuotaBucket[], field: 'requests' | 'tokens' | 'neurons') => buckets.reduce((n, b) => checkedAdd(n, b[field]), 0);
  return { rpm: sum(ledger.minutes, 'requests'), tpm: sum(ledger.minutes, 'tokens'),
    rpd: sum(ledger.days, 'requests'), tpd: sum(ledger.days, 'tokens'), neuronsPerDay: sum(ledger.days, 'neurons') };
}
export function incrementQuotaLedger(ledger: QuotaLedger, input: { requests: number; tokens: number; neurons: number }, now: number): QuotaLedger {
  const increment = (buckets: QuotaBucket[], window: DayWindow) => {
    const found = buckets.find(b => b.key === window.key);
    const next: QuotaBucket = { ...window, requests: checkedAdd(found?.requests ?? 0, input.requests),
      tokens: checkedAdd(found?.tokens ?? 0, input.tokens), neurons: checkedAdd(found?.neurons ?? 0, input.neurons) };
    return [...buckets.filter(b => b.key !== window.key), next];
  };
  return { ...ledger, minutes: increment(ledger.minutes, minuteWindow(now)),
    days: increment(ledger.days, dailyWindow(now, ledger.timeZone)), updatedAt: now };
}
export function ledgerResetAt(ledger: QuotaLedger, period: 'minute' | 'day', now: number): number {
  const buckets = period === 'minute' ? ledger.minutes : ledger.days;
  return buckets.length ? Math.min(...buckets.map(b => b.resetAt))
    : period === 'minute' ? minuteWindow(now).resetAt : dailyWindow(now, ledger.timeZone).resetAt;
}
export function quotaCapacity(limit: number, safetyMargin = DEFAULT_QUOTA_SAFETY_MARGIN): number {
  if (!nonnegativeInteger(limit) || !Number.isFinite(safetyMargin) || safetyMargin <= 0 || safetyMargin > 1) {
    throw new FreeChainDataError('Invalid quota capacity');
  }
  // Round the margin DOWN to one-millionth before exact integer multiplication. Floating
  // multiplication near MAX_SAFE_INTEGER must never round an admission limit upward.
  const millionths = Math.floor(safetyMargin * 1_000_000);
  return Number(BigInt(limit) * BigInt(millionths) / 1_000_000n);
}
export function validateQuotaInput(input: QuotaReservationInput, now: number): void {
  validTime(now);
  if (!input || typeof input.provider !== 'string' || !input.provider.trim() || input.provider.length > 128
    || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 256
    || (input.quotaScope !== undefined && (typeof input.quotaScope !== 'string' || !input.quotaScope.trim() || input.quotaScope.length > 256))
    || !nonnegativeInteger(input.inputTokens) || !nonnegativeInteger(input.outputTokens) || !input.limits
    || !['rpm', 'rpd', 'tpm', 'tpd', 'neuronsPerDay'].some(k => input.limits[k as keyof QuotaLimits] !== undefined)) {
    throw new FreeChainDataError('Invalid quota input');
  }
  checkedAdd(input.inputTokens, input.outputTokens);
  for (const field of ['rpm', 'rpd', 'tpm', 'tpd', 'neuronsPerDay'] as const) {
    if (input.limits[field] !== undefined) quotaCapacity(input.limits[field]!, input.safetyMargin);
  }
  if (input.limits.neuronsPerDay !== undefined && (!nonnegativeInteger(input.limits.neuronsPerRequest) || input.limits.neuronsPerRequest <= 0)) {
    throw new FreeChainDataError('Missing maximum neuron reservation');
  }
  dailyWindow(now, input.timeZone);
}
