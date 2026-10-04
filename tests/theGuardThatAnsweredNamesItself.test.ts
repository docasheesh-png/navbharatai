// THE GUARD THAT ANSWERED NAMES ITSELF — queue Q-013 (iOS build 105, admin screenshot 2026-10-01).
//
// App Mart on an iPhone was answered with an `{ error }` body instead of the store status. The crash it
// caused is fixed (Q-012), but WHICH guard sent the body stayed unknown: the route and its helpers
// cannot throw, App Check guards only POST money routes, so the candidates are the adaptive bot guard's
// 429 and the global 500 handler. The 500 handler already reports itself; the adaptive guard's blocks
// were silent, and the phone's sentence reached only the phone's screen.
//
// Two locks, each proven by reversion:
//   §1 the adaptive guard records the START of every hard block in the error tracker (the admin
//      Errors view), naming the reason, the request and the client kind, and never the IP;
//   §2 App Mart sends the sentence it shows the user to `/api/logs/error`, once per screen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockReport } from '../src/server/lib/adaptiveRateLimit';
import { storeStatusReport } from '../src/components/ide/appMart/storeStatus';

const ROOT = join(__dirname, '..');
const code = (p: string) => readFileSync(join(ROOT, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('§1 the adaptive guard reports a block it starts', () => {
  it('names a burst, the request that tipped it and the client', () => {
    const r = blockReport({ reason: 'burst', method: 'GET', path: '/api/nav-store/status', userAgent: IPHONE_UA, requestsInWindow: 121, windowMs: 10_000, blockMs: 60_000 });
    expect(r.message).toBe('Adaptive guard blocked a caller for 60s (121 requests in 10s from one address); the request that tipped it: GET /api/nav-store/status');
    expect(r.meta).toMatchObject({ guard: 'adaptive-rate-limit', reason: 'burst', userAgent: IPHONE_UA });
  });

  it('names an automated User-Agent, and an empty one honestly', () => {
    const r = blockReport({ reason: 'bot-user-agent', method: 'POST', path: '/api/chat', userAgent: '', requestsInWindow: 3, windowMs: 10_000, blockMs: 60_000 });
    expect(r.message).toContain('its User-Agent looks automated');
    expect(r.meta.userAgent).toBe('(none)');
  });

  it('never carries an address, and caps a long User-Agent', () => {
    const r = blockReport({ reason: 'burst', method: 'GET', path: '/api/x', userAgent: 'a'.repeat(1000), requestsInWindow: 200, windowMs: 10_000, blockMs: 60_000 });
    expect(String(r.meta.userAgent).length).toBe(160);
    expect(JSON.stringify(r)).not.toMatch(/\bip\b|address":/i);
  });

  it('the middleware captures the report where it starts the block (reversion lock)', () => {
    const src = code('src/server/lib/adaptiveRateLimit.ts');
    const start = src.indexOf('state.blockedUntil = now + blockMs;');
    expect(start).toBeGreaterThan(0);
    const after = src.slice(start, start + 900);
    expect(after).toContain('blockReport(');
    expect(after).toContain('errorTracker.capture(');
  });
});

describe('§2 App Mart reports a status it could not read', () => {
  it('carries the HTTP status, the sentence and the platform', () => {
    const r = storeStatusReport(429, 'Too many automated requests. Try again in 60s.', 'ios');
    expect(r).toEqual({
      message: 'App Mart could not read the store status (HTTP 429): Too many automated requests. Try again in 60s.',
      type: 'store-status-unreadable',
      source: 'app-mart/ios',
    });
  });

  it('says so when there was no HTTP status, and defaults the platform to web', () => {
    const r = storeStatusReport(undefined, 'x', null);
    expect(r.message).toContain('(no HTTP status)');
    expect(r.source).toBe('app-mart/web');
  });

  it('the screen sends it to the error log, once (reversion lock)', () => {
    const src = code('src/components/ide/NavAppStore.tsx');
    const at = src.indexOf('storeStatusReport(res.status, read.problem');
    expect(at).toBeGreaterThan(0);
    const around = src.slice(Math.max(0, at - 600), at + 200);
    expect(around).toContain("fetch('/api/logs/error'");
    expect(around).toContain('statusReportedRef.current');
  });
});
