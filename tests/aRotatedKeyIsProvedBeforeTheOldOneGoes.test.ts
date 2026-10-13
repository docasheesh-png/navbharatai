import { describe, it, expect } from 'vitest';
import { rotateKey, testConnection, disconnectByo, type ByoLifecycleDeps } from '../src/server/providers/byoLifecycle';

const GOOD = 'k'.repeat(40);
function fake(over: Partial<ByoLifecycleDeps> = {}) {
  const log: string[] = [];
  const d: ByoLifecycleDeps = {
    probe: async (_r, k) => k === GOOD,
    currentKeyVersion: async () => 3,
    storeKey: async (_u, _r, v) => { log.push(`store v${v}`); },
    activate: async (_u, _r, v) => { log.push(`activate v${v}`); },
    retireKey: async (_u, _r, v) => { log.push(`retire v${v}`); },
    forgetConnection: async () => { log.push('forget'); return true; },
    audit: async (_u, a, ok, detail) => { log.push(`audit ${a} ${ok} ${detail}`); },
    ...over,
  };
  return { d, log };
}

describe('BYO Supabase lifecycle (PR 16)', () => {
  it('a bad new key never replaces the old one', async () => {
    const { d, log } = fake();
    expect((await rotateKey(d, 'u', 'p', 'x'.repeat(40))).ok).toBe(false);
    expect(log.some((l) => /store|activate|retire/.test(l))).toBe(false);
  });
  it('a good key is stored, activated, then the old one retired — in that order', async () => {
    const { d, log } = fake();
    expect((await rotateKey(d, 'u', 'p', GOOD)).ok).toBe(true);
    expect(log.filter((l) => !l.startsWith('audit'))).toEqual(['store v4', 'activate v4', 'retire v3']);
  });
  it('a failed store keeps the old key', async () => {
    const { d, log } = fake({ storeKey: async () => { throw new Error('x'); } });
    expect((await rotateKey(d, 'u', 'p', GOOD)).ok).toBe(false);
    expect(log.some((l) => l.startsWith('retire') || l.startsWith('activate'))).toBe(false);
  });
  it('no secret appears in the audit or the result', async () => {
    const { d, log } = fake();
    const r = await rotateKey(d, 'u', 'p', GOOD);
    expect(JSON.stringify([r, log])).not.toContain(GOOD);
    expect(JSON.stringify(await testConnection(d, 'u', 'p', GOOD))).not.toContain(GOOD);
  });
  it('disconnect needs confirmation and never deletes the project', async () => {
    const { d, log } = fake();
    expect((await disconnectByo(d, 'u', false)).ok).toBe(false);
    expect(log).toEqual([]);
    expect((await disconnectByo(d, 'u', true)).ok).toBe(true);
    expect(log[0]).toBe('forget');
  });
});
