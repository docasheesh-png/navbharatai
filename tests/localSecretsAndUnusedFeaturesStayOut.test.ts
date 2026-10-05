// Forensic audit 2026-10-04 (P2) — a developer's `.env` can never be committed or copied into the image,
// and powerful browser features nobody uses are switched off by policy.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import type { AddressInfo } from 'node:net';
import { securityHeadersConfig, permissionsPolicyMiddleware, PERMISSIONS_POLICY } from '../src/server/lib/securityHeaders';

describe('local secret files', () => {
  it('git ignores .env and its variants, but not the committed template', () => {
    const ignored = (f: string) => {
      try { execFileSync('git', ['check-ignore', '-q', f]); return true; } catch { return false; }
    };
    for (const f of ['.env', '.env.local', '.env.production']) expect(ignored(f), f).toBe(true);
    expect(ignored('.env.example')).toBe(false);
  });

  it('the Docker build context excludes them too', () => {
    const di = readFileSync('.dockerignore', 'utf8').split('\n').map((l) => l.trim());
    expect(di).toContain('.env');
    expect(di).toContain('.env.*');
  });
});

describe('Permissions-Policy', () => {
  const app = express();
  app.use(helmet(securityHeadersConfig));
  app.use(permissionsPolicyMiddleware());
  app.get('/', (_q, r) => { r.send('ok'); });
  const server = app.listen(0);
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it('is sent, denies unused features, and never names a feature the previews delegate', async () => {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    const pp = r.headers.get('permissions-policy') ?? '';
    expect(pp).toBe(PERMISSIONS_POLICY);
    for (const f of ['usb=()', 'serial=()', 'hid=()', 'bluetooth=()']) expect(pp).toContain(f);
    for (const delegated of ['camera', 'microphone', 'geolocation', 'payment', 'fullscreen', 'autoplay']) expect(pp).not.toContain(delegated);
  });

  it('production mounts it right after helmet', () => {
    expect(readFileSync('server.ts', 'utf8')).toMatch(/app\.use\(helmet\(securityHeadersConfig\)\);\n\s*app\.use\(permissionsPolicyMiddleware\(\)\);/);
  });
});
