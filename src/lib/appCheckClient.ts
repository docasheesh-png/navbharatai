// App Check — the browser/app half (admin 2026-09-26: "App Check shuru karo"; slice 2 the same day:
// "slice 2 shuru karo"). The server half and the reasoning live in `src/server/lib/appCheck.ts`.
//
// WHAT THIS DOES: a short-lived token is attached to the handful of requests that spend money
// (`appCheckRoutes.ts` — the same list the server guards). Nothing else is touched.
//   • WEBSITE — reCAPTCHA Enterprise, and only once the server publishes a site key.
//   • PHONE APPS (slice 2) — the native Firebase App Check SDK through `@capacitor-firebase/app-check`:
//     Play Integrity on Android, App Attest on iOS. No site key is involved.
//
// 🔒 IT CAN NEVER STOP A REQUEST. Every failure — no key, the SDK or plugin failing to load, reCAPTCHA
// blocked by an extension, a device Play Integrity will not vouch for, a slow token — sends the request
// WITHOUT the header, exactly as before. The server is in monitor mode by default and counts that as
// "missing"; it refuses nothing unless an admin turns enforcement on.
//
// Everything is dependency-injected so the rules are testable without a browser or a device.

import { isAppCheckProtected } from './appCheckRoutes';

export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';
/** The longest a request waits for a token. A request that waits longer goes without one. */
export const TOKEN_WAIT_MS = 1_500;

export type TokenSource = () => Promise<string | null>;

/**
 * `scheme://host` for a URL — deliberately NOT `URL.origin`. The iOS app is served from
 * `capacitor://localhost`, and the URL standard defines the origin of a non-special scheme as the
 * string "null", so an origin comparison would silently refuse to attach the token on every iPhone.
 */
function originKey(u: URL): string {
  return `${u.protocol}//${u.host}`.toLowerCase();
}

/**
 * Should this fetch carry the token? Only a POST to a guarded route on one of OUR origins (the page's
 * own, plus the production API origin the phone apps' requests are rewritten to). A token is never
 * sent to another site — it identifies OUR app to OUR server. PURE.
 */
export function shouldAttachAppCheck(url: string, method: string, ownOrigins: string | readonly string[]): boolean {
  const origins: readonly string[] = typeof ownOrigins === 'string' ? [ownOrigins] : ownOrigins;
  if (origins.length === 0) return false;
  try {
    const allowed = origins.map((o) => originKey(new URL(o)));
    // A relative `/api/...` resolves against the PAGE's own origin, which is always the first entry.
    const u = new URL(url, origins[0]);
    if (!allowed.includes(originKey(u))) return false;
    return isAppCheckProtected(method, u.pathname);
  } catch {
    return false;
  }
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
  ownOrigins: string | readonly string[],
): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = isRequest ? (input as Request).url : input instanceof URL ? input.href : String(input);
    const method = init?.method ?? (isRequest ? (input as Request).method : 'GET');
    if (!shouldAttachAppCheck(url, method, ownOrigins)) return realFetch(input as RequestInfo, init);
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

/** The production API origin the phone apps' `/api` requests are rewritten to (see apiBase.ts). */
export const NATIVE_API_ORIGIN = 'https://navbharatai.com';

/** The minimal slice of the native plugin this module uses (DI for tests). */
export interface NativeAppCheck {
  initialize(opts: { isTokenAutoRefreshEnabled?: boolean }): Promise<void>;
  getToken(opts?: { forceRefresh?: boolean }): Promise<{ token: string }>;
}

async function loadNativeAppCheck(): Promise<NativeAppCheck | null> {
  const [{ Capacitor }, { FirebaseAppCheck }] = await Promise.all([
    import('@capacitor/core'),
    import('@capacitor-firebase/app-check'),
  ]);
  // A phone app built before the plugin shipped has no native half. Asking it would throw
  // "not implemented"; asking first keeps that an ordinary "missing".
  if (!Capacitor.isPluginAvailable('FirebaseAppCheck')) return null;
  return FirebaseAppCheck as unknown as NativeAppCheck;
}

let installed = false;

/** Test-only reset of the once-only guard. */
export function __resetAppCheckInstall(): void { installed = false; }

/**
 * Start App Check and wrap `fetch`. Idempotent, never throws, never awaited by startup — the app renders
 * whether or not any of this succeeds.
 */
export async function installAppCheck(
  w: AppCheckWindow = window as unknown as AppCheckWindow,
  deps: { loadNative?: () => Promise<NativeAppCheck | null> } = {},
): Promise<'installed' | 'installed-native' | 'native-unavailable' | 'no-key' | 'failed' | 'already'> {
  if (installed) return 'already';
  try {
    if (w.Capacitor?.isNativePlatform?.()) {
      // PHONE APPS — Play Integrity (Android) / App Attest (iOS). No site key: the provider is chosen by
      // the native SDK, and the device, not a web page, is what gets vouched for.
      const native = await (deps.loadNative ?? loadNativeAppCheck)();
      if (!native) return 'native-unavailable';
      await native.initialize({ isTokenAutoRefreshEnabled: true });
      const source: TokenSource = async () => (await native.getToken({ forceRefresh: false })).token;
      w.fetch = wrapFetchWithAppCheck(w.fetch.bind(w), source, [w.location.origin, NATIVE_API_ORIGIN]);
      installed = true;
      return 'installed-native';
    }
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
