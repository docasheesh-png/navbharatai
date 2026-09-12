// WHICH BUILD OF THE NATIVE APP IS RUNNING — one reader, shared.
//
// WHY THIS EXISTS AS ITS OWN MODULE. Three places already ask `@capacitor/app` for the same fact
// (`pushNotifications.ts`, `UpdateBanner.tsx`, and `nativeShell.ts` which hands the plugin around),
// and a fourth was about to be added for problem reports. That is the shape this repo has been bitten
// by before — the same fact read four ways, drifting one edit at a time — so the fourth reader is a
// shared one instead.
//
// 🔒 WHY IT MATTERS FOR A PROBLEM REPORT SPECIFICALLY. The Android app is BUNDLED: `capacitor.config.ts`
// sets `webDir: 'dist'` with no `server.url`, so an installed build keeps running the frontend it
// shipped with until the user takes a new one from Play. "It doesn't work on my phone" therefore has a
// very common answer — an old bundle — that is invisible without this number, and that no amount of
// asking the user can reliably recover.

let cached: string | null | undefined;

/**
 * The running native build's versionCode as a string, or null on the web and wherever the plugin
 * cannot answer. Never throws.
 *
 * null means UNKNOWN, never "web" and never zero — a caller that needs to distinguish those must say
 * so from the platform, not by reading a number that was never there.
 */
export async function nativeAppBuild(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    const raw = String((info as { build?: string })?.build ?? '').trim();
    cached = raw ? raw.slice(0, 20) : null;
  } catch {
    // Web, or a shell without the plugin. Not an error — most users are here.
    cached = null;
  }
  return cached;
}

/** Test seam only — a running app's build cannot change, so nothing in production re-reads it. */
export function resetNativeAppBuildCache(): void {
  cached = undefined;
}
