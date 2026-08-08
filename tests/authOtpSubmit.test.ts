import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldDeepDiagnose } from '../src/lib/authDiagnostics';

/**
 * OTP LOGIN REGRESSION (admin report 2026-08-07 — "OTP me gadbad ho gaya, pehle sab theek tha").
 *
 * The screenshot: the MOBILE NUMBER screen showing `[auth/invalid-email]` plus a five-line essay
 * about the GOOGLE provider's configuration. Two separate defects produced it, and both are fixed
 * at the class:
 *   1. The phone inputs live inside the same <form> as the email sign-in, and `handleSubmit` ran
 *      the EMAIL path unconditionally (its phone guard was an empty comment stub). Pressing the
 *      phone keyboard's "Go" key — implicit form submission, exactly what the screenshot caught —
 *      called signInWithEmailAndPassword with an EMPTY email → auth/invalid-email.
 *   2. Every failure then ran the deep probe, whose ADMIN_ONLY_OPERATION reply is rendered as a
 *      Google-configuration diagnosis — a confident WRONG answer pointing at the wrong console.
 */

describe('shouldDeepDiagnose', () => {
  it('never diagnoses a self-explanatory INPUT error as a server/config problem', () => {
    // The exact code from the screenshot — this is what must no longer summon the Google essay.
    expect(shouldDeepDiagnose('auth/invalid-email')).toBe(false);
    for (const code of [
      'auth/missing-email', 'auth/missing-password', 'auth/wrong-password', 'auth/user-not-found',
      'auth/invalid-credential', 'auth/email-already-in-use', 'auth/weak-password',
      'auth/too-many-requests', 'auth/network-request-failed',
      'auth/invalid-phone-number', 'auth/invalid-verification-code', 'auth/code-expired',
    ]) {
      expect(shouldDeepDiagnose(code), code).toBe(false);
    }
  });

  it('KEEPS the probe for the opaque config/internal class it was built for', () => {
    for (const code of ['auth/internal-error', 'auth/operation-not-allowed', 'auth/configuration-not-found', 'auth/unauthorized-domain']) {
      expect(shouldDeepDiagnose(code), code).toBe(true);
    }
    expect(shouldDeepDiagnose(undefined)).toBe(true);  // no code at all is exactly the probe's job
    expect(shouldDeepDiagnose('')).toBe(true);
  });

  it('is case/whitespace tolerant — a code is never mis-classified on formatting', () => {
    expect(shouldDeepDiagnose('  AUTH/INVALID-EMAIL  ')).toBe(false);
  });
});

const src = readFileSync(join(__dirname, '..', 'src/components/AuthComponent.tsx'), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = stripComments(src);

describe('form submission routes by the tab the user is on', () => {
  it('the phone tab NEVER reaches the email sign-in — Enter/"Go" sends or verifies the OTP instead', () => {
    const start = code.indexOf('const handleSubmit');
    const emailCall = code.indexOf('signInWithEmailAndPassword(auth, email, password)', start);
    const seg = code.slice(start, emailCall);
    // The guard exists, is a REAL condition (not the old empty stub), and returns before the email path.
    expect(seg).toContain("authMethod === 'phone' && isLogin");
    expect(seg).toContain('await handleVerifyOtp(); return;');
    expect(seg).toContain('await handleSendOtp(); return;');
    // A half-typed OTP must also stop here rather than falling through.
    expect(seg).toMatch(/return;\s*$/m);
  });

  it('both phone actions delegate to the SAME handlers the buttons call — one implementation each', () => {
    expect(code.split('const handleSendOtp').length - 1).toBe(1);
    expect(code.split('const handleVerifyOtp').length - 1).toBe(1);
    expect(code).toContain('onClick={handleSendOtp}');
    expect(code).toContain('onClick={handleVerifyOtp}');
  });

  it('the misleading deep probe is gated at the single place it is appended', () => {
    expect(code).toContain('if (!shouldDeepDiagnose(err?.code))');
    const gate = code.indexOf('shouldDeepDiagnose(err?.code)');
    const probe = code.indexOf('await diagnoseAuth(email, password)', gate);
    expect(gate).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(gate); // the gate runs BEFORE the probe, never after
  });
});
