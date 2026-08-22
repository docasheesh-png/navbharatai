import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  otpSendDecision,
  phoneOwnerUid,
  hasVerifiedPhoneWith,
  importPhoneGateEnabled,
  phoneForLog,
  PHONE_TAKEN_MESSAGE,
  IMPORT_NEEDS_PHONE_MESSAGE,
  type PhoneLookupAuth,
} from './phoneGate';
import { normalizePhone, maskPhone } from '../../lib/phoneNumber';

/**
 * ONE NUMBER, ONE ACCOUNT — and an import needs a verified one.
 *
 * ADMIN 2026-08-22: a number that already has an account must not be verifiable onto a second one, and
 * the OTP must not even be SENT. This replaced an earlier plan to MERGE the two accounts, which would
 * have been dangerous in exactly the Indian case: a disconnected number is reallocated after ~90 days,
 * so "already linked" often means the previous owner of that SIM.
 *
 * The subtle half — and the one these tests exist to keep true — is that LOGIN and VERIFY are opposite
 * cases on the same endpoint. Refusing a number that has an account is correct for VERIFY and would
 * lock every returning phone user out on LOGIN.
 */

const authWith = (over: Partial<PhoneLookupAuth>): PhoneLookupAuth => ({
  getUserByPhoneNumber: async () => null,
  getUser: async () => ({ phoneNumber: null }),
  ...over,
});

describe('otpSendDecision — the same number, two opposite answers', () => {
  it('LOGIN with a number that has an account is ALLOWED — that is what signing in IS', () => {
    const d = otpSendDecision({ purpose: 'login', ownerUid: 'someone', callerUid: null });
    expect(d.allow).toBe(true);
  });

  it('VERIFY a number owned by SOMEBODY ELSE is refused, with the way out in the message', () => {
    const d = otpSendDecision({ purpose: 'verify', ownerUid: 'other-user', callerUid: 'me' });
    expect(d.allow).toBe(false);
    expect(d.code).toBe('phone-belongs-to-another-account');
    // A bare "already in use" is a dead end and a support ticket. The refusal names the door.
    expect(d.message).toBe(PHONE_TAKEN_MESSAGE);
    expect(d.message).toContain('Sign in with this number');
  });

  it('VERIFY a number NOBODY owns is allowed', () => {
    expect(otpSendDecision({ purpose: 'verify', ownerUid: null, callerUid: 'me' }).allow).toBe(true);
  });

  it('VERIFY your OWN number again is allowed — a reinstall must not accuse you of theft', () => {
    expect(otpSendDecision({ purpose: 'verify', ownerUid: 'me', callerUid: 'me' }).allow).toBe(true);
  });
});

describe('phoneOwnerUid — fails OPEN, on purpose', () => {
  it('finds the owner of a number', async () => {
    const auth = authWith({ getUserByPhoneNumber: async () => ({ uid: 'owner-1' }) });
    expect(await phoneOwnerUid('+919876543210', async () => auth)).toBe('owner-1');
  });

  it('normalises before looking up — the client sends what a person typed', async () => {
    let asked = '';
    const auth = authWith({ getUserByPhoneNumber: async (p) => { asked = p; return null; } });
    await phoneOwnerUid('98765 43210', async () => auth);
    expect(asked).toBe('+919876543210');
  });

  it('a directory we cannot read returns null, so the OTP is SENT', async () => {
    // The provider still refuses a duplicate at link time, so nothing can slip through. Failing CLOSED
    // here would mean one provider hiccup locks every user out of verification — far worse than one
    // wasted SMS.
    const boom = async (): Promise<PhoneLookupAuth> => { throw new Error('directory down'); };
    expect(await phoneOwnerUid('+919876543210', boom)).toBeNull();
    expect(await phoneOwnerUid('+919876543210', async () => null)).toBeNull();
  });

  it('an unusable number is never looked up at all', async () => {
    let called = false;
    const auth = authWith({ getUserByPhoneNumber: async () => { called = true; return null; } });
    expect(await phoneOwnerUid('12345', async () => auth)).toBeNull();
    expect(called).toBe(false);
  });
});

describe('hasVerifiedPhoneWith — fails CLOSED, and the asymmetry is the point', () => {
  it('true only when the account really carries a number', async () => {
    expect(await hasVerifiedPhoneWith('u1', async () => authWith({ getUser: async () => ({ phoneNumber: '+919876543210' }) }))).toBe(true);
    expect(await hasVerifiedPhoneWith('u1', async () => authWith({ getUser: async () => ({ phoneNumber: '  ' }) }))).toBe(false);
    expect(await hasVerifiedPhoneWith('u1', async () => authWith({ getUser: async () => ({}) }))).toBe(false);
  });

  it('an unreadable directory means NOT verified — one OTP costs the user less than a free import costs us', async () => {
    const boom = async (): Promise<PhoneLookupAuth> => { throw new Error('down'); };
    expect(await hasVerifiedPhoneWith('u1', boom)).toBe(false);
    expect(await hasVerifiedPhoneWith('u1', async () => null)).toBe(false);
  });

  it('an anonymous caller is never verified', async () => {
    expect(await hasVerifiedPhoneWith(null, async () => authWith({ getUser: async () => ({ phoneNumber: '+91987' }) }))).toBe(false);
  });
});

