import { auth, signOutEverywhere } from './firebase';
import { performSignOut, defaultClearAuthStorage, clearAccountAuthStorage, deleteFirebaseAuthDb } from './signOutFlow';
import { clearGithubConnection } from './githubTokenStore';
import { teardownPushNotifications } from './pushNotifications';
import { withSessionAbort } from './sessionAbort';
import type { User } from 'firebase/auth';

let pendingGlobalLogout: User | null = null;
export function isAccountLogoutPending(): boolean { return pendingGlobalLogout !== null; }

export const UNCONFIRMED_LOGOUT_MESSAGE = 'We could not confirm logout on all devices. Some sessions may already be signed out. Sign in again and retry if needed.';

/** Same bounded current-device cleanup as the existing Profile logout; no server revocation here. */
export async function logoutCurrentDevice(expectedUser: User, accountOnly = false, expectedRefreshToken = expectedUser.refreshToken): Promise<void> {
  if (auth.currentUser !== expectedUser || expectedUser.refreshToken !== expectedRefreshToken) return; // a late response cannot sign out a replacement account
  await performSignOut({
    signOut: () => signOutEverywhere(),
    clearStorage: accountOnly ? clearAccountAuthStorage : defaultClearAuthStorage,
    extraCleanup: () => { clearGithubConnection(); void teardownPushNotifications(); },
    deleteAuthDb: () => deleteFirebaseAuthDb(),
    reload: () => window.location.reload(),
  });
}

/** A confirmed action, never called by ordinary logout or pre-login cleanup. No mutation retry. */
export async function logoutAllDevices(user: User): Promise<void> {
  if (auth.currentUser !== user) throw new Error('Your account changed. Please open Logout again.');
  const expectedRefreshToken = user.refreshToken;
  if (pendingGlobalLogout) throw new Error('Logout is already in progress.');
  pendingGlobalLogout = user;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const token = await withSessionAbort(user.getIdToken(), controller.signal);
    if (auth.currentUser !== user || user.refreshToken !== expectedRefreshToken) throw new Error('Session changed');
    const response = await withSessionAbort(fetch('/api/v1/auth/sessions/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
      signal: controller.signal,
      cache: 'no-store',
    }), controller.signal);
    const body: unknown = await withSessionAbort(response.json().catch(() => null), controller.signal);
    if (!response.ok || !body || typeof body !== 'object' || (body as { ok?: unknown }).ok !== true) {
      if (response.status === 429) throw new Error('Too many logout attempts. Please wait an hour before trying again.');
      throw new Error(UNCONFIRMED_LOGOUT_MESSAGE);
    }
    await logoutCurrentDevice(user, true, expectedRefreshToken);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Too many logout')) throw error;
    throw new Error(UNCONFIRMED_LOGOUT_MESSAGE);
  } finally {
    clearTimeout(timeout);
    if (pendingGlobalLogout === user) pendingGlobalLogout = null;
  }
}
