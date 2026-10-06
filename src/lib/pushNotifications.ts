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
import { Browser } from '@capacitor/browser';
import { registerDeviceToken, registerDeviceTokenResult, unregisterDeviceToken } from './pushApi';
import { PLAY_STORE_URL } from './appUpdate';
import { pushTapAction } from './appMartTarget';
import { recordNonFatal } from './observability';
import { iosBuildHasPush } from './iosBuildCapabilities';

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

/**
 * Where a registration attempt stands. A failure is reported WITH its stage, because "Push registration
 * failed" alone (Crashlytics, iOS 108) could equally have been a denied prompt, a missing APNs
 * entitlement, an FCM outage or our own server — four different fixes behind one sentence.
 */
export type PushStage = 'plugin' | 'permission' | 'token' | 'register' | 'listeners';

/**
 * How long a failed first `getToken` waits for the token to arrive by itself.
 *
 * On iOS the FCM token can only be minted AFTER Apple has issued the APNs device token, and that
 * happens asynchronously at launch. A `getToken` that runs first fails ("No APNS token specified
 * before fetching FCM Token") even though nothing is wrong — and the plugin then delivers the token
 * through `tokenReceived` the moment APNs answers. Waiting for THAT event is the plugin's own
 * contract, not a retry: nothing is called again, and if the event never comes the ORIGINAL error is
 * what gets reported.
 */
export const TOKEN_ARRIVAL_WAIT_MS = 20_000;

/**
 * The underlying cause of a failure, as a short line Crashlytics can group by. Capacitor rejects with
 * the native `localizedDescription` (iOS) or exception message (Android) plus, sometimes, a `code`.
 * The text is sanitized again by observability before it leaves the device; this only bounds it.
 */
export function pushFailureCause(err: unknown): { cause: string; code: string } {
  const e = (err ?? {}) as { message?: unknown; code?: unknown; name?: unknown };
  const message = typeof e.message === 'string' && e.message.trim() ? e.message.trim() : (typeof err === 'string' ? err : '');
  const code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code) : '';
  const name = typeof e.name === 'string' ? e.name : '';
  const cause = (message || name || 'unknown').replace(/\s+/g, ' ').slice(0, 160);
  return { cause, code: code.slice(0, 40) };
}

class StagedError extends Error {
  constructor(readonly stage: PushStage, readonly original: unknown) {
    super(pushFailureCause(original).cause);
  }
}

async function atStage<T>(stage: PushStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw err instanceof StagedError ? err : new StagedError(stage, err);
  }
}

type Messaging = typeof import('@capacitor-firebase/messaging').FirebaseMessaging;

/** The first token the plugin delivers by itself, or null after `waitMs`. Never throws. */
function tokenArrival(messaging: Messaging, waitMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    let handle: { remove: () => Promise<void> | void } | null = null;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { void handle?.remove(); } catch { /* the listener is gone either way */ }
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    Promise.resolve()
      .then(() => messaging.addListener('tokenReceived', (event) => { if (event?.token) finish(event.token); }))
      .then((h) => { handle = h; if (done) { try { void h.remove(); } catch { /* ignore */ } } })
      .catch(() => finish(null));
  });
}

