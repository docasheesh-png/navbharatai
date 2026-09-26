// App Check — the browser half (admin 2026-09-26: "App Check shuru karo"). The server half and the
// reasoning live in `src/server/lib/appCheck.ts`.
//
// WHAT THIS DOES: on the WEBSITE, when the server publishes a reCAPTCHA Enterprise site key, App Check
// is started once and a short-lived token is attached to the handful of requests that spend money
// (`appCheckRoutes.ts` — the same list the server guards). Nothing else is touched.
//
// 🔒 IT CAN NEVER STOP A REQUEST. Every failure — no key, the SDK failing to load, reCAPTCHA blocked by an
// extension, a slow token — sends the request WITHOUT the header, exactly as today. The server is in
// monitor mode by default and counts that as "missing"; it refuses nothing unless an admin turns
// enforcement on, which the server's own docs say must wait for the numbers.
//
// ⚠️ THE PHONE APPS DO NOT RUN THIS. A Capacitor WebView is served from `localhost`, which a reCAPTCHA key
// must not allow; the phone apps get Play Integrity / App Attest through a native plugin in the next
// slice, and that needs a fresh `.aab` / `.ipa`. Until then their requests are counted as native/missing.
//
// Everything is dependency-injected so the rules are testable without a browser.

import { isAppCheckProtected } from './appCheckRoutes';

export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';
/** The longest a request waits for a token. A request that waits longer goes without one. */
export const TOKEN_WAIT_MS = 1_500;

export type TokenSource = () => Promise<string | null>;

/**
 * Should this fetch carry the token? Only a same-origin, relative-or-own-origin POST to a guarded route.
 * A token is never sent to another site — it identifies OUR app to OUR server. PURE.
 */
export function shouldAttachAppCheck(url: string, method: string, ownOrigin: string): boolean {
  let path: string;
  try {
    const u = new URL(url, ownOrigin);
    if (u.origin !== ownOrigin) return false;
    path = u.pathname;
  } catch {
    return false;
  }
  return isAppCheckProtected(method, path);
}

/** A token, or null if none arrived within `waitMs`. Never throws. */
export async function tokenWithin(source: TokenSource, waitMs: number = TOKEN_WAIT_MS): Promise<string | null> {
  try {
    const t = await Promise.race([
      source(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
    ]);
    return typeof t === 'string' && t ? t : null;
  } catch {
    return null;
  }
}

/**
 * Wrap `fetch` so guarded requests carry the token. Everything else passes through untouched, and a
 * guarded request whose token cannot be had in time is sent without it — never refused, never delayed
 * past `TOKEN_WAIT_MS`.
 */
export function wrapFetchWithAppCheck(
  realFetch: typeof fetch,
  source: TokenSource,
  ownOrigin: string,
): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = isRequest ? (input as Request).url : input instanceof URL ? input.href : String(input);
    const method = init?.method ?? (isRequest ? (input as Request).method : 'GET');
    if (!shouldAttachAppCheck(url, method, ownOrigin)) return realFetch(input as RequestInfo, init);
    const token = await tokenWithin(source);
    if (!token) return realFetch(input as RequestInfo, init);
    const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined));
    headers.set(APP_CHECK_HEADER, token);
    return realFetch(input as RequestInfo, { ...init, headers });
  };
  return wrapped as typeof fetch;
}

interface AppCheckWindow {
  fetch: typeof fetch;
  location: { origin: string };
  Capacitor?: { isNativePlatform?: () => boolean };
}

/** Read the published site key. null on any failure — an unreachable config means "App Check off". */
export async function fetchAppCheckSiteKey(f: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await f('/api/public-config', { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { appCheckSiteKey?: unknown };
    return typeof body.appCheckSiteKey === 'string' && body.appCheckSiteKey ? body.appCheckSiteKey : null;
  } catch {
    return null;
  }
}

let installed = false;

/**
 * Start App Check on the website and wrap `fetch`. Idempotent, never throws, never awaited by startup —
 * the app renders whether or not any of this succeeds.
 */
export async function installAppCheck(w: AppCheckWindow = window as unknown as AppCheckWindow): Promise<'installed' | 'native' | 'no-key' | 'failed' | 'already'> {
  if (installed) return 'already';
  try {
    if (w.Capacitor?.isNativePlatform?.()) return 'native';
    const key = await fetchAppCheckSiteKey(w.fetch.bind(w));
    if (!key) return 'no-key';
    const [{ initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }, { app }] = await Promise.all([
      import('firebase/app-check'),
      import('./firebase'),
    ]);
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(key),
      isTokenAutoRefreshEnabled: true,
    });
    const source: TokenSource = async () => (await getToken(appCheck, false)).token;
    w.fetch = wrapFetchWithAppCheck(w.fetch.bind(w), source, w.location.origin);
    installed = true;
    return 'installed';
  } catch (err) {
    try { console.warn('[app-check] not started:', err instanceof Error ? err.message : err); } catch { /* ignore */ }
    return 'failed';
  }
}
