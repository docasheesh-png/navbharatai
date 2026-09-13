import { Capacitor } from '@capacitor/core';
import {
  EmailAuthProvider, GoogleAuthProvider, GithubAuthProvider,
  reauthenticateWithCredential, reauthenticateWithPopup, type User,
} from 'firebase/auth';

/**
 * `OAuthProvider` (the Apple door) IS exported by firebase/auth at RUNTIME, but the v12 umbrella types
 * do not re-export it — `AuthComponent` hits the same wall and resolves it the same way. Loading it
 * through the dynamic import keeps one vocabulary for the quirk instead of two.
 */
async function appleProvider(): Promise<{ new (id: string): { credential(o: { idToken: string; rawNonce?: string }): never } }> {
  const mod = (await import('firebase/auth')) as unknown as { OAuthProvider: { new (id: string): { credential(o: { idToken: string; rawNonce?: string }): never } } };
  return mod.OAuthProvider;
}

/**
 * PROVING "IT IS STILL YOU" — THE ONE PLACE, AND WHY IT HAD TO BECOME ONE PLACE.
 *
 * 🔴 THE BUG THIS FIXES (admin 2026-09-13, with a screenshot: *"yeh to kaam hi nahi kar raha hai"* —
 * `Firebase: Error (auth/argument-error)` on the vault's "Confirm with Google" button).
 *
 * The vault's unlock screen re-authenticated with `reauthenticateWithPopup`, which is the WEB flow: it
 * needs `window.open` and the Firebase auth handler on a real http(s) origin. The NATIVE app has
 * neither — its origin is a custom scheme and there is no popup to open — and `AuthComponent` already
 * knows this: it signs users in through the native `@capacitor-firebase/authentication` plugin and then
 * `signInWithCredential`, precisely because "embedded-webview OAuth is blocked/hangs".
 *
 * So the unlock path contradicted the sign-in path. On the app that produced `auth/argument-error`, and
 * because WebAuthn also cannot run in that WebView, the account door was the ONLY door left — which made
 * the whole feature unopenable on a phone. A lock nobody can open is not a strict lock; it is a broken
 * one, and it fails the rule that a shipped feature must work end to end.
 *
 * 🔒 THE CLASS, not the instance (fourth absolute rule, step 2). The same popup call was written out
 * TWICE in `VaultLockGate` — once to unlock and once to enrol a device — so a fix applied to one would
 * have left the other broken, and any future re-auth would have copied whichever it happened to see.
 * There is now exactly one implementation, and it decides native-vs-web the same way the sign-in does.
 *
 * WHAT IS NOT WEAKENED. This still ends in a real Firebase re-authentication, so `auth_time` inside the
 * ID token genuinely moves; the server reads that from the SIGNED token and is what actually decides
 * whether to hand back a ticket (`server/lib/deviceUnlock.ts`). Nothing here tells the server "trust
 * me" — it only makes the proof obtainable on the device the user is actually holding.
 */

/** How long the native provider sheet may hang before the user gets an honest, retryable error. */
const NATIVE_AUTH_TIMEOUT_MS = 90_000;

/**
 * Mirrors `AuthComponent`'s `raceNativeAuth`: a wiring/SDK fault once left the native bridge's promise
 * PENDING FOREVER and the user watched an infinite spinner. Never let the bridge decide the deadline.
 */
async function raceNative<T>(p: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), NATIVE_AUTH_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ReauthMethod = 'google' | 'apple' | 'github' | 'password';

/** Which door this account can actually use — read from the providers Firebase says it has. */
export function reauthMethodFor(user: Pick<User, 'providerData' | 'email'>): ReauthMethod | null {
  const ids = user.providerData.map((p) => p.providerId);
  if (ids.includes(GoogleAuthProvider.PROVIDER_ID)) return 'google';
  if (ids.includes('apple.com')) return 'apple';
  if (ids.includes(GithubAuthProvider.PROVIDER_ID)) return 'github';
  if (ids.includes(EmailAuthProvider.PROVIDER_ID) && user.email) return 'password';
  // A phone-only account has no re-authentication door on this screen. Saying so is better than
  // offering a button that cannot work — which is the exact failure being fixed here.
  return null;
}

