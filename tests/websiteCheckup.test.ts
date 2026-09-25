import { describe, it, expect } from 'vitest';
import {
  analyzeCheckup,
  analyzeHeaders,
  analyzeHttps,
  analyzeCookies,
  analyzeExposedSecrets,
  analyzeMixedContent,
  analyzeHygiene,
  summarizeCheckup,
  decideCheckupAccess,
  type CheckupFetch,
} from '../src/server/lib/websiteCheckup';
import type { DeploymentRecord } from '../src/server/AgentV3/DeploymentStore';

function record(over: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return { workspaceId: 'ws1', userId: 'user-A', url: 'https://a-abc.mitrify.in/', fileCount: 3, updatedAt: 1, status: 'active', ...over };
}

const CHECKED_AT = '2026-09-25T00:00:00.000Z';

/** A healthy, fully-configured HTTPS page, so each test overrides only what it needs. */
function healthyFetch(over: Partial<CheckupFetch> = {}): CheckupFetch {
  return {
    ok: true,
    finalUrl: 'https://a-abc.mitrify.in/',
    requestedUrl: 'https://a-abc.mitrify.in/',
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    },
    setCookies: [],
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>My Shop</title></head><body>hi</body></html>',
    requestedHttp: false,
    redirectedToHttps: false,
    ...over,
  };
}

describe('websiteCheckup — OWNERSHIP (your sites only)', () => {
  it('allows the owner of a live deployment, returning its url', () => {
    const a = decideCheckupAccess(record(), 'user-A');
    expect(a).toEqual({ ok: true, url: 'https://a-abc.mitrify.in/' });
  });

  it('REFUSES another user, even with a valid live record', () => {
    const a = decideCheckupAccess(record({ userId: 'user-A' }), 'user-B');
    expect(a.ok).toBe(false);
  });

  it('refuses a missing record', () => {
    expect(decideCheckupAccess(null, 'user-A').ok).toBe(false);
    expect(decideCheckupAccess(undefined, 'user-A').ok).toBe(false);
  });

  it('refuses an anonymous / empty uid', () => {
    expect(decideCheckupAccess(record(), '').ok).toBe(false);
    expect(decideCheckupAccess(record(), null).ok).toBe(false);
  });

  it('refuses a non-live deployment (held / taken down / no url)', () => {
    expect(decideCheckupAccess(record({ status: 'held' }), 'user-A').ok).toBe(false);
    expect(decideCheckupAccess(record({ status: 'taken_down' }), 'user-A').ok).toBe(false);
    expect(decideCheckupAccess(record({ url: '' }), 'user-A').ok).toBe(false);
  });

  it('the refusal reason never reveals whose site it is', () => {
    const a = decideCheckupAccess(record({ userId: 'someone-else' }), 'user-B');
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).not.toContain('someone-else');
  });
});

describe('websiteCheckup — HTTPS', () => {
  it('reports HTTPS as good', () => {
    const f = analyzeHttps(healthyFetch());
    expect(f.some((x) => x.id === 'https-on' && x.severity === 'good')).toBe(true);
  });

  it('flags a plain-http site as critical', () => {
    const f = analyzeHttps(healthyFetch({ finalUrl: 'http://a-abc.mitrify.in/', requestedHttp: true }));
    const hit = f.find((x) => x.id === 'https-off');
    expect(hit?.severity).toBe('critical');
    expect(hit?.fix).toBeTruthy();
  });
});

