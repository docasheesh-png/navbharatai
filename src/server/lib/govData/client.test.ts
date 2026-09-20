/**
 * THE GOVERNMENT-DATA CLIENT — every way a portal call can go wrong, and what we say when it does.
 *
 * The forwarded plan asked for exactly this list (timeout, 401/403, 404, malformed JSON, empty
 * response, rate limit, cache hit, cache miss, missing API), and it is the right list for one
 * reason: **a government dataset that silently returns nothing is indistinguishable from one that
 * returns nothing because there is nothing there.** Each failure below gets its own name so a log
 * line tells whoever reads it what to do next — a 404 usually means the registry row is stale, a
 * 401 means the key, a 429 means wait.
 *
 * 🔒 The property under all of them: **no path fabricates a record.** `ok: false` always carries an
 * empty `records` array and a reason.
 *
 * ⚠️ NOT ONE CASE HERE PROVES THE REAL ENDPOINT WORKS. data.gov.in is egress-blocked from this
 * environment (`403 CONNECT tunnel failed`, tested). These fakes pin OUR behaviour against the
 * response shapes the portal documents; the first live response is the first real evidence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchGovResource,
  allowedFilters,
  resourceUrl,
  cacheKeyFor,
  failureForStatus,
  recordsIn,
  govDataMeter,
  __resetGovDataClient,
  MAX_RECORDS,
} from './client';
import { sourceById, type ExternalSource } from './registry';

const KEY = { DATA_GOV_IN_API_KEY: 'test-key' } as unknown as NodeJS.ProcessEnv;
const CPCB = sourceById('cpcb-aqi')!;

/** A fetch that answers once with this body. */
const answers = (body: unknown, status = 200) =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

const ROWS = { records: [{ city: 'Kanpur', station: 'S1', pollutant_id: 'PM10', avg_value: '211' }] };

beforeEach(() => __resetGovDataClient());

