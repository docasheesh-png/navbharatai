import React, { useState, useEffect, useRef } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  Auth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  linkWithCredential,
  AuthProvider,
  UserCredential,
} from 'firebase/auth';
import { SIGN_IN_HINT_KEY } from '../lib/accountRoster';
import { Capacitor } from '@capacitor/core';
import { raceNativeAuth, settleWithinOrProceed, preLoginWebSignOutAllowed } from '../lib/nativeAuthGuard';
import { normalizePhone } from '../lib/phoneNumber';
import { motion } from 'motion/react';
import { X, AlertCircle, Loader2, Github } from 'lucide-react';
import { TirangaLoader } from './ui/TirangaLoader';
import { cn } from '../lib/utils';
import { firebaseConfig } from '../config/firebase';
import { signOutEverywhere } from '../lib/firebase';
import { markRedirectStarted } from '../lib/redirectSignInMarker';
import { explainAuthReason, shouldDeepDiagnose } from '../lib/authDiagnostics';
import { popupFailureAction, waitForSignedInUser, settleNativeSignIn, appleSignInFailureMessage, webSignInStrategy } from './socialSignInPolicy';

/**
 * Force-logout the old session BEFORE a new login — WEB ONLY, and never let it block the sign-in.
 *
 * ROOT-CAUSE FIX — the DEEP one (admin 2026-07-18, TestFlight build 27 sign-in trail):
 *   07:44:23 clearing any old session…
 *   07:44:27 opening Google sign-in…          (4s gap = the bounded clear TIMED OUT — signOut hung)
 *   07:44:37 Google returned — token: YES
 *   07:44:37 verifying with Firebase…
 *   07:44:55 failed: sign-in did not complete (18s later — signInWithCredential never ran)
 * On the iOS WKWebView the web-SDK signOut's persistence write can HANG, and a hung signOut HOLDS Firebase
 * Auth's internal operation queue — so the `signInWithCredential` that follows is stuck behind it forever
 * and the login "does not complete". The earlier fix (bounding the wait) let Google OPEN, but the still-
 * pending hung signOut then poisoned the actual sign-in. i.e. the pre-login force-logout is itself what
 * breaks native login.
 *
 * THE FIX: on the NATIVE app, do NOT sign the web-SDK auth instance out before signing in. The native
 * sign-in (signInWithCredential / signInWithEmailAndPassword / phone credential) REPLACES the old session
 * on its own, so a pre-logout is unnecessary there — and it's the thing that was breaking login. On WEB a
 * stale session can wedge signInWithPopup and signOut is safe (normal IndexedDB), so we keep the bounded
 * clear there. `preLoginWebSignOutAllowed` encodes this decision (tested); the bound is belt-and-braces.
 */
const FORCE_LOGOUT_TIMEOUT_MS = 4000;
async function forceLogoutBeforeLogin(): Promise<void> {
  if (!preLoginWebSignOutAllowed(Capacitor.isNativePlatform())) return; // native: never pre-signout (see above)
  // WEB: bounded + best-effort. settleWithinOrProceed resolves the moment the clear finishes (normal case)
  // OR after FORCE_LOGOUT_TIMEOUT_MS if it ever stalls, and never throws — so login is never blocked.
  await settleWithinOrProceed(signOutEverywhere(), FORCE_LOGOUT_TIMEOUT_MS);
}

/**
 * DIAGNOSTIC (admin 2026-07-18, iOS TestFlight builds 27 + 28): the native Google sign-in gets the Google
 * token ("Google returned — token: YES") but `signInWithCredential` then HANGS ~18s and "does not complete".
 * Because settleNativeSignIn returns 'failed' ONLY when the auth listener never fires, the stall is in the
 * Identity Toolkit NETWORK call (before the user is ever set), not in the persistence write. This probe hits
 * a lightweight, unauthenticated Identity Toolkit endpoint (`createAuthUri`) with a hard 10s timeout and
 * writes the result into the on-screen sign-in trail, so we can SEE whether the WKWebView can even reach
 * Google's auth backend:
 *   • "net probe: HTTP 200 in Nms"  → the network is fine; the SDK exchange itself is the stall (deeper bug)
 *   • "net probe FAILED … TIMEOUT"  → the WebView cannot reach identitytoolkit.googleapis.com → that IS the
 *                                      root cause (a WKWebView/ATS/network path issue to hunt next)
 * Diagnostic ONLY — fired in parallel, it never changes or blocks the real sign-in.
 */
