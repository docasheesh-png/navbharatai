// Tests for the "made by NavBharatAI" badge entitlement (admin 2026-08-21).
//
// The bug being locked out: the removal was decided entirely on the client, so a paid feature was free
// to anyone who flipped a localStorage toggle. Every rule below is money.

import { describe, it, expect } from 'vitest';
import { decideAppSignature, appSignatureNotice } from './appSignatureEntitlement';

const BASE = { requestedRemoval: false, signedIn: true, hasActivePass: false as boolean | null };

describe('decideAppSignature — the badge comes off only when it is paid for AND asked for', () => {
  it('THE ADMIN RULE: a Pass holder who has NOT turned it off still shows the badge', () => {
    expect(decideAppSignature({ ...BASE, requestedRemoval: false, hasActivePass: true }))
      .toEqual({ enabled: true, reason: 'not-requested' });
  });

  it('a Pass holder who DID turn it off gets it removed', () => {
    expect(decideAppSignature({ ...BASE, requestedRemoval: true, hasActivePass: true }))
      .toEqual({ enabled: false, reason: 'removed-by-pass' });
  });

  it('THE BUG: a user with NO Pass cannot remove it, however hard the client asks', () => {
    expect(decideAppSignature({ ...BASE, requestedRemoval: true, hasActivePass: false }))
      .toEqual({ enabled: true, reason: 'requires-pass' });
  });

  it('an anonymous caller cannot remove it — there is no subscription to check', () => {
    expect(decideAppSignature({ requestedRemoval: true, signedIn: false, hasActivePass: null }))
      .toEqual({ enabled: true, reason: 'requires-sign-in' });
  });

  it('FAILS CLOSED: an unreadable entitlement keeps the badge', () => {
    // The opposite of the wallet gate on purpose. Failing open here would hand the paid feature to
    // everyone during any Firestore blip; failing closed costs one user one badge.
    expect(decideAppSignature({ ...BASE, requestedRemoval: true, hasActivePass: null }))
      .toEqual({ enabled: true, reason: 'entitlement-unknown' });
  });

  it('admin/test accounts are entitled', () => {
    expect(decideAppSignature({ ...BASE, requestedRemoval: true, hasActivePass: false, isFreeListed: true }))
      .toEqual({ enabled: false, reason: 'removed-by-pass' });
  });

  it('not asking always wins, whatever else is true — including for an anonymous caller', () => {
    for (const hasActivePass of [true, false, null]) {
      for (const signedIn of [true, false]) {
        expect(decideAppSignature({ requestedRemoval: false, signedIn, hasActivePass }).enabled).toBe(true);
      }
    }
  });

  it('the badge is ONLY ever removed for a genuinely entitled asker', () => {
    // Exhaustive: enumerate every combination and assert removal implies (free-listed OR active pass),
    // so a future edit cannot open a hole in a branch nobody thought to test.
    for (const requestedRemoval of [true, false]) {
      for (const signedIn of [true, false]) {
        for (const hasActivePass of [true, false, null]) {
          for (const isFreeListed of [true, false]) {
            const d = decideAppSignature({ requestedRemoval, signedIn, hasActivePass, isFreeListed });
            if (!d.enabled) {
              expect(requestedRemoval, JSON.stringify({ requestedRemoval, signedIn, hasActivePass, isFreeListed })).toBe(true);
              expect(isFreeListed || hasActivePass === true).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('appSignatureNotice — a switch that does nothing must SAY so', () => {
  it('names the real price and where the toggle is', () => {
    const n = appSignatureNotice('requires-pass', 99);
    expect(n).toContain('₹99/month');
    expect(n).toContain('Settings → General');
  });

  it('uses whatever price is passed, so it can never drift from the real one', () => {
    expect(appSignatureNotice('requires-pass', 149)).toContain('₹149/month');
  });

  it('says something for every not-removed reason, and nothing when it WAS removed', () => {
    expect(appSignatureNotice('requires-sign-in', 99)).toBeTruthy();
    expect(appSignatureNotice('entitlement-unknown', 99)).toBeTruthy();
    expect(appSignatureNotice('removed-by-pass', 99)).toBeNull();
    expect(appSignatureNotice('not-requested', 99)).toBeNull();
  });

  it('never names a vendor or an internal reason code (white-label law)', () => {
    for (const r of ['requires-pass', 'requires-sign-in', 'entitlement-unknown'] as const) {
      const n = appSignatureNotice(r, 99) || '';
      expect(n).not.toMatch(/firestore|firebase|glm|kimi|claude|gemini|grok|e2b|entitlement-unknown/i);
    }
  });
});