describe('pure pieces', () => {
  it('🔒 the registry filter list is an ALLOWLIST — an undeclared parameter is dropped', () => {
    // A caller must not be able to append arbitrary query parameters to a government request, and
    // the cache key must stay bounded to a known set of names.
    const out = allowedFilters(CPCB, { city: 'Kanpur', limit: '99999', 'api-key': 'stolen' } as never);
    expect(out).toEqual({ city: 'Kanpur' });
  });

  it('drops blank values but keeps a real one', () => {
    expect(allowedFilters(CPCB, { city: '   ', state: 'Uttar Pradesh' })).toEqual({ state: 'Uttar Pradesh' });
  });

  it('builds the fixed government host with the key and filters escaped', () => {
    const url = resourceUrl(CPCB, 'k e y', { city: 'New Delhi' });
    expect(url.startsWith(`https://api.data.gov.in/resource/${CPCB.resourceId}?`)).toBe(true);
    expect(url).toContain('api-key=k%20e%20y');
    expect(url).toContain('format=json');
    expect(url).toContain(`limit=${MAX_RECORDS}`);
    // Literal brackets: how data.gov.in documents the parameter. See the client's note.
    expect(url).toContain('filters[city]=New%20Delhi');
  });

  it('🔒 the cache key does not depend on filter ORDER or case', () => {
    // Two spellings of one question must not become two entries — and two portal calls.
    expect(cacheKeyFor('x', { b: 'B', a: 'A' })).toBe(cacheKeyFor('x', { a: 'a', b: 'b' }));
  });

  it('names each HTTP status, because the remedies differ', () => {
    expect(failureForStatus(401)).toBe('auth-rejected');
    expect(failureForStatus(403)).toBe('auth-rejected');
    expect(failureForStatus(404)).toBe('not-found');
    expect(failureForStatus(429)).toBe('rate-limited');
    expect(failureForStatus(500)).toBe('http-error');
  });

  it('reads the documented envelope, and refuses anything else', () => {
    expect(recordsIn({ records: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(recordsIn({ records: [] })).toEqual([]);
    expect(recordsIn({})).toBeNull();
    expect(recordsIn(null)).toBeNull();
    expect(recordsIn({ records: 'nope' })).toBeNull();
    // Non-object rows are discarded rather than passed to a caller expecting fields.
    expect(recordsIn({ records: [1, null, { a: 1 }] })).toEqual([{ a: 1 }]);
  });
});

describe('🔒 a source nobody has checked cannot be fetched', () => {
  it('refuses an unknown id', async () => {
    const out = await fetchGovResource('no-such-source', { city: 'Kanpur' }, { env: KEY });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not-callable');
    expect(out.records).toEqual([]);
  });

  it('refuses a row that is real but not callable — and makes NO request', async () => {
    // `open-meteo-forecast` is in the registry and disabled. Naming it exactly must not reach it.
    let called = 0;
    const spy = (async () => { called += 1; return { ok: true, status: 200, json: async () => ROWS }; }) as unknown as typeof fetch;
    const out = await fetchGovResource('open-meteo-forecast', { latitude: '1' }, { env: KEY, fetchImpl: spy });
    expect(out.reason).toBe('not-callable');
    expect(called).toBe(0);
  });
});

describe('the guards before any network', () => {
  it('no key ⇒ no request', async () => {
    let called = 0;
    const spy = (async () => { called += 1; return { ok: true, status: 200, json: async () => ROWS }; }) as unknown as typeof fetch;
    const out = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: {} as never, fetchImpl: spy });
    expect(out.reason).toBe('no-key');
    expect(called).toBe(0);
  });

  it('🔒 no usable filter ⇒ no request — an unbounded pull of a national dataset never happens', async () => {
    let called = 0;
    const spy = (async () => { called += 1; return { ok: true, status: 200, json: async () => ROWS }; }) as unknown as typeof fetch;
    const out = await fetchGovResource('cpcb-aqi', { nonsense: 'x' } as never, { env: KEY, fetchImpl: spy });
    expect(out.reason).toBe('no-filter');
    expect(called).toBe(0);
  });
});

describe('every failure the portal can produce has a name, and none invents a record', () => {
  const cases: Array<[string, () => Promise<unknown>, string]> = [
    ['401 refused key', () => fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: answers({}, 401) }), 'auth-rejected'],
    ['403 forbidden', () => fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: answers({}, 403) }), 'auth-rejected'],
    ['404 stale resource id', () => fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: answers({}, 404) }), 'not-found'],
    ['429 rate limited', () => fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: answers({}, 429) }), 'rate-limited'],
    ['500 portal error', () => fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: answers({}, 500) }), 'http-error'],
    ['malformed envelope', () => fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: answers({ data: [] }) }), 'unreadable'],
    ['empty result', () => fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: answers({ records: [] }) }), 'empty'],
  ];

  for (const [name, run, reason] of cases) {
    it(`${name} ⇒ ${reason}, with no records`, async () => {
      const out = (await run()) as { ok: boolean; reason?: string; records: unknown[] };
      expect(out.ok).toBe(false);
      expect(out.reason).toBe(reason);
      expect(out.records).toEqual([]);
    });
  }

  it('JSON that will not parse ⇒ unreadable, never a throw', async () => {
    const broken = (async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })) as unknown as typeof fetch;
    const out = await fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: broken });
    expect(out.reason).toBe('unreadable');
  });

  it('a network error ⇒ http-error, never a throw', async () => {
    const dead = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const out = await fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: dead });
    expect(out.reason).toBe('http-error');
  });

  it('a timeout is named as one — it is not the same as a refusal', async () => {
    const hang = (async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }) as unknown as typeof fetch;
    const out = await fetchGovResource('cpcb-aqi', { city: 'K' }, { env: KEY, fetchImpl: hang, timeoutMs: 5 });
    expect(out.reason).toBe('timeout');
  });
});

