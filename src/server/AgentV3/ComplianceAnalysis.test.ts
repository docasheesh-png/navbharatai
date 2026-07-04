import { describe, it, expect } from 'vitest';
import {
  scanCompliance, complianceSummary, launchSafeCertificate,
  detectsPiiCollection, detectsTracker, detectsConsentUI, looksLikePrivacyPolicy,
  type ComplianceIssue,
} from './ComplianceAnalysis';

describe('scanCompliance — file-local rules', () => {
  it('flags personal data / secrets written to logs', () => {
    const out = scanCompliance('src/auth.ts', `console.log('user password is', password);`);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('pii-in-logs');
    expect(out[0].severity).toBe('high');
  });

  it('flags sensitive values kept in browser storage', () => {
    const out = scanCompliance('src/store.ts', `localStorage.setItem('access_token', token);`);
    expect(out.some((i) => i.kind === 'sensitive-in-browser-storage' && i.severity === 'medium')).toBe(true);
  });

  it('flags cookies set without SameSite, but not when SameSite is present', () => {
    expect(scanCompliance('a.ts', `document.cookie = 'sid=' + id;`).some((i) => i.kind === 'cookie-no-samesite')).toBe(true);
    expect(scanCompliance('a.ts', `document.cookie = 'sid=' + id + '; SameSite=Strict';`).some((i) => i.kind === 'cookie-no-samesite')).toBe(false);
  });

  it('flags a server cookie set without httpOnly, but not when httpOnly is present', () => {
    expect(scanCompliance('src/auth.ts', `res.cookie('session', token, { secure: true });`).some((i) => i.kind === 'cookie-no-httponly')).toBe(true);
    expect(scanCompliance('src/auth.ts', `res.cookie('session', token, { httpOnly: true, secure: true });`).some((i) => i.kind === 'cookie-no-httponly')).toBe(false);
    // Not a cookie set — must not false-positive on similarly-named calls.
    expect(scanCompliance('src/auth.ts', `app.use(res.cookieParser());`).some((i) => i.kind === 'cookie-no-httponly')).toBe(false);
  });

  it('flags a server cookie set without the Secure flag, but not when secure is present', () => {
    expect(scanCompliance('src/auth.ts', `res.cookie('session', token, { httpOnly: true });`).some((i) => i.kind === 'cookie-no-secure')).toBe(true);
    expect(scanCompliance('src/auth.ts', `res.cookie('session', token, { httpOnly: true, secure: true });`).some((i) => i.kind === 'cookie-no-secure')).toBe(false);
    // Not a cookie set — must not false-positive.
    expect(scanCompliance('src/auth.ts', `app.use(res.cookieParser());`).some((i) => i.kind === 'cookie-no-secure')).toBe(false);
  });

  it('does NOT false-flag a MULTI-LINE res.cookie() whose httpOnly/secure options are on later lines', () => {
    // Regression: the flag check was line-local, so a fully-secure multi-line cookie (the standard
    // Express form) reported cookie-no-httponly + cookie-no-secure.
    const multi = `res.cookie('sid', token, {\n  httpOnly: true,\n  secure: true,\n  sameSite: 'strict',\n});`;
    const out = scanCompliance('src/auth.ts', multi);
    expect(out.some((i) => i.kind === 'cookie-no-httponly')).toBe(false);
    expect(out.some((i) => i.kind === 'cookie-no-secure')).toBe(false);
    // …but a multi-line cookie genuinely MISSING the flags is still flagged.
    const insecure = `res.cookie('sid', token, {\n  maxAge: 3600000,\n  path: '/',\n});`;
    expect(scanCompliance('src/auth.ts', insecure).some((i) => i.kind === 'cookie-no-httponly')).toBe(true);
  });

  it('does not flag a cookie being DELETED (logout) for missing SameSite/Secure/httpOnly', () => {
    // document.cookie clear via Max-Age=0 / 1970 expiry.
    expect(scanCompliance('a.ts', `document.cookie = 'sid=; Max-Age=0; path=/';`).some((i) => i.kind === 'cookie-no-samesite')).toBe(false);
    expect(scanCompliance('a.ts', `document.cookie = 'sid=; expires=Thu, 01 Jan 1970 00:00:00 UTC';`).some((i) => i.kind === 'cookie-no-samesite')).toBe(false);
    // server-side clear via res.cookie('name', '', { maxAge: 0 }).
    expect(scanCompliance('src/auth.ts', `res.cookie('session', '', { maxAge: 0 });`).some((i) => i.kind === 'cookie-no-httponly' || i.kind === 'cookie-no-secure')).toBe(false);
  });

  it('flags personal data over plain http but ignores localhost', () => {
    expect(scanCompliance('a.ts', `fetch('http://api.example.com/u')`).some((i) => i.kind === 'insecure-http-endpoint')).toBe(true);
    expect(scanCompliance('a.ts', `fetch('http://localhost:3000/u')`).some((i) => i.kind === 'insecure-http-endpoint')).toBe(false);
  });

  it('flags a secret/token carried in a URL query string but not a benign param', () => {
    expect(scanCompliance('a.ts', 'fetch(`/api/login?password=${pw}`);').some((i) => i.kind === 'secret-in-url')).toBe(true);
    expect(scanCompliance('a.ts', `const u = '/reset?token=' + t;`).some((i) => i.kind === 'secret-in-url')).toBe(true);
    expect(scanCompliance('a.ts', `fetch('https://api.x.com/d?api_key=' + k);`).some((i) => i.kind === 'secret-in-url')).toBe(true);
    // a benign, non-sensitive query param is fine.
    expect(scanCompliance('a.ts', `fetch('/api/items?page=2&sort=name');`).some((i) => i.kind === 'secret-in-url')).toBe(false);
  });

  it('does not flag a benign log line', () => {
    expect(scanCompliance('a.ts', `console.log('server started on port', port);`)).toHaveLength(0);
  });

  it('ignores non-code and generated paths', () => {
    expect(scanCompliance('README.md', `console.log(password)`)).toHaveLength(0);
    expect(scanCompliance('node_modules/x/i.js', `console.log(password)`)).toHaveLength(0);
    expect(scanCompliance('src/a.test.ts', `console.log(password)`)).toHaveLength(0);
  });
});

