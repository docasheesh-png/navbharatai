// Native-only glue for the two mobile engagement features (admin request 2026-07-11). Everything here
// is a NO-OP on the web (guarded by Capacitor.isNativePlatform) and every call is try/catch-wrapped, so
// a missing plugin or a native error can never crash the app. The decision math lives in
// `mobileEngagement.ts` (pure + unit-tested); this file only bridges to the Capacitor plugins.
//
//   1. @capawesome/capacitor-app-update  → Play In-App Update API (is a newer versionCode live?).
//   2. @capacitor-community/in-app-review → Play In-App Review API (the native rating card).
//
// The plugins are registered natively by `npx cap sync android` (run by .github/workflows/android-aab.yml
// before the Gradle build), so the installed .aab has them; on web they import cleanly and simply refuse
// to run (unimplemented), which our native guard already prevents.

import { Capacitor } from '@capacitor/core';
import { AppUpdate } from '@capawesome/capacitor-app-update';
import { PLAY_STORE_MARKET_URL } from './appUpdate';
import { InAppReview } from '@capacitor-community/in-app-review';
import {
  parseReviewState,
  registerAppOpen,
  shouldRequestReview,
  updateIsAvailable,
} from './mobileEngagement';

const REVIEW_STATE_KEY = 'navbharat_review_state_v1';

/** True only inside the installed Android/iOS shell; false on plain web. Never throws. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

/**
 * Ask the Play Store whether a newer version of the app is available (i.e. the admin uploaded a new
 * signed .aab). Returns false on web or on any error. Because the app runs in BUNDLED mode (the web is
 * baked into the .aab), a Play update is the ONLY way installed users get new code — so this check is
 * what surfaces "please update" to them.
 */
export async function checkForAppUpdate(): Promise<boolean> {
  return (await playUpdateAvailability()) === 'available';
}

/**
 * The same question, answered in THREE states instead of two.
 *
 * ADMIN REPORT 2026-08-21 ("update kar lene ke bad bhi update ka button aa raha hai"): the boolean
 * above cannot tell "Play says you are current" apart from "we could not ask Play" — both are false.
 * That distinction is the entire fix: the first is a fact strong enough to overrule the version number
 * an admin typed into Cloud Run, and the second is no evidence at all and must change nothing.
 *
 * 'unknown' also covers the sideloaded app, where Play has no answer to give.
 */
export async function playUpdateAvailability(): Promise<'available' | 'none' | 'unknown'> {
  if (!isNativeApp()) return 'unknown';
  try {
    const info = await AppUpdate.getAppUpdateInfo();
    return updateIsAvailable(info.updateAvailability as unknown as number) ? 'available' : 'none';
  } catch {
    return 'unknown';
  }
}

/**
 * Open the Play Store APP directly so the user can install the pending update. No-op on web / on error.
 *
 * OPENS THE STORE, NOT THE WEBSITE (admin report 2026-08-16: "update button click → Play Store nahi,
 * website open hoti hai"). Two layers, both of which land in the Play Store app rather than a browser:
 *   1. `AppUpdate.openAppStore()` — the native app-update plugin's own store-open (the primary path).
 *   2. If that throws, fire the `market://` deep link, which the Play Store app answers via a native
 *      ACTION_VIEW intent. A plain `https://play.google.com/…` link is deliberately NOT used here —
 *      that is exactly what opened the browser.
 */
export async function openAppStoreForUpdate(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await AppUpdate.openAppStore();
    return;
  } catch {
    /* plugin path failed — fall through to the direct store deep link */
  }
  try {
    // `_system` sends it out of the WebView; `market://` is answered by the Play Store app, never a browser.
    window.open(PLAY_STORE_MARKET_URL, '_system');
  } catch {
    /* best effort — never crash */
  }
}

/**
 * If the user has engaged enough (see shouldRequestReview), show the native Play rating card once and
 * record the timestamp so we don't nag. Pass a custom clock/storage for tests; defaults to real ones.
 * No-op on web or if the review plugin/native flow is unavailable.
 */
export async function maybeRequestReview(
  nowMs: number = Date.now(),
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage(),
): Promise<void> {
  if (!isNativeApp() || !storage) return;
  try {
    const state = registerAppOpen(parseReviewState(storage.getItem(REVIEW_STATE_KEY)), nowMs);
    if (shouldRequestReview(state, nowMs)) {
      await InAppReview.requestReview();
      state.lastPromptedAtMs = nowMs;
    }
    storage.setItem(REVIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    /* best effort — never crash */
  }
}

/** localStorage may be unavailable (private mode / SSR) — return null instead of throwing. */
function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
