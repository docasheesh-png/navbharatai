import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

/**
 * "App mart me app jaldi open ho" (admin 2026-08-25) — the open path, made fast and kept honest.
 *
 * BEFORE: every Cloud Run instance's first serve of an app did a whole-subcollection file read plus a
 * 200–500 ms server-side compile (measured), between the viewer's tap and their first pixel — and
 * instances recycle on every deploy, so "first serve" was most serves. The page is fully determined
 * at publish time, so publish now BAKES it and open serves the bake.
 *
 * What these tests pin:
 *  1. open serves the baked page and never touches the file subcollection when a bake exists;
 *  2. the bake is version-checked — a re-publish must never serve its predecessor;
 *  3. the NavData id tag is injected on the BAKED path too (it flips window.NavData from the
 *     per-device preview backend to the real shared rows — a baked chat app that silently lost it
 *     would "work" while talking to nobody);
 *  4. no bake ⇒ the compile path serves, byte-identical to before — the bake can only make things
 *     faster, never break an open;
 *  5. publish bakes best-effort — a bake failure must not fail a publish whose files already saved.
 */

const state: {
  app: Record<string, unknown> | null;
  baked: string | null;
  bakedCalls: Array<{ id: string; version: number }>;
  filesCalls: number;
  bakeSaves: Array<{ id: string; version: number }>;
  bakeThrows: boolean;
} = { app: null, baked: null, bakedCalls: [], filesCalls: 0, bakeSaves: [], bakeThrows: false };

vi.mock('../src/server/lib/navStoreWeb', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    getWebApp: async () => state.app,
    getWebAppBakedPage: async (id: string, version: number) => {
      state.bakedCalls.push({ id, version });
      return state.baked;
    },
    getWebAppFiles: async () => {
      state.filesCalls++;
      return { 'index.html': '<!doctype html><html><body><h1>compiled live</h1></body></html>' };
    },
    saveWebApp: async () => undefined,
    saveWebAppBakedPage: async (id: string, version: number) => {
      if (state.bakeThrows) throw new Error('firestore hiccup');
      state.bakeSaves.push({ id, version });
      return true;
    },
    saveWebAppScreenshots: async () => undefined,
    listMyWebApps: async () => [],
    getRemixOrigin: async () => null,
    bumpWebAppCounter: () => undefined,
    evaluateWebPublish: (files: Record<string, string>) => ({ ok: true, files }),
  };
});
vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseIdentity: async () => ({ uid: 'u1', email: 'u@example.com' }),
  verifyFirebaseToken: async () => ({ uid: 'u1' }),
  rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../src/server/lib/workspaceIdentity', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, verifiedWorkspaceReadOk: () => true };
});
vi.mock('../src/server/AgentV3/WorkspaceFileStore', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, loadWorkspaceFiles: async () => ({ 'index.html': '<html><body>x</body></html>' }) };
});

const { registerNavStoreRoutes } = await import('../src/server/routes/navStore');
const routes = captureRoutes(registerNavStoreRoutes);
const open = routes.get('POST /api/nav-store/web/app/:id/open')!;
const publish = routes.get('POST /api/nav-store/web/publish')!;

let seq = 0;
beforeEach(() => {
  // A FRESH app id per test: the route's in-memory L1 cache is module-level and REAL, and a page
  // carrying across opens is exactly what production wants — so the tests work with it, not around it.
  seq++;
  state.app = { id: `app${seq}`, uid: 'u1', name: 'Racer', status: 'listed', visibility: 'public', version: 3, workspaceId: 'w1' };
  state.baked = null;
  state.bakedCalls = [];
  state.filesCalls = 0;
  state.bakeSaves = [];
  state.bakeThrows = false;
});

describe('open — the baked fast path', () => {
  it('serves the bake, asks for THIS version, and never reads the files', async () => {
    state.baked = '<!doctype html><html><body><h1>baked</h1></body></html>';
    const res = mockRes();
    await open(mockReq({ params: { id: String(state.app!.id) }, body: {} }), res);
    expect(res.body?.html).toContain('baked');
    expect(state.bakedCalls).toEqual([{ id: String(state.app!.id), version: 3 }]);
    expect(state.filesCalls).toBe(0);
  });

  it('injects the NavData id tag on the baked path', async () => {
    state.baked = '<!doctype html><html><body><h1>baked</h1></body></html>';
    const res = mockRes();
    await open(mockReq({ params: { id: String(state.app!.id) }, body: {} }), res);
    expect(res.body?.html).toContain(`__NBAI_STORE_APP_ID="${state.app!.id}"`);
  });

  it('falls back to the live compile when there is no bake — slower, never broken', async () => {
    const res = mockRes();
    await open(mockReq({ params: { id: String(state.app!.id) }, body: {} }), res);
    expect(state.filesCalls).toBe(1);
    expect(res.body?.html).toContain('compiled live');
    expect(res.body?.html).toContain(`__NBAI_STORE_APP_ID="${state.app!.id}"`);
  });
});

describe('publish — bakes without ever risking the publish', () => {
  const FORM = { workspaceId: 'w1', name: 'Racer', description: 'a game' };

  /** Let the deferred bake run: it is scheduled with setImmediate, deliberately after the response. */
  const afterResponse = (): Promise<void> => new Promise((r) => setImmediate(() => setImmediate(() => r())));

  it('THE PUBLISH ANSWERS FIRST — the bake has not run when the user gets their reply', async () => {
    // Admin 2026-08-27: "app mart me publish kar rahe hai, to infinity loading hoti ja rahi hai".
    // renderPreview + gzipSync are synchronous and CPU-bound, so awaiting them inside the request put
    // seconds of blocked event loop between the user and their answer on a big app — and no timeout
    // could have rescued it, because you cannot race a promise against work holding the only thread.
    const res = mockRes();
    await publish(mockReq({ body: FORM, headers: { host: 'navbharatai.com' } }), res);
    expect(res.body?.ok).toBe(true);
    expect(state.bakeSaves.length).toBe(0);   // …the user is not waiting for this
    // Drain it inside this test: a bake left pending would land in the NEXT test, after beforeEach
    // has reset the counter, and be counted there. (It did, the first time this was written.)
    await afterResponse();
  });

  it('and then bakes the newly published version', async () => {
    const res = mockRes();
    await publish(mockReq({ body: FORM, headers: { host: 'navbharatai.com' } }), res);
    await afterResponse();
    expect(state.bakeSaves.length).toBe(1);
    expect(state.bakeSaves[0].version).toBe(res.body?.version);
  });

  it('a bake failure does not fail the publish', async () => {
    state.bakeThrows = true;
    const res = mockRes();
    await publish(mockReq({ body: FORM, headers: { host: 'navbharatai.com' } }), res);
    expect(res.body?.ok).toBe(true);   // files saved; open will simply compile live
    await afterResponse();             // and the deferred failure must not surface as an unhandled one
    expect(res.body?.ok).toBe(true);
  });
});
