// Forensic audit 2026-10-04 — HTML a user wrote must never run as navbharatai.com.
//
// `GET /pwa/:id` (any signed-in account could save it) and `GET /preview/:id` (anyone, no account) sent a
// user's HTML as an ordinary page on our origin, where its script could read every visitor's session and
// GitHub token. Both now carry a `sandbox` CSP without `allow-same-origin`, which forces an opaque origin
// even when the link is opened directly. A real Express app serves the real routes here.

import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { registerPwaRoutes, type PwaStore } from '../src/server/routes/pwa';
import { registerPreviewRoutes } from '../src/server/routes/preview';
import { getPreviewService } from '../src/server/runtime/PreviewService';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { UNTRUSTED_HTML_CSP } from '../src/server/lib/untrustedHtml';

const store: PwaStore = new Map();
const PWA_ID = 'a1b2c3d4e5f60718';
store.set(PWA_ID, { html: '<html><head></head><body><script>steal()</script></body></html>', name: 'Evil" onload="x', createdAt: Date.now(), userId: 'u1' } as never);

const app = express();
app.use(express.json());
registerPwaRoutes(app, store);
registerPreviewRoutes(app);
const server = app.listen(0);
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => new Promise<void>((done) => server.close(() => done())));

function expectSandboxed(csp: string | null) {
  expect(csp).toBeTruthy();
  expect(csp).toMatch(/(^|;|\s)sandbox(\s|;|$)/);
  expect(csp).not.toMatch(/allow-same-origin/);
}

describe('a hosted /pwa page runs in an opaque origin', () => {
  it('the page is served with the sandbox CSP', async () => {
    const r = await fetch(`${base()}/pwa/${PWA_ID}`);
    expect(r.status).toBe(200);
    expectSandboxed(r.headers.get('content-security-policy'));
    expect(UNTRUSTED_HTML_CSP).not.toMatch(/allow-same-origin/);
  });

  it('the app name cannot break out of its attribute', async () => {
    const html = await (await fetch(`${base()}/pwa/${PWA_ID}`)).text();
    expect(html).toContain('content="Evil&quot; onload=&quot;x"');
  });

  it('the service-worker script only echoes an id this server minted', async () => {
    expect((await fetch(`${base()}/pwa/a'b/sw.js`)).status).toBe(404);
    expect((await fetch(`${base()}/pwa/${PWA_ID}/sw.js`)).status).toBe(200);
  });
});

describe('a static /preview page runs in an opaque origin', () => {
  it('the page is served with the sandbox CSP', async () => {
    const { sessionId } = await getPreviewService().static.start('p', VirtualFileSystem.fromRecord({ 'index.html': '<h1>hi</h1><script>steal()</script>' }));
    const r = await fetch(`${base()}/preview/${sessionId}`);
    expect(r.status).toBe(200);
    expectSandboxed(r.headers.get('content-security-policy'));
  });

  it('starting a preview needs an account', async () => {
    const r = await fetch(`${base()}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: { 'index.html': '<h1>x</h1>' } }) });
    expect(r.status).toBe(401);
  });
});

describe('census: every route that sends user HTML uses the one sender', () => {
  it('pwa.ts and preview.ts never set text/html by hand', () => {
    for (const f of ['src/server/routes/pwa.ts', 'src/server/routes/preview.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/setHeader\(\s*['"]Content-Type['"]\s*,\s*['"]text\/html/);
      expect(src, f).toMatch(/sendUntrustedHtml\(/);
    }
  });
});
