import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const deps = vi.hoisted(() => ({
  verify: vi.fn(async (token: string) => {
    if (token === 'alice-token') return { uid: 'alice' };
    if (token === 'bob-token') return { uid: 'bob' };
    throw new Error('invalid or expired token');
  }),
  countFiles: vi.fn(),
  list: vi.fn(), get: vi.fn(), save: vi.fn(), loadSession: vi.fn(),
  versions: new Map<string, Array<Record<string, unknown>>>(),
  sessions: new Map<string, Record<string, unknown>>(),
}));

// Exercise the real request verifier with the SDK mocked at its signature-verification boundary.
// VITEST is unset per request below, so the production auth path cannot silently bypass the check.
vi.mock('../src/server/lib/firebaseAdminModule', () => ({ loadFirebaseAdmin: async () => ({
  apps: [{}], auth: () => ({ verifyIdToken: deps.verify }),
}) }));
vi.mock('../src/server/AgentV3/WorkspaceFileStore', async (original) => ({
  ...await original<typeof import('../src/server/AgentV3/WorkspaceFileStore')>(),
  countWorkspaceFiles: deps.countFiles,
}));
vi.mock('../src/server/project/BuildHistoryStore', () => ({
  buildHistoryStore: { list: deps.list, get: deps.get, save: deps.save },
}));
vi.mock('../src/server/pro/ProBuildSession', () => ({ proBuildSessionStore: { load: deps.loadSession } }));

const sid = 'shared123';
const aliceWs = `agentv3-alice-${sid}`;
const bobWs = `agentv3-bob-${sid}`;
const anonWs = 'agentv3-anon-random-session123';
let routes: ReturnType<typeof captureRoutes>;
beforeAll(async () => {
  routes = captureRoutes((await import('../src/server/routes/build')).registerBuildRoutes);
});
beforeEach(() => {
  vi.stubEnv('VITEST', '');
  vi.clearAllMocks();
  deps.versions.clear();
  deps.sessions.clear();
  for (const [key, owner] of [[aliceWs, 'alice'], [bobWs, 'bob'], [anonWs, 'anonymous'], [sid, 'legacy-other-user']]) {
    deps.versions.set(key, [{
      id: 'v1', sessionId: key, commitMessage: `${owner}'s checkpoint`, files: { 'app.ts': `${owner}'s source` },
    }]);
    deps.sessions.set(key, { ok: true, files: { 'app.ts': `${owner}'s source` } });
  }
  // Both accounts have the SAME session suffix. Merely proving their own workspace exists can never
  // authorize a read of the shared legacy document at build_history/shared123.
  deps.countFiles.mockImplementation(async (workspaceId: string) =>
    workspaceId === aliceWs || workspaceId === bobWs ? 3 : 0);
  deps.list.mockImplementation(async (key: string) => (deps.versions.get(key) ?? [])
    .map(({ files: _files, ...meta }) => meta));
  deps.get.mockImplementation(async (key: string, id: string) =>
    deps.versions.get(key)?.find((version) => version.id === id) ?? null);
  deps.save.mockImplementation(async (key: string, entry: Record<string, unknown>) => {
    const rows = deps.versions.get(key) ?? [];
    rows.push({ ...entry, id: 'saved-now', sessionId: key });
    deps.versions.set(key, rows);
    return true;
  });
  deps.loadSession.mockImplementation(async (key: string) => deps.sessions.get(key) ?? null);
});
afterEach(() => vi.unstubAllEnvs());

const reads = [
  ['GET /api/build-history/:sessionId', 'list'],
  ['GET /api/build-history/:sessionId/:versionId', 'version'],
  ['GET /api/build-session/:sessionId', 'session'],
] as const;
const checkpoint = 'POST /api/build-history/:sessionId/checkpoint';

async function request(route: string, token?: string, sessionId = sid) {
  const res = mockRes();
  await routes.get(route)!(mockReq({
    params: { sessionId, versionId: 'v1' },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { name: 'my checkpoint', files: { 'app.ts': 'my submitted source' }, userId: 'bob' },
  }), res);
  return res;
}

