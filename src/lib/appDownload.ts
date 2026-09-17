// "Download app" affordance for the WEB (admin request 2026-07-13): a sidebar button, shown ONLY to a
// mobile-web visitor on navbharatai.com (never inside the already-installed native app, never on
// desktop), that takes them to the Android app.
//
// 🔴 THE BUG THIS FIXES, and it is a default that outlived its premise (admin, 2026-09-17: "jab koi
// user download app par click karta hai to pata nahi kahan redirect ho jata hai").
//
// This module used to default to the Play **internal-test opt-in** link, and the reasoning written
// beside it was correct AT THE TIME: *"The app is currently in INTERNAL TESTING, so the PUBLIC store
// listing does not exist yet (a public visitor would get 'item not found')."* The app went to
// PRODUCTION on Play on 2026-08-25 (release 91 — see CLAUDE.md's ANDROID_LATEST_VERSION_CODE entry).
// The premise changed; the default did not. So every ordinary visitor tapping "Download app" was sent
// to an opt-in page that shows them nothing unless the admin had personally added them as one of the
// (at most 100) internal testers.
//
// ⚠️ AND THE ESCAPE HATCH THE OLD COMMENT PROMISED COULD NOT BE USED. It said the migration needed
// "no code change — the admin just points VITE_PLAY_LISTING_URL at the public listing". That is false
// here: `import.meta.env.VITE_*` is frozen when the Docker image is BUILT, and neither
// VITE_PLAY_LISTING_URL nor VITE_APK_DOWNLOAD_URL is passed as a build `ARG` (Dockerfile/cloudbuild.yaml
// pass only VITE_PREVIEW_ORIGIN). Setting either one in Cloud Run therefore changes NOTHING, with no
// error anywhere to reveal it — the exact silent-drift class CLAUDE.md records for VITE_META_PIXEL_ID.
// Wiring one up is a deliberate four-line change (an `ARG`+`ENV` pair in Dockerfile, a `--build-arg`
// and a substitution in cloudbuild.yaml), following the VITE_PREVIEW_ORIGIN pattern already in both
// files. It is named here so nobody has to re-derive it, and so nobody "fixes" this again by setting a
// Cloud Run variable that cannot reach the browser.
//
// 🔒 THE CONSEQUENCE, which is the whole design of this file now: **the code default has to be right on
// its own**, because it is the only value that can actually reach a user today. It is the public Play
// listing, and the internal-test constant is GONE rather than demoted — a constant sitting one
// assignment away from being the default again is how this bug comes back.

import { isNativeApp } from './mobileNative';

/** The public Google Play listing — the one and only place a "Download app" tap may land today. */
export const PUBLIC_LISTING_URL = 'https://play.google.com/store/apps/details?id=com.navbharat.ai';

/** What `apkDownloadUrl()` returns when no build-time override was baked in. */
export const DEFAULT_LISTING_URL = PUBLIC_LISTING_URL;

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
 *   1. VITE_APK_DOWNLOAD_URL   — a hosted signed APK → a direct sideload download.
 *   2. VITE_PLAY_LISTING_URL   — an override of the listing.
 *   3. DEFAULT_LISTING_URL     — the PUBLIC Play listing. This is what production returns.
 *
 * ⚠️ Rungs 1 and 2 are BUILD-TIME values and are NOT wired into the image build today (see the header),
 * so in production this function returns the public Play listing. They are kept because the
 * android-aab workflow already documents VITE_APK_DOWNLOAD_URL as the path for hosting a signed APK —
 * but reading them is not the same as being able to set them, and the header says which is which.
 *
 * Always a real link — never dead, and never an internal-test page a visitor cannot open.
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
