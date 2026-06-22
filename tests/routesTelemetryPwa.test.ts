import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerTelemetryRoutes } from '../src/server/routes/telemetry';
import { registerPwaRoutes, type PwaStore } from '../src/server/routes/pwa';
import { registerSecretsRoutes } from '../src/server/routes/secrets';
import { registerSyncRoutes } from '../src/server/routes/sync';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

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
});

describe('pwa routes', () => {
  let store: PwaStore;
  let routes: Map<string, (req: any, res: any) => any>;

  beforeEach(() => {
    store = new Map();
    routes = captureRoutes(registerPwaRoutes, store);
  });

  it('save returns 400 without html', () => {
    const res = mockRes();
    routes.get('POST /api/pwa/save')!(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'HTML required' });
  });

  it('save stores the app and returns an id + url', () => {
    const res = mockRes();
    routes.get('POST /api/pwa/save')!(
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

  it('name defaults and is capped at 30 chars', () => {
    const res = mockRes();
    const longName = 'x'.repeat(50);
    routes.get('POST /api/pwa/save')!(mockReq({ body: { html: '<p>a</p>', name: longName } }), res);
    const entry = store.get(res.body.id);
    expect(entry?.name.length).toBe(30);
  });

  it('manifest returns 404 for unknown id', () => {
    const res = mockRes();
    routes.get('GET /pwa/:id/manifest.json')!(mockReq({ params: { id: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('manifest returns valid PWA fields for a stored app', () => {
    store.set('abc', { html: '<h1>App</h1>', name: 'Cool App', createdAt: Date.now() });
    const res = mockRes();
    routes.get('GET /pwa/:id/manifest.json')!(mockReq({ params: { id: 'abc' } }), res);
    expect(res.body.name).toBe('Cool App');
    expect(res.body.display).toBe('standalone');
    expect(res.body.start_url).toBe('/pwa/abc');
    expect(Array.isArray(res.body.icons)).toBe(true);
  });

  it('serving an unknown app returns 404 HTML', () => {
    const res = mockRes();
    routes.get('GET /pwa/:id')!(mockReq({ params: { id: 'missing' } }), res);
    expect(res.statusCode).toBe(404);
    expect(String(res.sent)).toContain('Link Expired');
  });

  it('serving a stored app injects the PWA manifest link into <head>', () => {
    store.set('xyz', { html: '<html><head></head><body>Hi</body></html>', name: 'App', createdAt: Date.now() });
    const res = mockRes();
    routes.get('GET /pwa/:id')!(mockReq({ params: { id: 'xyz' } }), res);
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