/** Human name for the button, so the UI never has to map provider ids itself. */
export function reauthMethodLabel(method: ReauthMethod | null): string {
  if (method === 'google') return 'Confirm with Google';
  if (method === 'apple') return 'Confirm with Apple';
  if (method === 'github') return 'Confirm with GitHub';
  if (method === 'password') return 'Confirm password';
  return 'Confirm it is you';
}

/**
 * Re-authenticate the CURRENT user, by whichever route actually works on this device.
 *
 * Native: the provider's own native sheet (the same plugin the app signs in with) → a fresh credential
 * → `reauthenticateWithCredential`. Web: the popup flow, unchanged.
 *
 * Throws a plain-language Error on any failure; the caller shows it. Returns nothing — the effect is on
 * the Firebase user, and the caller then refreshes the ID token so the server sees the new `auth_time`.
 */
export async function reauthenticateNow(user: User, password?: string): Promise<void> {
  const method = reauthMethodFor(user);
  if (!method) {
    throw new Error('This account cannot be confirmed on this screen. Sign out and sign in again to continue.');
  }

  if (method === 'password') {
    if (!user.email) throw new Error('This account has no password to confirm.');
    if (!password) throw new Error('Enter your account password.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return;
  }

  // ── Social providers ───────────────────────────────────────────────────────────────────────────
  if (!Capacitor.isNativePlatform()) {
    if (method === 'apple') {
      const Apple = await appleProvider();
      await reauthenticateWithPopup(user, new Apple('apple.com') as never);
      return;
    }
    await reauthenticateWithPopup(user, method === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider());
    return;
  }

  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');

  if (method === 'google') {
    const res = await raceNative(
      FirebaseAuthentication.signInWithGoogle(),
      'Google confirmation timed out — please try again.',
    );
    const idToken = res.credential?.idToken;
    if (!idToken) throw new Error('Google did not return a confirmation token — please try again.');
    await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken, res.credential?.accessToken));
    return;
  }

  if (method === 'apple') {
    const res = await raceNative(
      FirebaseAuthentication.signInWithApple({ skipNativeAuth: true }),
      'Apple confirmation timed out — please try again.',
    );
    const idToken = res.credential?.idToken;
    if (!idToken) throw new Error('Apple did not return a confirmation token — please try again.');
    // Apple's credential is nonce-bound: the raw nonce the plugin used must ride along or Firebase
    // rejects the token. `skipNativeAuth` is what makes the plugin hand it back instead of consuming it.
    const Apple = await appleProvider();
    await reauthenticateWithCredential(
      user,
      new Apple('apple.com').credential({ idToken, rawNonce: (res.credential as { nonce?: string } | undefined)?.nonce }),
    );
    return;
  }

  const res = await raceNative(
    FirebaseAuthentication.signInWithGithub({ skipNativeAuth: true }),
    'GitHub confirmation timed out — please try again.',
  );
  const ghToken = res.credential?.accessToken;
  if (!ghToken) throw new Error('GitHub did not return a confirmation token — please try again.');
  await reauthenticateWithCredential(user, GithubAuthProvider.credential(ghToken));
}

/**
 * Why the phone's own lock is not offered inside the native app — stated once, in code, so no screen
 * has to guess and no future session re-derives it from scratch.
 *
 * WebAuthn (the API behind Face ID / fingerprint / PIN in a browser) binds a credential to an ORIGIN.
 * The Capacitor shell's origin is `capacitor://localhost` on iOS — a custom scheme, which cannot be a
 * WebAuthn relying-party id at all — and the Android WebView's support varies by version. That is a
 * platform fact, not a defect in this app and not a missing lock on the user's phone: the phone has a
 * lock, the WebView simply cannot reach it.
 *
 * So on the app the honest copy says THAT, rather than "this device has no lock available", which reads
 * as the phone's fault and sends the user hunting through their settings for something that is already
 * switched on.
 */
export function deviceLockUnavailableReason(): 'native-shell' | 'browser' {
  return Capacitor.isNativePlatform() ? 'native-shell' : 'browser';
}
