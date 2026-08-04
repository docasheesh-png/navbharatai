import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerTelemetryRoutes } from '../src/server/routes/telemetry';
import { registerPwaRoutes, MAX_PWA_HTML_BYTES, pwaEntryExpired, pwaTtlMs, type PwaStore } from '../src/server/routes/pwa';
import { registerSecretsRoutes } from '../src/server/routes/secrets';
import { registerSyncRoutes } from '../src/server/routes/sync';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// PWA durable-hosting fix (admin 2026-08-02): saving requires a signed-in user, and the durable copy
// goes to Firestore. Partial-mock ONLY the two seams (token verify + server db handle); everything
// else in those modules stays real so the other route suites in this file are untouched.
const authState = { uid: null as string | null };
vi.mock('../src/server/lib/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, verifyFirebaseToken: vi.fn(async () => authState.uid) };
});
const dbState = { db: null as unknown };
vi.mock('../src/server/lib/serverDb', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getServerDb: vi.fn(() => dbState.db) };
});

/** A minimal admin-SDK-shaped fake Firestore (db.doc(path).get()/.set()) backed by a plain object. */
function fakeAdminDb(docs: Record<string, any>) {
  return {
    doc: (path: string) => ({
      get: async () => ({ exists: path in docs, data: () => docs[path] }),
      set: async (data: any) => { docs[path] = data; },
    }),
  };
}

describe('telemetry routes', () => {
  const routes = captureRoutes(registerTelemetryRoutes);

  it('registers the expected endpoints', () => {
    expect(routes.has('GET /api/analyze/pagespeed')).toBe(true);
    expect(routes.has('POST /api/logs/error')).toBe(true);
    expect(routes.has('POST /api/analytics/event')).toBe(true);
  });

  it('pagespeed returns 400 when url is missing', async () => {
    const res = mockRes();
    await routes.get('GET /api/analyze/pagespeed')!(mockReq({ query: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'url required' });
  });

  it('logs/error always returns 204 (best-effort ingestion)', () => {
    const res = mockRes();
    routes.get('POST /api/logs/error')!(mockReq({ body: { message: 'boom' } }), res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('analytics/event returns 400 when event name is missing', () => {
    const res = mockRes();
    routes.get('POST /api/analytics/event')!(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'event required' });
  });

  it('analytics/event returns 204 for a valid event', () => {
    const res = mockRes();
    routes.get('POST /api/analytics/event')!(mockReq({ body: { event: 'build_started' } }), res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });
});

describe('pagespeed route (mocked fetch)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps a successful Lighthouse response to score fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        lighthouseResult: {
          categories: {
            performance: { score: 0.92 },
            accessibility: { score: 0.88 },
            seo: { score: 1 },
            'best-practices': { score: 0.75 },
          },
          audits: { 'first-contentful-paint': { displayValue: '1.2 s' } },
        },
      }),
    }));
    const routes = captureRoutes(registerTelemetryRoutes);
    const res = mockRes();
    await routes.get('GET /api/analyze/pagespeed')!(mockReq({ query: { url: 'https://example.com' } }), res);
    expect(res.body.performance).toBe(92);
    expect(res.body.accessibility).toBe(88);
    expect(res.body.seo).toBe(100);
    expect(res.body.bestPractices).toBe(75);
    expect(res.body.fcp).toBe('1.2 s');
  });

  it('propagates the upstream error status when PageSpeed fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limited' } }),
    }));
    const routes = captureRoutes(registerTelemetryRoutes);
    const res = mockRes();
    await routes.get('GET /api/analyze/pagespeed')!(mockReq({ query: { url: 'https://x.com' } }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Rate limited' });
  });

  it('defaults to mobile strategy and echoes the extra vitals + finalUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        lighthouseResult: {
          finalUrl: 'https://example.com/',
          categories: { performance: { score: 0.5 } },
          audits: {
            'speed-index': { displayValue: '3.1 s' },
            'interactive': { displayValue: '4.0 s' },
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const routes = captureRoutes(registerTelemetryRoutes);
    const res = mockRes();
    await routes.get('GET /api/analyze/pagespeed')!(mockReq({ query: { url: 'https://example.com' } }), res);
    expect(fetchMock.mock.calls[0][0]).toContain('strategy=mobile');
    expect(res.body.strategy).toBe('mobile');
    expect(res.body.si).toBe('3.1 s');
    expect(res.body.tti).toBe('4.0 s');
    expect(res.body.finalUrl).toBe('https://example.com/');
  });

  it('passes strategy=desktop through to the PageSpeed API when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lighthouseResult: { categories: {}, audits: {} } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const routes = captureRoutes(registerTelemetryRoutes);
    const res = mockRes();
    await routes.get('GET /api/analyze/pagespeed')!(mockReq({ query: { url: 'https://example.com', strategy: 'desktop' } }), res);
    expect(fetchMock.mock.calls[0][0]).toContain('strategy=desktop');
    expect(res.body.strategy).toBe('desktop');
  });
});

