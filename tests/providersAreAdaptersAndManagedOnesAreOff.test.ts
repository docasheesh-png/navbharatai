// Go-live PR 9: provider adapters. BYO Supabase wraps the real flow; managed adapters are off.
import { describe, it, expect } from 'vitest';
import { buildRegistry, byoSupabaseAdapter, disabledManagedAdapter } from '../src/server/providers';

const t = { uid: 'u1', workspaceId: 'ws_12345678' };
const deps = (over: any = {}) => ({
  status: async () => ({ connected: true, orgName: 'Acme' }),
  provision: async () => ({ ok: true as const, projectRef: 'abcdefghijkl', projectName: 'app', url: 'https://abcdefghijkl.supabase.co' }),
  disconnect: async () => true,
  ...over,
});

describe('BYO Supabase adapter', () => {
  it('returns only non-secret facts', async () => {
    const r = await byoSupabaseAdapter(deps()).provision({ tenant: t, skuId: 'byo.supabase', idempotencyKey: 'k' });
    expect(r).toEqual({ ok: true, resourceRef: 'abcdefghijkl', publicInfo: { projectName: 'app', url: 'https://abcdefghijkl.supabase.co' }, secretsStored: true });
    expect(JSON.stringify(r)).not.toMatch(/key|password|DATABASE_URL/i);
  });
  it('maps 202 (not ready yet) and 5xx to retryable, 4xx to final', async () => {
    const a = byoSupabaseAdapter(deps({ provision: async () => ({ ok: false, status: 202, error: 'starting' }) }));
    expect((await a.provision({ tenant: t, skuId: 'x', idempotencyKey: 'k' }) as any).retryable).toBe(true);
    const b = byoSupabaseAdapter(deps({ provision: async () => ({ ok: false, status: 400, error: 'connect first' }) }));
    expect((await b.provision({ tenant: t, skuId: 'x', idempotencyKey: 'k' }) as any).retryable).toBe(false);
  });
  it('a throwing dependency becomes a failure, not a crash', async () => {
    const a = byoSupabaseAdapter(deps({ provision: async () => { throw new Error('boom'); } }));
    expect((await a.provision({ tenant: t, skuId: 'x', idempotencyKey: 'k' })).ok).toBe(false);
  });
  it('connection status and disconnect', async () => {
    const a = byoSupabaseAdapter(deps());
    expect((await a.connectionStatus!(t)).connected).toBe(true);
    expect((await a.disconnect!(t)).ok).toBe(true);
  });
});

describe('managed adapters are disabled by default', () => {
  it('every managed adapter refuses with no env', async () => {
    const reg = buildRegistry(deps(), {} as any);
    for (const [k, a] of reg) {
      if (a.mode !== 'managed') continue;
      expect(a.available().ok, k).toBe(false);
      const r = await a.provision({ tenant: t, skuId: 'x', idempotencyKey: 'k' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Nothing was created or charged/);
    }
  });
  it('the master switch alone is not enough — the per-provider authorisation is required', () => {
    expect(disabledManagedAdapter('x', 'AUTH_X', { PROVIDERS_MANAGED_ENABLED: 'on' } as any).available().ok).toBe(false);
    expect(disabledManagedAdapter('x', 'AUTH_X', { PROVIDERS_MANAGED_ENABLED: 'on', AUTH_X: 'on' } as any).available().ok).toBe(true);
  });
  it('even when authorised, the placeholder creates nothing', async () => {
    const a = disabledManagedAdapter('x', 'AUTH_X', { PROVIDERS_MANAGED_ENABLED: 'on', AUTH_X: 'on' } as any);
    expect((await a.provision({ tenant: t, skuId: 'x', idempotencyKey: 'k' })).ok).toBe(false);
  });
});
