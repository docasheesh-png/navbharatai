// "A new version is on the Play Store" — decided honestly.
//
// THE ASK (admin, 2026-08-11): "jab mai new app Play Store par dalu, to old app me notification jaye —
// 'update app' ka". The app runs in BUNDLED mode (capacitor.config.ts: webDir 'dist', no server.url),
// so an installed copy keeps running its own frozen frontend forever. A user can sit on a months-old
// build and never know, while every server-side improvement lands around them.
//
// WHY A SERVER CHECK RATHER THAN PLAY'S IN-APP UPDATE API. The Play In-App Update API is the "proper"
// native route, but it needs a native plugin, a native sync, and it only answers on a device that
// installed from Play. This check is one HTTP call the app already knows how to make, works the moment
// it ships, and — the deciding reason — its answer is a number WE control, so it can be corrected in
// seconds if a release is pulled. It can be swapped for the native API later without changing any of
// the decision logic below, because all of that logic lives here and is pure.
//
// THE RULES, and every one of them exists to stop a specific way this feature becomes hated:
//   • NEVER GUESS. If the server cannot be reached, or either version is unknown, the answer is "no
//     update". A false "update available" that leads to a Play page showing the version already
//     installed teaches the user to ignore the banner forever.
//   • NEVER NAG. A dismissal is remembered. The banner comes back when there is a genuinely NEWER
//     version, or after a cooling-off period — not on the next launch.
//   • FORCED UPDATES ARE A SEPARATE, DELIBERATE DECISION. Blocking someone out of the app they already
//     installed is the most hostile thing this code could do, so it only happens when the server
//     explicitly names a minimum version, and never as a side effect of a routine release.
//   • WEB IS NOT AFFECTED. The browser always loads the latest build; telling a web user to "update"
//     would be nonsense.
//
// Pure + dependency-free → fully unit-testable without a device.

/** What the server publishes about the current store release. */
export interface StoreVersionInfo {
  /** The Android versionCode of the newest build on Play. */
  androidVersionCode: number | null;
  /** Human version name for the message, e.g. "1.4.0". Optional. */
  androidVersionName?: string | null;
  /**
   * Builds older than this cannot run. OMITTED for a routine release — see the rule above. Only set
   * this when an old build is genuinely broken or unsafe.
   */
  minAndroidVersionCode?: number | null;
  /** Where "Update" sends the user. */
  storeUrl?: string | null;
}

export interface UpdateDecisionInput {
  /** True only inside the installed native shell. */
  isNative: boolean;
  platform?: string | null;
  /** The running build's own versionCode, from App.getInfo(). */
  installedVersionCode: number | null;
  store: StoreVersionInfo | null;
  /** The versionCode the user last dismissed, if any. */
  dismissedVersionCode?: number | null;
  /** When they dismissed it (epoch ms). */
  dismissedAt?: number | null;
  now: number;
}

export type UpdateVerdict =
  | { show: false; reason: string }
  | { show: true; forced: boolean; latest: number; versionName: string | null; storeUrl: string };

/** Default Play listing for this app. The bundle id is permanent (see nativeShellInvariants). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.navbharat.ai';

/**
 * The Play Store APP deep link for this app. `market://` is answered by the Play Store app on Android and
 * opens the listing INSIDE the store; a plain `https://play.google.com/…` link opens the browser instead
 * (admin report 2026-08-16: the Update button opened the website, not the Play Store). The bundle id is
 * permanent (nativeShellInvariants), so this is a constant.
 */
export const PLAY_STORE_MARKET_URL = 'market://details?id=com.navbharat.ai';

/**
 * The Play Store APP (`market://`) deep link for a Play listing URL. Given the server's `storeUrl` (an
 * `https://play.google.com/store/apps/details?id=…`), returns the `market://details?id=…` that opens the
 * Play Store app directly. Any non-Play or malformed URL falls back to this app's own market link, so the
 * caller always has a store-app URL to fire rather than a browser one. PURE + tested.
 */
