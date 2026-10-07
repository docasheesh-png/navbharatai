/**
 * Q-732 (admin 2026-10-07): "kabhi kabhi (30% time) google login nahi hota hai … login successfully →
 * back to navbharatai → still logout" — web browsers, phone and desktop, no error shown.
 *
 * Root cause: our app-wide `Cross-Origin-Opener-Policy: same-origin-allow-popups` was also sent on the
 * pages that run INSIDE a sign-in popup (Firebase's `/__/auth/handler`, the GitHub callback). In real
 * Chromium that header cut the popup off from the app the moment it navigated to the provider: the app
 * saw it as "closed" after 0.4 s and the return page had no `window.opener`. Firebase then gave up 8 s
 * later and the app treated it as the user's cancel, so anyone who took >10 s to type a password stayed
 * logged out. See `POPUP_RETURN_PATHS` in securityHeaders.ts.
 *
 * This file locks the CLASS: an app page keeps the policy, every popup-return page has none, the proxy
 * cannot put an upstream one back, and a new server page that answers `window.opener` must be listed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import type { Server } from 'http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import {
  securityHeadersConfig, popupReturnOpenerPolicyMiddleware, isPopupReturnPath, withoutOpenerPolicy, POPUP_RETURN_PATHS,
} from '../src/server/lib/securityHeaders';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let server: Server;
let base = '';

beforeAll(async () => {
  // The exact production order: helmet, then the popup-return exemption.
  const app = express();
  app.use(helmet(securityHeadersConfig));
  app.use(popupReturnOpenerPolicyMiddleware());
  app.use((_req, res) => { res.send('ok'); });
  await new Promise<void>((r) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
      r();
    });
  });
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const coopOf = async (path: string) => (await fetch(base + path)).headers.get('cross-origin-opener-policy');

describe('1 · the app keeps its opener policy; a page inside the popup has none', () => {
  it('the app page (the opener) still sends same-origin-allow-popups', async () => {
    expect(await coopOf('/')).toBe('same-origin-allow-popups');
    expect(await coopOf('/settings')).toBe('same-origin-allow-popups');
    expect(await coopOf('/api/auth/github/url')).toBe('same-origin-allow-popups');
  });

  it('Firebase\'s sign-in handler and iframe, and the GitHub callback, send none', async () => {
    for (const p of ['/__/auth/handler', '/__/auth/iframe', '/__/firebase/init.json', '/api/auth/github/callback', '/auth/github', '/api/github/callback', '/api/auth/firebase/callback']) {
      expect(await coopOf(p), p).toBeNull();
    }
  });

  it('a lookalike path is not a popup-return page', () => {
    expect(isPopupReturnPath('/__/authx')).toBe(false);
    expect(isPopupReturnPath('/auth/githubber')).toBe(false);
    expect(isPopupReturnPath('')).toBe(false);
    expect(isPopupReturnPath('/__/auth')).toBe(true);
  });
});

describe('2 · the proxied handler cannot get an opener policy back from upstream', () => {
  it('withoutOpenerPolicy drops it in any letter case and keeps everything else', () => {
    const h = { 'Cross-Origin-Opener-Policy': 'same-origin', 'content-type': 'text/html', 'set-cookie': ['a=1'] };
    expect(withoutOpenerPolicy(h)).toEqual({ 'content-type': 'text/html', 'set-cookie': ['a=1'] });
    expect(withoutOpenerPolicy({ 'cross-origin-opener-policy': 'x' })).toEqual({});
  });

  it('server.ts mounts the exemption after helmet, before the proxy, and strips the proxy response', () => {
    const s = read('server.ts');
    const helmetAt = s.indexOf('app.use(helmet(securityHeadersConfig));');
    const exemptAt = s.indexOf('app.use(popupReturnOpenerPolicyMiddleware());');
    const proxyAt = s.indexOf("app.use('/__/auth', proxyFirebaseAuth);");
    expect(helmetAt).toBeGreaterThan(-1);
    expect(exemptAt).toBeGreaterThan(helmetAt);
    expect(exemptAt).toBeLessThan(proxyAt);
    expect(s).toContain('res.writeHead(pres.statusCode || 502, withoutOpenerPolicy(rewriteProxyHeaders(');
  });
});

describe('3 · census — every server page that answers window.opener is a listed popup-return page', () => {
  // The pages each file serves that post back to `window.opener`. A NEW file with that code fails below
  // until its pages are added here AND to POPUP_RETURN_PATHS.
  const RETURN_PAGES: Record<string, string[]> = {
    'src/server/routes/githubAuth.ts': ['/api/auth/github/callback', '/auth/github', '/api/github/callback'],
    'src/server/routes/firebaseAuth.ts': ['/api/auth/firebase', '/api/auth/firebase/consent', '/api/auth/firebase/callback'],
  };

  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  // Code only: comment lines are dropped, so a note ABOUT window.opener is not a page that uses it.
  const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const answersOpener = [join(ROOT, 'server.ts'), ...walk(join(ROOT, 'src/server'))]
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => /window\.opener\.postMessage\s*\(/.test(code(readFileSync(f, 'utf8'))))
    .map((f) => relative(ROOT, f))
    .sort();

  it('no unlisted file posts to window.opener', () => {
    expect(answersOpener).toEqual(Object.keys(RETURN_PAGES).sort());
  });

  it('every listed page is a real route of its file and is exempt', () => {
    for (const [file, paths] of Object.entries(RETURN_PAGES)) {
      const src = read(file);
      for (const p of paths) {
        expect(src, `${p} in ${file}`).toContain(`'${p}'`);
        expect(isPopupReturnPath(p), p).toBe(true);
      }
    }
    expect(POPUP_RETURN_PATHS).toContain('/__/auth');
  });
});
