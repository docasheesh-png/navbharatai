// THE ONE CLIENT EVERY data.gov.in DATASET IS FETCHED THROUGH.
//
// WHY THIS EXISTS (admin 2026-09-20: "karo!!!"). The registry says WHAT a source is; this says HOW it
// is reached. Together they are the thing that matters in the forwarded plan's own words: adding the
// next government dataset must be a REGISTRY ROW, not a new code path. Every dataset on data.gov.in
// answers at the same endpoint shape with the same account-level key, so one client genuinely covers
// the catalogue — there is no per-dataset client to write, and writing one would be the mistake.
//
// 🔒 FOUR PROPERTIES THAT ARE NOT DECORATION.
//
//  1. **It cannot reach a source nobody has checked.** The id is resolved through
//     `callableSources()`, so a row that is `unverified`, disabled, or has no resource id is
//     unreachable here — not behind a flag, by construction. "Do not fake an endpoint" stops being
//     a promise.
//  2. **The registry's `filters` list is an ALLOWLIST.** A caller may only send parameters the row
//     declares. That keeps a caller from appending arbitrary query parameters to a government
//     request, and it keeps the cache key bounded to a known set.
//  3. **It never throws and never invents.** Every failure is a typed reason the caller can report
//     honestly; there is no path that returns a plausible-looking record.
//  4. **An empty or failed response is never cached.** Straight from `braveSearch.ts`'s own rule:
//     one blocked minute must not become ten.
//
// ⚠️ THE CACHE AND THE COALESCING ARE THIS REPO'S EXISTING PATTERN, DELIBERATELY COPIED RATHER THAN
// REINVENTED — including the `settled` flag, which `braveSearch.ts` records as the fix for a real
// bug it shipped with: an entry removed in a detached `.finally()` runs a microtask later than the
// caller's own continuation, so a second caller could coalesce onto an ALREADY-SETTLED promise and
// be handed a result that was deliberately not cached. Coalescing is only safe while a request is
// genuinely in the air.
//
// ⚠️ NOT ONE CALL HAS BEEN MADE AGAINST THE REAL ENDPOINT. Every data.gov.in host answers
// `403 CONNECT tunnel failed` through this environment's egress proxy — tested, not assumed. The URL
// shape and the `records` envelope come from published documentation. The first real response is
// this module's first real evidence.

import {
  callableSources,
  sourceById,
  type ExternalSource,
} from './registry';

/** One row as the portal returns it. Field names differ per dataset, so this stays open. */
export type GovRecord = Record<string, unknown>;

/**
 * Why a fetch produced nothing.
 *
 * Each value is something a caller can say out loud. There is deliberately no `'unknown'`: a reason
 * nobody can act on is the shape that lets a silent failure look handled.
 */
export type GovFailure =
  /** The id is not a callable registry row — unverified, disabled, or no resource id. */
  | 'not-callable'
  /** The row needs a credential that is not configured. */
  | 'no-key'
  /** No usable filter survived the allowlist, so the request would have been unbounded. */
  | 'no-filter'
  /** The key was refused (401/403). */
  | 'auth-rejected'
  /** The portal asked us to slow down (429). */
  | 'rate-limited'
  /** The resource id is not there (404) — the commonest sign of a stale registry row. */
  | 'not-found'
  /** Any other non-2xx. */
  | 'http-error'
  /** Not JSON, or JSON without the `records` envelope this API documents. */
  | 'unreadable'
  /** A well-formed answer with nothing in it. Not an error — just no data for that filter. */
  | 'empty'
  /** The request did not come back in time. */
  | 'timeout';

export interface GovFetchResult {
  ok: boolean;
  sourceId: string;
  records: GovRecord[];
  fromCache: boolean;
  reason?: GovFailure;
  /** The credit the licence obliges the answer to carry, or null. Taken from the registry row. */
  attribution: string | null;
}

const DEFAULT_TIMEOUT_MS = 6_000;
const HOST = 'https://api.data.gov.in/resource';

/**
 * Rows the portal may return in one request.
 *
 * A city can hold dozens of stations and each reports several fields, so a few hundred is the real
 * need. It is capped rather than unbounded because the point of the filter is to avoid pulling a
 * national dataset to answer a question about one district.
 */
export const MAX_RECORDS = 500;

// ── the cache, and the in-flight map (see the header for why `settled` exists) ───────────────────

interface CacheEntry { at: number; records: GovRecord[]; }
interface InFlight { p: Promise<GovFetchResult>; settled: boolean; }

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlight>();

const meter = { calls: 0, cacheHits: 0, coalesced: 0, failures: 0 };

/**
 * What this instance has fetched since boot — honest about being PER-INSTANCE.
 *
 * Cloud Run runs several, so this is never the account's total. Quoting it as portal usage would be
 * the same mistake `braveMeter()` already warns about in its own docblock.
 */
export function govDataMeter(): {
  calls: number; cacheHits: number; coalesced: number; failures: number; saved: number;
} {
  return { ...meter, saved: meter.cacheHits + meter.coalesced };
}

/** Test seam — a fresh instance's state without restarting the process. */
export function __resetGovDataClient(): void {
  cache.clear();
  inFlight.clear();
  meter.calls = 0; meter.cacheHits = 0; meter.coalesced = 0; meter.failures = 0;
}

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────

/**
 * The filters a source will actually accept. PURE.
 *
 * 🔒 THE REGISTRY'S LIST IS AN ALLOWLIST, and that is a security property rather than tidiness: it
 * stops a caller appending arbitrary query parameters to a government request, and it bounds the
 * cache key to a known set of names. An undeclared filter is DROPPED, silently and deliberately —
 * refusing the whole request over one stray key would turn a caller's typo into an outage.
 */
