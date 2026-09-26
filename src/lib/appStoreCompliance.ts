// Apple App Store compliance gating (admin decision 2026-09-26: "App Mart ka Android half iOS par
// hide kar do").
//
// WHY THIS EXISTS: App Mart is two halves. The first is instant web apps that open in the browser,
// and it works perfectly on an iPhone. The second is real Android `.apk` apps you download and
// install — and that one cannot work on an iPhone at all. An `.apk` does not install on iOS, so a
// "Download .apk" button there promises something the device cannot do: exactly the dead button the
// second absolute rule forbids. Separately, an iOS app that lists downloadable application packages
// for another platform invites a reviewer's question under Guideline 2.5.2 (executable code) / 4.7 —
// a risk taken for nothing, since the capability is unusable on that device anyway.
//
// THE SHAPE IS `playCompliance.ts`'s, deliberately. That module hides the medical-class AIs inside
// the PLAY-distributed shell; this one hides the Android-install half inside the APPLE one. Two
// stores, two rules, one pattern. Neither touches the web.
//
// WHAT THIS DELIBERATELY DOES NOT TOUCH, so the scope stays legible and nobody widens it by
// accident:
//   • the instant-app half — it runs in the WebView and is the reason the page exists on iOS;
//   • the "My apps" tab — a record of the creator's OWN submissions (status text, review note, a
//     download count), with nothing to install and nothing distributed to anyone else;
//   • the Publish tab's steps for building an Android app OF YOUR OWN project — a builder telling
//     you how to produce an artifact is not a store handing one out, and that is NavBharatAI's
//     actual product.
//
// PURE module: no Capacitor imports. Callers pass `Capacitor.getPlatform()`'s string (from
// mobileNative's `nativePlatformName()`), so every rule is unit-testable without a device.

import { isApplePlatform } from './storePurchase';

/**
 * Should App Mart's Android-install half be hidden right now? True only on Apple hardware.
 *
 * ⚠️ IT ASKS THE PLATFORM, NEVER `isNativeApp()`, and that distinction is the whole rule — it is the
 * same mistake the purchase rail was rejected for. An iPhone and an Android phone are both "native",
 * so a gate written on the flag would hide Android apps from the ANDROID app, which is the one place
 * they genuinely install. `isApplePlatform` is imported rather than re-matched here because a second
 * copy of "is this iOS?" is precisely how two copies drift apart.
 */
export function androidInstallsHidden(platform: string | null | undefined): boolean {
  return isApplePlatform(platform);
}

/**
 * The Android listings a device may be shown — none at all on Apple hardware.
 *
 * 🔒 THIS IS THE CHOKEPOINT, not a `hidden` prop on the section. FIVE surfaces read that one list:
 * the tile grid, its pager, the two "is the browse page empty?" conditions, and the detail sheet a
 * tile opens. Gating them one at a time is an inventory the sixth surface is missing from — the
 * lesson the App Store payment fix already paid for. Emptying the list instead makes every reader
 * correct by construction, exactly as `visibleProfessionals` does for the medical cards.
 *
 * Returns a copy, like `visibleProfessionals`, so a caller cannot mutate the source list.
 */
export function visibleAndroidApps<T>(apps: readonly T[], platform: string | null | undefined): T[] {
  return androidInstallsHidden(platform) ? [] : [...apps];
}
