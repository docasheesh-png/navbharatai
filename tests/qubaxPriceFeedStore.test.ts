import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectQubaxPrices, QUBAX_PRICE_FEED_INTERVAL_MS } from '../src/server/lib/qubaxPriceFeed';
import { QUBAX_PRICE_FEED_DOCUMENT, QUBAX_PRICE_FEED_LEASE_MS, QubaxPriceFeedStore, syncQubaxPriceFeed } from '../src/server/lib/qubaxPriceFeedStore';
import { QUBAX_PRICE_FEED_JOB, qubaxPriceFeedEnabled, refreshQubaxPriceFeed, registerQubaxPriceFeed } from '../src/server/lib/qubaxPriceFeedRuntime';
import { Scheduler } from '../src/server/lib/ScheduledJobs';
import { feedFetch, FEED_NOW as NOW } from './qubaxPriceFeedFixtures';

const getServerDb = vi.hoisted(() => vi.fn());
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); getServerDb.mockReset(); });

function fixtureDb() {
  let state: Record<string, any> = {}, now = NOW, queue: Promise<unknown> = Promise.resolve();
  const writes: { path: string; value: Record<string, unknown> }[] = [];
  const ref = { get: vi.fn(async () => ({ data: () => structuredClone(state) })) };
  const db = { doc: vi.fn((path: string) => { if (path !== QUBAX_PRICE_FEED_DOCUMENT) throw new Error('Forbidden document'); return ref; }),
    runTransaction: vi.fn((fn: (tx: any) => Promise<unknown>) => {
      const task = queue.then(() => fn({ get: ref.get, set: (_ref: unknown, value: Record<string, unknown>) => {
        writes.push({ path: QUBAX_PRICE_FEED_DOCUMENT, value: structuredClone(value) }); state = { ...state, ...structuredClone(value) };
      } }));
      queue = task.catch(() => {}); return task;
    }) };
  return { db, ref, writes, get state() { return state; }, set state(value) { state = value; }, get now() { return now; }, set now(value) { now = value; },
    store: new QubaxPriceFeedStore(db as any, () => now) };
}
describe('fenced atomic Qubax observation publication', () => {
  it('allows one concurrent claimant and atomically publishes only observation data', async () => {
    const f = fixtureDb(), leases = await Promise.all([f.store.claim(), f.store.claim()]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const s = await collectQubaxPrices(feedFetch(), () => NOW);
    await f.store.publish(leases[0]!, s);
    expect(await f.store.read()).toEqual(s);
    expect(f.state.lease).toBeNull();
    expect(f.state.lastSuccessAtMs).toBe(NOW);
    expect(f.writes.every(w => w.path === QUBAX_PRICE_FEED_DOCUMENT)).toBe(true);
    expect(await f.store.claim()).toBeNull();
  });
  it('does no HTTP work when the lease is held or store is unavailable', async () => {
    const f = fixtureDb(), fetcher = feedFetch();
    await f.store.claim();
    expect(await syncQubaxPriceFeed(f.store, fetcher, () => NOW)).toEqual({ status: 'held' });
    expect(fetcher).not.toHaveBeenCalled();
    f.db.runTransaction.mockRejectedValueOnce(new Error('private service credential error'));
    expect(await syncQubaxPriceFeed(f.store, fetcher, () => NOW)).toEqual({ status: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('publishes a complete generation and retains failed source age rather than replacing partially', async () => {
    const f = fixtureDb();
    expect(await syncQubaxPriceFeed(f.store, feedFetch(), () => NOW)).toMatchObject({ status: 'synced', canDispatch: false });
    const original = structuredClone(f.state.snapshot);
    f.now += QUBAX_PRICE_FEED_INTERVAL_MS;
    const fetcher = feedFetch(); fetcher.mockRejectedValueOnce(new Error('upstream private details'));
    expect(await syncQubaxPriceFeed(f.store, fetcher, () => f.now)).toEqual({ status: 'unavailable' });
    expect(f.state.snapshot).toEqual(original);
    expect(f.state.lastError).toBe('public_price_feed_unavailable');
    expect(f.state.nextAllowedAtMs).toBe(f.now + 30_000);
    f.now = NOW + 300_000;
    expect(await f.store.read()).toBeNull();
  });
  it('rejects late holders after lease expiry and replacement, including late failure', async () => {
    const f = fixtureDb(), lease = (await f.store.claim())!, snapshot = await collectQubaxPrices(feedFetch(), () => NOW);
    f.now += QUBAX_PRICE_FEED_LEASE_MS;
    await expect(f.store.publish(lease, snapshot)).rejects.toThrow('QUBAX_PRICE_FEED_FENCE');
    f.now = NOW + QUBAX_PRICE_FEED_INTERVAL_MS;
    const newer = (await f.store.claim())!;
    expect(newer.token).not.toBe(lease.token);
    await f.store.fail(lease);
    expect(f.state.lease.token).toBe(newer.token);
    await expect(f.store.publish(lease, snapshot)).rejects.toThrow('QUBAX_PRICE_FEED_FENCE');
  });
  it.each(['stale', 'future', 'newer-generation', 'tampered-lease', 'invalid-proof', 'before-lease'])('rejects %s publication', async reason => {
    const f = fixtureDb(), lease = (await f.store.claim())!, snapshot = await collectQubaxPrices(feedFetch(), () => NOW);
    if (reason === 'stale') f.now += 300_000;
    if (reason === 'future') snapshot.observedAtMs += 1;
    if (reason === 'newer-generation') f.state.snapshot = { startedAtMs: NOW + 1 };
    if (reason === 'tampered-lease') delete f.state.lease.expiresAtMs;
    if (reason === 'invalid-proof') (snapshot as any).canDispatch = true;
    if (reason === 'before-lease') snapshot.startedAtMs -= 1;
    await expect(f.store.publish(lease, snapshot)).rejects.toThrow('QUBAX_PRICE_FEED_FENCE');
  });
  it('snapshots the publish argument before awaiting database IO', async () => {
    const f = fixtureDb(), lease = (await f.store.claim())!, snapshot = await collectQubaxPrices(feedFetch(), () => NOW);
    const publish = f.store.publish(lease, snapshot);
    (snapshot as any).canDispatch = true;
    await publish;
    expect(f.state.snapshot.canDispatch).toBe(false);
  });
  it('fails closed on malformed persisted coordination state and missing snapshots', async () => {
    const f = fixtureDb();
    expect(await f.store.read()).toBeNull();
    for (const state of [{ nextAllowedAtMs: '0' }, { lease: { token: 'a', expiresAtMs: Infinity, startedAtMs: NOW } }, { lease: {} }]) {
      f.state = state;
      await expect(f.store.claim()).rejects.toThrow('QUBAX_PRICE_FEED_STATE');
    }
    f.now = NaN;
    await expect(f.store.claim()).rejects.toThrow('QUBAX_PRICE_FEED_CLOCK');
  });
});

describe('opt-in scheduling and source-only runtime', () => {
  it('does not activate because a Qubax key or inference flag is present', async () => {
    const env = { QUBAX_API_KEY: 'synthetic-only', QUBAX_ENABLED: '1' }, fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(qubaxPriceFeedEnabled(env)).toBe(false);
    expect(await refreshQubaxPriceFeed(env)).toEqual({ status: 'disabled' });
    expect(getServerDb).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('registers startup and 4-minute exclusive tick without modifying existing jobs', async () => {
    const scheduler = new Scheduler();
    const env = { QUBAX_PRICE_FEED_ENABLED: '1' };
    getServerDb.mockReturnValue(null);
    registerQubaxPriceFeed(scheduler, env);
    const job = scheduler.due(Date.now() + QUBAX_PRICE_FEED_INTERVAL_MS + 10).find(j => j.id === QUBAX_PRICE_FEED_JOB)!;
    expect(job).toMatchObject({ id: QUBAX_PRICE_FEED_JOB, exclusive: true, schedule: { kind: 'everyMs', ms: 240_000 } });
    await job.handler();
    expect(getServerDb).toHaveBeenCalled();
    env.QUBAX_PRICE_FEED_ENABLED = '0'; getServerDb.mockClear();
    await job.handler(); expect(getServerDb).not.toHaveBeenCalled();
    const disabled = { register: vi.fn(), runNow: vi.fn() };
    registerQubaxPriceFeed(disabled, {}); expect(disabled.register).not.toHaveBeenCalled();
  });
  it('participates in the existing authenticated external tick and bypasses only the generic lease', () => {
    const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    const bypass = server.match(/scheduler\.setClaim\(\(jobId\) => \[([^\]]+)\]\.includes\(jobId\)/)?.[1];
    expect(bypass).toContain(`'${QUBAX_PRICE_FEED_JOB}'`);
    expect(server).toContain('prices.registerQubaxPriceFeed(scheduler)');
    const scheduler = new Scheduler(), handler = vi.fn();
    scheduler.register({ id: QUBAX_PRICE_FEED_JOB, exclusive: true, schedule: { kind: 'everyMs', ms: 240_000 }, handler }, NOW);
    scheduler.setRunLog({ lastRun: async () => NOW - 240_000, record: async () => {} });
    return expect(scheduler.catchUp(NOW)).resolves.toMatchObject({ ran: [QUBAX_PRICE_FEED_JOB] });
  });
  it('returns unavailable without exposing database errors or making inference requests', async () => {
    getServerDb.mockImplementationOnce(() => { throw new Error('secret infrastructure detail'); });
    expect(await refreshQubaxPriceFeed({ QUBAX_PRICE_FEED_ENABLED: '1' })).toEqual({ status: 'unavailable' });
    getServerDb.mockReturnValue(null);
    expect(await refreshQubaxPriceFeed({ QUBAX_PRICE_FEED_ENABLED: '1' })).toEqual({ status: 'unavailable' });
  });
});
