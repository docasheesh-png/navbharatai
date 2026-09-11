// WHICH OUTSIDE HOSTS DOES THIS APP POINT AT? (NavBharat Cloud, slice 4 — ROADMAP §11.)
//
// 🔴 WHY THIS IS THE CHECK THAT CAN ACTUALLY WORK, and the one that cannot.
//
// The roadmap records a design error worth keeping: the obvious idea — "run Google Web Risk on the
// published app's URL at publish time" — is **worthless**. Web Risk answers *"is this URL on a list of
// KNOWN-bad URLs?"*, and at publish the app's own URL is seconds old, so it cannot be on any list. A
// check that always passes is not a check; it is reassurance.
//
// Web Risk earns its place somewhere else entirely: **the URLs the app's code POINTS AT**. A generated
// app posting credentials to `http://collect-logins.xyz/steal` — *that* host can already be on the
// list. And we can find it because we WROTE the app. A blind file host cannot do this.
//
// This module is the "find them" half, and it is PURE so the rule is tested without a network:
// files in, outbound origins out. The lookup, the cache and the verdict live in `webRisk.ts`.
//
// 🔒 EXTRACTION IS DELIBERATELY GENEROUS, DEDUPLICATION IS WHAT MAKES IT CHEAP. It would be tempting to
// skip "obviously fine" hosts like `api.stripe.com` here — but an allowlist is a thing to maintain and
// to get wrong, and the same handful of hosts appear across hundreds of apps, so the CACHE in
// `webRisk.ts` already collapses them to one lookup each. Free-tier spend is bounded by the number of
// DISTINCT hosts the platform has ever seen, not by the number of publishes.

/** Scanned for URLs. Binary assets and lockfiles cannot express an outbound call worth checking. */
const SCANNED_EXT = /\.(html?|js|mjs|cjs|jsx|ts|tsx|json|txt|css|env|ya?ml)$/i;

/** Per-file ceiling, same shape as ContentSafetyScanner's — a giant bundle must not stall a publish. */
const PER_FILE_MAX = 500_000;

/**
 * The most DISTINCT origins one publish will ever contribute.
 *
 * A bound, not a tuning knob: a hostile app could otherwise embed ten thousand unique hosts and turn
 * one publish into ten thousand Web Risk lookups — spending the free tier as an attack. Legitimate
 * apps use a handful.
 */
export const MAX_ORIGINS_PER_APP = 60;

/** Never worth a lookup: not reachable from the internet, so not something Web Risk has an opinion on. */
function isLocal(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '0.0.0.0' || h === '::1'
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || h.endsWith('.local') || h.endsWith('.localhost');
}

/**
 * Origins this platform serves from — an app pointing at its OWN preview or a NavBharatAI URL is not
 * pointing "outbound" at all, and asking Google about our own domains every publish would be noise.
 */
function isOurs(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'navbharatai.com' || h.endsWith('.navbharatai.com')
    || h.endsWith('.e2b.app') || h.endsWith('.web.app') || h.endsWith('.firebaseapp.com')
    || h.endsWith('.run.app') || h === 'mitrify.com' || h.endsWith('.mitrify.com')
    || h === 'mitrify.xyz' || h.endsWith('.mitrify.xyz');
}

/** `https://host[:port]` — the unit Web Risk is asked about, and the unit the cache keys on. PURE. */
export function originOf(rawUrl: string): string | null {
  try {
    const u = new URL(String(rawUrl ?? '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    if (isLocal(u.hostname) || isOurs(u.hostname)) return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

const URL_RE = /\bhttps?:\/\/[^\s"'`<>()[\]{}\\|^]+/gi;

/**
 * Every distinct outbound origin the app's own source points at, in first-seen order. PURE.
 *
 * Order is stable and deterministic so a report reads the same twice, and so the cap below cuts the
 * SAME set every time rather than a different arbitrary one per run.
 */
export function extractOutboundOrigins(files: Map<string, Buffer> | Record<string, string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const entries: Array<[string, string]> = [];
  if (files instanceof Map) {
    for (const [path, buf] of files) {
      if (!SCANNED_EXT.test(path)) continue;
      try { entries.push([path, buf.toString('utf8', 0, PER_FILE_MAX)]); } catch { /* unreadable is not a URL */ }
    }
  } else {
    for (const [path, text] of Object.entries(files ?? {})) {
      if (!SCANNED_EXT.test(path) || typeof text !== 'string') continue;
      entries.push([path, text.slice(0, PER_FILE_MAX)]);
    }
  }
  for (const [, text] of entries) {
    for (const m of text.match(URL_RE) ?? []) {
      // A URL in prose or JSON often carries a trailing delimiter; trimming it changes the ORIGIN
      // never, but keeps `new URL` from rejecting an otherwise fine address.
      const origin = originOf(m.replace(/[.,;:]+$/, ''));
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      out.push(origin);
      if (out.length >= MAX_ORIGINS_PER_APP) return out;
    }
  }
  return out;
}
