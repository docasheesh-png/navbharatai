// WHY A MOBILE OTP FAILED — in words the admin can act on, and a sentence the user can.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-26, screenshot of the Android app: "Mobile otp send nhi ho raha hai").
// The screen said "Could not verify your phone number. Please try again". That sentence was correct
// about nothing: it is the GENERIC fallback of `authErrorMessage.ts`, reached because the native
// phone-auth plugin reports a failure as `{ message }` with NO error code, so every native failure —
// an app the auth provider does not recognise, a region that is not enabled, an SMS quota, a blocked
// device — fell through to the same line. Worse, "try again" is a false instruction for every
// configuration fault: retrying cannot help. And the real reason went only to the phone's developer
// console, which nobody can read on a phone. So a broken OTP was invisible on BOTH sides.
//
// This module is the one place that reads a phone-auth failure (web error code OR native message) and
// answers two things: a bounded CATEGORY (recorded for the admin by `/api/auth/otp-outcome`), and
// the USER's sentence. The White-Label law still holds: no code, vendor name or raw text on screen.
//
// PURE — no I/O. Shared by the client (to classify) and the server (to validate what it is sent).

export type OtpFailureCategory =
  | 'invalid-number'
  | 'too-many-requests'
  | 'quota-exceeded'
  | 'network'
  | 'region-blocked'
  | 'provider-disabled'
  | 'billing'
  | 'app-not-authorized'
  | 'app-check'
  | 'recaptcha'
  | 'code-wrong'
  | 'code-expired'
  | 'internal'
  | 'other';

export const OTP_FAILURE_CATEGORIES: readonly OtpFailureCategory[] = [
  'invalid-number', 'too-many-requests', 'quota-exceeded', 'network', 'region-blocked',
  'provider-disabled', 'billing', 'app-not-authorized', 'app-check', 'recaptcha',
  'code-wrong', 'code-expired', 'internal', 'other',
];

/** Categories the PERSON cannot fix — a setting on our side. Retrying never helps these. */
const CONFIGURATION_FAULTS: ReadonlySet<OtpFailureCategory> = new Set<OtpFailureCategory>([
  'region-blocked', 'provider-disabled', 'billing', 'app-not-authorized', 'app-check', 'recaptcha',
]);

export function isConfigurationFault(c: OtpFailureCategory): boolean {
  return CONFIGURATION_FAULTS.has(c);
}

function rawCode(err: unknown): string {
  try {
    const c = (err as { code?: unknown })?.code;
    return typeof c === 'string' ? c.trim().toLowerCase() : '';
  } catch { return ''; }
}

function rawMessage(err: unknown): string {
  try {
    if (typeof err === 'string') return err;
    const m = (err as { message?: unknown })?.message;
    return typeof m === 'string' ? m : '';
  } catch { return ''; }
}

/**
 * The category of one phone-auth failure. Web errors carry an `auth/…` code; the native plugin carries
 * only the SDK's message, so the message is read too. Order matters: the most specific signal first
 * (a region block is phrased as "not allowed", so it must be tested before `provider-disabled`).
 * Anything unrecognised is `other` — never guessed.
 */
export function otpFailureCategory(err: unknown): OtpFailureCategory {
  const code = rawCode(err);
  const text = `${code} ${rawMessage(err)}`.toLowerCase();
  if (!text.trim()) return 'other';
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  if (has('invalid-phone-number', 'missing-phone-number', 'format of the phone number', 'phone number provided is incorrect', 'too_short', 'too_long', 'invalid_phone_number')) return 'invalid-number';
  if (has('invalid-verification-code', 'missing-verification-code', 'sms verification code used to create the phone auth credential is invalid', 'invalid_code')) return 'code-wrong';
  if (has('code-expired', 'sms code has expired', 'session_expired', 'session-expired')) return 'code-expired';
  if (has('region enabled', 'region is not enabled', 'sms unable to be sent', 'region_not_allowed', 'unsupported region')) return 'region-blocked';
  if (has('quota-exceeded', 'quota for the project has been exceeded', 'quota_exceeded', 'sms quota')) return 'quota-exceeded';
  if (has('too-many-requests', 'unusual activity', 'too_many_attempts', 'too many requests', 'blocked all requests')) return 'too-many-requests';
  if (has('billing-not-enabled', 'billing_not_enabled', 'billing is not enabled')) return 'billing';
  if (has('app-check', 'app check', 'appcheck')) return 'app-check';
  if (has('app-not-authorized', 'not authorized to use firebase authentication', 'sha-1', 'sha-256', 'play_integrity', 'play integrity', 'safety_net', 'safetynet', 'missing a valid app identifier', 'app_not_authorized', 'invalid app info')) return 'app-not-authorized';
  if (has('captcha', 'invalid-app-credential', 'missing-app-credential', 'recaptcha')) return 'recaptcha';
  if (has('operation-not-allowed', 'operation is not allowed', 'operation_not_allowed', 'must enable this service', 'admin-restricted-operation')) return 'provider-disabled';
  if (has('network-request-failed', 'network error', 'timeout', 'timed out', 'unreachable host', 'interrupted connection', 'failed to fetch', 'network request failed')) return 'network';
  if (has('internal-error', 'internal error')) return 'internal';
  return 'other';
}

/**
 * What the admin may read about a failure: the SDK's own words, with anything that looks like a phone
 * number or a token removed and the length bounded. Admin-only — never rendered to a user.
 */
export function otpFailureDetail(err: unknown): string {
  const code = rawCode(err);
  const msg = rawMessage(err);
  const joined = `${code ? `[${code}] ` : ''}${msg}`
    .replace(/\+?\d[\d\s-]{5,}\d/g, '<number>')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim();
  return joined.slice(0, 240);
}

export const OTP_NOT_AVAILABLE = 'Mobile OTP sign-in is not available right now. Please use Email or Google sign-in.';

/** The one sentence a person sees for this category. No code, vendor or raw text. PURE. */
export function otpUserMessage(category: OtpFailureCategory): string {
  switch (category) {
    case 'invalid-number':
      return 'Please enter a valid mobile number with the country code (e.g. +91…).';
    case 'too-many-requests':
      return 'Too many attempts from this device. Please wait a while and try again, or use Email or Google sign-in.';
    case 'quota-exceeded':
      return 'Too many codes have been sent. Please wait a while, or use Email or Google sign-in.';
    case 'network':
      return 'Could not connect. Check your internet connection and try again.';
    case 'code-wrong':
      return 'That code is not correct. Please check it and try again.';
    case 'code-expired':
      return 'That code has expired. Please request a new one.';
    case 'region-blocked':
    case 'provider-disabled':
    case 'billing':
    case 'app-not-authorized':
    case 'app-check':
    case 'recaptcha':
      // A setting on our side — "try again" would be a false instruction. Say what works instead.
      return OTP_NOT_AVAILABLE;
    default:
      return 'Could not send the code. Please try again, or use Email or Google sign-in.';
  }
}
