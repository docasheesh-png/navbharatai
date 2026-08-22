/**
 * The phone-bonus claim UI (gift plan v2, slice 3).
 *
 * The two things most worth pinning here are not visual:
 *
 * 1. THIS LINKS, IT DOES NOT SIGN IN. The existing phone flow in AuthComponent is a LOGIN — it calls
 *    `forceLogoutBeforeLogin()` then `signInWithPhoneNumber`/`signInWithCredential`. Reusing those
 *    here would sign the user OUT of the Google account they are standing in and INTO a phone-only
 *    account, abandoning their apps, wallet and history in exchange for a bonus. A future edit that
 *    "simplifies" this back to the sign-in helpers must fail CI.
 *
 * 2. A v2 wallet with credit still claimable must NOT be shown the recharge nag. Such a wallet reads
 *    as `exhausted` in ladder terms, so the ordering in FreeGiftBanner is load-bearing: telling
 *    someone to pay while ₹250 sits unclaimed is wrong at the moment being wrong costs most.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { linkErrorMessage, sanitisePhoneInput } from '../src/components/panels/PhoneBonusCard';

const root = join(__dirname, '..');

/** Scan CODE, not comments — the first run of this suite failed on its own documentation, which
 *  names the sign-in helpers precisely in order to say not to use them. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n');
}

const CARD = stripComments(readFileSync(join(root, 'src/components/panels/PhoneBonusCard.tsx'), 'utf8'));
const BANNER = readFileSync(join(root, 'src/components/panels/FreeGiftBanner.tsx'), 'utf8');
const BILLING = readFileSync(join(root, 'src/components/panels/BillingPanel.tsx'), 'utf8');

describe('the claim LINKS a number — it never signs the user in', () => {
  it('uses the link helpers, not the JS-SDK sign-in ones', () => {
    expect(CARD).toMatch(/linkWithCredential/);
    expect(CARD).toMatch(/linkWithPhoneNumber/);
    // Any of these would abandon the account the user is standing in.
    expect(CARD).not.toMatch(/signInWithCredential/);
    expect(CARD).not.toMatch(/signInWithPhoneNumber\(auth/);
    expect(CARD).not.toMatch(/forceLogoutBeforeLogin/);
  });

  it('the ONE permitted signIn* call is the native plugin dispatching an SMS, not a sign-in', () => {
    // `FirebaseAuthentication.signInWithPhoneNumber` is the Capacitor plugin's SMS dispatch. It
    // creates no session, because capacitor.config.ts sets `skipNativeAuth: true` — the plugin only
    // returns a verificationId and the JS SDK stays the single session source. The credential is then
    // LINKED. Verified against capacitor.config.ts, not assumed.
    const nativeCalls = CARD.match(/FirebaseAuthentication\.signInWithPhoneNumber\(/g) ?? [];
    expect(nativeCalls).toHaveLength(1);
    const config = readFileSync(join(root, 'capacitor.config.ts'), 'utf8');
    expect(config).toMatch(/skipNativeAuth:\s*true/);
    // …and what follows the code arriving is a LINK.
    expect(CARD).toMatch(/linkWithCredential\(user, PhoneAuthProvider\.credential/);
  });

  it('links onto the CURRENT user, and refuses politely when there is none', () => {
    expect(CARD).toMatch(/auth\.currentUser/);
    expect(CARD).toMatch(/Please sign in again, then claim the bonus/);
  });
});

describe('the amount is the server\'s decision, never the screen\'s', () => {
  it('asks the server to settle and sends no amount', () => {
    expect(CARD).toMatch(/claim-phone-bonus/);
    const body = CARD.slice(CARD.indexOf('claim-phone-bonus'), CARD.indexOf('claim-phone-bonus') + 400);
    expect(body).not.toMatch(/amount|tokens:|granted:/);
  });

  it('refreshes the ID token before claiming', () => {
    // The token only carries phone_number AFTER the link; without a refresh the server would
    // honestly answer "verify your phone first" on a verification that had just succeeded.
    const settle = CARD.slice(CARD.indexOf('const settle'), CARD.indexOf('const verifyCode'));
    const refreshAt = settle.indexOf('getIdToken(true)');
    const fetchAt = settle.indexOf('claim-phone-bonus');
    expect(refreshAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(refreshAt);
  });

  it('passes the server anti-spam gateway BEFORE asking Firebase for an SMS', () => {
    const send = CARD.slice(CARD.indexOf('const sendCode'), CARD.indexOf('const settle'));
    const gate = send.indexOf('passGateway');
    const sms = send.indexOf('signInWithPhoneNumber');
    expect(gate).toBeGreaterThan(-1);
    if (sms > -1) expect(sms).toBeGreaterThan(gate); // a refusal must cost no SMS
  });
});

describe('a refusal is information, not a failure', () => {
  it('a granted:0 response renders as a message, not an error', () => {
    expect(CARD).toMatch(/setStage\('refused'\)/);
    const settle = CARD.slice(CARD.indexOf('const settle'), CARD.indexOf('const verifyCode'));
    expect(settle).toMatch(/data\?\.ok && Number\(data\.granted\) > 0/);
  });

  it('the "number already on another account" case never accuses anyone', () => {
    const msg = linkErrorMessage('auth/credential-already-in-use');
    // Innocent and common: an older account they cannot sign in to, or a shared family handset.
    expect(msg).toMatch(/already linked to another NavBharatAI account/i);
    expect(msg).toMatch(/different number|sign in to that account/i);
    expect(msg).not.toMatch(/fraud|abuse|blocked|suspicious|violation/i);
  });

  it('has a usable line for every failure a real user can hit', () => {
    for (const code of [
      'auth/invalid-phone-number', 'auth/invalid-verification-code', 'auth/code-expired',
      'auth/too-many-requests', 'auth/provider-already-linked', 'auth/requires-recent-login',
      'auth/operation-not-allowed', 'something-nobody-anticipated',
    ]) {
      const m = linkErrorMessage(code);
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/auth\//); // never leak a raw Firebase code at a user
    }
  });
});

describe('the phone input cannot carry junk into an SMS request', () => {
  it('keeps digits only and bounds the length', () => {
    expect(sanitisePhoneInput('+91 98765-43210')).toBe('919876543210');
    expect(sanitisePhoneInput('abc')).toBe('');
    expect(sanitisePhoneInput('9'.repeat(40))).toHaveLength(12);
  });
});

describe('a v2 wallet with credit left is never told to pay', () => {
  it('the claim is checked BEFORE the exhausted/recharge branch', () => {
    const claimAt = BANNER.indexOf('if (claimable > 0)');
    const exhaustedAt = BANNER.indexOf('if (freeGift.exhausted)');
    expect(claimAt).toBeGreaterThan(-1);
    expect(exhaustedAt).toBeGreaterThan(claimAt);
  });

  it('the claim only applies to v2 wallets — a ladder wallet is untouched', () => {
    expect(BANNER).toMatch(/freeGift\.plan === 'v2' \? Number\(freeGift\.phoneBonusClaimable \?\? 0\) : 0/);
  });

  it('re-reads the wallet from the server after a claim', () => {
    // A balance this screen computed itself could disagree with the wallet — never on a billing screen.
    expect(BILLING).toMatch(/onClaimed=\{onFetchWallet\}/);
  });
});