describe('websiteCheckup — exposed secrets (the false-positive guard)', () => {
  it('does NOT flag a public Firebase web apiKey (AIza…) — it is meant to ship in client code', () => {
    const body = 'const firebaseConfig = { apiKey: "AIzaSyD-EXAMPLE-KEY-1234567890abcdef", authDomain: "x.firebaseapp.com" };';
    const f = analyzeExposedSecrets(healthyFetch({ body }));
    expect(f).toHaveLength(0);
  });

  it('flags a real Stripe secret key as critical', () => {
    // Assembled from fragments so no scannable secret literal exists in this file (it is a made-up
    // value used only to exercise the detector; GitHub push-protection flags the contiguous form).
    const fakeStripe = 'sk_' + 'live_' + '0123456789abcdefABCDEF9999';
    const body = `const k = "${fakeStripe}";`;
    const f = analyzeExposedSecrets(healthyFetch({ body }));
    expect(f[0]?.severity).toBe('critical');
    expect(f[0]?.id).toBe('exposed-secret');
  });

  it('flags an AWS access key id', () => {
    const fakeAws = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const f = analyzeExposedSecrets(healthyFetch({ body: fakeAws }));
    expect(f[0]?.severity).toBe('critical');
  });

  it('flags an inline private key block', () => {
    const fakeKey = '-----BEGIN ' + 'PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
    const f = analyzeExposedSecrets(healthyFetch({ body: fakeKey }));
    expect(f[0]?.severity).toBe('critical');
  });

  it('a clean page reports no secret finding', () => {
    expect(analyzeExposedSecrets(healthyFetch())).toHaveLength(0);
  });
});

describe('websiteCheckup — security headers', () => {
  it('reports each present header as good', () => {
    const f = analyzeHeaders(healthyFetch());
    expect(f.some((x) => x.id === 'hdr-hsts-ok' && x.severity === 'good')).toBe(true);
    expect(f.some((x) => x.id === 'hdr-xcto-ok')).toBe(true);
    expect(f.some((x) => x.id === 'hdr-frame-ok')).toBe(true);
  });

  it('flags missing HSTS and nosniff', () => {
    const f = analyzeHeaders(healthyFetch({ headers: { 'content-type': 'text/html' } }));
    expect(f.some((x) => x.id === 'hdr-hsts' && x.severity === 'warn')).toBe(true);
    expect(f.some((x) => x.id === 'hdr-xcto' && x.severity === 'warn')).toBe(true);
  });

  it('accepts a CSP frame-ancestors in place of X-Frame-Options', () => {
    const f = analyzeHeaders(healthyFetch({
      headers: { 'content-type': 'text/html', 'content-security-policy': "frame-ancestors 'none'" },
    }));
    expect(f.some((x) => x.id === 'hdr-frame-ok')).toBe(true);
  });

  it('a CSP without frame-ancestors does NOT satisfy the framing check', () => {
    const f = analyzeHeaders(healthyFetch({
      headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'" },
    }));
    expect(f.some((x) => x.id === 'hdr-frame' && x.severity === 'warn')).toBe(true);
  });

  it('notes version leakage as info only', () => {
    const f = analyzeHeaders(healthyFetch({ headers: { 'content-type': 'text/html', 'x-powered-by': 'Express 4.18.2' } }));
    const hit = f.find((x) => x.id === 'hdr-version-leak');
    expect(hit?.severity).toBe('info');
  });
});

describe('websiteCheckup — cookies', () => {
  it('flags a cookie missing safety flags', () => {
    const f = analyzeCookies(healthyFetch({ setCookies: ['session=abc123; Path=/'] }));
    expect(f[0]?.id).toBe('cookies-weak');
    expect(f[0]?.severity).toBe('warn');
  });

  it('accepts a fully-flagged cookie', () => {
    const f = analyzeCookies(healthyFetch({ setCookies: ['session=abc; Path=/; Secure; HttpOnly; SameSite=Lax'] }));
    expect(f[0]?.id).toBe('cookies-ok');
  });

  it('no cookies → no finding', () => {
    expect(analyzeCookies(healthyFetch())).toHaveLength(0);
  });
});

