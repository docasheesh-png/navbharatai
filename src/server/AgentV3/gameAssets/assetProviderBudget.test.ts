import { it, expect, vi, describe, afterEach } from 'vitest';
import { assetRetryDeadline } from './assetProviderBudget';
import { syntheticCandidate, syntheticGlb } from '../../../../tests/fixtures/gameAssetFixtures';

it('honors long numeric/HTTP-date Retry-After without truncating, with fail-closed overflow', () => {
  const now=Date.UTC(2026,10,1,12);
  expect(assetRetryDeadline('3600',now)).toBe(now+3600000);
  expect(assetRetryDeadline(new Date(now+7200000).toUTCString(),now)).toBe(now+7200000);
  expect(assetRetryDeadline('9'.repeat(100),now)).toBe(Number.MAX_SAFE_INTEGER);
  expect(assetRetryDeadline(null,now)).toBe(now+60000);
  expect(assetRetryDeadline('invalid',now)).toBe(now+60000);
});
it('reserves bounded spacing, supports cancellation, and never shortens concurrent backoff', async () => {
  vi.resetModules();vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,1));
  try {
    const {assetProviderPermit,recordAssetProviderResponse}=await import('./assetProviderBudget');
    const signal=new AbortController().signal,origin='https://models.example';
    expect(assetProviderPermit(origin,signal)).toBeUndefined();
    const queued=assetProviderPermit(origin,signal);expect(queued).toBeInstanceOf(Promise);
    // Q-3471: a second waiter QUEUES (up to 8 s) instead of being refused; it is served one second after the first.
    const second=assetProviderPermit(origin,signal);expect(second).toBeInstanceOf(Promise);
    await vi.advanceTimersByTimeAsync(1000);await queued;
    await vi.advanceTimersByTimeAsync(1000);await second;
    recordAssetProviderResponse(origin,new Response('',{status:429,headers:{'retry-after':'3600'}}));
    recordAssetProviderResponse(origin,new Response('',{status:503,headers:{'retry-after':'2'}}));
    await vi.advanceTimersByTimeAsync(301000);
    expect(()=>assetProviderPermit(origin,signal)).toThrow('rate limit');
    await vi.advanceTimersByTimeAsync(3299000);
    expect(assetProviderPermit(origin,signal)).toBeUndefined();
    const controller=new AbortController();const cancelled=assetProviderPermit(origin,controller.signal);
    const assertion=expect(cancelled).rejects.toThrow('cancelled');controller.abort();await assertion;
  } finally {vi.useRealTimers();}
});
it('enforces server backoff on binary downloads before another external request', async () => {
  vi.resetModules();const {downloadGameAsset}=await import('./assetDownload');
  const candidate=syntheticCandidate(syntheticGlb());
  const fetch=vi.fn(async()=>new Response('',{status:429,headers:{'retry-after':'3600'}}));vi.stubGlobal('fetch',fetch);
  const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now);
  try {
    await expect(downloadGameAsset(candidate,new Set(candidate.downloadOrigins),new AbortController().signal)).rejects.toThrow('response rejected');
    clock.mockReturnValue(now+301000);
    await expect(downloadGameAsset(candidate,new Set(candidate.downloadOrigins),new AbortController().signal)).rejects.toThrow('rate limit');
    expect(fetch).toHaveBeenCalledOnce();
  } finally {clock.mockRestore();vi.unstubAllGlobals();}
});

