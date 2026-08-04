// Native-shell API base (Bundled-mode foundation, PR 1 — admin decision 2026-07-08: "real app, no
// website feel" → Capacitor BUNDLED mode + native polish).
//
// THE PROBLEM THIS SOLVES: the frontend calls the API with site-relative paths — `fetch('/api/…')` —
// at 183 call sites. On the web (and in today's HOSTED native shell, whose WebView origin IS
// https://navbharatai.com) that just works. But in BUNDLED mode the WebView serves the app from a
// local origin (https://localhost on Android/iOS with the https scheme, capacitor://localhost on
// default iOS), so every relative `/api/…` call would hit the local shell — and fail. Rewriting 183
// call sites is exactly the class of bug-prone churn the root-cause rule forbids; instead this module
// rewrites them in ONE place, at the transport layer (fetch + XMLHttpRequest, which also covers axios).
//
// SAFETY GUARANTEES:
//   • Web: `window.Capacitor` doesn't exist → `installNativeApiRewrite` is a NO-OP. Byte-for-byte
//     today's behavior.
//   • Hosted native shell (today's app): Capacitor exists, but the WebView origin already IS the API
//     origin → no rewrite needed → NO-OP. Nothing changes until the bundled flip.
//   • Bundled native shell (the future flip): relative `/api/…` URLs are rewritten to the absolute
//     production origin. Auth is Bearer-token-only (no cookies, no `credentials: 'include'` anywhere),
//     so the cross-origin move grants no ambient credentials — the server still verifies the Firebase
//     token on every request, and the server-side CORS allowlist (src/server/lib/cors.ts) only
//     reflects the known native-shell origins.
//
// Everything is dependency-injected (the window-like object is a parameter) so the logic is fully
// unit-testable without a browser.

/** The production API origin the bundled native shell talks to. */
export const NATIVE_API_ORIGIN = 'https://navbharatai.com';

/** The minimal window surface this module touches (DI for tests). */
export interface ShellWindow {
  Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean };
  location: { origin: string };
  fetch: typeof fetch;
  XMLHttpRequest?: { prototype: { open: (...args: unknown[]) => unknown } };
}

/** True when running inside a Capacitor native shell (Android/iOS app), never on the plain web. */
export function isNativeShell(w: Pick<ShellWindow, 'Capacitor'>): boolean {
  const c = w.Capacitor;
  if (!c) return false;
  if (typeof c.isNativePlatform === 'function') {
    try { return c.isNativePlatform() === true; } catch { return false; }
  }
  return c.isNative === true;
}

/**
 * Does this runtime need the API rewrite? Only a native shell whose WebView origin is NOT already the
 * API origin (i.e. bundled mode). Hosted mode and the web return false. Pure.
 */
export function needsApiRewrite(nativeShell: boolean, currentOrigin: string, apiOrigin: string = NATIVE_API_ORIGIN): boolean {
  return nativeShell && currentOrigin !== apiOrigin;
}

/**
 * Rewrite a SITE-RELATIVE `/api/…` URL to the absolute production API origin. Anything else —
 * absolute URLs, other relative paths (assets), protocol-relative URLs — passes through untouched.
 * Pure.
 */
export function rewriteApiUrl(url: string, apiOrigin: string = NATIVE_API_ORIGIN): string {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?') ? apiOrigin + url : url;
}

/**
 * Install the transport-layer rewrite on a window-like object. Returns true only when actually
 * installed (bundled native shell); false = no-op (web / hosted shell). Patches:
 *   • fetch — string, URL, and Request inputs (a Request's absolute local-origin /api URL is
 *     re-targeted with `new Request(rewritten, original)`, preserving method/headers/body).
 *   • XMLHttpRequest.open — covers axios and any other XHR-based client without importing them.
 */
export function installNativeApiRewrite(w: ShellWindow, apiOrigin: string = NATIVE_API_ORIGIN): boolean {
  if (!needsApiRewrite(isNativeShell(w), w.location.origin, apiOrigin)) return false;

  const localApiPrefix = w.location.origin + '/api';
  const rewriteAbsolute = (url: string): string =>
    url === localApiPrefix || url.startsWith(localApiPrefix + '/') || url.startsWith(localApiPrefix + '?')
      ? apiOrigin + url.slice(w.location.origin.length)
      : url;

  const originalFetch = w.fetch.bind(w);
  w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // A string can be site-relative ('/api/…') OR an ABSOLUTE local-origin URL
    // ('capacitor://localhost/api/…', produced by `new URL(location.origin + '/api/…').toString()` —
    // the GitHub-connect and firebase-auth flows do exactly this). Apply BOTH rewrites (as the XHR path
    // below already does): rewriteAbsolute handles the local-absolute case, rewriteApiUrl the relative
    // one. Missing rewriteAbsolute here is why native GitHub connect silently failed to even start.
    if (typeof input === 'string') return originalFetch(rewriteApiUrl(rewriteAbsolute(input), apiOrigin), init);
    if (input instanceof URL) return originalFetch(rewriteAbsolute(input.toString()), init);
    if (typeof Request !== 'undefined' && input instanceof Request) {
      const target = rewriteAbsolute(input.url);
      return target === input.url ? originalFetch(input, init) : originalFetch(new Request(target, input), init);
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  const xhrProto = w.XMLHttpRequest?.prototype;
  if (xhrProto && typeof xhrProto.open === 'function') {
    const originalOpen = xhrProto.open;
    xhrProto.open = function (this: unknown, ...args: unknown[]) {
      if (typeof args[1] === 'string') args[1] = rewriteApiUrl(rewriteAbsolute(args[1]), apiOrigin);
      return originalOpen.apply(this, args);
    };
  }
  return true;
}