export async function initPushNotifications(
  userId: string,
  opts: { tokenWaitMs?: number } = {},
): Promise<void> {
  if (!isNativeApp() || !userId || registeredForUid === userId) return;
  const platform = nativePlatform();
  // An iPhone build signed WITHOUT the push entitlement can never receive a notification: iOS refuses
  // to issue it an APNs token. So it does not ask the user for a permission it cannot use, and does not
  // report a failure that was decided when the build was made. See iosBuildCapabilities.ts.
  if (platform === 'ios' && !iosBuildHasPush()) return;
  try {
    const { FirebaseMessaging } = await atStage('plugin', () => import('@capacitor-firebase/messaging'));

    // BEFORE the permission prompt, deliberately. A channel that exists when the user first says yes
    // is a channel their very first notification can use; created afterwards, the first push of the
    // session would still land in the fallback channel.
    await ensureNotificationChannel();

    const perm = await atStage('permission', async () => {
      const current = await FirebaseMessaging.checkPermissions();
      return current.receive === 'granted' ? current : FirebaseMessaging.requestPermissions();
    });
    if (perm.receive !== 'granted') return; // user declined — honest stop, no fake registration

    const token = await atStage('token', async () => {
      try {
        return (await FirebaseMessaging.getToken()).token;
      } catch (err) {
        const arrived = await tokenArrival(FirebaseMessaging, opts.tokenWaitMs ?? TOKEN_ARRIVAL_WAIT_MS);
        if (arrived) return arrived;
        throw err;
      }
    });
    if (!token) return;

    // Read ONCE. A running app's versionCode cannot change, so re-reading it on every token refresh
    // is pointless work — and it was worse than pointless: it put a dynamic import plus two awaits in
    // front of the refresh re-registration, which CI caught as a race (the re-register had not landed
    // when the next line ran). Cached here, the refresh path below stays synchronous.
    cachedVersionCode = await currentVersionCode();
    const sent = await atStage('register', () => registerDeviceTokenResult(userId, token, platform, cachedVersionCode));
    if (sent.ok) {
      registeredForUid = userId;
      currentToken = token;
    } else {
      // The device is ready and OUR side did not take the token — this device gets no pushes this
      // session. Reported, not swallowed; `registeredForUid` stays unset, so the next sign-in tries again.
      recordNonFatal(
        `Push registration failed at register: ${sent.status === null ? 'the request did not reach the server' : `the server answered ${sent.status}`}`,
        'notifications',
        { stage: 'register', platform, ...(sent.status === null ? {} : { http_status: sent.status }) },
      );
    }

    if (!listenersAttached) {
      listenersAttached = true;
      await atStage('listeners', async () => {
        // FCM tokens rotate (app reinstall, data clear, periodic refresh) — re-register the new one
        // against the CURRENTLY signed-in user so a stale token never silently stops receiving pushes.
        // TAPPING AN "UPDATE" NOTIFICATION MUST OPEN THE STORE, not merely bring the app forward.
        // Landing back on the version you already have is the same broken promise as a false banner —
        // and it is the one thing that would make this notification never get tapped again.
        //
        // AN APP MART PUSH (a comment, a reply) MUST OPEN THAT APP, not Home (admin 2026-10-01). It rides
        // the same `navbharat:navigate` event the in-app bell uses, so the two can never disagree about
        // where a notification leads. The decision itself is the pure `pushTapAction` (appMartTarget.ts).
        await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
          try {
            const data = (event?.notification?.data ?? {}) as Record<string, unknown>;
            const action = pushTapAction(data, PLAY_STORE_URL);
            if (!action) return;
            if (action.kind === 'open-app-mart') {
              window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'appstore', storeSocialKey: action.target } }));
              return;
            }
            const url = action.url;
            void Promise.resolve()
              .then(() => Browser.open({ url }))
              .catch(() => { window.open(url, '_blank', 'noopener'); });
          } catch { /* a tap handler must never crash the app */ }
        });

        await FirebaseMessaging.addListener('tokenReceived', (event) => {
          if (registeredForUid) {
            currentToken = event.token;
            void registerDeviceToken(registeredForUid, event.token, nativePlatform(), cachedVersionCode);
          }
        });
      });
    }
  } catch (err) {
    // Never block sign-in or crash the app over this — but never hide it either. The report names the
    // stage and the underlying cause (sanitized again by observability; the token is never in it), so
    // a denied prompt, a missing entitlement, an FCM outage and our own server are four different
    // Crashlytics issues instead of one sentence that fits them all.
    const stage: PushStage | 'unknown' = err instanceof StagedError ? err.stage : 'unknown';
    const { cause, code } = pushFailureCause(err instanceof StagedError ? err.original : err);
    recordNonFatal(`Push registration failed at ${stage}: ${cause}`, 'notifications', {
      stage,
      platform,
      ...(code ? { code } : {}),
    });
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
