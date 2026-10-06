// What THIS iPhone build was signed with — the one place the app learns it (2026-10-06, Crashlytics
// "Push registration failed", iOS 1.0 (108), iPhone 15).
//
// THE CLASS THIS CLOSES. Push notifications and App Attest are OPT-IN capabilities of the iOS build:
// `ios-ipa.yml` adds their entitlements only when `enable_push_notifications` / `enable_app_attest` is
// ticked, because each needs a one-time Apple Developer + Firebase setup first. But the web bundle inside
// the app was built the same way either way, so the JavaScript ASSUMED both were always there. Build 108
// was signed without `aps-environment`, so iOS could never issue an APNs token — yet the app still asked
// the user for notification permission, still asked Firebase for a token, and reported the certain failure
// to Crashlytics on every sign-in. A permission prompt for notifications that can never arrive is a fake
// feature, and the Crashlytics issue was the honest symptom of it.
//
// THE FIX IS ONE SOURCE OF TRUTH: the same workflow input that adds an entitlement also stamps it into the
// bundle (`VITE_IOS_PUSH` / `VITE_IOS_APP_ATTEST`, set in the "Build the web bundle" step). The two can no
// longer disagree, and `tests/anIosCapabilityIsUsedOnlyWhenTheBuildHasIt.test.ts` pins both halves.
//
// iOS ONLY. Android needs no entitlement for either (FCM and Play Integrity work on every signed build), so
// these answers are never consulted there.
//
// ⚠️ A LOCAL Xcode build made outside the workflow carries neither stamp, so it behaves like a build without
// the capability. To test push from Xcode, build the bundle with `VITE_IOS_PUSH=1 npm run build` first.

/** Was this iOS build signed with the push-notifications entitlement (`aps-environment`)? */
export function iosBuildHasPush(): boolean {
  return import.meta.env.VITE_IOS_PUSH === '1';
}

/** Was this iOS build signed with the App Attest entitlement? */
export function iosBuildHasAppAttest(): boolean {
  return import.meta.env.VITE_IOS_APP_ATTEST === '1';
}
