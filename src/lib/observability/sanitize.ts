// THE ONE SANITIZER EVERY ERROR REPORT PASSES THROUGH — client (before Crashlytics or our own log
// endpoint) and server (before the console and Cloud Error Reporting) alike.
//
// It is built on the redactors this repo already trusts (`redactSecrets` for keys, JWTs, PEM blocks and
// `secret=value` assignments; `redactPII` for email, phone, PAN, IFSC and Aadhaar) and adds only the
// shapes that an ERROR REPORT carries and a tool transcript does not:
//   • an `Authorization:` / `Bearer` / `Basic` header value that is not a JWT (an opaque OAuth token);
//   • `Cookie:` / `Set-Cookie:` values;
//   • card numbers (13–19 digits that pass the Luhn check, so an order id is left alone);
//   • UPI addresses (`name@okhdfc`), which the email pattern does not reach because they carry no TLD;
//   • a URL's query string and fragment, where sign-in links, OTP links and OAuth codes travel;
//   • any long opaque run (40+ letters/digits) — a session id or token whose shape we do not know.
//
// ⚠️ Recall over precision HERE, on purpose. `redactSecrets` is high-precision because it rewrites text
// a model and a user must keep reading; a crash report is read by an engineer, and a stack trace with
// one word too many masked is still debuggable, whereas a leaked token is not recoverable.
//
// PURE and never throws: a sanitizer that can fail is a reporter that can crash the app.

import { redactSecrets, redactPII } from '../../server/AgentV3/SecretRedactor';

export const REDACTED = '[REDACTED]';

/** Longest string any single field may carry into a report. */
export const MAX_FIELD_CHARS = 2000;

const EXTRA_PATTERNS: Array<{ re: RegExp; to: string | ((m: string, ...g: string[]) => string) }> = [
  // Authorization header values and bare Bearer/Basic credentials (a JWT is caught earlier).
  { re: /\b(authorization|proxy-authorization)\s*[:=]\s*("?)[^\s",;]+(?:\s+[^\s",;]+)?\2/gi, to: (_m, k) => `${k}: ${REDACTED}` },
  { re: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, to: (_m, k) => `${k} ${REDACTED}` },
  // Cookies.
  { re: /\b(set-cookie|cookie)\s*[:=]\s*[^\n]*/gi, to: (_m, k) => `${k}: ${REDACTED}` },
  // UPI virtual payment addresses (handle@psp, no TLD).
  { re: /\b[a-zA-Z0-9._-]{2,256}@(?:ok[a-z]+|ybl|ibl|axl|paytm|apl|upi|[a-z]{2,10}bank|sbi|icici|hdfc[a-z]*)\b(?!\.)/g, to: REDACTED },
  // Query string and fragment of any absolute URL (keep scheme, host and path).
  { re: /\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>)]*/g, to: (_m, base) => `${base}?${REDACTED}` },
  // Long opaque runs: session ids, tokens, hashes of secrets.
  { re: /\b[A-Za-z0-9_-]{40,}\b/g, to: REDACTED },
];

/** Luhn check, so a 16-digit order number is not mistaken for a card. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function maskCards(text: string): string {
  return text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/[ -]/g, '');
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? REDACTED : m;
  });
}

/**
 * Sanitize one free-text field of an error report: secrets, personal data, card numbers, payment
 * addresses, URL queries and opaque tokens are replaced with `[REDACTED]`, and the result is capped.
 */
export function sanitizeText(input: unknown, max = MAX_FIELD_CHARS): string {
  let text: string;
  try {
    text = typeof input === 'string' ? input : input == null ? '' : String(input);
  } catch {
    return '';
  }
  try {
    let out = redactPII(redactSecrets(text));
    out = out.replace(/\[REDACTED:[a-z-]+\]/g, REDACTED);
    for (const { re, to } of EXTRA_PATTERNS) {
      out = typeof to === 'string' ? out.replace(re, to) : out.replace(re, to as (m: string, ...g: string[]) => string);
    }
    out = maskCards(out);
    return out.length > max ? `${out.slice(0, max)}…` : out;
  } catch {
    // Unknown text we failed to clean is never sent as-is.
    return REDACTED;
  }
}

/** A page URL as a report may carry it: origin and path only, never a query string or fragment. */
export function sanitizeUrl(input: unknown): string {
  try {
    const raw = typeof input === 'string' ? input : '';
    if (!raw) return '';
    const u = new URL(raw, 'https://navbharatai.invalid');
    const path = sanitizeText(u.pathname, 300);
    return u.origin === 'https://navbharatai.invalid' ? path : `${u.origin}${path}`;
  } catch {
    return '';
  }
}

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const SENSITIVE_KEY = /(token|secret|password|passwd|pwd|auth|cookie|session|key|otp|pin|card|upi|vpa|balance|wallet|amount|email|phone|mobile|prompt|message|content)/i;

/**
 * Custom keys a report may carry: a fixed vocabulary of short snake_case names, scalar values only,
 * and never a key whose NAME suggests it holds something private — whatever its value is.
 */
export function sanitizeKeys(input: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input) return out;
  try {
    for (const [k, v] of Object.entries(input).slice(0, 24)) {
      if (!KEY_RE.test(k) || SENSITIVE_KEY.test(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string') out[k] = sanitizeText(v, 100);
    }
  } catch { /* a key we could not read is a key we do not send */ }
  return out;
}
