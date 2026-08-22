// ONE HOST, OR AUTH CANNOT WORK — the split-brain that logged everyone out.
//
// 🔒 ROOT CAUSE (admin's browser console, 2026-08-22):
//
//     POST https://www.navbharatai.com/api/agentv3/chat  401 (Unauthorized)
//
// The site answers on BOTH `navbharatai.com` and `www.navbharatai.com`, and auth only works on one of
// them. `authDomain` is a SINGLE value (`navbharatai.com` — see src/config/firebase.ts), chosen
// precisely so the auth handler is SAME-ORIGIN with the app; that is the property the whole redirect
// flow depends on. Open the site on `www.` and the handler is suddenly cross-origin, the session is
// partitioned away from the page, and every request goes out without a token: 401, on an account that
// just signed in successfully.
//
// That is why it looked like every provider broke at once. Apple loops forever (its redirect returns
// to a host that cannot hold the session), and Google/GitHub "stop working" the moment the user is on
// the www host — with no error, because from the browser's point of view nothing failed.
//
// The fix is one canonical origin. This is not a preference about URLs: with two hosts, cookies,
// sessions, storage and caches all silently fork, and every one of those forks is a bug someone will
// eventually report as something else.
//
// PURE — the decision only; the middleware that acts on it lives in server.ts.

export interface CanonicalDecision {
  /** Redirect to this absolute URL, or null to serve the request as-is. */
  redirectTo: string | null;
  /**
   * 308, not 301: a permanent redirect that PRESERVES the method and body. A 301 turns a POST into a
   * GET, which would silently drop an API call's payload — a far worse bug than the one being fixed.
   */
  status: 308;
}

export interface CanonicalInput {
  /** The `Host` header as received (may include a port). */
  host: string | null | undefined;
  /** The path + query, e.g. `/api/agentv3/chat?x=1`. */
  originalUrl: string;
  /** The canonical host we want everything on, e.g. `navbharatai.com`. Empty ⇒ feature off. */
  canonical: string;
}

/**
 * Decide whether this request is on the wrong host. PURE.
 *
 * 🔒 DELIBERATELY NARROW — it redirects ONLY the `www.` form of the canonical host, never anything
 * else. A rule that rewrote every unexpected host would catch Cloud Run's own internal hostname, the
 * health checker, preview revisions and localhost, and turn a login bug into an outage. Anything we
 * do not positively recognise is served exactly as before.
 */
export function canonicalHostRedirect(input: CanonicalInput): CanonicalDecision {
  const none: CanonicalDecision = { redirectTo: null, status: 308 };
  const canonical = normalizeHost(input.canonical);
  if (!canonical) return none;                       // not configured — do nothing at all
  const host = normalizeHost(input.host);
  if (!host) return none;
  if (host !== `www.${canonical}`) return none;      // only the www twin, nothing else
  const path = typeof input.originalUrl === 'string' && input.originalUrl.startsWith('/') ? input.originalUrl : '/';
  return { redirectTo: `https://${canonical}${path}`, status: 308 };
}

/** Lowercase, strip any port, drop a trailing dot. PURE. */
function normalizeHost(h: string | null | undefined): string {
  return String(h ?? '').trim().toLowerCase().split(':')[0].replace(/\.$/, '');
}

/**
 * The canonical host for this deployment.
 *
 * Read from the env so a different deployment (or a rename) needs no code change, and DEFAULTS to
 * empty — i.e. off. A hardcoded default would silently start redirecting on every environment that
 * merely shares this code, including local development.
 */
export function canonicalHostFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.CANONICAL_HOST ?? '').trim();
}
