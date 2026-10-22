import { describe, it, expect, vi } from 'vitest';
import { listUserWorkspaceApps, listUserWorkspaceAppsResult } from '../src/server/AgentV3/WorkspaceFileStore';
import { sendAdminOwnerApps } from '../src/server/routes/adminOwnerApps';
import { readFileSync } from 'node:fs';
import { mockRes } from './helpers/routeTestUtils';

const uid = 'u'.repeat(28);
const doc = (suffix: string, count = 1) => ({ id: `agentv3-${uid}-${suffix}`, data: () => ({ count, savedAt: 10 }) });
function fakeDb(docs: ReturnType<typeof doc>[], fails = false) {
  const query: Record<string, any> = {};
  for (const key of ['orderBy', 'startAt', 'endAt', 'limit']) query[key] = vi.fn(() => query);
  query.get = vi.fn(async () => { if (fails) throw new Error('unavailable'); return { docs }; });
  return { db: { collection: vi.fn(() => query) } as any, query };
}

describe('admin owner apps preserve read evidence', () => {
  it('the authenticated owner route uses the tested failure-aware handler', () => {
    const source = readFileSync('src/server/routes/admin.ts', 'utf8');
    const route = source.slice(source.indexOf("app.get('/api/admin/apps'"), source.indexOf("app.post('/api/admin/apps/"));
    expect(route).toContain("app.get('/api/admin/apps', verifyAdminToken");
    expect(route).toContain('await sendAdminOwnerApps(res, query.uid, rawCursor, limit');
    expect(route).toContain('read: listUserWorkspaceAppsResult');
    expect(route).not.toMatch(/await listUserWorkspaceApps\(/);
  });
  it('no store is failure for admin, while the legacy caller retains its empty fallback', async () => {
    expect(await listUserWorkspaceAppsResult(uid, 200, null)).toEqual({ ok: false, apps: [], scanLimited: false });
    expect(await listUserWorkspaceApps(uid)).toEqual([]);
  });
  it('query rejection never becomes successful absence', async () => {
    const { db } = fakeDb([], true);
    expect((await listUserWorkspaceAppsResult(uid, 200, db)).ok).toBe(false);
  });
  it('a successful empty query is distinguishable, and uses the owner prefix', async () => {
    const { db, query } = fakeDb([]);
    expect(await listUserWorkspaceAppsResult(uid, 200, db)).toEqual({ ok: true, apps: [], scanLimited: false });
    expect(query.startAt).toHaveBeenCalledWith(`agentv3-${uid}-`);
    expect(query.limit).toHaveBeenCalledWith(200);
    expect(query.get).toHaveBeenCalledTimes(1);
  });
  it('the raw 200-record bound stays visible even if every record is a snapshot or empty', async () => {
    const { db, query } = fakeDb(Array.from({ length: 200 }, (_, i) => doc(`${i}::green`)));
    expect(await listUserWorkspaceAppsResult(uid, 200, db)).toEqual({ ok: true, apps: [], scanLimited: true });
    expect(query.get).toHaveBeenCalledTimes(1);
  });
  it('keeps real saved apps and excludes empty/derived records', async () => {
    const { db } = fakeDb([doc('real'), doc('empty', 0), doc('real::attempt')]);
    const result = await listUserWorkspaceAppsResult(uid, 200, db);
    expect(result).toEqual({ ok: true, apps: [{ workspaceId: `agentv3-${uid}-real`, fileCount: 1, savedAt: 10 }], scanLimited: false });
  });
  it('the route sends 502, never ok/rows, after the actual store query fails', async () => {
    const { db } = fakeDb([], true);
    const res = mockRes();
    const rows = vi.fn();
    await sendAdminOwnerApps(res as any, uid, '', 12, {
      read: (id, limit) => listUserWorkspaceAppsResult(id, limit, db), rows,
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ ok: false, error: 'Could not read this user’s saved apps.' });
    expect(rows).not.toHaveBeenCalled();
  });
  it.each(['', '12', '192'])('the route preserves the scan-limit flag on page %s', async (cursor) => {
    const { db } = fakeDb(Array.from({ length: 200 }, (_, i) => doc(String(i))));
    const res = mockRes();
    const rows = vi.fn(async (_page: unknown[]) => []);
    await sendAdminOwnerApps(res as any, uid, cursor, 12, { read: (id, limit) => listUserWorkspaceAppsResult(id, limit, db), rows });
    expect(rows.mock.calls[0][0]).toHaveLength(cursor === '192' ? 8 : 12);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: 'owner', scanLimited: true, pageSize: 12 });
    if (cursor === '192') expect(res.body.nextCursor).toBeNull();
    else expect(res.body.nextCursor).toBeTruthy();
  });
  it('an enrichment failure is also a 502 rather than absence', async () => {
    const res = mockRes();
    await sendAdminOwnerApps(res as any, uid, '', 12, {
      read: async () => ({ ok: true, apps: [], scanLimited: false }), rows: async () => { throw new Error('join failed'); },
    });
    expect(res.statusCode).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});