// ── Q-3471 (failedbr #2523, admin option A 2026-11-27): the permit QUEUES a request for its turn, up to 8 s ──────────────
// The 3D assets and the sounds share raw.githubusercontent.com. The permit used to refuse the second waiter, so the two
// preparers could not overlap without losing models and sounds. These lock the new semantics: FIFO, bounded by the
// deadline, cancellation leaves no hole, a cooldown refuses only who it pushes past their deadline, and the rate — one
// request a second per origin — does not change.
describe('assetProviderPermit — a short, fair queue (Q-3471)', () => {
  const ORIGIN = 'https://raw.githubusercontent.com';
  const load = async () => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 10, 27)); return import('./assetProviderBudget'); };
  afterEach(() => { vi.useRealTimers(); });

  it('queues within 8 s in arrival order, one grant per second; the request whose turn is past 8 s is refused at once', async () => {
    const { assetProviderPermit, ASSET_PROVIDER_MAX_WAIT_MS, ASSET_PROVIDER_SPACING_MS } = await load();
    expect([ASSET_PROVIDER_MAX_WAIT_MS, ASSET_PROVIDER_SPACING_MS]).toEqual([8000, 1000]);
    const t0 = Date.now(); const signal = new AbortController().signal; const granted: Array<[number, number]> = [];
    expect(assetProviderPermit(ORIGIN, signal)).toBeUndefined();
    const waiters = Array.from({ length: 8 }, (_, i) => assetProviderPermit(ORIGIN, signal)!.then(() => { granted.push([i, Date.now() - t0]); }));
    expect(() => assetProviderPermit(ORIGIN, signal)).toThrow('Provider rate limit'); // its turn would be at 9 s
    await vi.advanceTimersByTimeAsync(8000); await Promise.all(waiters);
    expect(granted).toEqual(Array.from({ length: 8 }, (_, i) => [i, (i + 1) * 1000]));
  });

  it('the rate is unchanged: under a flood, grants on one origin are never closer than one second; other origins are independent', async () => {
    const { assetProviderPermit } = await load();
    const signal = new AbortController().signal; const times: Record<string, number[]> = { a: [], b: [] };
    const ask = (o: 'a' | 'b') => {
      let p: Promise<void> | undefined | null;
      try { p = assetProviderPermit(`https://${o}.example`, signal); } catch { p = null; }
      if (p === undefined) times[o].push(Date.now()); else if (p) void p.then(() => times[o].push(Date.now()), () => {});
    };
    for (let ms = 0; ms < 20_000; ms += 100) { ask('a'); if (ms % 300 === 0) ask('b'); await vi.advanceTimersByTimeAsync(100); }
    await vi.advanceTimersByTimeAsync(10_000);
    for (const o of ['a', 'b'] as const) {
      expect(times[o].length).toBeGreaterThan(15);
      for (let i = 1; i < times[o].length; i++) expect(times[o][i] - times[o][i - 1]).toBeGreaterThanOrEqual(1000);
    }
  });

  it('a cancelled waiter leaves the queue: the one behind it takes its turn (no wasted slot), and it rejects "cancelled"', async () => {
    const { assetProviderPermit } = await load();
    const t0 = Date.now(); const keep = new AbortController().signal; const cancel = new AbortController();
    assetProviderPermit(ORIGIN, keep);
    const first = assetProviderPermit(ORIGIN, keep)!;
    const cancelled = assetProviderPermit(ORIGIN, cancel.signal)!;
    let thirdAt = 0; const third = assetProviderPermit(ORIGIN, keep)!.then(() => { thirdAt = Date.now() - t0; });
    const rejected = expect(cancelled).rejects.toThrow('Provider request cancelled');
    cancel.abort(); await rejected;
    await vi.advanceTimersByTimeAsync(2000); await first; await third;
    expect(thirdAt).toBe(2000); // the cancelled waiter's 2 s slot went to the one behind it, not to nobody
  });

  it('a cooldown that arrives later refuses, at once, only the waiters it pushes past their deadline; the rest are served after it', async () => {
    const { assetProviderPermit, recordAssetProviderResponse } = await load();
    const t0 = Date.now(); const signal = new AbortController().signal;
    assetProviderPermit(ORIGIN, signal);
    const outcomes: string[] = [];
    const waiters = Array.from({ length: 4 }, (_, i) => assetProviderPermit(ORIGIN, signal)!.then(
      () => { outcomes.push(`${i}:ok@${Date.now() - t0}`); }, (e: Error) => { outcomes.push(`${i}:${e.message}@${Date.now() - t0}`); }));
    recordAssetProviderResponse(ORIGIN, new Response('', { status: 429, headers: { 'retry-after': '6' } }));
    await vi.advanceTimersByTimeAsync(0);
    // Deadline 8 s for all four; served from 6 s at one a second: 6 s, 7 s, 8 s fit — the fourth (9 s) is refused now.
    expect(outcomes).toEqual(['3:Provider rate limit@0']);
    await vi.advanceTimersByTimeAsync(8000); await Promise.all(waiters);
    expect(outcomes).toEqual(['3:Provider rate limit@0', '0:ok@6000', '1:ok@7000', '2:ok@8000']);
  });

  it('a longer server cooldown still refuses a new request at once (never shortened, never waited out past 8 s)', async () => {
    const { assetProviderPermit, recordAssetProviderResponse } = await load();
    recordAssetProviderResponse(ORIGIN, new Response('', { status: 503, headers: { 'retry-after': '9' } }));
    expect(() => assetProviderPermit(ORIGIN, new AbortController().signal)).toThrow('Provider rate limit');
    await vi.advanceTimersByTimeAsync(1000);
    const p = assetProviderPermit(ORIGIN, new AbortController().signal); expect(p).toBeInstanceOf(Promise); // now 8 s away: queued
    await vi.advanceTimersByTimeAsync(8000); await p;
  });
});
