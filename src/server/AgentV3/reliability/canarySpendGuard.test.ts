import OpenAI from 'openai';
import { describe, it, expect, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { CanaryReservationStore, canaryAuthorityPath, canaryFetch, runWithCanarySpendGuard, assertCanaryLegacyAllowed, type CanaryAuthority } from './canarySpendGuard';

// Optimistic transaction simulation only; no provider or database network calls.
function database() {
  const docs = new Map<string, unknown>();
  const versions = new Map<string, number>();
  let retries = 0;
  let loseNextResponse = false;
  let beforeCommit: (() => void) | undefined;
  let onRead: ((path: string) => void) | undefined;
  const reads: string[] = [];
  let transactions = 0;
  const copy = <T>(v: T): T => structuredClone(v);
  const seed = (path: string, value: unknown) => { docs.set(path, copy(value)); versions.set(path, (versions.get(path) ?? 0) + 1); };
  const doc = (path: string) => ({ path, get: async () => ({ exists: docs.has(path), data: () => copy(docs.get(path)) }) });
  const db = {
    doc,
    async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      transactions++;
      for (let round = 0; round < 100; round++) {
        const read = new Map<string, number>();
        const pending = new Map<string, unknown>();
        const tx = {
          async get(ref: { path: string }) {
            if (pending.size) throw new Error('Firestore transactions require all reads before writes');
            reads.push(ref.path); onRead?.(ref.path);
            read.set(ref.path, versions.get(ref.path) ?? 0);
            const value = copy(docs.get(ref.path));
            return { exists: docs.has(ref.path), data: () => value };
          },
          set(ref: { path: string }, data: unknown) { pending.set(ref.path, copy(data)); return tx; },
          create(ref: { path: string }, data: unknown) {
            if (!read.has(ref.path)) throw new Error('Test requires a prior absence read');
            if (docs.has(ref.path)) throw new Error('Already exists');
            pending.set(ref.path, copy(data)); return tx;
          },
        };
        const result = await fn(tx as unknown as Transaction);
        const hook = beforeCommit; beforeCommit = undefined; hook?.();
        if ([...read].some(([path, version]) => (versions.get(path) ?? 0) !== version)) { retries++; continue; }
        for (const [path, value] of pending) seed(path, value);
        if (loseNextResponse && pending.size) { loseNextResponse = false; throw new Error('Commit response lost'); }
        return result;
      }
      throw new Error('Contention exhausted');
    },
  };
  return { reads, get transactions() { return transactions; }, onRead: (hook: (path: string) => void) => { onRead = hook; },
    db: db as unknown as Pick<Firestore, 'doc' | 'runTransaction'>, docs, seed,
    get retries() { return retries; }, loseResponse: () => { loseNextResponse = true; },
    beforeCommit: (hook: () => void) => { beforeCommit = hook; } };
}const NOW = 1_800_000_000_000;
const AUTH = 'Bearer synthetic-not-a-secret';
const binding = { uid: 'synthetic-test-owner', requestId: 'one-todo-canary', fixtureHash: 'a'.repeat(64), tier: 'weak' as const };
const hash = createHash('sha256').update(AUTH).digest('hex');
function setup(overrides: Partial<CanaryAuthority> = {}) {
  const state = database();
  const authority: CanaryAuthority = { ...binding, version: 1, enabled: true, expiresAtMs: NOW + 600_000,
    accountCredentialSha256: hash, tariffEvidence: 'synthetic-reviewed-account-fixture-only',
    inputPerMillionNanoUsd: 950_000_000, outputPerMillionNanoUsd: 4_000_000_000,
    maxPhysicalAttempts: 12, maxApiPaise: 100_000, allInPaisePerUsdCeiling: 10_000, ...overrides };
  state.seed(canaryAuthorityPath('pilot'), authority);
  const store = new CanaryReservationStore(state.db, () => NOW);
  return { state, store, authority, run: <T>(fn: () => T) => runWithCanarySpendGuard('pilot', binding, store, fn) };
}
const URL = 'https://api.moonshot.ai/v1/chat/completions';
function request(fields = {}): RequestInit { return { method: 'POST', headers: { authorization: AUTH }, body: JSON.stringify({ model: 'kimi-k2.7-code', max_tokens: 32768, messages: [{ role: 'user', content: 'Build a synthetic todo app.' }], ...fields }) }; }
const success = () => new Response('{"choices":[]}', { status: 200 });
function total(s: ReturnType<typeof setup>) { return s.state.docs.get(`${canaryAuthorityPath('pilot')}/ledger/total`) as { attempts: number; reservedNanoUsd: number; halted: boolean }; }
describe('restricted canary predispatch guard', () => {
  it('does not change normal production fetch or legacy capability behavior', async () => {
    const transport = vi.fn(async () => success());
    const req = request({ model: 'anything' });
    await canaryFetch(transport)('https://normal.example', req);
    expect(transport).toHaveBeenCalledWith('https://normal.example', req);
    expect(() => assertCanaryLegacyAllowed('paid-image')).not.toThrow();
  });
  it('reserves full context plus reasoning-inclusive output before HTTP, without refunding success', async () => {
    const s = setup();
    const transport = vi.fn(async () => { expect(total(s).reservedNanoUsd).toBe(380_108_800); return success(); });
    await s.run(async () => { const response = await canaryFetch(transport)(URL, request()); await response.text(); });
    expect(total(s).reservedNanoUsd).toBe(380_108_800);
    expect(transport.mock.calls).toHaveLength(1);
  });
  it('counts every parallel race contender atomically and stops before the 13th HTTP', async () => {
    const s = setup(); const transport = vi.fn(async () => success());
    const settled = await s.run(() => Promise.allSettled(Array.from({ length: 20 }, () => canaryFetch(transport)(URL, request()))));
    expect(settled.filter(v => v.status === 'fulfilled')).toHaveLength(12);
    expect(transport).toHaveBeenCalledTimes(12);
    expect(total(s).attempts).toBe(12);
    expect(total(s).reservedNanoUsd).toBe(4_561_305_600);
    expect(s.state.retries).toBeGreaterThan(0);
  });
  it('enforces the rupee ceiling including the supplied all-in FX/tax upper bound', async () => {
    const s = setup({ maxApiPaise: 4000 }); const transport = vi.fn(async () => success());
    await s.run(async () => {
      await canaryFetch(transport)(URL, request());
      await expect(canaryFetch(transport)(URL, request())).rejects.toThrow();
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    { model: 'glm-4.7-flashx' }, { model: 'kimi-k2.7-code-highspeed' }, { max_tokens: 32769 },
    { max_tokens: undefined }, { n: 2 }, { max_completion_tokens: 1 }, { tools: [{ type: 'web_search' }] },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://private.example' } }] }] },
  ])('rejects unbounded request %j before any reservation or HTTP', async fields => {
    const s = setup(); const transport = vi.fn(async () => success());
    await expect(s.run(() => canaryFetch(transport)(URL, request(fields)))).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(total(s)).toBeUndefined();
  });
  it('rejects changed endpoint and mismatched account credentials', async () => {
    const s = setup(); const transport = vi.fn(async () => success());
    await expect(s.run(() => canaryFetch(transport)('https://api.reseller.example/v1/chat/completions', request()))).rejects.toThrow();
    await expect(s.run(() => canaryFetch(transport)(URL, { ...request(), headers: { authorization: 'Bearer other-synthetic' } }))).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('retains uncertain timeout liability and blocks subsequent retries, including after restart', async () => {
    const s = setup(); const transport = vi.fn(async () => { throw new Error('timeout'); });
    await expect(s.run(() => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    expect(total(s)).toMatchObject({ attempts: 1, reservedNanoUsd: 380_108_800, halted: true });
    const restarted = new CanaryReservationStore(s.state.db, () => NOW);
    await expect(runWithCanarySpendGuard('pilot', binding, restarted, () => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('retains streaming error and cancellation liabilities', async () => {
    const s = setup(); const transport = vi.fn(async () => new Response(new ReadableStream({ pull(c) { c.error(new Error('late stream loss')); } })));
    await s.run(async () => { const r = await canaryFetch(transport)(URL, request()); await expect(r.text()).rejects.toThrow(); });
    expect(total(s).halted).toBe(true); expect(total(s).reservedNanoUsd).toBe(380_108_800);
    const cancelled = setup();
    await cancelled.run(async () => { const r = await canaryFetch(async () => success())(URL, request()); await r.body!.cancel(); });
    expect(total(cancelled).halted).toBe(true);
  });
  it('retains a lost reservation commit and never dispatches or resets the counter', async () => {
    const s = setup(); s.state.loseResponse(); const transport = vi.fn(async () => success());
    await expect(s.run(() => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(total(s).attempts).toBe(1);
    expect(total(s).reservedNanoUsd).toBe(380_108_800);
  });
  it('claims a physical ID only once, including races', async () => {
    const s = setup(); const a = await Promise.allSettled([1, 2].map(() => s.store.reserve('pilot', binding, 'same-physical-id', hash, 32768)));
    expect(a.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(total(s).attempts).toBe(1);
  });
  it('counts explicit retry attempts separately, even with reused SDK transport', async () => {
    const s = setup(); const fetch = canaryFetch(async () => success());
    await s.run(async () => { await (await fetch(URL, request())).text(); await (await fetch(URL, request())).text(); });
    expect(total(s).attempts).toBe(2);
  });
  it('propagates scope across async work but does not permit nested cap replacement', async () => {
    const s = setup();
    await s.run(async () => {
      await Promise.resolve();
      expect(() => assertCanaryLegacyAllowed('image-generation')).toThrow();
      expect(() => assertCanaryLegacyAllowed('builder-claude')).toThrow();
      expect(() => s.run(() => null)).toThrow();
      expect(() => assertCanaryLegacyAllowed('builder-OpenAiToolRunner')).not.toThrow();
    });
    expect(() => assertCanaryLegacyAllowed('image-generation')).not.toThrow();
  });
  it('client-like caps cannot create authority, spoof identity or lift reviewed caps', async () => {
    const s = setup(); const transport = vi.fn(async () => success());
    await expect(runWithCanarySpendGuard('missing', binding, s.store, () => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    await expect(runWithCanarySpendGuard('pilot', { ...binding, uid: 'attacker' }, s.store, () => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    await expect(s.run(() => canaryFetch(transport)(URL, request({ benchmarkBudget: 999999 })))).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects authority edits after a reservation and expired/unreviewed tariffs', async () => {
    const s = setup(); await s.store.reserve('pilot', binding, 'first', hash, 32768);
    s.state.seed(canaryAuthorityPath('pilot'), { ...s.authority, maxPhysicalAttempts: 11 });
    await expect(s.store.reserve('pilot', binding, 'second', hash, 32768)).rejects.toThrow();
    for (const invalid of [{ expiresAtMs: NOW }, { tariffEvidence: '' }, { allInPaisePerUsdCeiling: 0 }, { maxPhysicalAttempts: 13 }, { maxApiPaise: 100001 }]) {
      const bad = setup(invalid); await expect(bad.store.reserve('pilot', binding, 'first', hash, 32768)).rejects.toThrow();
    }
  });
});


describe('real SDK physical transport boundary', () => {
  it('cached clients and automatic SDK retries cannot bypass a failed attempt hold', async () => {
    const s = setup();
    const transport = vi.fn(async () => new Response('{"error":{"message":"synthetic unavailable"}}', { status: 500, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } }));
    // Client is constructed outside ALS; scope is checked on physical fetch, not construction.
    const client = new OpenAI({ apiKey: 'synthetic-not-a-secret', baseURL: 'https://api.moonshot.ai/v1', maxRetries: 2, fetch: canaryFetch(transport) });
    await expect(s.run(() => client.chat.completions.create({ model: 'kimi-k2.7-code', max_tokens: 32768, messages: [{ role: 'user', content: 'Synthetic todo app' }] }))).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(total(s)).toMatchObject({ attempts: 1, halted: true, reservedNanoUsd: 380_108_800 });
  });
  it('a process restart cannot resume a lost commit or in-flight liability', async () => {
    const s = setup(); s.state.loseResponse();
    await expect(s.store.reserve('pilot', binding, 'lost-commit', hash, 32768)).rejects.toThrow();
    const restarted = new CanaryReservationStore(s.state.db, () => NOW);
    await expect(restarted.reserve('pilot', binding, 'new-attempt', hash, 32768)).rejects.toThrow();
    expect(total(s).attempts).toBe(1);
  });
});

describe('uncertain spend closure regression cases', () => {
  it('cannot reset a poisoned store by opening another scope after a lost commit', async () => {
    const s = setup(); s.state.loseResponse(); const transport = vi.fn(async () => success());
    await expect(s.run(() => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    await expect(s.run(() => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(total(s).attempts).toBe(1);
  });
  it('does not dispatch a delayed reservation after a sibling has failed', async () => {
    const s = setup(); const reserve = s.store.reserve.bind(s.store);
    let release!: () => void, reserved!: () => void;
    const pending = new Promise<void>(r => { release = r; });
    const ready = new Promise<void>(r => { reserved = r; });
    let calls = 0;
    vi.spyOn(s.store, 'reserve').mockImplementation(async (...args) => {
      await reserve(...args);
      if (++calls === 1) { reserved(); await pending; }
    });
    const transport = vi.fn(async () => { throw Error('sibling timeout'); });
    await s.run(async () => {
      const first = canaryFetch(transport)(URL, request()).catch(e => e);
      await ready;
      await expect(canaryFetch(transport)(URL, request())).rejects.toThrow();
      release(); expect(await first).toBeInstanceOf(Error);
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(total(s)).toMatchObject({ attempts: 2, reservedNanoUsd: 760_217_600, halted: true });
  });
  it('halts on signal abort after response headers even when the body is not consumed', async () => {
    const s = setup(); const abort = new AbortController(); const transport = vi.fn(async () => success());
    await s.run(async () => {
      await canaryFetch(transport)(URL, { ...request(), signal: abort.signal });
      abort.abort();
      await expect(canaryFetch(transport)(URL, request())).rejects.toThrow();
    });
    expect(transport).toHaveBeenCalledTimes(1); expect(total(s).reservedNanoUsd).toBe(380_108_800);
  });
  it('still errors the response body and poisons the store when durable halt fails', async () => {
    const s = setup(); let fail!: () => void;
    const transport = vi.fn(async () => new Response(new ReadableStream({ start(c) { fail = () => c.error(Error('stream lost')); } })));
    await s.run(async () => {
      const response = await canaryFetch(transport)(URL, request());
      vi.spyOn(s.state.db, 'runTransaction').mockRejectedValueOnce(Error('database unavailable'));
      const read = response.text(); fail(); await expect(read).rejects.toThrow('stream lost');
    });
    await expect(s.run(() => canaryFetch(transport)(URL, request()))).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

it('binds the reserved request to immutable wire values across the database await', async () => {
  const s = setup(); const reserve = s.store.reserve.bind(s.store);
  let release!: () => void, reserved!: () => void;
  const pending = new Promise<void>(r => { release = r; });
  const ready = new Promise<void>(r => { reserved = r; });
  vi.spyOn(s.store, 'reserve').mockImplementation(async (...args) => { await reserve(...args); reserved(); await pending; });
  const url = new globalThis.URL(URL), options = request();
  const headers = new Headers(options.headers); options.headers = headers;
  const transport = vi.fn(async () => success());
  await s.run(async () => {
    const response = canaryFetch(transport)(url, options);
    await ready;
    url.hostname = 'unreviewed.example';
    options.body = JSON.stringify({ model: 'unreviewed', max_tokens: 1_000_000 });
    headers.set('authorization', 'Bearer unreviewed-account');
    release(); await (await response).text();
  });
  const [sentUrl, sentOptions] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(sentUrl).toBe(URL);
  expect(JSON.parse(sentOptions.body as string)).toMatchObject({ model: 'kimi-k2.7-code', max_tokens: 32768 });
  expect(new Headers(sentOptions.headers).get('authorization')).toBe(AUTH);
  expect(sentOptions.redirect).toBe('error');
});
