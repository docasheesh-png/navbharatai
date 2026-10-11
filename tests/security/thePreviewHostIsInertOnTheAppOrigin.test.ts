import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { securityHeadersConfig } from '../../src/server/lib/securityHeaders';
import { APP_ORIGINS, previewSandboxGate } from '../../src/server/lib/previewHost';

/**
 * UI-S1 — /preview-sandbox.html is not a page of the app. Same gate the production server mounts
 * (previewSandboxGate), after Helmet, before static. Host navbharatai.com is 404. The preview host
 * gets the file and a frame-ancestors CSP that replaced Helmet's policy.
 */

let server: Server;
let port = 0;

function get(host: string, extra: Record<string, string> = {}): Promise<{ status: number; csp: string; nosniff: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/preview-sandbox.html',
      method: 'GET',
      headers: { Host: host, ...extra },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const csp = res.headers['content-security-policy'];
        resolve({
          status: res.statusCode || 0,
          csp: Array.isArray(csp) ? csp.join('; ') : (csp || ''),
          nosniff: String(res.headers['x-content-type-options'] || ''),
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  // Production trusts one proxy hop (server.ts). An X-Forwarded-Host must not unlock this file.
  app.set('trust proxy', 1);
  app.use(helmet(securityHeadersConfig));
  app.get('/preview-sandbox.html', previewSandboxGate);
  app.use(express.static(path.join(process.cwd(), 'public')));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN', '');
  vi.stubEnv('VITE_PREVIEW_ORIGIN', '');
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('the preview host page is inert on the app origin', () => {
  it('GET /preview-sandbox.html on the app host is 404', async () => {
    vi.stubEnv('PREVIEW_ORIGIN', 'https://preview.navbharatai.com');
    const res = await get('navbharatai.com');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('NavBharatAI Preview Sandbox');
  });

  it('a spoofed X-Forwarded-Host cannot make the app host look like the preview host', async () => {
    vi.stubEnv('PREVIEW_ORIGIN', 'https://preview.navbharatai.com');
    const res = await get('navbharatai.com', { 'X-Forwarded-Host': 'preview.navbharatai.com' });
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('ALLOWED_PARENTS');
  });

  it('is 404 until PREVIEW_ORIGIN is set, even when Host is the preview hostname', async () => {
    const res = await get('preview.navbharatai.com');
    expect(res.status).toBe(404);
  });

  it('the preview host gets the file and a frame-ancestors CSP that replaced Helmet', async () => {
    vi.stubEnv('PREVIEW_ORIGIN', 'https://preview.navbharatai.com');
    const res = await get('preview.navbharatai.com');
    expect(res.status).toBe(200);
    expect(res.body).toContain('ALLOWED_PARENTS');
    expect(res.csp).toContain('frame-ancestors https://navbharatai.com');
    expect(res.csp).toBe(`frame-ancestors ${APP_ORIGINS.join(' ')}`);
    // Helmet's policy was replaced, not left in place. Other Helmet headers stay.
    expect(res.csp).not.toContain("default-src 'self'");
    expect(res.nosniff).toBe('nosniff');
  });

  it('server.ts mounts the gate after Helmet and before static / Vite', () => {
    const serverSrc = readFileSync('server.ts', 'utf8');
    const helmetAt = serverSrc.indexOf('app.use(helmet(securityHeadersConfig))');
    const gateAt = serverSrc.indexOf("app.get('/preview-sandbox.html', previewSandboxGate)");
    const staticAt = serverSrc.indexOf('app.use(express.static(distPath');
    const viteAt = serverSrc.indexOf('app.use(vite.middlewares)');
    expect(helmetAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(helmetAt);
    expect(staticAt).toBeGreaterThan(gateAt);
    expect(viteAt).toBeGreaterThan(gateAt);
  });
});