describe('history is isolated by owner even when session ids collide', () => {
  for (const owner of ['alice', 'bob']) {
    for (const [route, kind] of reads) {
      it(`${owner} reads only their own ${kind} using the shared bare session id`, async () => {
        const result = await request(route, `${owner}-token`);
        expect(result.statusCode).toBe(200);
        if (kind === 'list') {
          expect(result.body.versions).toHaveLength(1);
          expect(result.body.versions[0].commitMessage).toBe(`${owner}'s checkpoint`);
        } else {
          expect(result.body.files).toEqual({ 'app.ts': `${owner}'s source` });
        }
        const storage = kind === 'list' ? deps.list : kind === 'version' ? deps.get : deps.loadSession;
        expect(storage.mock.calls[0]?.[0]).toBe(`agentv3-${owner}-${sid}`);
        expect(deps.verify).toHaveBeenCalledWith(`${owner}-token`);
      });
    }
    it(`${owner} saves a checkpoint under their full workspace id`, async () => {
      const result = await request(checkpoint, `${owner}-token`);
      expect(result.statusCode).toBe(200);
      expect(deps.save).toHaveBeenCalledWith(`agentv3-${owner}-${sid}`, expect.objectContaining({
        files: { 'app.ts': 'my submitted source' },
      }));
      expect(deps.versions.get(sid)).toHaveLength(1);
      expect(deps.versions.get(owner === 'alice' ? bobWs : aliceWs)).toHaveLength(1);
    });
  }

  for (const [route] of [...reads, [checkpoint]]) {
    it(`${route} refuses the full workspace id of another account before touching storage`, async () => {
      expect((await request(route, 'alice-token', bobWs)).statusCode).toBe(403);
      expect(deps.list).not.toHaveBeenCalled();
      expect(deps.get).not.toHaveBeenCalled();
      expect(deps.loadSession).not.toHaveBeenCalled();
      expect(deps.save).not.toHaveBeenCalled();
    });
    for (const [label, token] of [['missing', undefined], ['invalid', 'invalid-token'], ['expired', 'expired-token']] as const) {
      it(`${route} refuses ${label} token despite a claimed user id`, async () => {
        expect((await request(route, token)).statusCode).toBe(401);
        expect(deps.countFiles).not.toHaveBeenCalled();
        expect(deps.list).not.toHaveBeenCalled();
        expect(deps.get).not.toHaveBeenCalled();
        expect(deps.loadSession).not.toHaveBeenCalled();
        expect(deps.save).not.toHaveBeenCalled();
      });
    }
  }

  for (const [route, kind] of reads) {
    it(`${kind} never falls back to an unowned legacy bare-session document`, async () => {
      deps.versions.delete(aliceWs);
      deps.sessions.delete(aliceWs);
      const result = await request(route, 'alice-token');
      expect(result.statusCode).toBe(kind === 'list' ? 200 : 404);
      if (kind === 'list') expect(result.body.versions).toEqual([]);
      expect(JSON.stringify(result.body)).not.toContain('legacy-other-user');
      const storage = kind === 'list' ? deps.list : kind === 'version' ? deps.get : deps.loadSession;
      expect(storage.mock.calls.every(([key]) => key === aliceWs)).toBe(true);
      expect(deps.versions.get(sid)).toHaveLength(1); // retained for an ownership-proven migration
    });
    it(`${kind} still supports the established full anonymous workspace capability`, async () => {
      const result = await request(route, undefined, anonWs);
      expect(result.statusCode).toBe(200);
      if (kind === 'list') expect(result.body.versions[0].commitMessage).toBe("anonymous's checkpoint");
      else expect(result.body.files).toEqual({ 'app.ts': "anonymous's source" });
      expect(deps.countFiles).not.toHaveBeenCalled();
    });
  }

  it('the full anonymous capability writes only its own history', async () => {
    expect((await request(checkpoint, undefined, anonWs)).statusCode).toBe(200);
    expect(deps.save).toHaveBeenCalledWith(anonWs, expect.any(Object));
  });
});
