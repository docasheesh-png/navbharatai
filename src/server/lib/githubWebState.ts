/**
 * THE WEB GITHUB SIGN-IN IS BOUND TO THE BROWSER TAB THAT STARTED IT (Q-623, forensic audit 2026-10-04).
 *
 * THE FINDING. The web callback redirects to `<return url>#gh_token=<token>`, and the client stored ANY
 * `#gh_token=` fragment it was handed. So a link `https://navbharatai.com/#gh_token=<attacker token>`
 * planted the ATTACKER'S GitHub token in a victim's session — and every later push the victim made went
 * into the attacker's account. Nothing about the fragment said which browser had asked for it. The
 * OAuth `state` was just the return URL: no per-attempt value at all, so the same planting also worked
 * through the server (an attacker's own authorization `code` sent to the victim's callback).
 *
 * THE FIX — the standard OAuth anti-CSRF nonce, carried end to end:
 *
 *   1. The client makes a random nonce, keeps it in the tab's sessionStorage, and sends it (header
 *      `x-nbai-github-nonce`) when it asks for the authorize URL.
 *   2. The server signs the nonce into `state` together with the vetted return URL and an expiry —
 *      with the SAME `hmac` and key as the native states (`githubNativeHandoff.ts`), not a second signer.
 *   3. The callback releases the token to a web page ONLY for a state that verifies, and echoes the
 *      nonce beside the token (`#gh_token=…&gh_nonce=…`, or in the popup's postMessage).
 *   4. The client stores the token only when the echoed nonce equals the one IT saved, then deletes it.
 *
 * An attacker can build any fragment they like, but cannot know a nonce that lives in the victim's tab.
 * An unsigned or broken state is refused before the code is exchanged — the callback never again hands
 * a token to a page for an attempt nobody can vouch for.
 *
 * PURE — a function of its arguments, testable without a network or a browser.
 */

import { hmac, sameSignature, isOauthNonce } from './githubNativeHandoff';

/** Prefix of a signed web state: `nbai-web-v1.<base64url(returnUrl)>.<nonce>.<expiryMs>.<hmac>`. */
export const WEB_STATE_PREFIX = 'nbai-web-v1';

export type WebState =
  /** Not a signed web state at all (an old tab's raw return URL, an empty state, a crafted one). */
  | { kind: 'none' }
  /** Verified. `returnUrl` is '' when the starting page was not one we return tokens to. */
  | { kind: 'web'; returnUrl: string; nonce: string }
  /** Shaped like a signed web state but unusable. */
  | { kind: 'web-invalid'; reason: 'malformed' | 'bad-signature' | 'expired' };

/**
 * Sign a web state. `returnUrl` must already be vetted by `safeReturnUrl` (or be '' for the popup page);
 * it is signed so nobody can swap it after the fact, and re-vetted at the callback anyway.
 */
export function signWebState(secret: string, returnUrl: string, nonce: string, expiresAtMs: number): string {
  const payload = `${WEB_STATE_PREFIX}.${Buffer.from(returnUrl, 'utf8').toString('base64url')}.${nonce}.${expiresAtMs}`;
  return `${payload}.${hmac(secret, payload)}`;
}

/** Classify an incoming `state`. Signature is checked before expiry, as with the native states. */
export function parseWebState(secret: string, state: unknown, nowMs: number): WebState {
  const s = typeof state === 'string' ? state : '';
  if (!s.startsWith(`${WEB_STATE_PREFIX}.`)) return { kind: 'none' };

  const parts = s.split('.');
  if (parts.length !== 5) return { kind: 'web-invalid', reason: 'malformed' };
  const [, urlB64, nonce, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!/^[A-Za-z0-9_-]*$/.test(urlB64) || !isOauthNonce(nonce) || !Number.isFinite(exp)) {
    return { kind: 'web-invalid', reason: 'malformed' };
  }
  if (!sameSignature(sig, hmac(secret, `${WEB_STATE_PREFIX}.${urlB64}.${nonce}.${expRaw}`))) {
    return { kind: 'web-invalid', reason: 'bad-signature' };
  }
  if (nowMs > exp) return { kind: 'web-invalid', reason: 'expired' };
  return { kind: 'web', returnUrl: Buffer.from(urlB64, 'base64url').toString('utf8'), nonce };
}

/** The fragment the web callback returns: the token AND the nonce it belongs to, both URL-encoded. */
export function webReturnFragment(accessToken: string, nonce: string): string {
  return `#gh_token=${encodeURIComponent(accessToken)}&gh_nonce=${encodeURIComponent(nonce)}`;
}