export function allowedFilters(
  source: ExternalSource,
  filters: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of source.filters) {
    const raw = filters[name];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) out[name] = value;
  }
  return out;
}

/** The request URL. PURE, exported so a test can pin the host and the escaping. */
export function resourceUrl(
  source: ExternalSource,
  apiKey: string,
  filters: Readonly<Record<string, string>>,
  limit = MAX_RECORDS,
): string {
  // `filters[name]` keeps LITERAL brackets: that is how data.gov.in documents the parameter, and
  // this environment cannot reach the portal to test an invented encoding against its parser.
  const parts = Object.entries(filters).map(
    ([k, v]) => `&filters[${k}]=${encodeURIComponent(v)}`,
  );
  return `${HOST}/${source.resourceId}`
    + `?api-key=${encodeURIComponent(apiKey)}`
    + '&format=json'
    + `&limit=${limit}`
    + parts.join('');
}

/** The cache key. PURE — filter order must not produce two entries for one question. */
export function cacheKeyFor(sourceId: string, filters: Readonly<Record<string, string>>): string {
  const pairs = Object.keys(filters).sort().map((k) => `${k}=${filters[k].toLowerCase()}`);
  return `${sourceId}|${pairs.join('&')}`;
}

/**
 * What an HTTP status means here. PURE.
 *
 * Each one is separated because the remedies are completely different: a 404 usually means the
 * registry row is stale, a 401 means the key, a 429 means wait. Collapsing them into "it failed"
 * would leave whoever reads the log with no next step.
 */
export function failureForStatus(status: number): GovFailure {
  if (status === 401 || status === 403) return 'auth-rejected';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  return 'http-error';
}

/**
 * The records out of a portal response, or null when the envelope is not what this API documents.
 * PURE.
 */
export function recordsIn(body: unknown): GovRecord[] | null {
  if (!body || typeof body !== 'object') return null;
  const records = (body as { records?: unknown }).records;
  if (!Array.isArray(records)) return null;
  return records.filter((r): r is GovRecord => !!r && typeof r === 'object' && !Array.isArray(r));
}

function fail(sourceId: string, reason: GovFailure, attribution: string | null = null): GovFetchResult {
  return { ok: false, sourceId, records: [], fromCache: false, reason, attribution };
}

// ── the one I/O function ─────────────────────────────────────────────────────────────────────────

export interface GovFetchOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /** Skip the cache for this call. Used by an admin "test this source" action. */
  noCache?: boolean;
}

/**
 * Fetch one registry source with one set of filters.
 *
 * Never throws. Never returns a record it did not receive. A caller that gets `ok: false` has a
 * `reason` it can report honestly and an `attribution` it will not need.
 */
export async function fetchGovResource(
  sourceId: string,
  filters: Readonly<Record<string, string>> = {},
  opts: GovFetchOptions = {},
): Promise<GovFetchResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;

  // 🔒 Resolved through callableSources(), NOT sourceById(): a row nobody has checked cannot be
  // reached from here even if a caller names it exactly.
  const source = callableSources().find((s) => s.id === sourceId);
  if (!source || source.auth !== 'data-gov-in-key' || !source.resourceId) {
    return fail(sourceId, 'not-callable', sourceById(sourceId)?.attribution ?? null);
  }

  const attribution = source.attribution;
  const apiKey = String(env[source.keyEnv ?? ''] ?? '').trim();
  if (!apiKey) return fail(sourceId, 'no-key', attribution);

  const usable = allowedFilters(source, filters);
  if (Object.keys(usable).length === 0) return fail(sourceId, 'no-filter', attribution);

  const key = cacheKeyFor(sourceId, usable);

  if (!opts.noCache && source.cacheTtlMs > 0) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < source.cacheTtlMs) {
      meter.cacheHits += 1;
      return { ok: true, sourceId, records: hit.records, fromCache: true, attribution };
    }
    const live = inFlight.get(key);
    // Coalescing is only safe while the request is genuinely in the air — see the header.
    if (live && !live.settled) {
      meter.coalesced += 1;
      return live.p;
    }
  }

  const entry: InFlight = { settled: false, p: Promise.resolve(fail(sourceId, 'http-error', attribution)) };
  entry.p = (async (): Promise<GovFetchResult> => {
    meter.calls += 1;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetchImpl(resourceUrl(source, apiKey, usable), { signal: controller.signal });
      if (!res.ok) { meter.failures += 1; return fail(sourceId, failureForStatus(res.status), attribution); }

      let body: unknown;
      try { body = await res.json(); } catch { meter.failures += 1; return fail(sourceId, 'unreadable', attribution); }

      const records = recordsIn(body);
      if (!records) { meter.failures += 1; return fail(sourceId, 'unreadable', attribution); }
      // Zero rows is not an error — the filter simply matched nothing. It is NOT cached, because a
      // dataset that fills in an hour must not be remembered as empty for the whole TTL.
      if (records.length === 0) return fail(sourceId, 'empty', attribution);

      if (source.cacheTtlMs > 0) cache.set(key, { at: now(), records });
      return { ok: true, sourceId, records, fromCache: false, attribution };
    } catch (err) {
      meter.failures += 1;
      const aborted = (err as { name?: string })?.name === 'AbortError';
      return fail(sourceId, aborted ? 'timeout' : 'http-error', attribution);
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlight.set(key, entry);
  try {
    return await entry.p;
  } finally {
    entry.settled = true;
    inFlight.delete(key);
  }
}
