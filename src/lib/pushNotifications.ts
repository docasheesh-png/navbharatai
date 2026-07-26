// Native push notifications — the missing third mobile-engagement feature (admin request 2026-07-26:
// "push notification kaam nahi kar raha hai" — root cause was that it had never been built at all;
// mobileNative.ts only ever wired app-update-check + in-app-review). Uses @capacitor-firebase/messaging
// (same plugin family as the already-shipped @capacitor-firebase/authentication), which handles the
// iOS APNs↔FCM token bridge internally — unlike the raw @capacitor/push-notifications plugin, which
// would hand back a bare APNs token our FCM-based server couldn't send to.
//
// Everything here is a no-op on web (guarded by Capacitor.isNativePlatform, mirroring mobileNative.ts)
// and every native call is try/catch-wrapped, so a missing plugin, a denied permission, or a native
// error can never crash the app or block sign-in. A denied permission is an honest terminal state —
// this never fakes a successful registration.

import { Capacitor } from '@capacitor/core';
import { registerDeviceToken, unregisterDeviceToken } from './pushApi';

/** True only inside the installed Android/iOS shell; false on plain web. Never throws. */
function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

function nativePlatform(): 'android' | 'ios' | 'web' {
  try {
    const p = Capacitor.getPlatform();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}

// Registration is per-signed-in-session — avoid re-requesting permission / re-registering on every
// re-render. Reset on sign-out so a different account on the same device registers its own token.
let registeredForUid: string | null = null;
let currentToken: string | null = null;
let listenersAttached = false;

/**
 * Ask for notification permission and register this device's FCM token against the signed-in user.
 * Call once after a real login (a verified Firebase ID token must be available, since /api/push
 * requires it). No-op on web, no-op if already registered for this uid this session. Never throws.
 */
export async function initPushNotifications(userId: string): Promise<void> {
  if (!isNativeApp() || !userId || registeredForUid === userId) return;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

    let perm = await FirebaseMessaging.checkPermissions();
    if (perm.receive !== 'granted') perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return; // user declined — honest stop, no fake registration

    const platform = nativePlatform();
    const { token } = await FirebaseMessaging.getToken();
    if (!token) return;

    const ok = await registerDeviceToken(userId, token, platform);
    if (ok) {
      registeredForUid = userId;
      currentToken = token;
    }

    if (!listenersAttached) {
      listenersAttached = true;
      // FCM tokens rotate (app reinstall, data clear, periodic refresh) — re-register the new one
      // against the CURRENTLY signed-in user so a stale token never silently stops receiving pushes.
      await FirebaseMessaging.addListener('tokenReceived', (event) => {
        if (registeredForUid) {
          currentToken = event.token;
          void registerDeviceToken(registeredForUid, event.token, nativePlatform());
        }
      });
    }
  } catch {
    /* best-effort — never block sign-in or crash the app over a push registration failure */
  }
}

/** Unregister this device's token (call on sign-out) and reset session state so the next sign-in
 *  (possibly a different account) registers cleanly. Best-effort. */
export async function teardownPushNotifications(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (registeredForUid && currentToken) {
      await unregisterDeviceToken(registeredForUid, currentToken);
    }
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    await FirebaseMessaging.deleteToken();
  } catch {
    /* best-effort */
  } finally {
    registeredForUid = null;
    currentToken = null;
  }
}
