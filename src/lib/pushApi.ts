// Authenticated client for the /api/push device-token endpoints — mirrors secretsApi.ts exactly (same
// auth-header pattern, same bounded-timeout fetch, same honest-error surfacing).

import { auth } from './firebase';
import { authHeader as authHeaders } from './authHeaders';


const REQUEST_TIMEOUT_MS = 15_000;

async function pushFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, headers: { ...(init.headers || {}), ...(await authHeaders()) }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Register (or refresh) this device's FCM token for the signed-in user. Best-effort: returns false
 *  instead of throwing, since registration is a background bootstrap step, never a user-facing action. */
export async function registerDeviceToken(userId: string, token: string, platform: 'android' | 'ios' | 'web', appVersionCode?: number | null): Promise<boolean> {
  try {
    const res = await pushFetch(`/api/push/${userId}/register-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform, appVersionCode: appVersionCode ?? null }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Unregister this device's token (e.g. on sign-out). Best-effort. */
export async function unregisterDeviceToken(userId: string, token: string): Promise<boolean> {
  try {
    const res = await pushFetch(`/api/push/${userId}/register-token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
