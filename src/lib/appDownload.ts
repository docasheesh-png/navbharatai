// "Download app" affordance for the WEB (admin request 2026-07-13): a sidebar button, shown ONLY to a
// mobile-web visitor on navbharatai.com (never inside the already-installed native app, never on
// desktop), that downloads the Android app directly. When the admin hosts a signed APK and sets
// VITE_APK_DOWNLOAD_URL, the button downloads that APK; otherwise it falls back to the Play listing so
// the button is ALWAYS real — never a dead/fake link.

import { isNativeApp } from './mobileNative';

/** The Play listing — the honest fallback when no direct-APK URL is configured. */
export const PLAY_LISTING_URL = 'https://play.google.com/store/apps/details?id=com.navbharat.ai';

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

/** The URL the "Download app" button points at: the configured direct-APK URL, else the Play listing. */
export function apkDownloadUrl(): string {
  try {
    const u = (import.meta.env.VITE_APK_DOWNLOAD_URL as string | undefined)?.trim();
    if (u) return u;
  } catch {
    /* import.meta may be unavailable in some test envs */
  }
  return PLAY_LISTING_URL;
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
