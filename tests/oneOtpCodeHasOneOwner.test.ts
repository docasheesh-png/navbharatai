// MOBILE OTP HEALTH, READ PROPERLY (admin page copy, 2026-09-30: "android: 6 sent, 6 verified,
// 1 failed — sign-in:verify:code-expired").
//
// All six people signed in, and one failure was still recorded. The failure was a code used TWICE: on
// Android the SMS Retriever reads the code and signs in automatically, and when the person also taps
// Verify, the same code is spent a second time and fails with code-expired. The sibling in the same
// listener was worse and invisible: with INSTANT verification the phone confirms the number itself, no
// SMS is ever sent, and the listener returned silently — the person waited for a code that could never
// arrive, and none of the three counters moved.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { otpFailureCategory, otpUserMessage, isConfigurationFault, OTP_FAILURE_CATEGORIES } from '../src/lib/otpFailure';
import { summariseOtpOutcomes, parseOtpOutcome } from '../src/server/lib/otpOutcomes';
import { OTP_FIX_HINT } from '../src/components/admin/OtpHealthCard';

const auth = readFileSync('src/components/AuthComponent.tsx', 'utf8');

describe('instant verification is a named, recorded outcome', () => {
  it('the sign-in flow\'s code-less event and the link flow\'s plugin error land in the same category', () => {
    expect(otpFailureCategory({ code: 'instant-verified', message: 'x' })).toBe('instant-verified');
    // What the plugin says when it tries to LINK natively with no native user (skipNativeAuth).
    expect(otpFailureCategory({ message: 'No user is signed in.' })).toBe('instant-verified');
  });

  it('the server accepts it (a category it did not know would be stored as "other")', () => {
    expect(parseOtpOutcome({ outcome: 'failed', surface: 'android', flow: 'sign-in', stage: 'verify', category: 'instant-verified' }))
      .toMatchObject({ category: 'instant-verified' });
    expect(OTP_FAILURE_CATEGORIES).toContain('instant-verified');
    expect(OTP_FIX_HINT['instant-verified']).toMatch(/Service Account Token Creator/);
  });

  it('the person is told no code is coming and what works instead — never "try again" or "wait"', () => {
    const m = otpUserMessage('instant-verified');
    expect(m).toMatch(/without sending a code/);
    expect(m).toMatch(/Email or Google/);
    expect(m).not.toMatch(/try again|wait/i);
    expect(m).not.toMatch(/firebase|google play|capacitor/i);
  });

  it('it is not reported as a console setting, because it is not one', () => {
    expect(isConfigurationFault('instant-verified')).toBe(false);
  });

  it('the listener no longer returns silently when the event carries no code: it asks once more with the native session', () => {
    const listener = auth.slice(auth.indexOf("addListener('phoneVerificationCompleted'"), auth.indexOf("addListener('phoneCodeSent'"));
    expect(listener).toMatch(/if \(!code\) \{[\s\S]*phoneSession\.current = 'native';[\s\S]*signInWithPhoneNumber\(\{ phoneNumber: phone, skipNativeAuth: false \}\)/);
    expect(listener).not.toMatch(/if \(!vid \|\| !code\) return;/);
    // …and a completed native session is handed over, under the same one-owner claim.
    expect(listener).toMatch(/if \(phoneSession\.current === 'native'\) \{[\s\S]*otpClaim\.current !== 'idle'[\s\S]*finishNativePhoneSession\(\)/);
  });

  it('the NORMAL path never reaches the native session: it is set only in the code-less branch, and reset per send', () => {
    expect(auth.match(/phoneSession\.current = 'native'/g)?.length).toBe(1);
    expect(auth).toMatch(/otpClaim\.current = 'idle';\s*phoneSession\.current = 'web';/);
  });

  it('a failed handover is recorded as instant-verified with its code, and the person is told what works', () => {
    const fn = auth.slice(auth.indexOf('const finishNativePhoneSession = async'), auth.indexOf('const handleVerifyOtp = async'));
    expect(fn).toMatch(/describeOtpFailure\(\{ code: 'instant-verified', message: `Native session handover failed: \$\{why\}` \}, 'verify'\)/);
  });
});

describe('one code, one owner', () => {
  const listener = auth.slice(auth.indexOf("addListener('phoneVerificationCompleted'"), auth.indexOf("addListener('phoneCodeSent'"));
  const verify = auth.slice(auth.indexOf('const handleVerifyOtp = async'), auth.indexOf('const handleSubmit = async'));

  it('the automatic path takes the code only if nobody has, and releases it on failure', () => {
    expect(listener).toMatch(/otpClaim\.current !== 'idle'\) return;/);
    expect(listener.indexOf("otpClaim.current = 'working'")).toBeLessThan(listener.indexOf('signInWithCredential'));
    expect(listener).toMatch(/otpClaim\.current = 'done'/);
    expect(listener).toMatch(/catch[\s\S]*otpClaim\.current = 'idle'/);
  });

  it('a Verify tap stands down while the automatic path owns the code, and closes once it is done', () => {
    expect(verify).toMatch(/if \(otpClaim\.current === 'done'\) \{ onClose\(\); return; \}/);
    expect(verify).toMatch(/if \(otpClaim\.current === 'working'\) return;/);
    // …checked BEFORE anything is spent.
    expect(verify.indexOf("otpClaim.current === 'working'")).toBeLessThan(verify.indexOf('signInWithCredential'));
  });

  it('every new code starts un-owned, on both platforms', () => {
    const send = auth.slice(auth.indexOf('await FirebaseAuthentication.removeAllListeners();'), auth.indexOf('const handleVerifyOtp = async'));
    expect(send).toMatch(/nativeVerificationId\.current = null;\s*otpClaim\.current = 'idle';/);
    expect(send).toMatch(/signInWithPhoneNumber\(auth, phone, recaptchaVerifier\.current\);\s*otpClaim\.current = 'idle';/);
  });
});

describe('the admin card reads the numbers plainly', () => {
  it('a failure count is never printed without the verified count beside it', () => {
    const s = summariseOtpOutcomes([{
      day: '2026-09-30',
      counts: { android: { sent: 6, verified: 6, failed: 1 } },
      reasons: { android: { 'sign-in:verify:code-expired': 1 } },
      lastDetail: {},
    }]);
    expect(s.headline).toBe('android: 6 sent, 6 verified, 1 failed — top reason "code-expired".');
  });

  it('the code-expired hint names the double use, not only a late code', () => {
    expect(OTP_FIX_HINT['code-expired']).toMatch(/SECOND time/);
  });
});
