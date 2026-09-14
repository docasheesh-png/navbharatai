// COMING BACK FROM SUPABASE INSIDE THE NATIVE APP (admin report 2026-09-14: "database supabase connect
// hi nahi ho raha", screenshotted from the iOS app: tapping "Connect Supabase" ends on an in-browser
// "Please sign in first." with no way back into the app).
//
// ROOT CAUSE. The one-tap connect flow (`SupabaseConnectCard.tsx` + `supabaseIntegration.ts`) was built
// and fixed for the WEB app only: `connect()` does a full-page `window.location.assign()` to Supabase,
// and the server callback redirects back to `https://navbharatai.com/?sbconnect=<nonce>` — a SAME-TAB,
// SAME-ORIGIN round trip that works because a web browser tab never changes origin.
//
// The native (Capacitor) app's own WebView origin is `https://localhost` (Android) or
// `capacitor://localhost` (iOS) — NOT `https://navbharatai.com` (see CLAUDE.md's own notes on the
// secret-vault device lock, and `capacitor.config.ts`). So on native:
//   1. `window.location.assign()` leaves the app's own origin for Supabase's OAuth pages, which iOS/
//      Android route into the SYSTEM browser (exactly the Safari chrome visible in the report screenshot).
//   2. Supabase's redirect lands on `https://navbharatai.com/...` — a REAL public origin, completely
//      separate from the native app's own storage, with no Firebase Auth session in it.
//   3. The server's 302 to `https://navbharatai.com/?sbconnect=...` loads the full web app there, and its
//      attempt to complete the connection (`authedFetch('/api/integrations/supabase/complete')`) has no
//      ID token to attach — 401 "Please sign in first.", verbatim what the report showed.
//
// This is THE SAME CLASS of bug already root-caused and fixed for GitHub connect (see
// `githubOauthReturn.ts` and `useGitHubConnect.ts`'s "the user is stranded on the website in an external
// browser" comment) — just never ported to Supabase. The fix mirrors that one: an IN-APP browser
// (`@capacitor/browser`) instead of a full navigation, and a return via the app's own custom URL scheme
// (`com.navbharat.ai://supabase-callback`, the SAME scheme GitHub already registered — see the Android
// manifest's scheme-only `<data android:scheme="com.navbharat.ai" />` intent-filter and the iOS workflow's
// `CFBundleURLSchemes` entry — so nothing native-side needs registering again).
//
// UNLIKE GitHub, no encrypted ticket is needed here: the nonce this deep link carries is not a secret —
// it only unlocks a claim that the server independently checks is being made by the SAME Firebase uid
// that started the flow (`claimPendingConnection` in `supabaseIntegration.ts`). An app that intercepted
// the scheme could read the nonce but could never redeem it as anyone else's account.
//
// PURE — the parsing lives here, deep-link-shaped input in, so it is testable without a device.

/** Where the app's Supabase-connect deep link lands. Must match the server's native redirect target. */
export const SUPABASE_DEEP_LINK_PREFIX = 'com.navbharat.ai://supabase-callback';

/**
 * The completion nonce carried by a deep link, or null when this is not our Supabase return.
 *
 * Sent as a QUERY param (not a fragment) because the server builds this redirect itself — unlike the
 * GitHub token, there is no reason to keep it out of a server access log; it is a single-use claim key,
 * not a credential. Runs on every deep link the OS hands the app, including ones we did not send, so it
 * must return null for anything that is not our callback.
 */
export function nonceFromSupabaseDeepLink(url: string | null | undefined): string | null {
  const raw = String(url ?? '');
  if (!raw.startsWith(SUPABASE_DEEP_LINK_PREFIX)) return null;
  const query = raw.slice(SUPABASE_DEEP_LINK_PREFIX.length).replace(/^\?/, '');
  const nonce = new URLSearchParams(query).get('nonce');
  return nonce && nonce.trim() ? nonce : null;
}

/** The honest failure message carried by a deep link, or null when there is none. */
export function errorFromSupabaseDeepLink(url: string | null | undefined): string | null {
  const raw = String(url ?? '');
  if (!raw.startsWith(SUPABASE_DEEP_LINK_PREFIX)) return null;
  const query = raw.slice(SUPABASE_DEEP_LINK_PREFIX.length).replace(/^\?/, '');
  const error = new URLSearchParams(query).get('error');
  return error && error.trim() ? error : null;
}

/** The custom window event dispatched when a native Supabase-connect deep link has just been stashed. */
export const SUPABASE_NATIVE_RETURN_EVENT = 'navbharat:supabase-native-return';
