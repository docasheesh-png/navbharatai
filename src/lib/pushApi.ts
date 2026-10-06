// Authenticated client for the /api/push device-token endpoints — mirrors secretsApi.ts exactly (same
// auth-header pattern, same bounded-timeout fetch, same honest-error surfacing).

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

/**
 * Register (or refresh) this device's FCM token, and say how it went: `status` is the server's HTTP
 * status, or null when the request never reached it (offline, timeout). Never throws.
 *
 * The status is what makes a server-side refusal visible (2026-10-06, the push autopsy): a plain
 * boolean made "our server said 401" and "the phone was offline" the same silent `false`, so the last
 * link of the registration chain was the one link nobody could see.
 */
export async function registerDeviceTokenResult(userId: string, token: string, platform: 'android' | 'ios' | 'web', appVersionCode?: number | null): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await pushFetch(`/api/push/${userId}/register-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform, appVersionCode: appVersionCode ?? null }),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

/** Register (or refresh) this device's FCM token for the signed-in user. Best-effort: returns false
 *  instead of throwing, since registration is a background bootstrap step, never a user-facing action. */
export async function registerDeviceToken(userId: string, token: string, platform: 'android' | 'ios' | 'web', appVersionCode?: number | null): Promise<boolean> {
  return (await registerDeviceTokenResult(userId, token, platform, appVersionCode)).ok;
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
