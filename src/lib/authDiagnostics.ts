// Auth error diagnostics — turn a raw Identity Toolkit error message into a plain, ACTIONABLE
// reason. A bare Firebase `auth/internal-error` hides the real cause; these mappings name the
// exact Firebase Console fix and project so an admin can resolve it without a desktop console.
//
// Extracted from AuthComponent so the mapping is unit-testable in isolation (it imports only the
// plain firebaseConfig object — no Firebase SDK init / side effects).

import { firebaseConfig } from '../config/firebase';

/**
 * Should a failed sign-in ALSO run the deep server probe (`diagnoseAuth`) and show its verdict?
 *
 * ROOT CAUSE this closes (admin report 2026-08-07, OTP screen): the probe was appended to EVERY
 * auth failure. For an error the user's own input already explains — an empty/invalid email, a
 * missing password — the probe fires an ANONYMOUS sign-up, gets the perfectly normal
 * ADMIN_ONLY_OPERATION back, and `explainAuthReason` turns that into a five-line essay about the
 * GOOGLE provider's configuration. So a phone-tab user saw a wall of red text telling an admin to
 * go fix Google sign-in — a false diagnosis pointing at the wrong console, for a failure that had
 * nothing to do with Google. A wrong explanation is worse than none: it sends the reader hunting in
 * the wrong place (rule 5 — the system must tell the truth about its own state).
 *
 * The probe is genuinely useful for the CONFIG/INTERNAL class (that is what it was built for), so
 * it stays for exactly those. PURE + unit-tested.
 */
export function shouldDeepDiagnose(code: string | null | undefined): boolean {
  const c = (code || '').trim().toLowerCase();
  if (!c) return true; // no code at all — an opaque failure is exactly what the probe is for
  // Errors whose cause is the submitted input or a known account state: self-explanatory already.
  const selfExplanatory = [
    'auth/invalid-email',
    'auth/missing-email',
    'auth/missing-password',
    'auth/wrong-password',
    'auth/user-not-found',
    'auth/invalid-credential',
    'auth/invalid-login-credentials',
    'auth/email-already-in-use',
    'auth/weak-password',
    'auth/user-disabled',
    'auth/too-many-requests',
    'auth/network-request-failed',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/invalid-phone-number',
    'auth/missing-phone-number',
    'auth/invalid-verification-code',
    'auth/code-expired',
  ];
  return !selfExplanatory.includes(c);
}

export function explainAuthReason(message: string): string {
  const m = (message || '').toUpperCase();
  if (!m) return '';
  if (m.includes('CONFIGURATION_NOT_FOUND')) {
    return `Firebase Authentication is not set up for this project. An admin must open Firebase Console → Authentication → "Get started" and enable the sign-in providers (project ${firebaseConfig.projectId}).`;
  }
  // ADMIN_ONLY_OPERATION is the server's reply to our diagnostic probe (an anonymous sign-up)
  // when anonymous auth is off — which is the NORMAL, expected default. It therefore proves the
  // API key + auth backend are healthy, so it must NOT be reported as "all sign-in disabled".
  // For a Google auth/internal-error this means the fault is the Google provider's OWN config.
  // Keep this BEFORE the operation-not-allowed branch so the two are never conflated.
  if (m.includes('ADMIN_ONLY_OPERATION')) {
    return `The auth backend and API key are working (anonymous sign-up is off — that's the normal default). So a Google sign-in failure is the Google provider's own configuration. An admin should open Firebase Console → Authentication → Sign-in method → Google (project ${firebaseConfig.projectId}) and confirm: Google is ENABLED, it has a Web-SDK OAuth client AND a project support email set, the "Identity Toolkit API" is enabled in Google Cloud, and this site's domain is under Authentication → Settings → Authorized domains.`;
  }
  if (m.includes('PASSWORD_LOGIN_DISABLED') || m.includes('OPERATION_NOT_ALLOWED')) {
    return `Sign-in is disabled for this project — the required provider (Email/Password or Google) is turned off. An admin must enable it in Firebase Console → Authentication → Sign-in method (project ${firebaseConfig.projectId}).`;
  }
  if (m.includes('INVALID_LOGIN_CREDENTIALS') || m.includes('EMAIL_NOT_FOUND') || m.includes('INVALID_PASSWORD')) {
    return 'Wrong email or password — or no account exists for this email yet. Switch to Sign up to create one.';
  }
  if (m.includes('USER_DISABLED')) return 'This account has been disabled.';
  if (m.includes('TOO_MANY_ATTEMPTS')) return 'Too many attempts — wait a bit and try again.';
  if (m.includes('API KEY') || m.includes('API_KEY') || m.includes('REFERER')) {
    return `The Firebase API key is invalid or restricted for this site. An admin must check the key and its allowed referrers (project ${firebaseConfig.projectId}).`;
  }
  return `Server said: ${message}`;
}
