import { describe, it, expect } from 'vitest';
import { rewriteAuthCookieDomain, rewriteProxyHeaders } from './authProxyCookies';

/**
 * ADMIN, 2026-08-22: "Apple login — Apple par login successfully ho jata hai, wapas NavBharatAI par
 * aao to phir bhi logged out. Bar bar."
 *
 * The auth reverse-proxy streams the upstream response back untouched, `Set-Cookie` included. A cookie
 * carrying `Domain=…firebaseapp.com` is one the browser MUST reject when it arrives from
 * navbharatai.com — a site may only set cookies for its own domain. The handler believes it stored its
 * state, the browser silently drops it, the return finds nothing, and the app loads logged out with no
 * error anywhere. Nothing "fails", which is why the loop repeats identically forever.
 *
 * Google was unaffected because it takes the POPUP path, which hands the result back by postMessage and
 * never needs a cookie to survive a cross-site return — exactly the asymmetry that was reported.
 */
const OURS = 'navbharatai.com';

describe('rewriteAuthCookieDomain', () => {
  it('THE CASE THAT STARTED THIS: a foreign Domain is dropped so the browser keeps the cookie', () => {
    const out = rewriteAuthCookieDomain(
      'firebaseSession=abc; Domain=gen-lang-client-0866594388.firebaseapp.com; Path=/; Secure; HttpOnly',
      OURS,
    );
    expect(out).not.toMatch(/domain=/i);
    expect(out).toContain('firebaseSession=abc');
  });

  it('🔒 keeps every other attribute exactly as upstream set it', () => {
    // Path, Secure, HttpOnly and SameSite are Firebase's decisions. Re-deciding them here would be
    // guessing on the SDK's behalf, and a wrong SameSite is its own silent login failure.
    const out = rewriteAuthCookieDomain(
      'x=1; Domain=other.example.com; Path=/__/auth; Max-Age=600; Secure; HttpOnly; SameSite=None',
      OURS,
    );
    for (const attr of ['Path=/__/auth', 'Max-Age=600', 'Secure', 'HttpOnly', 'SameSite=None']) {
      expect(out).toContain(attr);
    }
  });

  it('leaves a Domain that the browser would ALREADY honour', () => {
    // Nothing is broken in these cases, so nothing is changed — a rewrite that fires when it need not
    // is just a second way to introduce a bug.
    expect(rewriteAuthCookieDomain('x=1; Domain=navbharatai.com', OURS)).toMatch(/Domain=navbharatai\.com/i);
    expect(rewriteAuthCookieDomain('x=1; Domain=.navbharatai.com', OURS)).toMatch(/Domain=\.navbharatai\.com/i);
  });

  it('a cookie with no Domain at all is untouched — it already binds to us', () => {
    const c = 'x=1; Path=/; Secure';
    expect(rewriteAuthCookieDomain(c, OURS)).toBe(c);
  });

  it('handles junk without throwing', () => {
    expect(rewriteAuthCookieDomain('', OURS)).toBe('');
    expect(rewriteAuthCookieDomain(undefined as never, OURS)).toBe('');
    expect(rewriteAuthCookieDomain('x=1; Domain=foo.com', '')).not.toMatch(/domain=/i);
  });
});

describe('rewriteProxyHeaders', () => {
  it('rewrites every cookie in the array Node actually gives us', () => {
    const headers = {
      'content-type': 'text/html',
      'set-cookie': ['a=1; Domain=up.example.com', 'b=2; Domain=up.example.com; Secure'],
    };
    const out = rewriteProxyHeaders(headers, OURS);
    expect((out['set-cookie'] as string[]).every((c) => !/domain=/i.test(c))).toBe(true);
    expect(out['content-type']).toBe('text/html');
  });

  it('handles the bare-string and absent shapes too, and never mutates the input', () => {
    const one = { 'set-cookie': 'a=1; Domain=up.example.com' };
    expect(rewriteProxyHeaders(one, OURS)['set-cookie']).not.toMatch(/domain=/i);
    expect(one['set-cookie']).toMatch(/domain=/i);          // original untouched
    const none = { 'content-type': 'text/html' };
    expect(rewriteProxyHeaders(none, OURS)).toBe(none);      // nothing to do ⇒ same object
  });
});
