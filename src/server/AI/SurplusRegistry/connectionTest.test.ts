import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSurplusConnectionTestStatus, runSurplusConnectionTest, runSurplusCredentialCheck,
  SURPLUS_CONNECTION_TEST_AUTHORITY, SURPLUS_CONNECTION_TEST_DOCUMENT, SURPLUS_CONNECTION_TEST_ID,
  SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT } from './connectionTest';
import type { SurplusConnectionTestDependencies } from './connectionTest';

const NOW = 1_800_000_000_000;
const KEY = 'inf_synthetic_connection_test_key';
const wire = (changes: Record<string, unknown> = {}) => ({ id: 'synthetic-response-id', model: 'deepseek-v4.1-flash',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }], usage: { buyer_cost_micro: 29 }, ...changes });
function setup() {
  const docs = new Map<string, any>();
  let queue: Promise<unknown> = Promise.resolve();
  const options: { unavailable?: boolean; failFinalWrite?: boolean; uncertainCommit?: boolean; afterReservation?: () => void } = {};
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  const db = {
    doc: (path: string) => ({ path, get: async () => { if (options.unavailable) throw new Error('raw database secret'); return snapshot(path); } }),
    runTransaction: (fn: (tx: any) => Promise<any>) => {
      const next = queue.then(async () => {
        if (options.unavailable) throw new Error('raw database secret');
        const writes = new Map<string, unknown>();
        const result = await fn({ get: async (ref: { path: string }) => snapshot(ref.path),
          set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)) });
        const final = [...writes.values()].some((value: any) => value.completedAt !== undefined);
        if (final && options.failFinalWrite) throw new Error('raw write failure');
        for (const [key, value] of writes) docs.set(key, value);
        if (writes.size && !final) {
          options.afterReservation?.();
          if (options.uncertainCommit) throw new Error('uncertain commit acknowledgement');
        }
        return result;
      });
      queue = next.catch(() => {}); return next;
    },
  };
  const env: NodeJS.ProcessEnv = { K_SERVICE: 'synthetic-cloud-run-service', SURPLUS_API_KEY: KEY,
    AGENTV3_SURPLUS_BUILDER: 'on', SURPLUS_REGISTRY_ENABLED: 'on' };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(wire()), { status: 200, headers: { 'content-type': 'application/json' } }));
  const deps: SurplusConnectionTestDependencies = { db: db as never, env, fetcher: fetcher as typeof fetch, now: () => NOW };
  return { docs, db, options, env, fetcher, deps, stored: () => docs.get(SURPLUS_CONNECTION_TEST_DOCUMENT) };
}
afterEach(() => vi.useRealTimers());

describe('live connection-test diagnostic (no review seed)', () => {
  it('reports ready from key alone without provider I/O or review doc', async () => {
    const t = setup();
    expect(await getSurplusConnectionTestStatus(t.deps)).toEqual({ status: 'ready', environmentConfigured: true, productionFlagsOff: true,
      latencyMs: null, actualCostUsd: null, expectedResponse: 'not_checked' });
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
    expect(t.docs.has(SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT)).toBe(false);
  });
  it('runs while Surplus builder/registry flags are ON', async () => {
    const t = setup();
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('passed');
    expect(t.env.AGENTV3_SURPLUS_BUILDER).toBe('on');
    expect(t.env.SURPLUS_REGISTRY_ENABLED).toBe('on');
  });
  it.each([
    { K_SERVICE: undefined }, { SURPLUS_API_KEY: undefined }, { SURPLUS_API_KEY: 'inf_admin_secret' },
    { SURPLUS_API_KEY: 'replace_with_your_surplus_api_key' }, { SURPLUS_API_KEY: 'inf_credential\nsecret' },
    { SURPLUS_API_KEY: 'not-standard-key' },
  ])('rejects unavailable runtime configuration: %j', async change => {
    const t = setup(); Object.assign(t.env, change);
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('blocked_configuration');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('blocked_configuration');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored()).toBeUndefined();
  });
  it('fails closed without durable database availability', async () => {
    const t = setup(); t.deps.db = null;
    expect((await getSurplusConnectionTestStatus(t.deps)).status).toBe('unavailable');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unavailable');
  });
});

