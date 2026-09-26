import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  appCheckMode, appCheckSiteKey, clientKind, shouldRefuse, classifyAppCheck, isVerifierOutage,
  appCheckGuard, appCheckStats, __resetAppCheckCounts,
} from '../src/server/lib/appCheck';
import { isAppCheckProtected } from '../src/lib/appCheckRoutes';
import {
  shouldAttachAppCheck, tokenWithin, wrapFetchWithAppCheck, fetchAppCheckSiteKey, installAppCheck, APP_CHECK_HEADER,
} from '../src/lib/appCheckClient';
import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED } from '../src/content/legal/privacyPolicy';
import { LEGAL_META } from '../src/content/legal/meta';

/**
 * App Check, slice 1 (admin 2026-09-26: "App Check shuru karo"): the website attaches a token to the
 * routes that spend money; the server verifies and COUNTS it, and refuses nothing unless an admin sets
 * APP_CHECK_MODE=enforce.
 */

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const ORIGIN = 'https://navbharatai.com';

describe('1 · the mode can never lock anybody out by accident', () => {
  it('unset, blank and unreadable all mean monitor', () => {
    for (const v of [undefined, '', '  ', 'enforced', 'on', 'true', 'ENFORCE!']) {
      expect(appCheckMode(env(v === undefined ? {} : { APP_CHECK_MODE: v }))).toBe('monitor');
    }
  });
  it('only the exact words switch it', () => {
    expect(appCheckMode(env({ APP_CHECK_MODE: ' Enforce ' }))).toBe('enforce');
    expect(appCheckMode(env({ APP_CHECK_MODE: 'off' }))).toBe('off');
  });
  it('monitor refuses nothing; enforce refuses only a checked-and-bad or absent token', () => {
    for (const o of ['valid', 'missing', 'invalid', 'unverifiable'] as const) {
      expect(shouldRefuse('monitor', o)).toBe(false);
      expect(shouldRefuse('off', o)).toBe(false);
    }
    expect(shouldRefuse('enforce', 'missing')).toBe(true);
    expect(shouldRefuse('enforce', 'invalid')).toBe(true);
    expect(shouldRefuse('enforce', 'valid')).toBe(false);
    // Our verifier being down is OUR outage, never the user's refusal.
    expect(shouldRefuse('enforce', 'unverifiable')).toBe(false);
  });
});

describe('2 · the site key', () => {
  it('a real-looking key passes, trimmed; junk is treated as unset', () => {
    expect(appCheckSiteKey(env({ APP_CHECK_SITE_KEY: '  6LcAbCdEfGhIjKlMnOpQrStUvWxYz0123456789  ' }))).toBe('6LcAbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    for (const bad of ['', 'your-site-key', '<script>', 'a b c d e f g h i j k l m n o p q r s t']) {
      expect(appCheckSiteKey(env({ APP_CHECK_SITE_KEY: bad }))).toBeNull();
    }
  });
});

describe('3 · only the routes that spend money are guarded', () => {
  const GUARDED = [
    '/api/agentv3/chat', '/api/chat/navbharat', '/api/chat/navbharatai', '/api/image/generate',
    '/api/professional/teacher/chat', '/api/professional/teacher/exam', '/api/professionals/doctor/chat',
    '/api/repo-analyst/chat', '/api/auth/send-otp', '/api/agentv3/chat?x=1',
  ];
  it.each(GUARDED)('POST %s is guarded', (p) => expect(isAppCheckProtected('POST', p)).toBe(true));
  it.each([
    ['GET', '/api/agentv3/chat'],                  // a navigation cannot carry a header
    ['POST', '/api/chat/completions'],             // the Developer API — outside servers, API-key auth
    ['POST', '/api/payment/webhook'],              // Cashfree's server
    ['POST', '/api/bots/telegram/webhook/abc'],
    ['POST', '/api/share'],
    ['GET', '/api/auth/firebase/callback'],
    ['POST', '/api/agentv3/chat/extra'],
    ['POST', '/api/professional/a/b/chat'],
  ])('%s %s is NOT guarded', (m, p) => expect(isAppCheckProtected(m, p)).toBe(false));

  it('every guarded route is a route the server really registers (a rename must fail here, not in prod)', () => {
    const sources = [
      'src/server/routes/agentv3.ts', 'src/server/routes/chat.ts', 'src/server/routes/imageGen.ts',
      'src/server/routes/auth.ts', 'src/server/routes/repoAnalyst.ts',
    ].map((f) => readFileSync(f, 'utf8')).join('\n') + readAll('src/server/professionals') + readAll('src/server/routes');
    for (const route of ['/api/agentv3/chat', '/api/chat/navbharat', '/api/chat/navbharatai', '/api/image/generate',
      '/api/professional/:id/chat', '/api/professional/:id/exam', '/api/professionals/:id/chat', '/api/repo-analyst/chat', '/api/auth/send-otp']) {
      expect(sources, route).toContain(`'${route}'`);
    }
  });
});

