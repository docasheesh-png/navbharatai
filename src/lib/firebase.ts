// THE single client-side Firebase initialization (root-cause fix, 2026-07-11).
//
// BUG CLASS THIS KILLS: the client used to call initializeApp() in TWO modules with DIFFERENT
// options — App.tsx (the real config: custom authDomain `navbharatai.com`, the same-origin domain
// the whole popup/redirect auth flow depends on) and this file (a stale JSON with the OLD
// cross-origin `*.firebaseapp.com` authDomain). The Firebase SDK throws `app/duplicate-app` when
// the second call's options differ — so whichever module loaded second CRASHED, and if this file
// ever loaded FIRST, the default app carried the WRONG authDomain and Google sign-in state got
// cross-origin-partitioned (the exact silent first-login failure the custom domain was built to
// fix). Now there is exactly ONE init, built from the ONE config (src/config/firebase.ts), and
// THE one place Firebase is initialised, and now the one place `auth`/`db` are imported FROM.
// App.tsx used to re-export them so features could take them off the app root; that re-export was
// removed on 2026-08-24 because it formed an import cycle through the root and made the client
// bundle unsplittable. Every consumer imports from here directly — see tests/appModuleGraph.test.ts.

import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, setPersistence, browserLocalPersistence, indexedDBLocalPersistence, signOut as fbSignOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { firebaseConfig } from '../config/firebase';
import { ensureSessionPersisted, hasPersistedSession, type SessionPersistenceOutcome } from './authPersistence';

export const app = initializeApp({ ...firebaseConfig, firestoreDatabaseId: firebaseConfig.firestoreDbId });

// ROOT-CAUSE FIX — iOS "Google returned token: YES → verifying with Firebase… → never completes"
// (admin 2026-07-18, TestFlight builds 25–29). The build-29 diagnostic PROVED the network is fine
// (`net probe: HTTP 200 in 1171ms` to identitytoolkit) and that `signInWithCredential` neither resolves
// NOR rejects. That signature is the well-known Firebase JS SDK ✕ Capacitor WKWebView incompatibility:
// `getAuth()` wires the DEFAULT browser integrations (the popup/redirect resolver with its hidden iframe
// to authDomain + browser persistence heuristics), and inside a `capacitor://localhost` WebView that
// machinery can never finish initializing — so the auth instance's internal operation queue never opens,
// and EVERY sign-in op (Google credential exchange, email, phone) queues behind it forever: no error,
// no result, an eternal "verifying with Firebase…". This is exactly why the failure survived all three
// call-site fixes (#1512/#1515/#1516) — the defect is in how the auth INSTANCE is created, not in any flow.
//
// The Capacitor recipe: on NATIVE, create the instance with `initializeAuth` — explicit persistence and
// NO popupRedirectResolver (native sign-in uses the plugin + signInWithCredential; it never needs the
// popup/redirect iframe). WEB is byte-for-byte unchanged: `getAuth` + the localStorage preference.
//
// PART 2 of the root fix — WHY localStorage and NOT indexedDB on native (build 30 evidence, admin
// 2026-07-18): with the init fixed, build 30 got a real step further — the Google exchange SUCCEEDED
// (auth.currentUser was set, the modal auto-closed via the settle guard's currentUser check) but the app
// STILL showed logged-out and nothing survived a relaunch. That is the signature of the session-SAVE
// hanging: the SDK sets currentUser, then AWAITS persistence.setCurrentUser(user), and only THEN notifies
// onAuthStateChanged listeners. On iOS, WebKit suspends IndexedDB transactions when the WebView is
// backgrounded — and the native Google/Apple/GitHub sheet does exactly that — so the IDB write wedges,
// the listener notification never fires, and the UI/session never learn about the successful login.
// localStorage is synchronous and immune to that suspension, so the save completes and onAuthStateChanged
// fires normally. (Tradeoff, stated honestly: sessions stored under the old IDB key are not read anymore —
// one extra login after this update, on a path that was broken anyway.)
// PART 3 of the root fix — THE COLD-RESTART LOGOUT (admin 2026-07-25: "app band karo, background se
// clear karo, wapas open karo — logout hi mila tha", on BOTH platforms and EVERY provider).
//
// `initializeAuth` resolves persistence exactly ONCE, at this line, by asking each candidate
// `_isAvailable()`. Passing a SINGLE store meant that if localStorage was unavailable for even that
// instant inside the WebView, the SDK SILENTLY fell back to IN-MEMORY persistence for the whole app
// session — sign-in worked, the app behaved normally, and the session evaporated on the next launch.
// That also explains why every OTHER localStorage value (settings, chats, workspaces) survived a cold
// restart while only the login did: our own writes happen later, once storage is warm.
//
// Passing an ordered HIERARCHY of DURABLE stores removes the silent-downgrade path: a transient
// localStorage miss now falls through to IndexedDB (also durable) instead of collapsing to in-memory.
// localStorage stays FIRST because it is synchronous and immune to the WebKit IndexedDB suspension that
// wedged the native sign-in write (PART 2 above) — IndexedDB is only ever the fallback, never the
// default. The healing half lives in `ensureNativeSessionPersisted()` below.
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: [browserLocalPersistence, indexedDBLocalPersistence] })
  : getAuth(app);
