import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { createReportAccess, listReportAccess, newReportToken, reportTokenHash, reportTokenOk, revokeReportAccess } from '../src/server/lib/failedReportAccess';

beforeEach(() => { vi.stubEnv('ADMIN_USERNAME', 'test-owner'); state.db = null; });
describe('scoped report credentials', () => {
  it('stores only a hash, expires, and revokes on the next request', async () => {
    const rows = new Map<string, any>();
    state.db = { runTransaction: async (fn: any) => fn({ get: async () => ({ size: rows.size }), create: (ref: any, d: unknown) => ref.create(d) }), collection: () => ({
      limit: () => ({}),
      doc: (id: string) => ({
        create: async (data: unknown) => { rows.set(id, data); },
        get: async () => ({ data: () => rows.get(id) }),
        delete: async () => { rows.delete(id); },
      }),
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [...rows].map(([id, d]) => ({ id, data: () => d })) }) }) }),
    }) };
    const a = await createReportAccess('My tool');
    expect(a.token).toMatch(/^nbfr_[A-Za-z0-9_-]{43}$/); expect(a.id).toBe(reportTokenHash(a.token));
    expect(JSON.stringify([...rows.values()])).not.toContain(a.token);
    expect(await reportTokenOk(`Bearer ${a.token}`, a.createdAt)).toBe(true);
    expect(await reportTokenOk(`Bearer ${a.token}`, a.expiresAt)).toBe(false);
    expect(await listReportAccess()).toEqual([{ id: a.id, label: a.label, createdAt: a.createdAt, expiresAt: a.expiresAt }]);
    rows.get(a.id).scope = 'admin'; expect(await reportTokenOk(`Bearer ${a.token}`)).toBe(false);
    rows.get(a.id).scope = 'failed-reports:read'; rows.get(a.id).owner = 'someone-else'; expect(await reportTokenOk(`Bearer ${a.token}`)).toBe(false);
    rows.get(a.id).owner = 'test-owner'; await revokeReportAccess(a.id); expect(await reportTokenOk(`Bearer ${a.token}`)).toBe(false);
  });
  it('caps the registry atomically so every credential remains manageable', async () => {
    state.db = { collection: () => ({ limit: () => ({}) }), runTransaction: async (fn: any) => fn({ get: async () => ({ size: 100 }) }) };
    await expect(createReportAccess('Another tool')).rejects.toThrow(/Revoke an old credential/);
  });
  it('uses random credentials and refuses malformed or unknown authentication without a read', async () => {
    expect(newReportToken()).not.toEqual(newReportToken());
    for (const header of [undefined, [], 'secret', 'Bearer fake', 'Bearer nbfr_short']) expect(await reportTokenOk(header)).toBe(false);
    await expect(reportTokenOk('Bearer ' + newReportToken())).rejects.toThrow(/unavailable/);
    await expect(createReportAccess('tool')).rejects.toThrow(/unavailable/);
    await expect(listReportAccess()).rejects.toThrow(/unavailable/);
    await expect(revokeReportAccess('id')).rejects.toThrow(/unavailable/);
  });
});
