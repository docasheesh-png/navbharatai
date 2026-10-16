// WARM THE SCREENS A MODE SWITCH OPENS, WHILE THE BROWSER IS IDLE (admin 2026-10-14: "navbharatai free me
// mode change karne me bahut time lag raha hai … free->dr ai, dr ai->teacher ai, sab slow hai").
//
// 🔴 WHAT WAS MEASURED (real production build, headless Chromium, desktop, 4x CPU, 150 ms RTT / 1.5 Mbps):
// the first switch to each AI took 490 ms (Teacher AI) and 590 ms (image studio); every later switch took
// 60-110 ms. The whole difference is the screen's code arriving: Doctor AI, every professional and the
// image studio are separate lazy chunks (App.tsx `_lz`, ViewPanels.tsx), fetched only when the user picks
// them. The picker closes, the user waits on a network round trip, and the next mode waits on another —
// on a real connection, uncached, that is what "every switch is slow" feels like.
//
// 🔒 THE FIX IS TO START THAT DOWNLOAD EARLY, NOT TO REMOVE THE SPLIT. The chunks stay lazy (a user who
// never opens Doctor AI still never executes it); after the app is up and the browser is idle, each one is
// fetched ONCE and left in the HTTP cache (`immutable`, one year), so the pick finds it already there.
// `import()` of the same specifier the lazy screen uses resolves to the same chunk, so nothing is
// downloaded twice and no code runs until the screen is opened.
//
// It never competes with the user: one chunk at a time, after the load event, only in an idle slot, and
// not at all on a data-saver or 2G connection, in the native apps (the bundle is on the device already) or
// outside a production build.
//
// 🔴 "NATIVE" IS ASKED OF `isNativeApp()`, NEVER OF `window.Capacitor`: the Capacitor core defines that global in
// every browser too, so testing for its mere presence switched the warm-up off on the website — the only
// place it is for. (Found by measuring: the first build of this file fetched nothing.)
//
// The policy is a pure function so the tests can pin it.

/** The screens a Mode pick opens, in the order a person reaches for them. */
export const WARMED_SCREENS: ReadonlyArray<{ name: string; load: () => Promise<unknown> }> = Object.freeze([
  { name: 'free-chat', load: () => import('../components/panels/NBIChatPanel') },
  { name: 'professional-chat', load: () => import('../components/professionals/ProfessionalChat') },
  { name: 'doctor-ai', load: () => import('../components/sda/SDAChat') },
  { name: 'image-studio', load: () => import('../components/ide/AIImageGenerator') },
]);

export interface WarmEnv {
  production: boolean;
  nativeShell: boolean;
  saveData?: boolean;
  effectiveType?: string;
}

/** Should idle warming run here at all? PURE. */
export function shouldWarmModeChunks(env: WarmEnv): boolean {
  if (!env.production || env.nativeShell) return false;
  if (env.saveData === true) return false;
  return !/^(slow-2g|2g)$/.test(String(env.effectiveType ?? ''));
}

import { isNativeApp } from './mobileNative';

let started = false;

/** Fetch each warmed screen once, one at a time, in idle slots. Best-effort: a failure only means the user waits as before. */
export function warmModeChunksWhenIdle(): void {
  if (started || typeof window === 'undefined') return;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!shouldWarmModeChunks({
    production: Boolean(import.meta.env?.PROD),
    nativeShell: isNativeApp(),
    saveData: conn?.saveData,
    effectiveType: conn?.effectiveType,
  })) return;
  started = true;
  const idle = (cb: () => void) => {
    const ric = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(cb, { timeout: 4000 }); else setTimeout(cb, 1500);
  };
  let i = 0;
  const next = () => {
    if (i >= WARMED_SCREENS.length) return;
    const screen = WARMED_SCREENS[i++];
    screen.load().catch(() => { /* a failed warm-up costs nothing; the pick will fetch it itself */ }).finally(() => idle(next));
  };
  const begin = () => setTimeout(() => idle(next), 2500); // after the first screen has had its moment
  if (document.readyState === 'complete') begin(); else window.addEventListener('load', begin, { once: true });
}
