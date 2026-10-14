// Go-live PR 11: secret sink — vault always, Secret Manager only when switched on, values never leak.
import { describe, it, expect, vi } from 'vitest';
import { secretIdFor, secretSinkConfig, storeSecrets } from '../src/server/lib/secretSink';

const values = { DATABASE_URL: 'postgres://u:SUPERSECRET@h/db', bad_name: 'x' };
const ON = { SECRET_MANAGER_SINK: 'on', SECRET_MANAGER_PROJECT: 'nbai-apps-proj' } as any;

describe('secret sink', () => {
  it('is off by default and writes the vault only', async () => {
    const vault = vi.fn(async () => true);
    const fetch = vi.fn();
    const r = await storeSecrets({ uid: 'u', workspaceId: 'w', values }, { vault, fetch: fetch as any, token: async () => 't', env: {} as any });
    expect(r).toEqual({ ok: true, vault: true, secretManager: 'off', written: 1 });
    expect(fetch).not.toHaveBeenCalled();
    expect(vault).toHaveBeenCalledWith('u', { DATABASE_URL: values.DATABASE_URL }, 'w');
  });
  it('needs a valid project as well as the switch', () => {
    expect(secretSinkConfig({ SECRET_MANAGER_SINK: 'on' } as any).enabled).toBe(false);
    expect(secretSinkConfig(ON).enabled).toBe(true);
  });
  it('dual-writes when on; ids are hashed', async () => {
    const calls: any[] = [];
    const fetch = async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
    const r = await storeSecrets({ uid: 'u', workspaceId: 'w', values }, { vault: async () => true, fetch, token: async () => 't', env: ON });
    expect(r.secretManager).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain(secretIdFor('u', 'w', 'DATABASE_URL'));
    expect(calls.map((c) => c.url).join(' ')).not.toMatch(/DATABASE_URL|\bu\b/);
  });
  it('a Secret Manager failure keeps the vault result and never logs the value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await storeSecrets({ uid: 'u', workspaceId: 'w', values }, { vault: async () => true, fetch: async () => ({ ok: false, status: 403 }), token: async () => 't', env: ON });
    expect(r).toMatchObject({ ok: true, secretManager: 'failed' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SUPERSECRET');
    warn.mockRestore();
  });
  it('the vault failing is a failure even if Secret Manager worked', async () => {
    const r = await storeSecrets({ uid: 'u', workspaceId: null, values }, { vault: async () => false, fetch: async () => ({ ok: true, status: 200 }), token: async () => 't', env: ON });
    expect(r.ok).toBe(false);
  });
});