describe('websiteCheckup — mixed content', () => {
  it('flags http:// resources on an https page', () => {
    const body = '<img src="http://cdn.example.com/logo.png"><script src="https://ok.com/a.js"></script>';
    const f = analyzeMixedContent(healthyFetch({ body }));
    expect(f[0]?.id).toBe('mixed-content');
    expect(f[0]?.severity).toBe('warn');
  });

  it('a clean https page reports good', () => {
    const f = analyzeMixedContent(healthyFetch({ body: '<img src="https://cdn.example.com/logo.png">' }));
    expect(f[0]?.id).toBe('mixed-content-ok');
  });

  it('does not run on a plain-http page (nothing to compare against)', () => {
    expect(analyzeMixedContent(healthyFetch({ finalUrl: 'http://x/', body: '<img src="http://y/z">' }))).toHaveLength(0);
  });
});

describe('websiteCheckup — hygiene', () => {
  it('rewards title + viewport + charset', () => {
    const f = analyzeHygiene(healthyFetch());
    expect(f.some((x) => x.id === 'has-title')).toBe(true);
    expect(f.some((x) => x.id === 'has-viewport')).toBe(true);
    expect(f.some((x) => x.id === 'has-charset')).toBe(true);
  });

  it('flags a missing title and viewport', () => {
    const f = analyzeHygiene(healthyFetch({ body: '<!doctype html><html><head></head><body>hi</body></html>' }));
    expect(f.some((x) => x.id === 'no-title' && x.severity === 'warn')).toBe(true);
    expect(f.some((x) => x.id === 'no-viewport' && x.severity === 'warn')).toBe(true);
  });

  it('does not run hygiene checks on a non-HTML response', () => {
    const f = analyzeHygiene(healthyFetch({ headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }));
    expect(f).toHaveLength(0);
  });
});

describe('websiteCheckup — grade + summary', () => {
  it('a critical finding grades at-risk', () => {
    const { grade } = summarizeCheckup([{ id: 'x', severity: 'critical', title: 't', detail: 'd' }]);
    expect(grade).toBe('at-risk');
  });

  it('an all-good checkup grades excellent', () => {
    const { grade, summary } = summarizeCheckup([{ id: 'g', severity: 'good', title: 't', detail: 'd' }]);
    expect(grade).toBe('excellent');
    expect(summary).toContain('NavBharatAI');
  });

  it('three-plus warnings grade needs-attention', () => {
    const w = { severity: 'warn' as const, title: 't', detail: 'd' };
    const { grade } = summarizeCheckup([{ id: '1', ...w }, { id: '2', ...w }, { id: '3', ...w }]);
    expect(grade).toBe('needs-attention');
  });
});

describe('websiteCheckup — assembly + white-label', () => {
  it('an unreachable site is graded, not thrown', () => {
    const r = analyzeCheckup({
      ok: false, error: 'The site took too long to respond.',
      finalUrl: 'https://x/', requestedUrl: 'https://x/', status: 0, headers: {}, setCookies: [], body: '',
      requestedHttp: false, redirectedToHttps: false,
    }, CHECKED_AT);
    expect(r.grade).toBe('unreachable');
    expect(r.findings).toHaveLength(0);
  });

  it('orders findings worst-first and counts them', () => {
    const r = analyzeCheckup(healthyFetch({
      finalUrl: 'http://x/', requestedHttp: true, headers: { 'content-type': 'text/html' },
      body: '<html><head></head><body></body></html>',
    }), CHECKED_AT);
    expect(r.findings[0]?.severity).toBe('critical'); // https-off leads
    expect(r.counts.critical).toBeGreaterThanOrEqual(1);
  });

  it('never leaks a third-party vendor or model name in any finding text', () => {
    const r = analyzeCheckup(healthyFetch({ setCookies: ['s=1'] }), CHECKED_AT);
    const blob = JSON.stringify(r).toLowerCase();
    for (const banned of ['claude', 'anthropic', 'sonnet', 'opus', 'gemini', 'grok', 'kimi', 'glm', 'openai', 'firebase hosting vendor']) {
      expect(blob).not.toContain(banned);
    }
  });
});