function readAll(dir: string): string {
  let out = '';
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) continue;
    if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out += readFileSync(p, 'utf8');
  }
  return out;
}

describe('4 · verifying a token', () => {
  it('missing, valid, invalid and our own outage are four different answers', async () => {
    expect(await classifyAppCheck(undefined, async () => {})).toBe('missing');
    expect(await classifyAppCheck('tok', async () => {})).toBe('valid');
    expect(await classifyAppCheck('tok', async () => { throw new Error('Decoding App Check token failed'); })).toBe('invalid');
    expect(await classifyAppCheck('tok', async () => { throw new Error('fetch failed: ECONNRESET'); })).toBe('unverifiable');
    expect(await classifyAppCheck('x'.repeat(5000), async () => {})).toBe('invalid');
  });
  it('an outage is recognised by its shape', () => {
    expect(isVerifierOutage(new Error('getaddrinfo ENOTFOUND firebaseappcheck.googleapis.com'))).toBe(true);
    expect(isVerifierOutage(new Error('The provided App Check token has expired.'))).toBe(false);
  });
  it('the phone apps are told apart from the website by their WebView origin', () => {
    expect(clientKind('capacitor://localhost')).toBe('native');
    expect(clientKind('https://localhost')).toBe('native');
    expect(clientKind('https://navbharatai.com')).toBe('web');
    expect(clientKind(undefined)).toBe('web');
  });
});

describe('5 · the middleware', () => {
  beforeEach(() => __resetAppCheckCounts());
  const run = async (opts: { mode?: string; path?: string; method?: string; token?: string; origin?: string; verify?: () => Promise<void> }) => {
    const verify = vi.fn(opts.verify ?? (async () => {}));
    const guard = appCheckGuard({ verify, env: env(opts.mode ? { APP_CHECK_MODE: opts.mode } : {}) });
    const req = {
      method: opts.method ?? 'POST', path: opts.path ?? '/api/agentv3/chat',
      headers: { ...(opts.token ? { 'x-firebase-appcheck': opts.token } : {}), ...(opts.origin ? { origin: opts.origin } : {}) },
    };
    let status = 0; let body: unknown = null; const next = vi.fn();
    const res = { status: (s: number) => { status = s; return { json: (b: unknown) => { body = b; } }; } };
    await guard(req as never, res as never, next);
    return { status, body, next, verify };
  };

  it('monitor (the default) never refuses, and counts', async () => {
    const r = await run({});
    expect(r.next).toHaveBeenCalled();
    expect(r.status).toBe(0);
    expect(appCheckStats(env({})).web.missing).toBe(1);
  });
  it('an unguarded route is passed straight through without reading anything', async () => {
    const r = await run({ path: '/api/payment/webhook', mode: 'enforce' });
    expect(r.next).toHaveBeenCalled();
    expect(r.verify).not.toHaveBeenCalled();
  });
  it('enforce refuses a missing token with a generic message', async () => {
    const r = await run({ mode: 'enforce' });
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toMatch(/app ?check|recaptcha|firebase|token/i);
  });
  it('enforce lets a valid token through, and lets OUR outage through too', async () => {
    expect((await run({ mode: 'enforce', token: 't' })).next).toHaveBeenCalled();
    expect((await run({ mode: 'enforce', token: 't', verify: async () => { throw new Error('socket hang up'); } })).next).toHaveBeenCalled();
  });
  it('native and web are counted apart, so enforcement can be judged per surface', async () => {
    await run({ origin: 'capacitor://localhost' });
    await run({ token: 't' });
    const s = appCheckStats(env({}));
    expect(s.native.missing).toBe(1);
    expect(s.web.valid).toBe(1);
    expect(s.scope).toMatch(/instance/);
  });
});