describe('normalizePhone — shared with the browser so the two can never drift', () => {
  it('applies the country code to a bare 10-digit number, matching the sign-in screen', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
    expect(normalizePhone('98765-43210')).toBe('+919876543210');
    expect(normalizePhone(' (98765) 43210 ')).toBe('+919876543210');
  });

  it('keeps an explicit country code', () => {
    expect(normalizePhone('+1 415 555 0123')).toBe('+14155550123');
  });

  it('refuses to GUESS a country — a wrong guess looks up somebody else’s number', () => {
    expect(normalizePhone('919876543210')).toBeNull(); // 12 digits, no plus
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('masks for logs without printing the number', () => {
    expect(maskPhone('+919876543210')).toBe('••••3210');
    expect(phoneForLog('9876543210')).toBe('••••3210');
    expect(maskPhone('12')).toBe('');
  });
});

describe('the kill switch', () => {
  it('is ON by default and OFF only when explicitly set', () => {
    expect(importPhoneGateEnabled({})).toBe(true);
    expect(importPhoneGateEnabled({ AGENTV3_IMPORT_REQUIRES_PHONE: 'on' })).toBe(true);
    expect(importPhoneGateEnabled({ AGENTV3_IMPORT_REQUIRES_PHONE: 'off' })).toBe(false);
    expect(importPhoneGateEnabled({ AGENTV3_IMPORT_REQUIRES_PHONE: 'OFF' })).toBe(false);
  });
});

// ── The wiring ──────────────────────────────────────────────────────────────
describe('both gates are really connected, and to the same helper', () => {
  const auth = readFileSync(join(process.cwd(), 'src/server/routes/auth.ts'), 'utf8');
  const chat = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const zip = readFileSync(join(process.cwd(), 'src/server/routes/zipUpload.ts'), 'utf8');

  it('send-otp checks ownership only for VERIFY, and defaults to LOGIN', () => {
    expect(auth).toContain("req.body?.purpose === 'verify' ? 'verify' : 'login'");
    expect(auth).toContain("if (purpose === 'verify') {");
    expect(auth).toContain('otpSendDecision(');
  });

  it('the refusal is a 409, not a 429 — retrying later cannot help', () => {
    expect(auth).toContain('res.status(409)');
  });

  it('ONE gate covers BOTH import kinds, at the line that already recognises them', () => {
    // A gate per route would be two gates that drift; a third import kind added later inherits this
    // one for free.
    expect(chat).toContain('if (hasImportIntent && importPhoneGateEnabled()) {');
    expect(chat).toContain('hasVerifiedPhoneWith(importerUid, getAdminAuthForPhone)');
  });

  it('the zip upload is refused BEFORE any bytes move', () => {
    expect(zip).toContain('importPhoneGateEnabled() && !(await hasVerifiedPhoneWith(uid, getAdminAuthForPhone))');
    expect(zip).toContain("code: 'phone-verification-required'");
  });

  it('the user is told WHY, not just refused', () => {
    expect(IMPORT_NEEDS_PHONE_MESSAGE).toContain('one OTP');
    expect(IMPORT_NEEDS_PHONE_MESSAGE).toContain('once');
  });
});

describe('the client side is wired, and does not accidentally SIGN IN', () => {
  const sheet = readFileSync(join(process.cwd(), 'src/components/VerifyPhoneSheet.tsx'), 'utf8');
  const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
  const authUi = readFileSync(join(process.cwd(), 'src/components/AuthComponent.tsx'), 'utf8');
  const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

  it('the sheet LINKS the number to the current account — it never signs in with it', () => {
    // Signing in here would open whichever account owns the number, which the user would experience
    // as their account silently changing while they were trying to secure it.
    expect(sheet).toContain('linkWithPhoneNumber');
    expect(sheet).toContain('linkWithCredential(');
    expect(sheet).not.toContain('signInWithPhoneNumber');
    expect(sheet).not.toContain('signInWithCredential');
  });

  it('it declares its purpose, so the server knows this is VERIFY and not LOGIN', () => {
    expect(sheet).toContain("purpose: 'verify'");
  });

  it('a taken number ends in a DOOR, not a dead end', () => {
    expect(sheet).toContain('Sign in with this number instead');
    // The sheet REPORTS the situation; the panel that opened it decides where "sign in" goes. Asserting
    // the dispatch on the sheet would be asserting a layering the code deliberately does not have.
    expect(sheet).toContain('onSignInInstead(');
    expect(panel).toContain("signIn: 'phone'");
    // …and App actually listens for it, or the button would be decoration.
    expect(app).toContain("detail?.signIn === 'phone'");
    expect(app).toContain('setShowAuth(true)');
  });

  it('the refused import offers the OTP instead of "Fix with AI"', () => {
    // Fix-with-AI cannot repair a missing phone number and would spend a build finding that out.
    expect(panel).toContain("state.errorCode === 'phone-verification-required'");
    expect(panel).toContain('Verify my number');
  });

  it('sign-in and the server share ONE normaliser — the drift this whole check depends on not having', () => {
    expect(authUi).toContain("import { normalizePhone } from '../lib/phoneNumber'");
    expect(authUi).not.toContain("'+91' + phone");
    expect(sheet).toContain("from '../lib/phoneNumber'");
  });
});
