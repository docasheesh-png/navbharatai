/// <reference types="vite/client" />
// Firebase configuration — reads from Vite env vars with compile-time fallbacks.
// To override locally: create .env.local with VITE_FIREBASE_* values (gitignored).
//
// P5.1 (assessed 2026-06-28): the hardcoded fallbacks below are INTENTIONALLY KEPT, not a
// leaked secret. Two reasons:
//  1) They are LOAD-BEARING in production. The Docker/Cloud Build pipeline does NOT inject
//     any VITE_FIREBASE_* vars, so at build time import.meta.env.VITE_FIREBASE_* is undefined
//     and the app relies entirely on these defaults. Removing them would break Firebase init
//     (auth, Firestore, sync) for every user. They may ONLY be removed AFTER the build is
//     wired to inject the vars — and verified on a real deploy.
//  2) A Firebase WEB apiKey is public by design — it identifies the project, it is not a
//     secret; access is controlled by Firebase Security Rules, not key secrecy. So there is
//     no security benefit to hiding it. (Server-side service-account keys are the real
//     secrets and are NOT in client code.)
// The env vars still take precedence when present (override without a code change).

// authDomain = OUR OWN domain (navbharatai.com). This is what the Google consent screen shows
// ("continue to navbharatai.com", not the raw *.firebaseapp.com project host) and it makes the
// WHOLE auth flow same-origin with the app.
//
// The custom authDomain was previously reverted because signInWithRedirect returned logged-out —
// the ROOT CAUSE was that authDomain (firebaseapp.com) ≠ app origin (navbharatai.com), so the auth
// handler's session storage was cross-origin-partitioned away from the app. Pointing authDomain at
// navbharatai.com makes them SAME-origin, which removes that partitioning entirely (and sign-in is
// popup-first regardless). All prerequisites are now in place and verified (2026-07-04):
//   • server.ts reverse-proxies /__/auth/* + /__/firebase/* to the Firebase host (serves the handler),
//   • navbharatai.com is a Firebase Authorized Domain (current logins from it already succeed), and
//   • the Google OAuth Web client lists https://navbharatai.com/__/auth/handler as a redirect URI
//     AND https://navbharatai.com as a JavaScript origin.
// Override per-env with VITE_FIREBASE_AUTH_DOMAIN. NOTE: server.ts's FIREBASE_AUTH_HOST must stay the
// real *.firebaseapp.com host — that is the proxy's upstream, not the client authDomain.
//
// NATIVE APP (admin 2026-07-15 — "google login iOS app me nahi ho raha: auth/network-request-failed"):
// the custom authDomain (navbharatai.com) is served through server.ts's reverse-proxy. In the WEB that
// is fine and fixes the redirect-partitioning bug. But inside a Capacitor WebView (origin
// capacitor://localhost) the Firebase SDK reaching that PROXIED custom domain is a real extra failure
// point — a proxy hiccup / unreachable custom host surfaces as auth/network-request-failed and blocks
// Google sign-in. The native app signs in via the NATIVE Google plugin + signInWithCredential, which
// talks to Google's own hosts directly and does NOT need the custom domain — so on native we use the
// project's default *.firebaseapp.com authDomain (Google-hosted, always reachable, no proxy). Web is
// unchanged.
const DEFAULT_FIREBASE_AUTH_DOMAIN = 'gen-lang-client-0866594388.firebaseapp.com';
function isNativeShell(): boolean {
  try {
    const c = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean } }).Capacitor;
    if (!c) return false;
    return typeof c.isNativePlatform === 'function' ? c.isNativePlatform() === true : c.isNative === true;
  } catch { return false; }
}
const AUTH_DOMAIN = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
  || (isNativeShell() ? DEFAULT_FIREBASE_AUTH_DOMAIN : 'navbharatai.com');

export const firebaseConfig = {
  projectId:        import.meta.env.VITE_FIREBASE_PROJECT_ID       || 'gen-lang-client-0866594388',
  appId:            import.meta.env.VITE_FIREBASE_APP_ID            || '1:950841184325:web:5f54018ec63af0376d132c',
  apiKey:           import.meta.env.VITE_FIREBASE_API_KEY           || 'AIzaSyAGIUMRMGgD4MTUxflH4pVbVhVleM0LdwE',
  authDomain:       AUTH_DOMAIN,
  // MIGRATED 2026-07-12 off the AI-Studio free-tier database (ai-studio-cc9cd998-…), which is
  // HARD-CAPPED to 40k writes/day even on Blaze ("cannot exceed free quota even with billing") — that
  // cap exhausted daily and broke payments/wallet/session-save. `navbharat-prod` is a fresh Native-mode
  // database on standard billing with NO daily write cap. Override per-env with VITE_FIREBASE_FIRESTORE_DB.
  firestoreDbId:    import.meta.env.VITE_FIREBASE_FIRESTORE_DB      || 'navbharat-prod',
  storageBucket:    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET    || 'gen-lang-client-0866594388.firebasestorage.app',
  messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER  || '950841184325',
  measurementId:    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID    || '',
};
