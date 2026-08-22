import { describe, it, expect } from 'vitest';
import { canonicalHostRedirect, canonicalHostFromEnv } from './canonicalHost';

/**
 * ADMIN'S BROWSER CONSOLE, 2026-08-22:
 *
 *   POST https://www.navbharatai.com/api/agentv3/chat  401 (Unauthorized)
 *
 * The site answers on BOTH hosts and auth works on only one. `authDomain` is a SINGLE value
 * (`navbharatai.com`), chosen precisely so the auth handler is same-origin with the app. On `www.`
 * that property is gone: the session is partitioned away from the page and every request goes out
 * with no token — 401, on an account that just signed in successfully.
 *
 * That is why "Apple, Google aur GitHub sab band ho gaye" at once, with no error anywhere: from the
 * browser's point of view nothing failed.
 */
const CANON = 'navbharatai.com';
const dec = (host: string | null, url = '/api/agentv3/chat') =>
  canonicalHostRedirect({ host, originalUrl: url, canonical: CANON });

describe('canonicalHostRedirect', () => {
  it('THE REPORTED CASE: www is sent to the canonical host, path and query intact', () => {
    expect(dec('www.navbharatai.com', '/api/agentv3/chat?x=1').redirectTo)
      .toBe('https://navbharatai.com/api/agentv3/chat?x=1');
  });

  it('🔒 308, NOT 301 — a 301 turns a POST into a GET and silently drops the body', () => {
    // That would be a far worse bug than the one being fixed: an API call that "succeeds" with no data.
    expect(dec('www.navbharatai.com').status).toBe(308);
  });

  it('the canonical host itself is served, never redirected', () => {
    expect(dec('navbharatai.com').redirectTo).toBeNull();
  });

  it('🔒 DELIBERATELY NARROW — anything not recognised is served exactly as before', () => {
    // A rule that rewrote every unexpected host would catch Cloud Run's internal hostname, the health
    // checker, preview revisions and localhost — turning a login bug into an outage.
    for (const h of ['localhost', '127.0.0.1', 'navbharat-ai-prod-abc.a.run.app', 'mitrify.com', 'www.other.com', null, '']) {
      expect(dec(h).redirectTo, String(h)).toBeNull();
    }
  });

  it('handles ports, case and a trailing dot the way a Host header really arrives', () => {
    expect(dec('WWW.NavBharatAI.com:443').redirectTo).toBe('https://navbharatai.com/api/agentv3/chat');
    expect(dec('www.navbharatai.com.').redirectTo).toBe('https://navbharatai.com/api/agentv3/chat');
  });

  it('a junk path never becomes an open redirect', () => {
    // originalUrl must start with '/' or it is replaced — otherwise a crafted value could steer the
    // Location header at another site.
    expect(canonicalHostRedirect({ host: 'www.navbharatai.com', originalUrl: '//evil.com', canonical: CANON }).redirectTo)
      .toBe('https://navbharatai.com//evil.com');   // still OUR host — the path cannot change the origin
    expect(canonicalHostRedirect({ host: 'www.navbharatai.com', originalUrl: 'https://evil.com', canonical: CANON }).redirectTo)
      .toBe('https://navbharatai.com/');
  });

  it('🔒 UNCONFIGURED means OFF — no canonical host, no redirects anywhere', () => {
    expect(canonicalHostRedirect({ host: 'www.navbharatai.com', originalUrl: '/', canonical: '' }).redirectTo).toBeNull();
    expect(canonicalHostFromEnv({} as NodeJS.ProcessEnv)).toBe('');
    expect(canonicalHostFromEnv({ CANONICAL_HOST: ' navbharatai.com ' } as never)).toBe('navbharatai.com');
  });
});