export function playStoreAppUrl(storeUrl?: string | null): string {
  if (!storeUrl) return PLAY_STORE_MARKET_URL;
  try {
    const u = new URL(storeUrl);
    if (!/(^|\.)play\.google\.com$/i.test(u.hostname)) return PLAY_STORE_MARKET_URL;
    const id = u.searchParams.get('id');
    return id ? `market://details?id=${encodeURIComponent(id)}` : PLAY_STORE_MARKET_URL;
  } catch {
    return PLAY_STORE_MARKET_URL;
  }
}

/** How long a dismissal silences the banner for the SAME version. */
export const DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

/**
 * Should the "update available" banner be shown right now?
 *
 * Every negative branch names its reason, so the admin diagnostics can say WHY a device is not being
 * prompted instead of leaving it a mystery — the difference between "working as designed" and "the
 * feature is silently broken" is exactly this string.
 */
export function decideUpdate(input: UpdateDecisionInput): UpdateVerdict {
  // The web always serves the newest build; there is nothing to update.
  if (!input.isNative) return { show: false, reason: 'not-native' };
  // iOS is deliberately out of scope (admin: no .ipa) — this is the Play Store path only.
  if (input.platform && String(input.platform).toLowerCase() !== 'android') {
    return { show: false, reason: 'not-android' };
  }

  const installed = int(input.installedVersionCode);
  const latest = int(input.store?.androidVersionCode);
  // NEVER GUESS: an unknown on either side means no claim at all.
  if (installed == null) return { show: false, reason: 'installed-version-unknown' };
  if (latest == null) return { show: false, reason: 'store-version-unknown' };
  if (latest <= installed) return { show: false, reason: 'up-to-date' };

  const storeUrl = (input.store?.storeUrl || PLAY_STORE_URL).trim() || PLAY_STORE_URL;
  const versionName = input.store?.androidVersionName?.trim() || null;

  // A forced update must be an explicit server decision, never a consequence of shipping.
  const minimum = int(input.store?.minAndroidVersionCode);
  if (minimum != null && installed < minimum) {
    return { show: true, forced: true, latest, versionName, storeUrl };
  }

  // NEVER NAG: a dismissal holds for this version until it goes stale, and a NEWER version overrides
  // it — someone who said "not now" to build 40 should still hear about build 55.
  const dismissed = int(input.dismissedVersionCode);
  if (dismissed != null && dismissed >= latest) {
    const at = typeof input.dismissedAt === 'number' ? input.dismissedAt : null;
    if (at == null || input.now - at < DISMISS_COOLDOWN_MS) {
      return { show: false, reason: 'dismissed' };
    }
  }

  return { show: true, forced: false, latest, versionName, storeUrl };
}

/** The user-facing line. Kept short — a banner nobody reads is a banner nobody taps. */
export function updateMessage(v: Extract<UpdateVerdict, { show: true }>): string {
  const name = v.versionName ? ` (${v.versionName})` : '';
  return v.forced
    ? `This version of NavBharatAI is no longer supported. Please update${name} to continue.`
    : `A new version of NavBharatAI${name} is available on the Play Store.`;
}

/**
 * Parse whatever the server returned into a trustworthy shape.
 *
 * Deliberately strict: a malformed payload becomes `null` (⇒ no prompt) rather than a partially-read
 * object that could compare against a garbage number and tell every user to update.
 */
export function parseStoreVersion(raw: unknown): StoreVersionInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const code = int(o.androidVersionCode);
  if (code == null) return null;
  const url = typeof o.storeUrl === 'string' && /^https?:\/\//.test(o.storeUrl) ? o.storeUrl : null;
  return {
    androidVersionCode: code,
    androidVersionName: typeof o.androidVersionName === 'string' ? o.androidVersionName : null,
    minAndroidVersionCode: int(o.minAndroidVersionCode),
    storeUrl: url,
  };
}
