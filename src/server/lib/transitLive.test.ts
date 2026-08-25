import { describe, it, expect } from 'vitest';
import { detectTransitQuery, buildTransitRequest, officialSourceNote, liveTransitContext, TRANSIT_MAX_CHARS } from './transitLive';

const NOW = new Date('2026-08-25T10:00:00Z');

/**
 * LIVE TRANSIT (admin 2026-08-25: "train ki live location bhi bata de"). The honesty line: live
 * position comes ONLY from a real feed, never a snippet-shaped guess — so these tests pin the three
 * legs that keep that true: what counts as a transit question, the exact requests we send, and that
 * every failure degrades to '' (the caller's search fallback), never to invented data.
 */
describe('detectTransitQuery — what a live feed can actually answer', () => {
  it('a 5-digit number is a train ONLY in a train-ish sentence', () => {
    expect(detectTransitQuery('train 12301 kaha hai')).toEqual({ kind: 'train', trainNo: '12301' });
    expect(detectTransitQuery('meri gadi 12951 late hai kya')).toEqual({ kind: 'train', trainNo: '12951' });
    // The same digits in builder chat are just digits.
    expect(detectTransitQuery('set the port to 12301')).toBeNull();
  });

  it('a 10-digit number is a PNR only next to the word PNR', () => {
    expect(detectTransitQuery('pnr 8524167930 check karo')).toEqual({ kind: 'pnr', pnr: '8524167930' });
    expect(detectTransitQuery('8524167930 pnr status')).toEqual({ kind: 'pnr', pnr: '8524167930' });
    expect(detectTransitQuery('mera number 9876543210 hai')).toBeNull();
  });

  it('a flight is an airline code + number', () => {
    expect(detectTransitQuery('flight AI 101 kitni late hai')).toEqual({ kind: 'flight', flightNo: 'AI101' });
    expect(detectTransitQuery('6E-2412 ka status')).toEqual({ kind: 'flight', flightNo: '6E2412' });
    expect(detectTransitQuery('mera code XY 123 hai')).toBeNull();
  });

  it('no transit shape ⇒ null (petrol rates are the search path, not a feed)', () => {
    expect(detectTransitQuery('petrol ka rate kya hai')).toBeNull();
  });
});

describe('buildTransitRequest — the exact requests, pinned', () => {
  it('train → live running status', () => {
    const r = buildTransitRequest({ kind: 'train', trainNo: '12301' }, 'K', NOW);
    expect(r.url).toBe('https://irctc1.p.rapidapi.com/api/v1/liveTrainStatus?trainNo=12301&startDay=0');
    expect(r.headers['X-RapidAPI-Key']).toBe('K');
    expect(r.headers['X-RapidAPI-Host']).toBe('irctc1.p.rapidapi.com');
  });
  it('pnr → PNR status', () => {
    const r = buildTransitRequest({ kind: 'pnr', pnr: '8524167930' }, 'K', NOW);
    expect(r.url).toContain('getPNRStatus?pnrNumber=8524167930');
  });
  it('flight → dated status lookup', () => {
    const r = buildTransitRequest({ kind: 'flight', flightNo: 'AI101' }, 'K', NOW);
    expect(r.url).toBe('https://aerodatabox.p.rapidapi.com/flights/number/AI101/2026-08-25');
    expect(r.headers['X-RapidAPI-Host']).toBe('aerodatabox.p.rapidapi.com');
  });
});

describe('officialSourceNote — the model is always told where the official truth lives', () => {
  it('names NTES / IRCTC / the airline per kind', () => {
    expect(officialSourceNote('train')).toContain('enquiry.indianrail.gov.in');
    expect(officialSourceNote('pnr')).toContain('IRCTC');
    expect(officialSourceNote('flight')).toContain('airline');
  });
});

describe('liveTransitContext — real data or nothing, never an invention', () => {
  const okFetch = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('returns a bounded LIVE TRANSIT DATA block from a real response', async () => {
    const out = await liveTransitContext('train 12301 kaha hai', {
      env: { RAPIDAPI_KEY: 'K' } as NodeJS.ProcessEnv,
      fetchImpl: okFetch({ position: 'Departed Kanpur Central, running 25 min late' }),
      now: NOW,
    });
    expect(out).toContain('LIVE TRANSIT DATA');
    expect(out).toContain('Departed Kanpur Central');
    expect(out).toContain('enquiry.indianrail.gov.in');
    // White-Label: the feed's vendor never appears in the model-facing block.
    expect(out).not.toMatch(/rapidapi|aerodatabox|irctc1\.p\./i);
  });

  it('caps a huge payload instead of flooding the chat context', async () => {
    const out = await liveTransitContext('train 12301 kaha hai', {
      env: { RAPIDAPI_KEY: 'K' } as NodeJS.ProcessEnv,
      fetchImpl: okFetch({ big: 'x'.repeat(TRANSIT_MAX_CHARS * 2) }),
      now: NOW,
    });
    expect(out).toContain('…(truncated)');
    expect(out.length).toBeLessThan(TRANSIT_MAX_CHARS + 700);
  });

  it("no key ⇒ '' — the search fallback answers instead", async () => {
    let called = false;
    const out = await liveTransitContext('train 12301 kaha hai', {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch,
    });
    expect(out).toBe('');
    expect(called).toBe(false);
  });

  it("a non-transit message ⇒ '' without any network", async () => {
    let called = false;
    const out = await liveTransitContext('petrol ka rate kya hai', {
      env: { RAPIDAPI_KEY: 'K' } as NodeJS.ProcessEnv,
      fetchImpl: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch,
    });
    expect(out).toBe('');
    expect(called).toBe(false);
  });

  it("an HTTP error, an unreadable body, or an empty body ⇒ '' — never fake grounding", async () => {
    const base = { env: { RAPIDAPI_KEY: 'K' } as NodeJS.ProcessEnv, now: NOW };
    expect(await liveTransitContext('train 12301 kaha hai', { ...base, fetchImpl: (async () => new Response('x', { status: 429 })) as unknown as typeof fetch })).toBe('');
    expect(await liveTransitContext('train 12301 kaha hai', { ...base, fetchImpl: (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch })).toBe('');
    expect(await liveTransitContext('train 12301 kaha hai', { ...base, fetchImpl: okFetch({}) })).toBe('');
  });

  it("a hung feed times out to '' — the reply never waits on it", async () => {
    const out = await liveTransitContext('train 12301 kaha hai', {
      env: { RAPIDAPI_KEY: 'K' } as NodeJS.ProcessEnv,
      timeoutMs: 20,
      fetchImpl: ((url: string, init?: RequestInit) => new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })) as unknown as typeof fetch,
    });
    expect(out).toBe('');
  });
});
