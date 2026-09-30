// ANDROID INSTANT VERIFICATION → A REAL SIGN-IN (admin 2026-09-30: "sabhi problem fix? … No - continue").
//
// 🔴 THE PROBLEM. Android can confirm a phone number WITHOUT sending an SMS ("instant verification").
// The app keeps ONE session — the web SDK's (`skipNativeAuth: true`) — and a code-less native
// credential cannot be moved into it. So a person whose phone did this could not sign in by mobile.
//
// 🔑 THE FIX, and only for that case: the phone signs in on the NATIVE side, sends us that session's
// ID token, and we answer with a Firebase CUSTOM token for the SAME uid, which the web SDK can sign in
// with. The normal path (a typed or auto-read code) is untouched and never reaches this.
//
// 🔒 IT GRANTS NOTHING NEW. The caller must already hold a valid ID token for this uid, and a custom
// token only lets them become that same uid in the web SDK. We additionally require that the token came
// from a PHONE sign-in with a verified number, and that the sign-in happened in the last five minutes,
// so an old or non-phone token found elsewhere cannot be replayed through here.
//
// ⚠️ INFRA: `createCustomToken` without a key file signs through IAM (`iam.serviceAccounts.signBlob`), so
// the Cloud Run service account needs the **Service Account Token Creator** role on itself. When it is
// missing the answer is an honest 503 `custom-token-unavailable` — the person is told to use Email or
// Google, exactly as before this existed, and the admin's OTP card shows the code.

export interface ExchangeAuth {
  verifyIdToken(token: string): Promise<{
    uid: string;
    phone_number?: string;
    auth_time?: number;
    firebase?: { sign_in_provider?: string };
  }>;
  createCustomToken(uid: string): Promise<string>;
}

export type ExchangeResult =
  | { ok: true; token: string }
  | { ok: false; status: number; code: string; message: string };

/** How recent the native phone sign-in must be. Long enough for the round trip, short enough to limit replay. */
export const EXCHANGE_MAX_AGE_S = 300;

/** Exchange a native phone-sign-in ID token for a custom token. Never throws. `nowS` is injected for tests. */
export async function exchangePhoneIdToken(
  idToken: unknown,
  auth: ExchangeAuth | null,
  nowS: number,
): Promise<ExchangeResult> {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 8192) {
    return { ok: false, status: 400, code: 'bad-request', message: 'Sign-in could not be completed.' };
  }
  if (!auth) {
    return { ok: false, status: 503, code: 'unavailable', message: 'Sign-in is not available right now.' };
  }
  let decoded: Awaited<ReturnType<ExchangeAuth['verifyIdToken']>>;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    return { ok: false, status: 401, code: 'invalid-token', message: 'Sign-in could not be completed.' };
  }
  if (decoded.firebase?.sign_in_provider !== 'phone' || !decoded.phone_number) {
    return { ok: false, status: 403, code: 'not-phone', message: 'Sign-in could not be completed.' };
  }
  const authTime = Number(decoded.auth_time);
  if (!Number.isFinite(authTime) || nowS - authTime > EXCHANGE_MAX_AGE_S || authTime - nowS > 60) {
    return { ok: false, status: 401, code: 'stale', message: 'That sign-in took too long. Please try again.' };
  }
  try {
    return { ok: true, token: await auth.createCustomToken(decoded.uid) };
  } catch (err) {
    // Admin-only: the server log. Most often the missing IAM role named above.
    try {
      console.error('[AUTH] phone-exchange: createCustomToken failed — does the service account hold "Service Account Token Creator"?',
        err instanceof Error ? err.message : err);
    } catch { /* ignore */ }
    return { ok: false, status: 503, code: 'custom-token-unavailable', message: 'Sign-in is not available right now.' };
  }
}
