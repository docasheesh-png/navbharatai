// U-4 (verified recipe modules) — CSRF protection (double-submit cookie, dependency-free, node:crypto).
//
// Any app that authenticates with a COOKIE session is open to CSRF: a malicious site can make the victim's
// browser POST to your app with their session cookie attached, and the browser sends it automatically. The
// standard, stateless defence is the double-submit-cookie pattern: issue a random token in a readable cookie,
// and require every state-changing request to ECHO that token in a header. A cross-origin attacker cannot READ
// the victim's cookie (same-origin policy), so it cannot set the matching header — the request is rejected.
// Two things are always gotten wrong: (1) the compare is done with === (leaks via timing) instead of a
// constant-time compare; (2) the middleware guards GET too (breaks navigation) or forgets to guard PATCH/DELETE.
// This recipe ships issueCsrfToken(res) + a csrfProtection middleware that guards exactly the unsafe methods,
// reads the token from the cookie WITHOUT a cookie-parser dependency, and compares in constant time. Pair it
// with SameSite=Lax/Strict cookies for defence in depth. Dependency-free (node:crypto), no env keys. PURE
// builder; correct and complete — no TODO stubs. Unit-tested.

export interface CsrfConfig {
  files: Record<string, string>;
  instructions: string;
}

const CSRF_SERVER = `import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const COOKIE_NAME = 'csrf_token';
const HEADER_NAME = 'x-csrf-token';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Read one cookie value from the raw Cookie header — no cookie-parser dependency needed.
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

// Constant-time string compare (avoids leaking how many chars matched via timing). Length-safe.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Issue a fresh CSRF token: set it as a readable (NOT httpOnly — the frontend must read it to echo it) cookie
 * and return it so you can also hand it to the client (e.g. render it into the page or a /csrf endpoint). Call
 * on session start / page load. SameSite=Lax + Secure in production narrows the attack surface further.
 */
export function issueCsrfToken(res: Response): string {
  const token = crypto.randomBytes(32).toString('hex');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', COOKIE_NAME + '=' + token + '; Path=/; SameSite=Lax' + secure);
  return token;
}

/**
 * Express middleware: reject a state-changing request (POST/PUT/PATCH/DELETE) unless the '\${HEADER_NAME}'
 * header matches the '\${COOKIE_NAME}' cookie (double-submit). Safe methods (GET/HEAD/OPTIONS) pass through. A
 * cross-origin attacker cannot read the cookie, so cannot forge the header → 403. The frontend reads the
 * cookie and sends it back as the header on every mutating fetch/XHR.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!UNSAFE.has(req.method.toUpperCase())) return next();
  const cookieToken = readCookie(req, COOKIE_NAME);
  const headerToken = (req.headers[HEADER_NAME] || '') as string;
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }
  next();
}
`;

const CSRF_TEST = `import { describe, it, expect, vi } from 'vitest';
import { issueCsrfToken, csrfProtection } from './csrf';

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 0,
    body: undefined as unknown,
    setHeader(k: string, v: string) { headers[k] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
}

describe('csrf', () => {
  it('issues a random token in a readable, SameSite cookie (not httpOnly)', () => {
    const res = mockRes();
    const token = issueCsrfToken(res as never);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const cookie = res.headers['Set-Cookie'];
    expect(cookie).toContain('csrf_token=' + token);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie.toLowerCase()).not.toContain('httponly');
  });

  it('lets safe methods (GET) through without a token', () => {
    const next = vi.fn();
    const res = mockRes();
    csrfProtection({ method: 'GET', headers: {} } as never, res as never, next as never);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('accepts a POST whose header matches the cookie (double-submit)', () => {
    const next = vi.fn();
    const res = mockRes();
    const req = { method: 'POST', headers: { cookie: 'csrf_token=abc123', 'x-csrf-token': 'abc123' } };
    csrfProtection(req as never, res as never, next as never);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a POST with a missing or mismatched token (403), does not call next', () => {
    for (const headers of [
      { cookie: 'csrf_token=abc123', 'x-csrf-token': 'WRONG' },
      { cookie: 'csrf_token=abc123' }, // no header
      { 'x-csrf-token': 'abc123' },     // no cookie
      {},                               // neither
    ]) {
      const next = vi.fn();
      const res = mockRes();
      csrfProtection({ method: 'POST', headers } as never, res as never, next as never);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });
});
`;

const INSTRUCTIONS =
  'CSRF protection (double-submit cookie) wired at server/lib/csrf.ts (no dependency — node:crypto). If your ' +
  'app authenticates with a COOKIE session, guard state-changing routes: app.use(csrfProtection) (or per ' +
  'router), and call issueCsrfToken(res) on session start / page load to set the csrf_token cookie. The ' +
  "frontend reads that cookie and echoes it as the 'x-csrf-token' header on every POST/PUT/PATCH/DELETE " +
  'fetch/XHR; a request whose header does not match the cookie is rejected with 403 (constant-time compare). ' +
  'Safe methods (GET/HEAD/OPTIONS) pass through. Combine with SameSite=Lax/Strict cookies for defence in ' +
  'depth. NOTE: token-in-header APIs (Bearer/JWT, no cookie) do not need this. No API key needed.';

export function generateCsrfIntegration(): CsrfConfig {
  return {
    files: {
      'server/lib/csrf.ts': CSRF_SERVER,
      'server/lib/csrf.test.ts': CSRF_TEST,
    },
    instructions: INSTRUCTIONS,
  };
}