async function probeAuthNetwork(apiKey: string, mark: (s: string) => void): Promise<void> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'probe@navbharatai.com', continueUri: 'https://navbharatai.com' }),
      signal: ctrl.signal,
    });
    mark(`net probe: HTTP ${res.status} in ${Date.now() - started}ms`);
  } catch (e: any) {
    const why = e?.name === 'AbortError' ? 'TIMEOUT(10s)' : String(e?.message || e).slice(0, 40);
    mark(`net probe FAILED in ${Date.now() - started}ms: ${why}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Temporary diagnostic: hit the Identity Toolkit sign-up endpoint directly from
 * the app (so it carries the app's referer + key) and return the RAW server
 * response. This reveals the real reason behind a bare auth/internal-error —
 * e.g. "Requests from referer … are blocked", "CONFIGURATION_NOT_FOUND",
 * "PROJECT_DISABLED", "API key not valid", or "ADMIN_ONLY_OPERATION" (which
 * would actually mean the auth backend is fine).
 */
/**
 * Probe the REAL Identity Toolkit endpoint to surface the actual reason behind a
 * bare auth/internal-error. When email+password are supplied we hit
 * signInWithPassword (the same path the SDK used) so we see the true error
 * (CONFIGURATION_NOT_FOUND, PASSWORD_LOGIN_DISABLED, INVALID_LOGIN_CREDENTIALS…);
 * otherwise we fall back to a generic probe. Returns a plain, actionable message.
 */
async function diagnoseAuth(email?: string, password?: string): Promise<string> {
  try {
    const useLogin = !!(email && password);
    const endpoint = useLogin ? 'signInWithPassword' : 'signUp';
    const body = useLogin ? { email, password, returnSecureToken: true } : { returnSecureToken: true };
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${firebaseConfig.apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const text = await res.text();
    let reason = '';
    try { reason = JSON.parse(text)?.error?.message || ''; } catch { /* keep raw text */ }
    const explained = explainAuthReason(reason);
    return explained || `Server response (${res.status}): ${text}`.slice(0, 400);
  } catch (e: any) {
    return `Could not reach the auth server: ${e?.message ?? String(e)}`;
  }
}

/**
 * Surface the REAL reason behind a Firebase auth failure. The generic
 * "auth/internal-error" message hides the underlying server response; this digs
 * out the nested detail (customData / serverResponse) so the user can see and
 * report the actual cause without a desktop console.
 */
function describeAuthError(err: any): string {
  try {
    const code = err?.code ? `[${err.code}] ` : '';
    const msg = err?.message ?? String(err);
    const cd = err?.customData ?? {};
    let server = cd?.serverResponse ?? cd?._serverResponse ?? cd?.message ?? '';
    if (server && typeof server !== 'string') server = JSON.stringify(server);
    // Avoid repeating the same text twice.
    const extra = server && !msg.includes(String(server)) ? ` — ${server}` : '';
    // Best-effort: also log the full object for a desktop console.
    try { console.error('AUTH_ERROR_FULL', JSON.stringify(err, Object.getOwnPropertyNames(err))); } catch { /* ignore */ }
    return `${code}${msg}${extra}`.slice(0, 700) || 'Sign-in failed. Try again.';
  } catch {
    return err?.message || 'Sign-in failed. Try again.';
  }
}

/**
 * Honest, actionable messages for social (Google/GitHub) sign-in failures. The two
 * failures that are config — not code — name the exact Firebase Console fix so the
 * admin can resolve them without a developer console.
 */
// Prefetched at module load so handleAppleSignIn's await resolves instantly inside the click
// handler — see the DESKTOP FIX note there. A load failure is retried by the handler's own await.
const firebaseAuthModuleForApple = import('firebase/auth');

function describeSocialError(err: any): string {
  const code = err?.code || '';
  switch (code) {
    case 'auth/unauthorized-domain':
      return `This site's domain isn't authorized for sign-in. Admin: add it under Firebase Console → Authentication → Settings → Authorized domains (project ${firebaseConfig.projectId}).`;
    case 'auth/operation-not-allowed':
      return `This sign-in provider isn't enabled. Admin: enable it under Firebase Console → Authentication → Sign-in method (project ${firebaseConfig.projectId}).`;
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Sign in with that method first.';
    case 'auth/network-request-failed':
      return 'Network error reaching the sign-in provider. Check your connection and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled. Please try again.';
    default:
      return describeAuthError(err);
  }
}

/**
 * Capture the GitHub OAuth access token from a successful sign-in and store it so
 * NavBharatAI can connect to the user's repos (git-native storage, deploy, PR flow).
 * The token carries the scopes we requested (repo, workflow, …) — 100% app connection.
 */
function captureGithubToken(result: UserCredential): void {
  try {
    const cred = GithubAuthProvider.credentialFromResult(result);
    if (cred?.accessToken) localStorage.setItem('gh_token', cred.accessToken);
  } catch { /* best-effort — never block sign-in */ }
}