describe('fixed, bounded, durable one-shot dispatch', () => {
  it('sends only one fixed synthetic request using the existing runtime Standard key', async () => {
    const t = setup();
    const result = await runSurplusConnectionTest(t.deps);
    expect(result).toMatchObject({ status: 'passed', expectedResponse: 'matched', actualCostUsd: '0.000029', latencyMs: 0 });
    expect(t.fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.surplusintelligence.ai/min90/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'Reply with exactly OK and nothing else.' }], max_tokens: 32, stream: false, si_route: { objective: 'price' } });
    expect(t.stored()).toMatchObject({ attempts: 1, state: 'reported', authorizationId: SURPLUS_CONNECTION_TEST_AUTHORITY, remainingBudgetUsd: '1' });
    expect(JSON.stringify([...t.docs.values()])).not.toContain(KEY);
  });
  it('reserves before network and deduplicates concurrent calls', async () => {
    const t = setup(); let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    t.fetcher.mockImplementation(async () => { expect(t.stored().state).toBe('unknown_liability_hold'); await gate; return new Response(JSON.stringify(wire())); });
    const first = runSurplusConnectionTest(t.deps);
    await vi.waitFor(() => expect(t.fetcher).toHaveBeenCalledTimes(1));
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => runSurplusConnectionTest({ ...t.deps })));
    expect(duplicates.every(value => value.status === 'unknown_liability_hold')).toBe(true);
    finish(); expect((await first).status).toBe('passed');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('passed'); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not rearm after a completed attempt', async () => {
    const t = setup(); await runSurplusConnectionTest(t.deps);
    t.env.SURPLUS_API_KEY = 'inf_rotated_key';
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('passed');
    expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it('never treats malformed retained evidence as a fresh unattempted gate', async () => {
    const t = setup(); t.docs.set(SURPLUS_CONNECTION_TEST_DOCUMENT, { status: 'ready' });
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it('rechecks credential after reservation and never frees the consumed gate', async () => {
    const t = setup(); t.options.afterReservation = () => { t.env.SURPLUS_API_KEY = 'inf_changed'; };
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold');
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.stored().attempts).toBe(1);
  });
  it('bounds network time and never retries on timeout', async () => {
    vi.useFakeTimers(); const t = setup();
    t.deps.fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('raw token secret'))); })) as typeof fetch;
    const pending = runSurplusConnectionTest(t.deps); await vi.advanceTimersByTimeAsync(60_001);
    expect((await pending).status).toBe('unknown_liability_hold');
    expect((await runSurplusConnectionTest(t.deps)).status).toBe('unknown_liability_hold'); expect(t.deps.fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('exact cost and safe expected-response projection', () => {
  it.each([
    ['0', '0'], ['1000', '0.001'], ['1000000', '1'], ['9007199254740993', '9007199254.740993'],
  ])('preserves exact integer microUSD %s as %s', async (raw, expected) => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire()).replace('"buyer_cost_micro":29', `"buyer_cost_micro":${raw}`)));
    const out = await runSurplusConnectionTest(t.deps);
    expect(out.actualCostUsd).toBe(expected); expect(out.status).toBe(BigInt(raw) > 1_000_000n ? 'budget_exceeded' : 'passed');
  });
  it.each(['wrong response and confidential text', 'okay', 'OK extra'])('records mismatch, not raw model text: %s', async content => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify(wire({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }))));
    expect(await runSurplusConnectionTest(t.deps)).toMatchObject({ status: 'failed', expectedResponse: 'mismatched', actualCostUsd: '0.000029' });
    expect(JSON.stringify(t.stored())).not.toContain(content);
  });
  it('contains no wallet writers, builder activation, or review seeding', () => {
    const source = readFileSync('src/server/AI/SurplusRegistry/connectionTest.ts', 'utf8');
    expect(source).not.toMatch(/console\.|createSurplusChat\(|createSurplusBuildTransport\(|reserveSurplusAttempt\(|refreshSurplusRegistry\(|recordProviderCost\(|user_token_wallets|\/buyer\/keys/);
    expect(source).not.toMatch(/\.set\([^\n]*SURPLUS_CONNECTION_TEST_REVIEW_DOCUMENT/);
  });
});

describe('non-inference credential authentication check', () => {
  it('checks only the fixed buyer/me endpoint without reading private account body', async () => {
    const t = setup(); t.docs.clear();
    const cancel = vi.fn(async () => {}), read = vi.fn(() => { throw new Error('private body must not be read'); });
    t.fetcher.mockResolvedValue({ status: 200, redirected: false, headers: new Headers({ 'content-type': 'application/json' }), body: { cancel, getReader: read } } as unknown as Response);
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: 'accepted' });
    expect(cancel).toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it.each([[200, 'accepted'], [401, 'rejected'], [403, 'unavailable']])('maps HTTP %s to %s', async (status, expected) => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response('raw', { status: status as number, headers: { 'content-type': 'application/json' } }));
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: expected });
  });
  it('rejects admin keys with no network call', async () => {
    const t = setup(); t.env.SURPLUS_API_KEY = 'inf_admin_secret';
    expect(await runSurplusCredentialCheck(t.deps)).toEqual({ status: 'unavailable' }); expect(t.fetcher).not.toHaveBeenCalled();
  });
});

describe('liveAdmission source hygiene', () => {
  it('does not mention a SURPLUS_SAFETY_BYPASS flag (architecture is key+flag live)', () => {
    const source = readFileSync('src/server/AI/SurplusRegistry/liveAdmission.ts', 'utf8')
      + readFileSync('src/server/AI/SurplusRegistry/productionAdapter.ts', 'utf8');
    expect(source).not.toContain('SURPLUS_SAFETY_BYPASS');
    expect(createHash('sha256').update(KEY).digest('hex')).toHaveLength(64);
    expect(SURPLUS_CONNECTION_TEST_ID).toBe('approved-one-shot-v1');
  });
});
