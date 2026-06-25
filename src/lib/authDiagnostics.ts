// Auth error diagnostics — turn a raw Identity Toolkit error message into a plain, ACTIONABLE
// reason. A bare Firebase `auth/internal-error` hides the real cause; these mappings name the
// exact Firebase Console fix and project so an admin can resolve it without a desktop console.
//
// Extracted from AuthComponent so the mapping is unit-testable in isolation (it imports only the
// plain firebaseConfig object — no Firebase SDK init / side effects).

import { firebaseConfig } from '../config/firebase';

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
