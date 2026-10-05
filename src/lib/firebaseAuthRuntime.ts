// Four `firebase/auth` exports that exist at runtime but that the v12 umbrella TYPES do not surface to
// tsc. Two components used to reach them with `(await import('firebase/auth')) as any` — five times in
// AuthComponent and once in VerifyPhoneSheet.
//
// Q-625: those `import()` calls split nothing. firebase/auth is imported statically by `lib/firebase.ts`,
// which is in the startup chunk, so every one of them was a free `await` in the middle of a sign-in
// handler and nothing more (an `await` before a popup is how Apple sign-in once lost its user activation —
// see the DESKTOP FIX note in AuthComponent). They are read here, once, from a static namespace import.
//
// Each export is a direct member read (`ns.X`), never `const m = ns as any`: a namespace object that
// escapes into a variable would force the bundler to keep every export of firebase/auth.

import * as firebaseAuth from 'firebase/auth';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const OAuthProvider: any = (firebaseAuth as any).OAuthProvider;
export const PhoneAuthProvider: any = (firebaseAuth as any).PhoneAuthProvider;
export const signInWithCustomToken: any = (firebaseAuth as any).signInWithCustomToken;
export const linkWithPhoneNumber: any = (firebaseAuth as any).linkWithPhoneNumber;