describe('pwa routes (durable hosting — Firestore-backed, signed-in saves)', () => {
  let store: PwaStore;
  let routes: Map<string, (req: any, res: any) => any>;

  beforeEach(() => {
    store = new Map();
    routes = captureRoutes(registerPwaRoutes, store);
    authState.uid = 'user-1';   // default: signed in
    dbState.db = null;          // default: no server db (local-dev memory-only path)
  });

  it('save requires a signed-in user (durable hosting on our domain is never anonymous)', async () => {
    authState.uid = null;
    const res = mockRes();
    await routes.get('POST /api/pwa/save')!(mockReq({ body: { html: '<h1>Hi</h1>' } }), res);
    expect(res.statusCode).toBe(401);
    expect(String(res.body.error)).toContain('sign in');
  });

  it('save returns 400 without html', async () => {
    const res = mockRes();
    await routes.get('POST /api/pwa/save')!(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'HTML required' });
  });

  it('save refuses an app bigger than the Firestore doc cap with an HONEST 413', async () => {
    const res = mockRes();
    const big = 'x'.repeat(MAX_PWA_HTML_BYTES + 1);
    await routes.get('POST /api/pwa/save')!(mockReq({ body: { html: big } }), res);
    expect(res.statusCode).toBe(413);
    expect(String(res.body.error)).toContain('too large');
  });

  it('save stores the app and returns an id + url (memory-only when no server db)', async () => {
    const res = mockRes();
    await routes.get('POST /api/pwa/save')!(
      mockReq({ body: { html: '<h1>Hi</h1>', name: 'My App' }, headers: { host: 'navbharatai.web.app' } }),
      res,
    );
    expect(res.body.id).toBeTruthy();
    expect(res.body.url).toContain('/pwa/');
    expect(store.size).toBe(1);
    const entry = store.get(res.body.id);
    expect(entry?.html).toBe('<h1>Hi</h1>');
    expect(entry?.name).toBe('My App');
  });

  it('save writes the DURABLE copy to Firestore (the cold-restart/multi-instance fix)', async () => {
    const docs: Record<string, any> = {};
    dbState.db = fakeAdminDb(docs);
    const res = mockRes();
    await routes.get('POST /api/pwa/save')!(mockReq({ body: { html: '<h1>Hi</h1>', name: 'Durable' } }), res);
    expect(res.body.id).toBeTruthy();
    const saved = docs[`pwa_apps/${res.body.id}`];
    expect(saved?.html).toBe('<h1>Hi</h1>');
    expect(saved?.userId).toBe('user-1'); // ownership recorded for abuse handling
  });

  it('save returns an HONEST 503 when the durable write fails — never a URL that would die', async () => {
    dbState.db = { doc: () => ({ set: async () => { throw new Error('firestore down'); } }) };
    const res = mockRes();
    await routes.get('POST /api/pwa/save')!(mockReq({ body: { html: '<h1>Hi</h1>' } }), res);
    expect(res.statusCode).toBe(503);
    expect(store.size).toBe(0); // no half-saved entry
  });

  it('serving falls through to Firestore when memory is cold (restart/other instance) and hydrates the cache', async () => {
    const id = 'a1b2c3d4e5f60718'; // 16-hex, like a real minted id
    const docs: Record<string, any> = {
      [`pwa_apps/${id}`]: { html: '<html><head></head><body>Hi</body></html>', name: 'App', createdAt: Date.now(), userId: 'user-1' },
    };
    dbState.db = fakeAdminDb(docs);
    const res = mockRes();
    await routes.get('GET /pwa/:id')!(mockReq({ params: { id } }), res);
    expect(String(res.sent)).toContain(`<link rel="manifest" href="/pwa/${id}/manifest.json">`);
    expect(store.has(id)).toBe(true); // cache hydrated for the next hit
  });

  it('an entry past its TTL is treated as absent (honest 404, not a stale app)', async () => {
    const id = 'a1b2c3d4e5f60718';
    dbState.db = fakeAdminDb({
      [`pwa_apps/${id}`]: { html: '<h1>Old</h1>', name: 'Old', createdAt: Date.now() - pwaTtlMs() - 1000 },
    });
    const res = mockRes();
    await routes.get('GET /pwa/:id')!(mockReq({ params: { id } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('pwaEntryExpired: fresh entries live, old entries expire, junk createdAt expires', () => {
    expect(pwaEntryExpired(Date.now())).toBe(false);
    expect(pwaEntryExpired(Date.now() - pwaTtlMs() - 1)).toBe(true);
    expect(pwaEntryExpired(NaN)).toBe(true);
  });

  it('name defaults and is capped at 30 chars', async () => {
    const res = mockRes();
    const longName = 'x'.repeat(50);
    await routes.get('POST /api/pwa/save')!(mockReq({ body: { html: '<p>a</p>', name: longName } }), res);
    const entry = store.get(res.body.id);
    expect(entry?.name.length).toBe(30);
  });

  it('manifest returns 404 for unknown id', async () => {
    const res = mockRes();
    await routes.get('GET /pwa/:id/manifest.json')!(mockReq({ params: { id: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('manifest returns valid PWA fields for a stored app', async () => {
    store.set('abc', { html: '<h1>App</h1>', name: 'Cool App', createdAt: Date.now() });
    const res = mockRes();
    await routes.get('GET /pwa/:id/manifest.json')!(mockReq({ params: { id: 'abc' } }), res);
    expect(res.body.name).toBe('Cool App');
    expect(res.body.display).toBe('standalone');
    expect(res.body.start_url).toBe('/pwa/abc');
    expect(Array.isArray(res.body.icons)).toBe(true);
  });

  it('serving an unknown app returns 404 HTML', async () => {
    const res = mockRes();
    await routes.get('GET /pwa/:id')!(mockReq({ params: { id: 'missing' } }), res);
    expect(res.statusCode).toBe(404);
    expect(String(res.sent)).toContain('App Not Found');
  });

  it('serving a stored app injects the PWA manifest link into <head>', async () => {
    store.set('xyz', { html: '<html><head></head><body>Hi</body></html>', name: 'App', createdAt: Date.now() });
    const res = mockRes();
    await routes.get('GET /pwa/:id')!(mockReq({ params: { id: 'xyz' } }), res);
    expect(String(res.sent)).toContain('<link rel="manifest" href="/pwa/xyz/manifest.json">');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('service worker is served as javascript with the right scope header', () => {
    const res = mockRes();
    routes.get('GET /pwa/:id/sw.js')!(mockReq({ params: { id: 'sw1' } }), res);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['service-worker-allowed']).toBe('/pwa/sw1');
    expect(String(res.sent)).toContain("CACHE='nb-pwa-sw1'");
  });
});

describe('secrets routes registration (auth-gated CRUD surface)', () => {
  it('registers the user-scoped secrets endpoints', () => {
    const routes = captureRoutes(registerSecretsRoutes);
    expect(routes.has('GET /api/secrets/:userId')).toBe(true);
    expect(routes.has('POST /api/secrets/:userId')).toBe(true);
    expect(routes.has('DELETE /api/secrets/:userId/:secretId')).toBe(true);
  });
});

describe('sync routes registration', () => {
  it('registers the user-scoped sync endpoints', () => {
    const routes = captureRoutes(registerSyncRoutes);
    expect(routes.has('GET /api/sync/:userId')).toBe(true);
    expect(routes.has('POST /api/sync/:userId')).toBe(true);
  });
});