export const AuthComponent = ({ auth, setUser, onClose }: { auth: Auth, setUser: any, onClose: () => void }) => {
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  
  // Custom states for Secure Verification System
  const [otpSending, setOtpSending] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  
  // NATIVE AUTH TRAIL (admin iPhone debug 2026-07-17): a live, on-screen list of the exact sign-in
  // steps as they happen, shown ONLY in the native app. The Google-login hang survived one fix and the
  // next screenshot must answer "WHERE does it stop" with data, not guesses — the trail shows whether
  // the flow died at the Google sheet, the returned token, or the Firebase verify call.
  // Sign-in step tracing. The on-screen "Sign-in progress" box was removed (admin 2026-07-18 — Google/Apple
  // login confirmed working, the live diagnostic is no longer needed by users). The marks now go only to the
  // console, so the same step-by-step trace is still available for debugging without cluttering the UI.
  const mark = (step: string) => {
    try { console.log(`[auth] ${step}`); } catch { /* best-effort */ }
  };

  const recaptchaRef = useRef<HTMLDivElement>(null);
  const recaptchaVerifier = useRef<RecaptchaVerifier | null>(null);
  // Native (Android/iOS) phone-auth verification id — set by the plugin's `phoneCodeSent` listener.
  const nativeVerificationId = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (recaptchaVerifier.current) {
        recaptchaVerifier.current.clear();
      }
    };
  }, []);

  // Cooldown timer tracker side-effect
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  const initRecaptcha = () => {
    if (!recaptchaRef.current) return;
    try {
      if (!recaptchaVerifier.current) {
        recaptchaVerifier.current = new RecaptchaVerifier(auth, recaptchaRef.current, {
          'size': 'invisible',
          'callback': () => {
            console.log('Recaptcha solved');
          }
        });
      }
    } catch (err) {
      console.error('Recaptcha init error:', err);
    }
  };

  const handleSendOtp = async () => {
    // ONE normaliser, shared with the server (src/lib/phoneNumber.ts). This used to be four lines of
    // the same rule written here, and the server was about to need it too — two copies of "10 digits
    // means +91" drift silently, and when they do the client sends one number while the server looks
    // up another, which is exactly how a duplicate slips past the one-number-one-account check.
    const phone = normalizePhone(mobile);
    if (!phone) {
        setError('Enter mobile with country code (e.g. +91...)');
        return;
    }
    
    if (otpCooldown > 0 || otpSending) {
      return;
    }
    
    setOtpSending(true);
    setError('');
    setSuccessMessage('');

    try {
      // FORCE-LOGOUT THE OLD SESSION FIRST (admin 2026-07-18: "kisi bhi id se login … old session
      // automatic force logout") — starting a phone-OTP login clears any lingering session up front, so
      // the new sign-in (auto- or manual-verify) always lands. Best-effort; never blocks the OTP send.
      await forceLogoutBeforeLogin(); // bounded — never blocks the sign-in (see forceLogoutBeforeLogin)
      // 1. Verify and reserve request through the backend security rate limits
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Verification gateway limits reached. Please wait.');
      }

      // 2. Security checks passed → dispatch a REAL OTP via Firebase Phone Auth.
      if (Capacitor.isNativePlatform()) {
        // NATIVE (Android/iOS): use the native Firebase phone flow — a REAL SMS sent via Play Integrity
        // (no reCAPTCHA), and Android auto-reads the code via the SMS Retriever API (the "direct OTP
        // verification" flow). No READ_SMS permission is needed (Retriever is hash-scoped), which also
        // keeps the app Play-Store-compliant. Requires Firebase console: Phone provider enabled + the
        // app's SHA-1/SHA-256 fingerprints registered for com.navbharat.ai.
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        // PhoneAuthProvider is exported by `firebase/auth` at runtime but the v12 umbrella types don't
        // surface it to tsc — resolve it dynamically (it IS present) and build the JS-SDK credential.
        const { PhoneAuthProvider } = (await import('firebase/auth')) as any;
        await FirebaseAuthentication.removeAllListeners();
        nativeVerificationId.current = null;
        // Auto-read (SMS Retriever) — sign in the JS SDK the moment the code is captured automatically.
        await FirebaseAuthentication.addListener('phoneVerificationCompleted', async (event: any) => {
          try {
            const vid = event?.verificationId ?? nativeVerificationId.current;
            const code = event?.verificationCode;
            if (!vid || !code) return;
            await signInWithCredential(auth, PhoneAuthProvider.credential(vid, code));
            setIsOtpVerified(true);
            setError('');
            addTerminalLine(`[AUTH] Authentication successful via Phone (auto-verified)`, 'success');
            onClose();
          } catch (e: any) {
            setError(e?.message || 'Auto sign-in failed. Enter the code manually.');
          }
        });
        await FirebaseAuthentication.addListener('phoneCodeSent', (event: any) => {
          nativeVerificationId.current = event?.verificationId ?? null;
          setIsOtpSent(true);
          setOtpCooldown(30);
          setSuccessMessage('OTP sent to your phone.');
          addTerminalLine(`[AUTH] Verification code sent to ${phone}`, 'info');
        });
        await FirebaseAuthentication.addListener('phoneVerificationFailed', (event: any) => {
          setError(event?.message || 'Phone verification failed. Please use Email or Google sign-in.');
          setOtpSending(false);
        });
        await FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: phone });
        setOtpSending(false);
        return;
      }

      // WEB: reCAPTCHA-verified Firebase phone auth.
      initRecaptcha();
      if (!recaptchaVerifier.current) throw new Error('Recaptcha failed to initialize');

      const result = await signInWithPhoneNumber(auth, phone, recaptchaVerifier.current);
      setConfirmationResult(result);
      setIsOtpSent(true);
      setOtpCooldown(30); // 30-second security cooldown starts
      setSuccessMessage('OTP sent successfully.');
      addTerminalLine(`[AUTH] Verification code sent to ${phone}`, 'info');
    } catch (err: any) {
      // HONEST failure — NO fake bypass (removed 2026-07-14). The old code force-activated a fake
      // "enter 123456" login on EVERY failure (`|| true`), which was both a security hole (anyone could
      // sign in as any number with 123456) and a fake feature. Real OTP only; on failure the working
      // Email / Google sign-in options remain.
      console.error('[OTP SEND ERROR]', err);
      const code = err?.code || err?.message || '';
      const msg = /operation-not-allowed/.test(code)
        ? 'Phone OTP sign-in is not enabled for this app yet. Please use Email or Google sign-in.'
        : (err?.message || 'Could not send the OTP. Please try again, or use Email / Google sign-in.');
      setError(msg);
      if (recaptchaVerifier.current) {
        recaptchaVerifier.current.clear();
        recaptchaVerifier.current = null;
      }
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // NATIVE: build a real Firebase phone credential from the plugin's verificationId + the entered
        // code and sign the JS SDK in (skipNativeAuth keeps the web SDK the single session source).
        if (!nativeVerificationId.current) throw new Error('Please request an OTP first.');
        const { PhoneAuthProvider } = (await import('firebase/auth')) as any;
        await signInWithCredential(auth, PhoneAuthProvider.credential(nativeVerificationId.current, otp));
      } else {
        if (!confirmationResult) return;
        await confirmationResult.confirm(otp);
      }
      setIsOtpVerified(true);
      setError('');
      addTerminalLine(`[AUTH] Authentication successful via Phone`, 'success');
      onClose(); // Auto close on successful login
    } catch (err: any) {
      setError('Invalid OTP code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // ROOT CAUSE FIX (admin report 2026-08-07 — "OTP me gadbad ho gaya", screenshot showed
    // `[auth/invalid-email]` on the MOBILE NUMBER screen): this handler ran the EMAIL sign-in
    // unconditionally. The phone inputs live inside the same <form>, so pressing the phone
    // keyboard's "Go" key (implicit form submission — exactly what the screenshot caught) landed
    // here and called signInWithEmailAndPassword with an EMPTY email → auth/invalid-email. The old
    // guard above was an empty comment stub, so it caught nothing.
    //
    // Fixed at the CLASS, not the instance: the form now routes by the tab the user is actually on,
    // and "Go" does the RIGHT thing rather than merely being blocked — on the phone tab it sends
    // the OTP, and once the code has been sent it verifies it. Both delegate to the SAME handlers
    // the buttons use, so there is one implementation per action and nothing can drift.
    if (authMethod === 'phone' && isLogin) {
      if (isOtpSent && otp.length === 6) { await handleVerifyOtp(); return; }
      if (!isOtpSent) { await handleSendOtp(); return; }
      return; // OTP sent but not fully typed — Enter must never fall through to the email path
    }

    setError('');
    setLoading(true);
    try {
      // FORCE-LOGOUT THE OLD SESSION FIRST (admin 2026-07-18: "kisi bhi id se login … old session
      // automatic force logout") — on WEB only. On the native app the pre-login web signOut can hang and
      // poison the sign-in (see forceLogoutBeforeLogin); the sign-in that follows replaces the old session.
      if (!Capacitor.isNativePlatform()) mark('clearing any old session…');
      await forceLogoutBeforeLogin(); // web-only + bounded — never blocks the sign-in (see forceLogoutBeforeLogin)
      // The same no-hang guarantee as social sign-in: an unanswered auth request surfaces an honest
      // timeout instead of an endless spinner (iPhone report 2026-07-17 — the spinner sat on THIS button).
      if (isLogin) {
        mark('email sign-in…');
        await raceNativeAuth(
          signInWithEmailAndPassword(auth, email, password),
          'Sign-in timed out — check your internet and try again.',
          45_000,
        );
      } else {
        mark('creating account…');
        await raceNativeAuth(
          createUserWithEmailAndPassword(auth, email, password),
          'Sign-up timed out — check your internet and try again.',
          45_000,
        );
      }
      mark('email auth ✓');
      onClose();
    } catch (err: any) {
      mark(`failed: ${String(err?.message || err).slice(0, 80)}`);
      // Only run the deep server probe for failures it can actually explain. For a self-explanatory
      // input error the probe's ADMIN_ONLY_OPERATION reply used to be rendered as a Google-provider
      // configuration essay — a confident WRONG diagnosis (see shouldDeepDiagnose).
      if (!shouldDeepDiagnose(err?.code)) { setError(describeAuthError(err)); return; }
      setError(`${describeAuthError(err)} · diagnosing…`);
      setError(`${describeAuthError(err)}\n${await diagnoseAuth(email, password)}`);
    } finally {
      setLoading(false);
    }
  };

  // P-UX.8 — Account recovery: email a Firebase password-reset link so a locked-out user can get back in.
  const handleForgotPassword = async () => {
    const target = email.trim();
    setError('');
    setSuccessMessage('');
    if (!target) {
      setError('Enter your email above first, then tap "Forgot password?".');
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, target);
      // Don't reveal whether an account exists (account-enumeration safety) — always confirm sent.
      setSuccessMessage(`If an account exists for ${target}, a password reset link is on its way. Check your inbox (and spam).`);
    } catch (err: any) {
      // Firebase hides user-not-found by default; surface only real, actionable errors.
      if (err?.code === 'auth/invalid-email') setError('That email address looks invalid. Please check it and try again.');
      else if (err?.code === 'auth/too-many-requests') setError('Too many attempts. Please wait a minute and try again.');
      else setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // Helper for IDE logs integration if needed
  const addTerminalLine = (text: string, type: 'info' | 'error' | 'success' | 'warn' = 'info') => {
      console.log(`[IDE LOG] ${type}: ${text}`);
  };

  // ── Social sign-in (Google + GitHub) — popup-first, redirect fallback ─────────
  // Popup is the primary path: it sidesteps the cross-origin storage partitioning
  // that makes signInWithRedirect return logged-out on a different serving domain,
  // and the COOP header (server.ts) now lets the popup deliver its result.
  //
  // What a popup FAILURE means is decided by the pure, tested popupFailureAction:
  //  • 'redirect' — the browser genuinely BLOCKED the popup → full-page redirect fallback
  //    (finalized at the app root via getRedirectResult).
  //  • 'cancel'   — the USER closed the popup, or a double-tap superseded it → stop QUIETLY
  //    (spinner off, no error, and NEVER a forced page navigation — cancel means cancel).
  //  • 'error'    — a real failure → surfaced honestly.
  // (Previously cancel/double-tap ALSO force-navigated the whole page to Google — the
  // "login is not smooth" jolt the admin reported.)
  const socialSignIn = async (provider: AuthProvider, onCredential?: (r: UserCredential) => void): Promise<'ok' | 'cancelled' | 'redirecting'> => {
    // FORCE-LOGOUT THE OLD SESSION FIRST (admin 2026-07-18: "jab koi user kisi bhi id se login kare, to
    // old session automatic force logout ho jana chahiye"). Every login — any account, any method — starts
    // by clearing a lingering/half-dead session that could wedge the WEB popup. WEB ONLY: on the native app
    // the pre-login web signOut can HANG and hold Firebase Auth's queue, blocking the very signInWithCredential
    // that follows — the build-27 "verifying with Firebase… → sign-in did not complete" failure. The native
    // sign-in replaces the old session on its own, so we skip the pre-logout there (see forceLogoutBeforeLogin).
    if (!Capacitor.isNativePlatform()) mark('clearing any old session…');
    await forceLogoutBeforeLogin(); // web-only + bounded — never blocks the sign-in (see forceLogoutBeforeLogin)
    // NATIVE app + Google/Apple → use the device's NATIVE sign-in, NOT the web popup/redirect.
    // Google disallows OAuth inside embedded WebViews (the web flow opens an external browser and
    // breaks on return with "missing initial state"), and Apple's Sign in with Apple is a native
    // capability on iOS. The @capacitor-firebase/authentication plugin runs the native account sheet
    // and returns a credential we exchange into the Firebase JS SDK (skipNativeAuth: true keeps the
    // web SDK the single session source) — no browser, fully in-app. The web login path is untouched.
    const providerId = (provider as { providerId?: string })?.providerId;
    const isGoogle = providerId === GoogleAuthProvider.PROVIDER_ID;
    const isApple = providerId === 'apple.com';
    const isGithub = providerId === GithubAuthProvider.PROVIDER_ID;
    if (Capacitor.isNativePlatform() && (isGoogle || isApple || isGithub)) {
      try {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        let credential;
        if (isGoogle) {
          mark('opening Google sign-in…');
          // raceNativeAuth (2026-07-17): a wiring/SDK fault once left this promise PENDING FOREVER
          // (the redirect URL never reached GIDSignIn) — the user saw an infinite spinner. The bridge
          // now always answers within the window or the user gets an honest, retryable error.
          const nativeResult = await raceNativeAuth(
            FirebaseAuthentication.signInWithGoogle(),
            'Google sign-in timed out — please try again.',
          );
          const idToken = nativeResult.credential?.idToken;
          mark(`Google returned — token: ${idToken ? 'YES' : 'NO'}`);
          if (!idToken) {
            throw new Error(
              'Native Google sign-in returned no ID token — check the iOS GoogleService-Info.plist / Android google-services.json (SHA-1) setup.',
            );
          }
          credential = GoogleAuthProvider.credential(idToken, nativeResult.credential?.accessToken);
        } else if (isGithub) {
          mark('opening GitHub sign-in…');
          // GitHub on the app (admin 2026-07-18: "github login bhi fix karo"): the web popup flow cannot
          // run inside the WebView (same class as Google — embedded-webview OAuth is blocked/hangs), so use
          // the plugin's NATIVE GitHub flow (the Firebase iOS/Android SDK opens an in-app browser sheet).
          // Same scopes as the web flow so the token can fully drive repo connect (repo/workflow/identity).
          const nativeResult = await raceNativeAuth(
            FirebaseAuthentication.signInWithGithub({
              scopes: ['repo', 'workflow', 'read:user', 'user:email'],
              customParameters: [{ key: 'allow_signup', value: 'true' }],
            }),
            'GitHub sign-in timed out — please try again.',
          );
          const accessToken = nativeResult.credential?.accessToken;
          mark(`GitHub returned — token: ${accessToken ? 'YES' : 'NO'}`);
          if (!accessToken) {
            throw new Error(
              'Native GitHub sign-in returned no access token — check that the GitHub provider is enabled in Firebase.',
            );
          }
          credential = GithubAuthProvider.credential(accessToken);
          // The GitHub OAuth token powers repo connect — store it exactly like the web flow's
          // captureGithubToken does (credentialFromResult may not see it on a credential exchange).
          try { localStorage.setItem('gh_token', accessToken); } catch { /* best-effort */ }
        } else {
          mark('opening Apple sign-in…');
          // Apple: the plugin returns an Apple identity token + the raw nonce it used; Firebase's
          // Apple OAuthProvider verifies the token against that same nonce. Missing token ⇒ the
          // "Sign in with Apple" capability / Firebase Apple provider isn't set up yet.
          const nativeResult = await raceNativeAuth(
            FirebaseAuthentication.signInWithApple(),
            'Apple sign-in timed out — please try again.',
          );
          const idToken = nativeResult.credential?.idToken;
          if (!idToken) {
            throw new Error(
              'Native Apple sign-in returned no identity token — enable the "Sign in with Apple" capability (Xcode) and the Apple provider in Firebase.',
            );
          }
          // OAuthProvider is exported by firebase/auth at runtime but the v12 umbrella types don't
          // surface it to tsc (same as PhoneAuthProvider above) — resolve it dynamically.
          const { OAuthProvider } = (await import('firebase/auth')) as any;
          const appleProvider = new OAuthProvider('apple.com');
          credential = appleProvider.credential({ idToken, rawNonce: nativeResult.credential?.nonce });
        }
        // DIAGNOSTIC (build 29): fire a parallel, timed reachability probe to Google's auth backend so the
        // trail shows whether the WebView can reach identitytoolkit at all (see probeAuthNetwork). Never awaited.
        void probeAuthNetwork(firebaseConfig.apiKey, mark);
        mark('verifying with Firebase…');
        // Exchange the native credential into the Firebase JS SDK, but NEVER let a stalled WKWebView
        // persistence write hang the login spinner forever (the "stuck after returning from Google" bug,
        // admin 2026-07-17). settleNativeSignIn caps the exchange and, if it overruns, still succeeds
        // when the session actually landed via the auth listener — else it reports a clean failure.
        // (The on-screen trail marks each hop so a stuck attempt shows exactly where it stopped.)
        let result: UserCredential | null = null;
        const exchange = signInWithCredential(auth, credential).then(
          (r) => { result = r; },
          (e) => { mark(`exchange error: ${String(e?.code || e?.message || e).slice(0, 60)}`); throw e; }, // surface the REAL reason (was swallowed)
        );
        const outcome = await settleNativeSignIn(exchange, auth, 15000, 3000);
        if (outcome === 'failed') {
          mark('failed: sign-in did not complete');
          throw new Error('Sign-in did not complete. Please check your connection and try again.');
        }
        mark(`Firebase ✓ signed in${result ? '' : ' (via session listener)'}`);
        if (result) onCredential?.(result);
        // Flip the APP UI to logged-in DIRECTLY from the sign-in result — never depend solely on the
        // onAuthStateChanged broadcast. ROOT CAUSE (build 30): the auth listener only fires AFTER the
        // SDK's session-save await, so a stalled persistence write left a fully-signed-in user looking
        // logged OUT (modal closed, header still "LOGIN"). The persistence fix (localStorage on native,
        // lib/firebase.ts) kills the stall itself; this makes the UI honest even if a save ever lags again.
        const signedInUser = (result as UserCredential | null)?.user ?? (auth as { currentUser?: unknown }).currentUser ?? null;
        if (signedInUser) setUser(signedInUser);
        onClose();
        return 'ok';
      } catch (nativeErr: any) {
        mark(`failed: ${String(nativeErr?.message || nativeErr).slice(0, 80)}`);
        // The user dismissing the native account sheet must mean CANCEL — never an error banner.
        // iOS Apple cancel surfaces code 1001 / "AuthorizationError"; Google Android cancel is 12501.
        const msg = String(nativeErr?.message || nativeErr?.code || '').toLowerCase();
        if (msg.includes('cancel') || msg.includes('canceled') || msg.includes('cancelled')
          || msg.includes('12501') || msg.includes('1001') || msg.includes('com.apple.authenticationservices')) {
          return 'cancelled';
        }
        throw nativeErr;
      }
    }
    // APPLE ON WEB GOES STRAIGHT TO THE REDIRECT FLOW — see webSignInStrategy for the evidence.
    // Apple's form_post return cannot reliably hand the credential back to the opener, so the popup
    // completed the sign-in and the app never heard about it. The redirect has no relay to break, and
    // getRedirectResult at the app root already finalizes it.
    if (webSignInStrategy(providerId) === 'redirect') {
      // WRITE IT DOWN BEFORE WE HAND OVER THE PAGE (admin 2026-08-22 — the Apple login loop).
      // On return, `getRedirectResult` reports `auth/no-auth-event` for BOTH "came back with nothing"
      // and "ordinary page load", so the app could not tell them apart and stayed silent about both.
      // This marker is the only thing that can: we know we sent them, because we recorded it.
      markRedirectStarted(typeof sessionStorage !== 'undefined' ? sessionStorage : null, providerId, Date.now());
      await signInWithRedirect(auth, provider);
      return 'redirecting';   // the page navigates away; nothing after this runs
    }
    try {
      // (The old session was already fully cleared by signOutEverywhere() at the top of socialSignIn.)
      const result = await signInWithPopup(auth, provider);
      onCredential?.(result);
      onClose(); // success — App.tsx onAuthStateChanged also closes/syncs state
      return 'ok';
    } catch (err: any) {
      const action = popupFailureAction(err?.code);
      if (action === 'redirect') {
        // Popup genuinely unavailable — fall back to full-page redirect (navigates away).
        await signInWithRedirect(auth, provider);
        return 'redirecting';
      }
      if (action === 'cancel') {
        // ROOT-CAUSE FIX (admin 2026-07-11 — first Google login silently stayed logged out):
        // `popup-closed-by-user` can fire even though the sign-in COMPLETED (the SDK's closed-poller
        // races the auth event, slowest on a cold first attempt). A cancel is only final after a
        // short grace window watching for the sign-in to actually land — signed in ⇒ success.
        const landed = await waitForSignedInUser(auth);
        if (landed) {
          console.log('[SOCIAL SIGN-IN] popup reported cancel but the sign-in landed — treating as success');
          onClose();
          return 'ok';
        }
        return 'cancelled';
      }
      throw err;
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    const provider = new GoogleAuthProvider();
    // THE ACCOUNT THE USER WAS REACHING FOR (admin 2026-08-22). When this screen was opened by tapping
    // a specific account in the switch menu, Google is told which one, so the chooser lands on it
    // instead of making the user pick again from a list they just picked from.
    //
    // `prompt: 'select_account'` stays either way — a login_hint alone can silently sign them straight
    // back into the wrong account when only one session is live with Google, which is the failure this
    // whole menu exists to avoid. The hint is consumed once and cleared, so it cannot steer a LATER,
    // unrelated sign-in.
    //
    // 🔒 And it is genuinely READ here. The previous attempt wrote `nbai:switch-to` for "the sign-in
    // screen to offer first" and nothing ever consumed it — a stored hint standing in for a working
    // handoff. Writing a key nobody reads is not a feature.
    let signInHint = '';
    try {
      signInHint = (localStorage.getItem(SIGN_IN_HINT_KEY) || '').trim();
      if (signInHint) localStorage.removeItem(SIGN_IN_HINT_KEY);
    } catch { /* private mode / blocked storage — the chooser simply shows every account */ }
    provider.setCustomParameters(signInHint
      ? { prompt: 'select_account', login_hint: signInHint }
      : { prompt: 'select_account' });
    try {
      const outcome = await socialSignIn(provider);
      // The user's own cancel: just re-enable the buttons — no error banner, no navigation.
      if (outcome === 'cancelled') setLoading(false);
    } catch (err: any) {
      console.error('[GOOGLE SIGN-IN]', err);
      setError(describeSocialError(err));
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError('');
    setLoading(true);
    // Apple is a Firebase OAuthProvider ('apple.com'). On native iOS the socialSignIn helper routes
    // through the native "Sign in with Apple" sheet; on web it uses the popup (Apple's web OAuth).
    // OAuthProvider is resolved dynamically (v12 umbrella types don't surface it — see the note above).
    //
    // DESKTOP FIX (admin 2026-08-09, "desktop browser me Apple login nahi ho raha"): this await used
    // to FETCH the firebase/auth chunk inside the click handler. On a cold cache that network wait
    // consumed the browser's transient user activation, so the signInWithPopup that followed was
    // popup-BLOCKED → fell back to signInWithRedirect → which silently dies on desktop Chrome's
    // storage-partitioned return ("missing initial state"). Google never hit this because its
    // provider is statically imported. The module promise now starts at MODULE LOAD (below), so by
    // click time this await resolves from memory in the same tick and the popup keeps the user
    // activation it needs.
    const { OAuthProvider } = (await firebaseAuthModuleForApple) as any;
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    try {
      const outcome = await socialSignIn(provider);
      if (outcome === 'cancelled') {
        // NOT SILENT, unlike Google/GitHub (admin 2026-08-16, with Apple's own error page attached:
        // "Invalid web redirect url"). Firebase reports `auth/popup-closed-by-user` for BOTH a real
        // cancel and a popup the user closed because APPLE refused the request — the SDK cannot tell
        // them apart. Treating every close as a quiet cancel meant a user hitting the configuration
        // error saw an Apple error page, closed it, and the app said NOTHING. Forever. A dead button.
        // See appleSignInFailureMessage: it serves both readings and names the exact fix.
        setError(appleSignInFailureMessage());
        setLoading(false);
      }
    } catch (err: any) {
      console.error('[APPLE SIGN-IN]', err);
      setError(describeSocialError(err));
      setLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
    setError('');
    setLoading(true);
    const provider = new GithubAuthProvider();
    // Maximum repo permission so NavBharatAI can fully connect to the user's apps:
    // repo (full read/write to code + statuses + deployments), workflow (manage CI/
    // Actions for the git-native PR→CI→merge flow), and identity scopes.
    provider.addScope('repo');
    provider.addScope('workflow');
    provider.addScope('read:user');
    provider.addScope('user:email');
    provider.setCustomParameters({ allow_signup: 'true' });
    try {
      const outcome = await socialSignIn(provider, captureGithubToken);
      // The user's own cancel: re-enable the buttons quietly — no error, no forced redirect.
      if (outcome === 'cancelled') setLoading(false);
    } catch (err: any) {
      // The user's GitHub email already belongs to an account created with another method
      // (Google or Email/Password). Instead of dead-ending, LINK GitHub onto that account so the
      // user actually signs in and can use their GitHub repos. Real account-linking, not a message.
      if (err?.code === 'auth/account-exists-with-different-credential') {
        const linked = await linkGithubToExistingAccount(err);
        if (linked) return; // signed in + GitHub linked — done
        return; // linkGithubToExistingAccount already set an actionable error/loading state
      }
      console.error('[GITHUB SIGN-IN]', err);
      setError(describeSocialError(err));
      setLoading(false);
    }
  };

  /**
   * Resolve `auth/account-exists-with-different-credential`: the GitHub email is already registered
   * with Google or Email/Password. Sign in with that existing method, then link the pending GitHub
   * credential onto the SAME account — so the user ends up signed in with GitHub connected (one
   * account, both methods). Returns true when the user is signed in + linked.
   */
  const linkGithubToExistingAccount = async (err: any): Promise<boolean> => {
    try {
      const pendingCred = GithubAuthProvider.credentialFromError(err);
      const email: string = err?.customData?.email || err?.email || '';
      if (!pendingCred || !email) { setError(describeSocialError(err)); setLoading(false); return false; }
      // Firebase "Email Enumeration Protection" (ON by default) makes fetchSignInMethodsForEmail
      // return an EMPTY array — so we can't always learn the existing method. Treat "password-only"
      // as the only case that needs a typed password; for everything else (google.com, OR unknown
      // because of enumeration protection) verify via Google — the enabled social provider — then
      // link GitHub onto that account.
      const methods: string[] = await fetchSignInMethodsForEmail(auth, email).catch(() => [] as string[]);
      const passwordOnly = methods.includes('password') && !methods.includes('google.com');
      let signedIn: UserCredential | null = null;
      if (passwordOnly) {
        if (!password) {
          setError(`This email (${email}) already has a password account. Type your password above, then click "Continue with GitHub" again to connect it.`);
          setLoading(false);
          return false;
        }
        signedIn = await signInWithEmailAndPassword(auth, email, password);
      } else if (Capacitor.isNativePlatform()) {
        // NATIVE: verify ownership via the plugin's native Google sheet (the web popup cannot run in the
        // WebView, and the native auth instance deliberately has no popup resolver — see lib/firebase.ts).
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const nativeResult = await raceNativeAuth(
          FirebaseAuthentication.signInWithGoogle(),
          'Google verification timed out — please try again.',
        );
        const idToken = nativeResult.credential?.idToken;
        if (!idToken) throw new Error('Google verification returned no token — please try again.');
        signedIn = await signInWithCredential(
          auth,
          GoogleAuthProvider.credential(idToken, nativeResult.credential?.accessToken),
        );
      } else {
        const g = new GoogleAuthProvider();
        g.setCustomParameters({ login_hint: email });
        signedIn = await signInWithPopup(auth, g); // verify ownership via Google, then link GitHub
      }
      if (signedIn?.user) {
        // Attach GitHub to the now-authenticated account, and keep the GitHub OAuth token (for
        // git-native storage) straight from the pending credential.
        await linkWithCredential(signedIn.user, pendingCred);
        try { if (pendingCred.accessToken) localStorage.setItem('gh_token', pendingCred.accessToken); } catch { /* best-effort */ }
        setUser(signedIn.user);
        onClose();
        return true;
      }
      setLoading(false);
      return false;
    } catch (e: any) {
      console.error('[GITHUB LINK]', e);
      setError(describeSocialError(e));
      setLoading(false);
      return false;
    }
  };

  return (
    <div className="absolute inset-0 z-[500] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        // max-h + overflow-y-auto so a tall form (email + all 4 social buttons) never runs off the top/
        // bottom of the screen — it scrolls INSIDE the card instead. 100dvh tracks the real visible height
        // on mobile Safari (accounts for the address bar), and the safe-area insets keep it clear of the notch.
        className="relative w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-[#161b22] border border-white/10 rounded-[2.5rem] shadow-3xl p-8"
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1.5rem)' }}
      >
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 p-2 hover:bg-white/5 rounded-full text-[#484f58] hover:text-white transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-black text-white tracking-tighter uppercase">
              {isLogin ? 'Welcome Back' : 'Join Bharat'}
            </h2>
            <p className="text-[11px] text-[#8b949e] font-black uppercase tracking-[0.2em]">
              {isLogin ? 'Access your AI Workspace' : 'Start your building journey'}
            </p>
          </div>

          {isLogin && (
            <div className="flex bg-[#0d1117] p-1 rounded-2xl border border-white/5">
              <button
                type="button"
                onClick={() => setAuthMethod('email')}
                className={cn(
                  "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                  authMethod === 'email' ? "bg-white/10 text-white shadow-lg" : "text-[#484f58] hover:text-white"
                )}
              >
                Email Access
              </button>
              <button
                type="button"
                onClick={() => setAuthMethod('phone')}
                className={cn(
                  "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                  authMethod === 'phone' ? "bg-white/10 text-white shadow-lg" : "text-[#484f58] hover:text-white"
                )}
              >
                OTP Access
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isLogin && authMethod === 'phone' ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-[#484f58] uppercase tracking-widest ml-1">Mobile Number</label>
                  <div className="flex gap-2">
                    <input 
                      type="tel" 
                      value={mobile} 
                      disabled={otpSending || isOtpSent}
                      onChange={e => setMobile(e.target.value)} 
                      placeholder="+91 Mobile" 
                      className="flex-1 bg-[#0d1117] border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-inner" 
                    />
                    <button 
                      type="button"
                      onClick={handleSendOtp}
                      disabled={otpSending || otpCooldown > 0}
                      className={cn(
                        "px-4 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all flex items-center justify-center gap-1.5 min-w-[124px]",
                        otpSending || otpCooldown > 0
                          ? "bg-white/5 border border-white/5 text-[#484f58] cursor-not-allowed pointer-events-none opacity-60"
                          : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg active:scale-95"
                      )}
                    >
                      {otpSending ? (
                        <>
                          <TirangaLoader className="w-3.5 h-3.5" />
                          <span>Sending...</span>
                        </>
                      ) : otpCooldown > 0 ? (
                        <span>Resend in {otpCooldown}s</span>
                      ) : isOtpSent ? (
                        <span>Resend OTP</span>
                      ) : (
                        <span>Send OTP</span>
                      )}
                    </button>
                  </div>
                </div>

                {isOtpSent && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="space-y-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest ml-1">Enter 6-digit OTP</label>
                      <input 
                        type="text" 
                        maxLength={6}
                        value={otp} 
                        onChange={e => setOtp(e.target.value)} 
                        placeholder="000000" 
                        className="w-full bg-[#0d1117] border border-amber-500/20 rounded-2xl p-4 text-xs text-amber-500 outline-none focus:border-amber-500 transition-all shadow-inner text-center tracking-[0.5em] font-bold" 
                      />
                    </div>
                    <button 
                      type="button"
                      onClick={handleVerifyOtp}
                      disabled={loading || otp.length !== 6}
                      className="w-full py-5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] transition-all"
                    >
                      {loading ? 'Verifying...' : 'Verify & Access'}
                    </button>
                  </motion.div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {!isLogin && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-[#484f58] uppercase tracking-widest ml-1">Full Name</label>
                    <input 
                      type="text" 
                      value={name} 
                      onChange={e => setName(e.target.value)} 
                      placeholder="Bharat Kumar" 
                      className="w-full bg-[#0d1117] border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-indigo-500 transition-all shadow-inner" 
                    />
                  </div>
                )}
                
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-[#484f58] uppercase tracking-widest ml-1">Email / User ID</label>
                  <input 
                    type="email" 
                    required
                    value={email} 
                    onChange={e => setEmail(e.target.value)} 
                    placeholder="you@bharat.ai" 
                    className="w-full bg-[#0d1117] border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-indigo-500 transition-all shadow-inner" 
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-[#484f58] uppercase tracking-widest ml-1">Password</label>
                  <input 
                    type="password" 
                    required
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    placeholder="••••••••"
                    className="w-full bg-[#0d1117] border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-indigo-500 transition-all shadow-inner"
                  />
                  {isLogin && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={loading}
                        className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors mt-1 mr-1"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}
                </div>

                {!isLogin && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-[#484f58] uppercase tracking-widest ml-1">Mobile Verification (Optional)</label>
                    {!isOtpVerified ? (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <input 
                            type="tel" 
                            value={mobile} 
                            disabled={otpSending || isOtpSent}
                            onChange={e => setMobile(e.target.value)} 
                            placeholder="+91 Mobile" 
                            className="flex-1 bg-[#0d1117] border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-inner" 
                          />
                          <button 
                            type="button"
                            onClick={handleSendOtp}
                            disabled={otpSending || otpCooldown > 0}
                            className={cn(
                              "px-4 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all flex items-center justify-center gap-1.5 min-w-[124px]",
                              otpSending || otpCooldown > 0
                                ? "bg-white/5 border border-white/5 text-[#484f58] cursor-not-allowed pointer-events-none opacity-60"
                                : "bg-[#0d1117] border border-white/10 text-white hover:bg-white/5"
                            )}
                          >
                            {otpSending ? (
                              <>
                                <TirangaLoader className="w-3.5 h-3.5" />
                                <span>Sending...</span>
                              </>
                            ) : otpCooldown > 0 ? (
                              <span>Resend in {otpCooldown}s</span>
                            ) : isOtpSent ? (
                              <span>Resend OTP</span>
                            ) : (
                              <span>Get OTP</span>
                            )}
                          </button>
                        </div>

                        {isOtpSent && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            className="space-y-3"
                          >
                            <input 
                              type="text" 
                              maxLength={6}
                              value={otp} 
                              onChange={e => setOtp(e.target.value)} 
                              placeholder="OTP Code" 
                              className="w-full bg-[#0d1117] border border-amber-500/20 rounded-2xl p-4 text-xs text-amber-500 outline-none focus:border-amber-500 transition-all shadow-inner text-center tracking-[0.5em] font-bold" 
                            />
                            <button 
                              type="button"
                              onClick={handleVerifyOtp}
                              disabled={loading || otp.length !== 6}
                              className="w-full py-5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] transition-all"
                            >
                              {loading ? 'Verifying...' : 'Verify Mobile'}
                            </button>
                          </motion.div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-2 text-emerald-500 text-[10px] font-bold">
                        <div className="w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center text-white text-[8px]">✓</div>
                        <span>Mobile Verified: {mobile}</span>
                      </div>
                    )}
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={loading || (!isLogin && mobile.trim().length > 0 && !isOtpVerified)}
                  className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-20 text-white rounded-2xl font-black uppercase tracking-[0.3em] transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <TirangaLoader className="w-5 h-5" />
                  ) : (
                    isLogin ? 'Login Access' : 'Complete Signup'
                  )}
                </button>
              </div>
            )}
          </form>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-500 text-[10px] font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3 text-emerald-400 text-[10px] font-bold">
              <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">✓</div>
              <span>{successMessage}</span>
            </div>
          )}

          {/* ── Social sign-in: Google + GitHub ─────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">or continue with</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-4 bg-white hover:bg-gray-100 disabled:opacity-50 text-gray-900 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 active:scale-95"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
              Sign in with Google
            </button>
            <button
              type="button"
              onClick={handleAppleSignIn}
              disabled={loading}
              // Force white text + icon inline so the label is readable no matter what theme/global CSS is
              // applied around the modal (the button rendered with dark, unreadable text otherwise).
              style={{ color: '#ffffff' }}
              className="w-full py-4 bg-black hover:bg-[#1a1a1a] disabled:opacity-50 text-white border border-white/25 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 active:scale-95"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.53c-.02-2.02 1.65-2.99 1.72-3.04-.94-1.37-2.4-1.56-2.92-1.58-1.24-.13-2.42.73-3.05.73-.63 0-1.6-.71-2.63-.69-1.35.02-2.6.79-3.3 2-1.4 2.44-.36 6.04 1.01 8.02.67.97 1.47 2.05 2.51 2.01 1.01-.04 1.39-.65 2.61-.65 1.22 0 1.56.65 2.63.63 1.09-.02 1.78-.98 2.44-1.96.77-1.12 1.09-2.21 1.11-2.27-.02-.01-2.13-.82-2.15-3.23zM15.04 6.36c.56-.68.94-1.62.83-2.56-.81.03-1.79.54-2.37 1.22-.52.6-.98 1.56-.86 2.48.9.07 1.83-.46 2.4-1.14z"/></svg>
              Sign in with Apple
            </button>
            <button
              type="button"
              onClick={handleGithubSignIn}
              disabled={loading}
              // Lighter GitHub grey + forced white text/icon so the label reads clearly (was too dark).
              style={{ color: '#ffffff' }}
              className="w-full py-4 bg-[#30363d] hover:bg-[#3a4048] disabled:opacity-50 text-white border border-white/25 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 active:scale-95"
            >
              <Github className="w-4 h-4" />
              Continue with GitHub
            </button>
            <p className="text-[9px] text-[#484f58] text-center leading-relaxed">
              GitHub connects your repos so NavBharatAI can build, commit &amp; deploy your apps.
            </p>
          </div>

          {/* Hidden Recaptcha */}
          <div ref={recaptchaRef} id="recaptcha-container"></div>

          <div className="pt-4 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setIsOtpSent(false);
                setIsOtpVerified(false);
                setAuthMethod('email');
              }}
              className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest hover:text-indigo-400 transition-colors"
            >
              {isLogin ? "New to NavBharat? Create One" : "Already built something? Login"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
