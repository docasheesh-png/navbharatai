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
// App.tsx re-exports from here so every existing `import { auth } from './App'` keeps working.

import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../config/firebase';

export const app = initializeApp({ ...firebaseConfig, firestoreDatabaseId: firebaseConfig.firestoreDbId });
export const auth = getAuth(app);
// Persist sessions in localStorage (explicit, though the default is already durable). Fire-and-forget
// by design — both the default (indexedDB) and this are durable, so a pending switch never loses a
// sign-in; a failure (private mode) just keeps the default and is logged, never thrown.
setPersistence(auth, browserLocalPersistence).catch((e) => console.warn('[firebase] setPersistence failed (keeping default persistence):', e?.message || e));
export const db = getFirestore(app, firebaseConfig.firestoreDbId);