describe('the cache', () => {
  it('a second identical question does not call the portal again', async () => {
    let calls = 0;
    const counting = (async () => { calls += 1; return { ok: true, status: 200, json: async () => ROWS }; }) as unknown as typeof fetch;
    const a = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: counting });
    const b = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: counting });
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(b.records).toEqual(a.records);
    expect(calls).toBe(1);
    expect(govDataMeter().cacheHits).toBe(1);
  });

  it('a DIFFERENT question is a cache miss', async () => {
    let calls = 0;
    const counting = (async () => { calls += 1; return { ok: true, status: 200, json: async () => ROWS }; }) as unknown as typeof fetch;
    await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: counting });
    await fetchGovResource('cpcb-aqi', { city: 'Lucknow' }, { env: KEY, fetchImpl: counting });
    expect(calls).toBe(2);
  });

  it('the entry expires on the row\'s own TTL', async () => {
    let calls = 0;
    const counting = (async () => { calls += 1; return { ok: true, status: 200, json: async () => ROWS }; }) as unknown as typeof fetch;
    let t = 1_000_000;
    const now = () => t;
    await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: counting, now });
    t += (CPCB as ExternalSource).cacheTtlMs + 1;
    const again = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: counting, now });
    expect(again.fromCache).toBe(false);
    expect(calls).toBe(2);
  });

  it('🔒 an EMPTY or FAILED answer is never cached — one blocked minute must not become ten', async () => {
    let calls = 0;
    const emptyThenFull = (async () => {
      calls += 1;
      return calls === 1
        ? { ok: true, status: 200, json: async () => ({ records: [] }) }
        : { ok: true, status: 200, json: async () => ROWS };
    }) as unknown as typeof fetch;
    const first = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: emptyThenFull });
    expect(first.reason).toBe('empty');
    const second = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: emptyThenFull });
    expect(second.ok).toBe(true);
    expect(second.fromCache).toBe(false);
    expect(calls).toBe(2);
  });

  it('noCache forces a fresh call — the admin "test this source" path', async () => {
    let calls = 0;
    const counting = (async () => { calls += 1; return { ok: true, status: 200, json: async () => ROWS }; }) as unknown as typeof fetch;
    await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: counting });
    await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: counting, noCache: true });
    expect(calls).toBe(2);
  });

  it('🔒 two callers asking at the same moment make ONE portal call', async () => {
    let calls = 0;
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    const slow = (async () => {
      calls += 1;
      await gate;
      return { ok: true, status: 200, json: async () => ROWS };
    }) as unknown as typeof fetch;

    const a = fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: slow });
    const b = fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: slow });
    release(null);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(calls).toBe(1);
    expect(govDataMeter().coalesced).toBe(1);
  });
});

describe('what the answer carries back', () => {
  it('brings the licence attribution with the data, so the caller cannot forget it', async () => {
    const out = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: answers(ROWS) });
    expect(out.ok).toBe(true);
    expect(out.attribution).toContain('Central Pollution Control Board');
  });

  it('carries it on a FAILURE too — the obligation does not depend on success', async () => {
    const out = await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: answers({}, 500) });
    expect(out.attribution).toContain('Central Pollution Control Board');
  });
});

describe('the meter is honest about what it is', () => {
  it('counts calls, hits and failures since this instance booted', async () => {
    await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: answers(ROWS) });
    await fetchGovResource('cpcb-aqi', { city: 'Kanpur' }, { env: KEY, fetchImpl: answers(ROWS) });
    await fetchGovResource('cpcb-aqi', { city: 'Agra' }, { env: KEY, fetchImpl: answers({}, 500) });
    const m = govDataMeter();
    expect(m.calls).toBe(2);       // the second Kanpur came from cache
    expect(m.cacheHits).toBe(1);
    expect(m.failures).toBe(1);
    expect(m.saved).toBe(1);
  });
});
