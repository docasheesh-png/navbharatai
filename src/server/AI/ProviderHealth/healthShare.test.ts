/**
 * Owner improvement #2 and the P3 safety rule: shared health is bounded, carries no free text, and in the default
 * OBSERVE mode never changes which provider a ladder calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __instanceIdForTests, __resetHealthShareForTests, flushShared, pullShared, queueTransition, sharedHealthStatus,
  SHARE_MAX_WRITES_PER_FLUSH, SHARE_WRITE_MIN_MS, type ShareStore, type SharedRecord } from './healthShare';
import { noteProviderCall, onTrafficTransition, resetTrafficHealthForTests, shouldSkipProvider } from './trafficHealth';

const NOW = Date.parse('2026-11-18T10:00:00Z');
function memory() {
  const docs = new Map<string, SharedRecord>(); const writes: SharedRecord[] = []; let reads = 0;
  const store: ShareStore = {
    write: async (id, r) => { writes.push(r); docs.set(id, r); },
    readSince: async (since, limit) => { reads++; return [...docs.values()].filter(r => r.atMs >= since).sort((a, b) => b.atMs - a.atMs).slice(0, limit); },
  };
  return { store, docs, writes, reads: () => reads };
}
const other = (provider: string, state: SharedRecord['state'], atMs: number): SharedRecord =>
  ({ provider, state, kind: state === 'suspended' ? 'suspended' : 'timeout', recoverAt: atMs + 300_000, atMs, instance: 'another-server' });

afterEach(() => { __resetHealthShareForTests(); resetTrafficHealthForTests(); vi.unstubAllEnvs(); });

describe('default OBSERVE: shown, never acted on', () => {
  it('another server reports GLM suspended → shown, but this server does not skip GLM', async () => {
    const m = memory(); m.docs.set('GLM', other('GLM', 'suspended', NOW - 1000));
    expect(await pullShared(m.store, NOW)).toBe(true);
    expect(sharedHealthStatus(NOW).remote.map(r => r.provider)).toEqual(['GLM']);
    expect(shouldSkipProvider('GLM', NOW)).toBe(false);
  });
  it('mode on: a NEWER report is adopted; an older one never overrides what this server saw', async () => {
    vi.stubEnv('TRAFFIC_HEALTH_SHARE', 'on');
    const m = memory(); m.docs.set('GLM', other('GLM', 'suspended', NOW - 1000));
    await pullShared(m.store, NOW);
    expect(shouldSkipProvider('GLM', NOW)).toBe(true);
    resetTrafficHealthForTests();
    noteProviderCall({ provider: 'KIMI', surface: 'builder', ok: false, error: new Error('429 insufficient balance'), at: NOW - 100 });
    noteProviderCall({ provider: 'KIMI', surface: 'builder', ok: true, at: NOW - 50 });
    m.docs.set('KIMI', other('KIMI', 'suspended', NOW - 500));
    await pullShared(m.store, NOW);
    expect(shouldSkipProvider('KIMI', NOW)).toBe(false); // this server saw it recover after the other server's report
  });
  it('mode off: nothing is read or written', async () => {
    vi.stubEnv('TRAFFIC_HEALTH_SHARE', 'off');
    const m = memory();
    queueTransition({ provider: 'GLM', state: 'down', kind: 'timeout', reason: 'x', recoverAt: 1, at: NOW });
    expect(await flushShared(m.store, NOW)).toBe(0);
    expect(await pullShared(m.store, NOW)).toBe(false);
    expect(m.reads()).toBe(0);
  });
  it('its own records are ignored on read', async () => {
    const m = memory(); m.docs.set('GLM', { ...other('GLM', 'down', NOW), instance: __instanceIdForTests() });
    await pullShared(m.store, NOW);
    expect(sharedHealthStatus(NOW).remote).toEqual([]);
  });
});

describe('bounded writes, no free text', () => {
  it('only a state CHANGE is queued, coalesced to one write per provider per 20 s', async () => {
    const m = memory();
    onTrafficTransition(queueTransition);
    for (let i = 0; i < 3; i++) noteProviderCall({ provider: 'GLM', surface: 'builder', ok: false, error: new Error('timed out'), at: NOW + i });
    for (let i = 0; i < 20; i++) noteProviderCall({ provider: 'GLM', surface: 'builder', ok: false, error: new Error('timed out'), at: NOW + 10 + i });
    expect(await flushShared(m.store, NOW + 100)).toBe(1);
    noteProviderCall({ provider: 'GLM', surface: 'builder', ok: true, at: NOW + 200 });
    expect(await flushShared(m.store, NOW + 300)).toBe(0); // within 20 s of the last write: held
    expect(await flushShared(m.store, NOW + 100 + SHARE_WRITE_MIN_MS)).toBe(1); // then the latest state (up) goes out
    expect(m.writes.map(w => w.state)).toEqual(['down', 'up']);
  });
  it('at most 32 writes per flush, and a failed write stays queued', async () => {
    for (let i = 0; i < 50; i++) queueTransition({ provider: `P${i}`, state: 'down', kind: 'timeout', reason: null, recoverAt: 1, at: NOW });
    const m = memory();
    expect(await flushShared(m.store, NOW)).toBe(SHARE_MAX_WRITES_PER_FLUSH);
    const failing: ShareStore = { write: async () => { throw new Error('down'); }, readSince: async () => [] };
    expect(await flushShared(failing, NOW)).toBe(0);
    expect(await flushShared(m.store, NOW)).toBe(50 - SHARE_MAX_WRITES_PER_FLUSH);
  });
  it('a shared record holds only fixed fields: no provider message, no key', async () => {
    const m = memory();
    queueTransition({ provider: 'GLM', state: 'suspended', kind: 'suspended', reason: 'key sk-test-SECRET-123 balance empty', recoverAt: NOW + 1, at: NOW, model: 'glm-5.3' });
    await flushShared(m.store, NOW);
    expect(Object.keys(m.writes[0]).sort()).toEqual(['atMs', 'instance', 'kind', 'model', 'provider', 'recoverAt', 'state']);
    expect(JSON.stringify(m.writes)).not.toContain('SECRET');
  });
  it('reads back off while nothing changes', async () => {
    const m = memory();
    await pullShared(m.store, NOW); await pullShared(m.store, NOW); await pullShared(m.store, NOW);
    expect(sharedHealthStatus(NOW).intervalMs).toBeGreaterThan(20_000);
    expect(sharedHealthStatus(NOW).intervalMs).toBeLessThanOrEqual(60_000);
  });
});
