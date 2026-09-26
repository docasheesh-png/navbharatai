// A FAILED MOBILE OTP SAYS WHY — to the admin, and honestly to the user (admin 2026-09-26:
// "Mobile otp send nhi ho raha hai", screenshot of the Android app reading "Could not verify your phone
// number. Please try again"). The native phone-auth plugin reports a failure as `{ message }` with no
// code, so every native failure fell through to the generic line and its real reason was readable only
// in the handset's developer console.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  otpFailureCategory, otpFailureDetail, otpUserMessage, isConfigurationFault, OTP_NOT_AVAILABLE,
  OTP_FAILURE_CATEGORIES,
} from '../src/lib/otpFailure';
import { otpFailureReport, otpSurface, sendOtpReport } from '../src/lib/otpReport';
import { parseOtpOutcome, scrubDetail, summariseOtpOutcomes } from '../src/server/lib/otpOutcomes';
import { otpReportAllowed, OTP_REPORTS_PER_HOUR } from '../src/server/routes/auth';
import { readableAuthError } from '../src/components/VerifyPhoneSheet';
import { OTP_FIX_HINT } from '../src/components/admin/OtpHealthCard';

const native = (message: string) => ({ message });

describe('1 · the native plugin\'s message is read, not dropped', () => {
  const cases: Array<[string, string]> = [
    ['This app is not authorized to use Firebase Authentication. Please verify that the correct package name, SHA-1, and SHA-256 are configured in the Firebase Console. [ Invalid app info in play_integrity_token ]', 'app-not-authorized'],
    ['SMS unable to be sent until this region enabled by the app developer.', 'region-blocked'],
    ['The sms quota for the project has been exceeded.', 'quota-exceeded'],
    ['We have blocked all requests from this device due to unusual activity. Try again later.', 'too-many-requests'],
    ['The format of the phone number provided is incorrect. Please enter the phone number in a format that can be parsed into E.164 format.', 'invalid-number'],
    ['This operation is not allowed. You must enable this service in the console.', 'provider-disabled'],
    ['An internal error has occurred. [ BILLING_NOT_ENABLED ]', 'billing'],
    ['A network error (such as timeout, interrupted connection or unreachable host) has occurred.', 'network'],
    ['Firebase App Check token is invalid.', 'app-check'],
    ['An internal error has occurred. [ Something new ]', 'internal'],
    ['Something nobody has seen before', 'other'],
  ];
  for (const [msg, cat] of cases) {
    it(`${cat} ← "${msg.slice(0, 50)}…"`, () => expect(otpFailureCategory(native(msg))).toBe(cat));
  }

  it('web error codes are read too', () => {
    expect(otpFailureCategory({ code: 'auth/invalid-app-credential' })).toBe('recaptcha');
    expect(otpFailureCategory({ code: 'auth/billing-not-enabled' })).toBe('billing');
    expect(otpFailureCategory({ code: 'auth/operation-not-allowed' })).toBe('provider-disabled');
    expect(otpFailureCategory({ code: 'auth/invalid-verification-code' })).toBe('code-wrong');
    expect(otpFailureCategory({ code: 'auth/code-expired' })).toBe('code-expired');
    expect(otpFailureCategory(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('never throws on junk', () => {
    for (const j of [null, undefined, 42, {}, { message: 7 }, 'x']) expect(OTP_FAILURE_CATEGORIES).toContain(otpFailureCategory(j));
  });
});

describe('2 · the user\'s sentence is honest and white-label', () => {
  it('a setting on our side never says "try again" — retrying cannot help', () => {
    for (const c of OTP_FAILURE_CATEGORIES.filter(isConfigurationFault)) {
      expect(otpUserMessage(c)).toBe(OTP_NOT_AVAILABLE);
      expect(otpUserMessage(c)).not.toMatch(/try again/i);
    }
  });
  it('no sentence names a vendor, code or raw text', () => {
    for (const c of OTP_FAILURE_CATEGORIES) expect(otpUserMessage(c)).not.toMatch(/firebase|google play|auth\/|sha-|\[/i);
  });
  it('the verify sheet no longer prints the provider\'s raw message', () => {
    const raw = native('This app is not authorized to use Firebase Authentication. Please verify SHA-1');
    expect(readableAuthError(raw)).toBe(OTP_NOT_AVAILABLE);
    expect(readableAuthError(Object.assign(new Error('Verification expired. Send the code again.'), { ownMessage: true })))
      .toBe('Verification expired. Send the code again.');
    expect(readableAuthError({ code: 'auth/requires-recent-login' })).toMatch(/sign in again/);
  });
});

describe('3 · what reaches the admin names nobody', () => {
  it('phone numbers and long tokens are scrubbed, on the phone and again on the server', () => {
    const d = otpFailureDetail(native('Failed for +91 77420 39808 with token abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP123'));
    expect(d).not.toMatch(/77420|39808/);
    expect(d).toContain('<number>');
    expect(d).toContain('<token>');
    expect(scrubDetail('call 9876543210 now')).toBe('call <number> now');
    expect(scrubDetail('x'.repeat(1000)).length).toBeLessThanOrEqual(240);
  });
  it('the report carries the category and the scrubbed detail, and a surface from the platform', () => {
    const r = otpFailureReport(native('SMS unable to be sent until this region enabled by the app developer.'), 'android', 'sign-in', 'send');
    expect(r).toMatchObject({ outcome: 'failed', surface: 'android', flow: 'sign-in', stage: 'send', category: 'region-blocked' });
    expect(otpSurface(() => 'ios')).toBe('ios');
    expect(otpSurface(() => 'electron')).toBe('web');
    expect(otpSurface(() => { throw new Error('x'); })).toBe('web');
  });
  it('sending a report can never throw, even when fetch does', () => {
    expect(() => sendOtpReport({ outcome: 'sent', surface: 'web', flow: 'sign-in' }, (() => { throw new Error('boom'); }) as never)).not.toThrow();
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    sendOtpReport({ outcome: 'sent', surface: 'web', flow: 'sign-in' }, f as never);
    expect(f).toHaveBeenCalledWith('/api/auth/otp-outcome', expect.objectContaining({ method: 'POST' }));
  });
});

describe('4 · the server trusts nothing it is sent', () => {
  it('unknown enums are refused, never coerced', () => {
    expect(parseOtpOutcome({ outcome: 'hacked', surface: 'web', flow: 'sign-in' })).toBeNull();
    expect(parseOtpOutcome({ outcome: 'sent', surface: 'windows', flow: 'sign-in' })).toBeNull();
    expect(parseOtpOutcome(null)).toBeNull();
    expect(parseOtpOutcome({ outcome: 'failed', surface: 'android', flow: 'link', category: 'made-up', detail: 'call 9876543210' }))
      .toEqual({ outcome: 'failed', surface: 'android', flow: 'link', stage: 'send', category: 'other', detail: 'call <number>' });
    // A success carries no reason, whatever is sent with it.
    expect(parseOtpOutcome({ outcome: 'sent', surface: 'web', flow: 'sign-in', detail: 'x', category: 'billing' }))
      .toEqual({ outcome: 'sent', surface: 'web', flow: 'sign-in' });
  });
  it('one address may report only so often', () => {
    const now = 1_000_000;
    for (let i = 0; i < OTP_REPORTS_PER_HOUR; i++) expect(otpReportAllowed('203.0.113.9', now + i)).toBe(true);
    expect(otpReportAllowed('203.0.113.9', now + 100)).toBe(false);
    expect(otpReportAllowed('203.0.113.10', now + 100)).toBe(true);
    expect(otpReportAllowed('203.0.113.9', now + 3_600_001 + OTP_REPORTS_PER_HOUR)).toBe(true);
  });
});

describe('5 · the admin card reads the numbers plainly', () => {
  it('"every send failed" is said, with the top reason and whether it is our setting', () => {
    const s = summariseOtpOutcomes([
      { day: '2026-09-26', counts: { android: { failed: 3 }, web: { sent: 2, verified: 2 } }, reasons: { android: { 'sign-in:send:app-not-authorized': 3 } }, lastDetail: { 'android:app-not-authorized': { text: 'not authorized', at: 5 } } },
      { day: '2026-09-25', counts: { android: { failed: 1 } }, reasons: { android: { 'sign-in:send:app-not-authorized': 1 } }, lastDetail: { 'android:app-not-authorized': { text: 'older', at: 1 } } },
    ]);
    expect(s.headline).toMatch(/android: every send failed \(4\) — mostly "app-not-authorized", a setting on our side/);
    expect(s.headline).toMatch(/web: 2 sent, none failed/);
    expect(s.latest).toEqual([{ key: 'android:app-not-authorized', text: 'not authorized', at: 5 }]);
  });
  it('an empty tally says nothing was recorded, not that all is well', () => {
    expect(summariseOtpOutcomes([]).headline).toBe('No mobile OTP attempt has been recorded yet.');
  });
  it('every failure kind has a fix hint', () => {
    for (const c of OTP_FAILURE_CATEGORIES) expect(OTP_FIX_HINT[c]).toBeTruthy();
  });
});

describe('6 · the wiring (source guards — tsc and vitest cannot see a missing listener)', () => {
  const auth = readFileSync('src/components/AuthComponent.tsx', 'utf8');
  const sheet = readFileSync('src/components/VerifyPhoneSheet.tsx', 'utf8');
  it('the sign-in screen classifies and reports every OTP failure', () => {
    expect(auth).toMatch(/phoneVerificationFailed[\s\S]{0,120}describeOtpFailure\(event, 'send'\)/);
    expect(auth).toMatch(/describeOtpFailure\(err, 'verify'\)/);
    expect(auth).not.toMatch(/describeAuthError\([^)]*'otp'\)/);
  });
  it('the verify sheet listens for a FAILED native send, not only a successful one', () => {
    expect(sheet).toMatch(/addListener\('phoneVerificationFailed'/);
    expect(sheet).toMatch(/await outcome;/);
  });
  it('the report route and the admin card are mounted', () => {
    expect(readFileSync('src/server/routes/auth.ts', 'utf8')).toMatch(/app\.post\('\/api\/auth\/otp-outcome'/);
    expect(readFileSync('src/server/routes/admin.ts', 'utf8')).toMatch(/app\.get\('\/api\/admin\/otp-outcomes', verifyAdminToken/);
    expect(readFileSync('src/components/AdminDashboard.tsx', 'utf8')).toMatch(/<OtpHealthCard adminToken=\{adminToken\} \/>/);
  });
});