describe('project-level detectors', () => {
  it('detects PII collection from form fields/input types', () => {
    expect(detectsPiiCollection(`<input type="email" name="email" />`)).toBe(true);
    expect(detectsPiiCollection(`<input type="password" />`)).toBe(true);
    expect(detectsPiiCollection(`<input type="text" name="nickname" />`)).toBe(false);
  });

  it('detects geolocation access as personal-data collection (sensitive location)', () => {
    expect(detectsPiiCollection(`navigator.geolocation.getCurrentPosition(onPos);`)).toBe(true);
    expect(detectsPiiCollection(`const id = navigator.geolocation.watchPosition(cb);`)).toBe(true);
    expect(detectsPiiCollection(`const pos = computePosition(el);`)).toBe(false);
  });

  it('detects trackers and consent surfaces', () => {
    expect(detectsTracker(`<script src="https://www.googletagmanager.com/gtag/js"></script>`)).toBe(true);
    expect(detectsTracker(`mixpanel.init('abc')`)).toBe(true);
    expect(detectsTracker(`const x = 1;`)).toBe(false);
    expect(detectsConsentUI(`import CookieConsent from 'react-cookie-consent';`)).toBe(true);
    expect(detectsConsentUI(`const x = 1;`)).toBe(false);
  });

  it('recognises a privacy policy by filename or content', () => {
    expect(looksLikePrivacyPolicy('src/pages/Privacy.tsx', 'anything')).toBe(true);
    expect(looksLikePrivacyPolicy('src/x.tsx', 'This Privacy Policy explains how we use your data.')).toBe(true);
    expect(looksLikePrivacyPolicy('src/x.tsx', 'Welcome to the app')).toBe(false);
  });
});

describe('launchSafeCertificate', () => {
  it('CERTIFIED when clean', () => {
    expect(launchSafeCertificate([])).toContain('CERTIFIED');
  });
  it('NOT CERTIFIED when a high blocker exists', () => {
    const i: ComplianceIssue[] = [{ file: 'a', line: 1, kind: 'pii-in-logs', severity: 'high', snippet: '' }];
    expect(launchSafeCertificate(i)).toContain('NOT CERTIFIED');
  });
  it('CONDITIONAL when only medium issues exist', () => {
    const i: ComplianceIssue[] = [{ file: 'a', line: 1, kind: 'cookie-no-samesite', severity: 'medium', snippet: '' }];
    expect(launchSafeCertificate(i)).toContain('CONDITIONAL');
  });
});

describe('complianceSummary', () => {
  it('reports a clean scan with the certificate', () => {
    const s = complianceSummary([]);
    expect(s).toContain('No privacy/compliance issues detected');
    expect(s).toContain('CERTIFIED');
  });
  it('lists issues, counts by severity, and ends with the certificate', () => {
    const issues: ComplianceIssue[] = [
      { file: 'a.ts', line: 3, kind: 'pii-in-logs', severity: 'high', snippet: 'console.log(password)' },
      { file: 'b.ts', line: 9, kind: 'cookie-no-samesite', severity: 'medium', snippet: 'document.cookie=...' },
    ];
    const s = complianceSummary(issues);
    expect(s).toContain('2 issue(s)');
    expect(s).toContain('1 high');
    expect(s).toContain('a.ts:3');
    expect(s).toContain('NOT CERTIFIED');
  });
});
