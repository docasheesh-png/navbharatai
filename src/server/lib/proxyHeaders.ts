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

/**
 * The upgrade handler speaks raw bytes, not an HTTP response object. Strip Set-Cookie from the
 * status+header block (no trailing blank line) and return the block to write back.
 */
export function sanitizeUpgradeResponseHeaders(headerBlock: string): string {
  const lines = headerBlock.split('\r\n');
  const status = lines[0] ?? '';
  const bag: HeaderBag = {};
  const order: string[] = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') {
      const prev = bag[key];
      const arr = Array.isArray(prev) ? prev.slice() : prev ? [prev] : [];
      arr.push(value);
      bag[key] = arr;
    } else if (bag[key] === undefined) {
      bag[key] = value;
      order.push(key);
    }
  }
  const clean = sanitizeProxyResponseHeaders(bag);
  const out = [status];
  for (const key of order) {
    const value = clean[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) { for (const item of value) out.push(`${key}: ${item}`); }
    else out.push(`${key}: ${value}`);
  }
  return out.join('\r\n');
}