// WEB ONLY: persist sessions in localStorage (explicit, though the default is already durable).
// Fire-and-forget by design — both the default (indexedDB) and this are durable, so a pending switch
// never loses a sign-in; a failure (private mode) just keeps the default and is logged, never thrown.
// (On native the persistence was fixed at init above — never enqueue extra ops on the native instance.)
if (!Capacitor.isNativePlatform()) {
  setPersistence(auth, browserLocalPersistence).catch((e) => console.warn('[firebase] setPersistence failed (keeping default persistence):', e?.message || e));
}
export const db = getFirestore(app, firebaseConfig.firestoreDbId);

/**
 * THE HEALING HALF of the cold-restart-logout fix (see the `auth` initialization above).
 *
 * Layer 1 (the persistence hierarchy) stops the silent in-memory downgrade from happening. This is
 * layer 2, the last line of defence: once a user is actually signed in, VERIFY that a durable session
 * record really exists. If it does not, the instance is running in-memory and the session would be lost
 * on the next launch — so re-apply a durable persistence, which makes the Firebase SDK MIGRATE the
 * current user into it, then re-verify.
 *
 * Best-effort and non-blocking by construction: it never throws and never gates sign-in, so a failure
 * here can only ever leave today's behavior, never break a working login. Returns an HONEST outcome
 * (`repair-failed` is reported as such, never dressed up as success) so a future diagnostic can state
 * plainly whether the session will survive a restart. NO-OP on web, whose persistence is already sound.
 */
export async function ensureNativeSessionPersisted(): Promise<SessionPersistenceOutcome | 'skipped-web'> {
  if (!Capacitor.isNativePlatform()) return 'skipped-web';
  return ensureSessionPersisted({
    hasDurableSession: () => {
      try { return hasPersistedSession(typeof localStorage !== 'undefined' ? localStorage : null); } catch { return false; }
    },
    // Re-applying a durable persistence is what migrates the live user into storage.
    applyDurablePersistence: () => setPersistence(auth, browserLocalPersistence),
    log: (m) => console.warn(m),
  });
}

/**
 * FULL client sign-out — clears the session on EVERY layer, so "logout" truly logs out.
 *
 * ROOT-CAUSE FIX (admin 2026-07-18: "app me bhi logout hota hi nahi"): in the Capacitor app the sign-in
 * runs through the NATIVE `@capacitor-firebase/authentication` plugin, which holds its OWN session
 * (GIDSignIn on iOS / Google Sign-In on Android) ON TOP of the web SDK's. `performSignOut` only cleared
 * the web SDK (`signOut(auth)`), so the native plugin session lingered — the user looked logged out but a
 * stale native session survived (and only got cleared by the NEXT sign-in). This signs out the native
 * plugin first (app only — the dynamic import never loads on web), THEN the web SDK, so logout is complete
 * on both app and browser. Best-effort on the native leg: a plugin signOut failure must never block the
 * web signOut that actually flips the app to logged-out.
 */
export async function signOutEverywhere(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      await FirebaseAuthentication.signOut();
    } catch { /* no native plugin session (or web) — fine */ }
  }
  await fbSignOut(auth);
}