describe('6 · the browser half can never stop a request', () => {
  it('attaches only to our own origin and only to guarded routes', () => {
    expect(shouldAttachAppCheck('/api/agentv3/chat', 'POST', ORIGIN)).toBe(true);
    expect(shouldAttachAppCheck(`${ORIGIN}/api/image/generate`, 'post', ORIGIN)).toBe(true);
    expect(shouldAttachAppCheck('https://evil.example/api/agentv3/chat', 'POST', ORIGIN)).toBe(false);
    expect(shouldAttachAppCheck('/api/wallet', 'POST', ORIGIN)).toBe(false);
    expect(shouldAttachAppCheck('/api/agentv3/chat', 'GET', ORIGIN)).toBe(false);
  });

  it('a guarded request carries the header; others are untouched', async () => {
    const real = vi.fn(async () => new Response('ok'));
    const f = wrapFetchWithAppCheck(real as never, async () => 'TOKEN', ORIGIN);
    await f('/api/agentv3/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const init = real.mock.calls[0][1] as RequestInit;
    const h = new Headers(init.headers);
    expect(h.get(APP_CHECK_HEADER)).toBe('TOKEN');
    expect(h.get('Content-Type')).toBe('application/json');
    await f('/api/wallet', { method: 'POST' });
    expect(real.mock.calls[1][1]).toEqual({ method: 'POST' });
  });

  it('a slow or failing token source sends the request without it', async () => {
    const real = vi.fn(async () => new Response('ok'));
    const never = () => new Promise<string>(() => {});
    expect(await tokenWithin(never, 20)).toBeNull();
    const f = wrapFetchWithAppCheck(real as never, async () => { throw new Error('reCAPTCHA blocked'); }, ORIGIN);
    await f('/api/chat/navbharat', { method: 'POST' });
    expect(real).toHaveBeenCalledTimes(1);
    expect(new Headers((real.mock.calls[0][1] as RequestInit).headers).get(APP_CHECK_HEADER)).toBeNull();
  });

  it('reads the site key and treats any failure as "off"', async () => {
    const ok = async () => new Response(JSON.stringify({ appCheckSiteKey: 'k'.repeat(30) }), { status: 200 });
    expect(await fetchAppCheckSiteKey(ok as never)).toBe('k'.repeat(30));
    expect(await fetchAppCheckSiteKey((async () => new Response('{}')) as never)).toBeNull();
    expect(await fetchAppCheckSiteKey((async () => { throw new Error('offline'); }) as never)).toBeNull();
  });

  it('never starts in the phone apps, and never starts without a key', async () => {
    const base = { location: { origin: ORIGIN }, fetch: (async () => new Response('{"appCheckSiteKey":null}')) as never };
    expect(await installAppCheck({ ...base, Capacitor: { isNativePlatform: () => true } })).toBe('native');
    expect(await installAppCheck(base)).toBe('no-key');
  });

  it('main.tsx starts it without awaiting it', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/\n\s*void installAppCheck\(\);/);
  });
});

describe('7 · the privacy policy says what reCAPTCHA does', () => {
  it('discloses it, names Google, and says what we receive', () => {
    expect(PRIVACY_POLICY).toContain('### 3.3 Bot protection on the website (Google reCAPTCHA Enterprise)');
    expect(PRIVACY_POLICY).toMatch(/Our server receives only the token and whether it is valid/);
    expect(PRIVACY_POLICY).toMatch(/Bot protection: Google reCAPTCHA Enterprise/);
  });
  it('the Settings tile shows the same date as the policy page', () => {
    expect(LEGAL_META.find((m) => m.id === 'legal_privacy')?.updated).toBe(PRIVACY_POLICY_UPDATED);
  });
});
