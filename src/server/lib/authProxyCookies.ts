// COOKIES THAT SURVIVE THE AUTH REVERSE-PROXY — the one-line thing that silently breaks a redirect login.
//
// 🔒 WHY THIS EXISTS (admin, 2026-08-22: "Apple login: Apple par login ho jata hai, wapas navbharatai
// par aao to phir bhi logged out — bar bar").
//
// `authDomain` is our OWN origin (navbharatai.com) so the redirect flow is same-origin, and server.ts
// reverse-proxies `/__/auth/*` to the project's real `*.firebaseapp.com` host. That proxy streams the
// upstream response back untouched — INCLUDING its `Set-Cookie` headers.
//
// A cookie carrying `Domain=gen-lang-client-…firebaseapp.com` is one the browser MUST reject when it
// arrives from navbharatai.com: a site may only set cookies for its own domain. So the handler thinks
// it stored its state, the browser silently drops it, the return leg finds nothing, and the app loads
// logged out — with no error anywhere, because nothing actually failed. That silence is why the loop
// repeats identically forever.
//
// Stripping `Domain=` is the correct fix for a reverse proxy, not a workaround: a cookie with no
// Domain attribute binds to the host that served it — which, from the browser's point of view, IS
// navbharatai.com. It is also strictly narrower than any Domain form (no subdomain sharing), so it
// cannot widen a cookie's reach.
//
// ⚠️ WHY THIS DID NOT BREAK GOOGLE: Google uses the POPUP flow, whose handler lives in a window we
// opened and hands the result back by postMessage — it never depends on a cookie surviving a
// cross-site return. Only Apple takes the redirect path (see webSignInStrategy), which is exactly the
// asymmetry the admin reported.
//
// PURE — no I/O, so every rule here is unit-testable.

/**
 * Rewrite one upstream `Set-Cookie` value so the browser will actually keep it.
 *
 * Two changes, both conservative:
 *  1. `Domain=<upstream host>` is REMOVED — the cookie then binds to the host that served it (ours).
 *     A Domain that already matches our own host is left alone; there is nothing to fix.
 *  2. Nothing else is touched. Path, Max-Age, HttpOnly, Secure and SameSite are the upstream's
 *     decisions and re-deciding them here would be guessing on Firebase's behalf.
 *
 * PURE.
 */
export function rewriteAuthCookieDomain(cookie: string, ourHost: string): string {
  const raw = String(cookie ?? '');
  if (!raw) return raw;
  const host = String(ourHost ?? '').trim().toLowerCase().replace(/^\./, '');
  return raw
    .split(';')
    .filter((part) => {
      const m = part.trim().match(/^domain\s*=\s*(.+)$/i);
      if (!m) return true;                       // not a Domain attribute — keep it
      const domain = m[1].trim().toLowerCase().replace(/^\./, '');
      // A Domain that IS our host (or a parent of it) would be honoured by the browser — leave it.
      if (host && (domain === host || host.endsWith(`.${domain}`))) return true;
      return false;                              // a foreign Domain — drop the attribute
    })
    .join(';');
}

/**
 * Apply the rewrite across every `Set-Cookie` on a proxied response. Node gives this header as a
 * string[] (or a bare string, or nothing at all), so all three shapes are handled rather than assumed.
 * Returns the headers object to pass to `writeHead`. PURE — the input is never mutated.
 */
export function rewriteProxyHeaders<T extends Record<string, unknown>>(headers: T, ourHost: string): T {
  const sc = (headers as Record<string, unknown>)['set-cookie'];
  if (sc === undefined || sc === null) return headers;
  const rewritten = Array.isArray(sc)
    ? sc.map((c) => rewriteAuthCookieDomain(String(c), ourHost))
    : rewriteAuthCookieDomain(String(sc), ourHost);
  return { ...headers, 'set-cookie': rewritten };
}
