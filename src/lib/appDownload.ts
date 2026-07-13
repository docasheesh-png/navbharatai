// "Download app" affordance for the WEB (admin request 2026-07-13): a sidebar button, shown ONLY to a
// mobile-web visitor on navbharatai.com (never inside the already-installed native app, never on
// desktop), that downloads the Android app directly. When the admin hosts a signed APK and sets
// VITE_APK_DOWNLOAD_URL, the button downloads that APK; otherwise it falls back to the Play listing so
// the button is ALWAYS real — never a dead/fake link.

import { isNativeApp } from './mobileNative';

// Distribution links. The app is currently in INTERNAL TESTING, so the PUBLIC store listing does not
// exist yet (a public visitor would get "item not found"). The internal-test opt-in link is what
// actually lets an added tester install today. Both are overridable via VITE_PLAY_LISTING_URL, so when
// the app is promoted to production the admin just points that env var at the public listing — no code
// change. NOTE: the internal-test link only works for testers the admin has added (≤100); for truly
// public direct install, host the signed APK and set VITE_APK_DOWNLOAD_URL (that takes priority below).
export const PUBLIC_LISTING_URL = 'https://play.google.com/store/apps/details?id=com.navbharat.ai';
export const INTERNAL_TEST_URL = 'https://play.google.com/apps/internaltest/4701220640641478442';
/** The honest fallback when no direct-APK URL is configured — today the internal-test link. */
export const DEFAULT_LISTING_URL = INTERNAL_TEST_URL;

/** Pure decision core (unit-testable) — no globals. */
export function computeShowDownloadApp(input: {
  native: boolean;
  userAgent: string;
  innerWidth: number;
  hostname: string;
}): boolean {
  if (input.native) return false; // already inside the installed app → nothing to download
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(input.userAgent || '') || input.innerWidth < 768;
  if (!isMobile) return false;
  const host = input.hostname || '';
  return host === 'navbharatai.com' || host.endsWith('.navbharatai.com');
}

/**
 * The URL the "Download app" button points at, in priority order:
 *   1. VITE_APK_DOWNLOAD_URL   — a hosted signed APK → real DIRECT download for anyone (sideload).
 *   2. VITE_PLAY_LISTING_URL   — an admin-set listing (e.g. the public store page once live).
 *   3. DEFAULT_LISTING_URL     — today's internal-test opt-in link (works for added testers).
 * Always a real link — never dead/fake.
 */
export function apkDownloadUrl(): string {
  try {
    const apk = (import.meta.env.VITE_APK_DOWNLOAD_URL as string | undefined)?.trim();
    if (apk) return apk;
    const listing = (import.meta.env.VITE_PLAY_LISTING_URL as string | undefined)?.trim();
    if (listing) return listing;
  } catch {
    /* import.meta may be unavailable in some test envs */
  }
  return DEFAULT_LISTING_URL;
}

/** Should the "Download app" button render right now? Mobile web on navbharatai.com only. Never throws. */
export function shouldShowDownloadApp(): boolean {
  try {
    return computeShowDownloadApp({
      native: isNativeApp(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      innerWidth: typeof window !== 'undefined' ? window.innerWidth : 1024,
      hostname: typeof window !== 'undefined' ? window.location.hostname : '',
    });
  } catch {
    return false;
  }
}
