// BLD-12 — the dev-preview proxy must not hand a user's dev server the platform's credentials,
// and must not copy that server's Set-Cookie back onto our origin.
//
// Request side drops the headers that carry a Firebase session, an App Check token, the test-only
// verified-uid seam, or a forwarded user. Response side drops Set-Cookie. Hop-by-hop headers the
// proxy already skipped (host on the request, content-encoding and transfer-encoding on the response)
// stay the caller's job — this module does not grow that list.
//
// Returns a new object. The input is not mutated.

const REQUEST_DROP = new Set([
  'authorization',
  'cookie',
  'x-firebase-appcheck',
  'x-test-verified-uid',
  'x-forwarded-user',
]);

export type HeaderValue = string | string[] | undefined;
export type HeaderBag = { [key: string]: HeaderValue };

function withoutKeys(h: HeaderBag | null | undefined, drop: (key: string) => boolean): HeaderBag {
  const out: HeaderBag = { ...(h || {}) };
  for (const key of Object.keys(out)) {
    if (drop(key.toLowerCase())) delete out[key];
  }
  return out;
}

/** Copy of `h` with credential / identity headers removed (any letter case). */
export function sanitizeProxyRequestHeaders(h: HeaderBag | null | undefined): HeaderBag {
  return withoutKeys(h, (key) => REQUEST_DROP.has(key));
}

/** Copy of `h` with Set-Cookie removed (any letter case). */
export function sanitizeProxyResponseHeaders(h: HeaderBag | null | undefined): HeaderBag {
  return withoutKeys(h, (key) => key === 'set-cookie');
}
