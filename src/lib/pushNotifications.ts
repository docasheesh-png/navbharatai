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
import { PLAY_STORE_URL } from './appUpdate';

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
/**
 * The build this device is running (Android versionCode), reported alongside the push token.
 *
 * This is what makes "notify only the users who are behind" possible — without it the server cannot
 * tell an old install from a current one, and the only options are to notify everybody (which trains
 * people to ignore us) or nobody. Returns null when unavailable; null means UNKNOWN, and the broadcast
 * never sends to an unknown.
 */
let cachedVersionCode: number | null = null;

async function currentVersionCode(): Promise<number | null> {
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    const n = Number.parseInt(String((info as { build?: string })?.build ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * The Android notification channel every NavBharatAI push is posted to.
 *
 * ⚠️ THIS STRING IS ALSO IN AndroidManifest.xml, as
 * `com.google.firebase.messaging.default_notification_channel_id`, and the two must match exactly.
 * They are two halves of one setting: the manifest tells Firebase which channel to post to, and this
 * is the code that CREATES it. A manifest naming a channel nobody created is not an error — Android
 * silently posts to its fallback "Miscellaneous" channel instead, which is the very thing this was
 * added to fix. Pinned in both directions by tests/aNotificationLooksLikeOurApp.test.ts.
 */
export const NOTIFICATION_CHANNEL_ID = 'nbai_updates';

/**
 * Create the app's own notification channel (Android 8+; a no-op elsewhere).
 *
 * WHY IT MATTERS, beyond the name in Settings: a channel's importance is fixed at CREATION and the
 * user owns it afterwards — Android deliberately refuses to let an app raise it later. So a channel
 * that is first created at the default importance can never be upgraded to a heads-up banner, and
 * "my notifications do not pop up" becomes unfixable for everyone who already installed the app.
 * Importance 4 (High) is therefore the one value that must be right the first time.
 *
 * Visibility is Private (0) — Android's own default, and the right one here because a push can carry
 * a wallet balance. The notification still appears on the lock screen; its text is withheld until the
 * phone is unlocked.
 *
 * Idempotent by design: Android ignores a repeat create for an id that exists (it only refreshes the
 * name and description), so calling this on every sign-in is safe and is what keeps the channel
 * present after a user clears app data.
 */
async function ensureNotificationChannel(): Promise<void> {
  if (nativePlatform() !== 'android') return;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    await FirebaseMessaging.createChannel({
      id: NOTIFICATION_CHANNEL_ID,
      name: 'Updates',
      description: 'Build results, wallet alerts and app updates from NavBharatAI.',
      importance: 4,
      visibility: 0,
      vibration: true,
      lights: true,
    });
  } catch {
    /* best-effort — an older plugin or an OS that has no channels must never block registration */
  }
}

export async function initPushNotifications(userId: string): Promise<void> {
  if (!isNativeApp() || !userId || registeredForUid === userId) return;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

    // BEFORE the permission prompt, deliberately. A channel that exists when the user first says yes
    // is a channel their very first notification can use; created afterwards, the first push of the
    // session would still land in the fallback channel.
    await ensureNotificationChannel();

    let perm = await FirebaseMessaging.checkPermissions();
    if (perm.receive !== 'granted') perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return; // user declined — honest stop, no fake registration

    const platform = nativePlatform();
    const { token } = await FirebaseMessaging.getToken();
    if (!token) return;

    // Read ONCE. A running app's versionCode cannot change, so re-reading it on every token refresh
    // is pointless work — and it was worse than pointless: it put a dynamic import plus two awaits in
    // front of the refresh re-registration, which CI caught as a race (the re-register had not landed
    // when the next line ran). Cached here, the refresh path below stays synchronous.
    cachedVersionCode = await currentVersionCode();
    const ok = await registerDeviceToken(userId, token, platform, cachedVersionCode);
    if (ok) {
      registeredForUid = userId;
      currentToken = token;
    }

    if (!listenersAttached) {
      listenersAttached = true;
      // FCM tokens rotate (app reinstall, data clear, periodic refresh) — re-register the new one
      // against the CURRENTLY signed-in user so a stale token never silently stops receiving pushes.
      // TAPPING AN "UPDATE" NOTIFICATION MUST OPEN THE STORE, not merely bring the app forward.
      // Landing back on the version you already have is the same broken promise as a false banner —
      // and it is the one thing that would make this notification never get tapped again.
      await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
        try {
          const data = (event?.notification?.data ?? {}) as Record<string, unknown>;
          if (String(data.action ?? '') !== 'open_store') return;
          const url = typeof data.storeUrl === 'string' && /^https?:\/\//.test(data.storeUrl)
            ? data.storeUrl
            : PLAY_STORE_URL;
          void import('@capacitor/browser')
            .then(({ Browser }) => Browser.open({ url }))
            .catch(() => { window.open(url, '_blank', 'noopener'); });
        } catch { /* a tap handler must never crash the app */ }
      });

      await FirebaseMessaging.addListener('tokenReceived', (event) => {
        if (registeredForUid) {
          currentToken = event.token;
          void registerDeviceToken(registeredForUid, event.token, nativePlatform(), cachedVersionCode);
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
