/// <reference types="vite/client" />
// Firebase configuration — reads from Vite env vars with compile-time fallbacks.
// To override locally: create .env.local with VITE_FIREBASE_* values (gitignored).
// For production: set substitution variables in cloudbuild.yaml.

const FALLBACK_AUTH_DOMAIN = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'gen-lang-client-0866594388.firebaseapp.com';

/**
 * authDomain decides where the OAuth/redirect sign-in helper (`/__/auth/*`) and the
 * auth iframe live. When it differs from the app's own origin, modern browsers
 * partition that storage so signInWithRedirect comes back signed-OUT, and Google's
 * consent screen shows the firebaseapp.com domain instead of ours. On our own
 * domains the server proxies `/__/auth/*` + `/__/firebase/*` to Firebase, so we point
 * authDomain at the CURRENT origin — same-origin storage (redirect completes) and the
 * consent screen reads "continue to navbharatai.com". Other hosts keep the default.
 */
function resolveAuthDomain(): string {
  if (typeof window === 'undefined') return FALLBACK_AUTH_DOMAIN;
  const host = window.location.hostname;
  if (host === 'navbharatai.com' || host === 'www.navbharatai.com') return host;
  return FALLBACK_AUTH_DOMAIN;
}

export const firebaseConfig = {
  projectId:        import.meta.env.VITE_FIREBASE_PROJECT_ID       || 'gen-lang-client-0866594388',
  appId:            import.meta.env.VITE_FIREBASE_APP_ID            || '1:950841184325:web:5f54018ec63af0376d132c',
  apiKey:           import.meta.env.VITE_FIREBASE_API_KEY           || 'AIzaSyAGIUMRMGgD4MTUxflH4pVbVhVleM0LdwE',
  authDomain:       resolveAuthDomain(),
  firestoreDbId:    import.meta.env.VITE_FIREBASE_FIRESTORE_DB      || 'ai-studio-cc9cd998-d842-4462-9833-b44f49825878',
  storageBucket:    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET    || 'gen-lang-client-0866594388.firebasestorage.app',
  messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER  || '950841184325',
  measurementId:    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID    || '',
};
