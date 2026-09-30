// HAND A NATIVE PHONE SIGN-IN OVER TO THE WEB SESSION (2026-09-30). Used ONLY when Android confirmed the
// number without sending an SMS ("instant verification"), which the normal code-based path cannot use
// — see src/server/lib/phoneTokenExchange.ts for why and for the security reasoning.
//
// Order: read the native session's ID token → the server exchanges it for a custom token → the web SDK
// signs in with that → the native session is signed out, so the app keeps ONE session as before.
// Every step is injected, so each failure is testable and each one ends in a NAMED code, never a throw.

export type HandoverResult = { ok: true } | { ok: false; code: string };

export interface HandoverDeps {
  getNativeIdToken(): Promise<string>;
  exchange(idToken: string): Promise<{ ok: true; token: string } | { ok: false; code: string }>;
  signInWithCustomToken(token: string): Promise<void>;
  signOutNative(): Promise<void>;
}

export async function handOverNativePhoneSession(deps: HandoverDeps): Promise<HandoverResult> {
  let idToken: string;
  try {
    idToken = await deps.getNativeIdToken();
  } catch {
    return { ok: false, code: 'no-native-session' };
  }
  if (!idToken) return { ok: false, code: 'no-native-session' };
  let exchanged: Awaited<ReturnType<HandoverDeps['exchange']>>;
  try {
    exchanged = await deps.exchange(idToken);
  } catch {
    return { ok: false, code: 'network' };
  }
  if (!('token' in exchanged) || !exchanged.ok) return { ok: false, code: 'code' in exchanged ? exchanged.code : 'unknown' };
  try {
    await deps.signInWithCustomToken(exchanged.token);
  } catch {
    return { ok: false, code: 'web-sign-in-failed' };
  }
  // Best-effort: the web session is the one that matters, and it now exists.
  try { await deps.signOutNative(); } catch { /* ignore */ }
  return { ok: true };
}

/** POST the native ID token to the server's exchange. Never throws. */
export async function fetchPhoneExchange(
  idToken: string,
  f: typeof fetch = fetch,
): Promise<{ ok: true; token: string } | { ok: false; code: string }> {
  try {
    const res = await f('/api/auth/phone-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; token?: unknown; code?: unknown };
    if (res.ok && body.ok === true && typeof body.token === 'string' && body.token) return { ok: true, token: body.token };
    return { ok: false, code: typeof body.code === 'string' && body.code ? body.code : `http-${res.status}` };
  } catch {
    return { ok: false, code: 'network' };
  }
}
