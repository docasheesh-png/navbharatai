import { describe, it, expect } from 'vitest';
import {
  buildChecklist, checklistLabel, pendingRupees, shouldShowChecklist, noticeShouldWait, checklistHeadline,
} from '../src/lib/referralChecklist';
import {
  shouldOfferReferralBox, referralBoxAlreadyOffered, markReferralBoxOffered,
  holdReferralCode, heldReferralCode, clearHeldReferralCode,
} from '../src/lib/pendingReferralCode';

/**
 * The checklist inside the testing notice, and the one-time code box on the sign-in screen.
 *
 * Both are about the same risk: showing somebody MONEY on a surface that was designed to disappear.
 * The popup auto-dismisses after three seconds, and the sign-in screen is somewhere a user passes
 * through once. Everything asserted here is a rule that stops a person losing ₹100 to a timer or a
 * form they never saw again.
 */

const rows = (claimed: string[] = []) => buildChecklist(
  ['referral-code', 'email', 'mobile', 'github'].map((step) => ({ step, claimed: claimed.includes(step), rupees: 100 })),
);

describe('building the rows', () => {
  it('returns the admin’s own order regardless of what the server sent', () => {
    const out = buildChecklist([
      { step: 'github', claimed: false, rupees: 100 },
      { step: 'mobile', claimed: true, rupees: 100 },
      { step: 'referral-code', claimed: true, rupees: 100 },
      { step: 'email', claimed: true, rupees: 100 },
    ]);
    expect(out.map((r) => r.step)).toEqual(['referral-code', 'email', 'mobile', 'github']);
  });

  it('reads CLAIMED only from an explicit true — anything else errs toward "there is money left"', () => {
    for (const claimed of [false, 'true', 1, null, undefined, {}]) {
      const out = buildChecklist([{ step: 'email', claimed, rupees: 100 }]);
      expect(out[0].claimed, JSON.stringify(claimed)).toBe(false);
    }
    expect(buildChecklist([{ step: 'email', claimed: true, rupees: 100 }])[0].claimed).toBe(true);
  });

  it('DROPS an unreadable row rather than guessing — this renders money', () => {
    const out = buildChecklist([
      { step: 'email', claimed: false, rupees: 100 },
      { step: 'not-a-step', claimed: false, rupees: 100 },
      { step: 'github', claimed: false, rupees: 0 },
      { step: 'mobile', claimed: false, rupees: 'lots' },
      null, 'nonsense', 42,
    ]);
    expect(out.map((r) => r.step)).toEqual(['email']);
  });

  it('survives a response that is not a list at all', () => {
    for (const junk of [null, undefined, {}, 'steps', 42]) expect(buildChecklist(junk)).toEqual([]);
  });

  it('de-duplicates a repeated step', () => {
    const out = buildChecklist([
      { step: 'email', claimed: true, rupees: 100 },
      { step: 'email', claimed: false, rupees: 100 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].claimed).toBe(true);
  });
});

describe('the words', () => {
  it('say claimed or pending, with the amount, as the admin’s example does', () => {
    expect(checklistLabel('email', true, 100)).toBe('Gmail / email verified — ₹100 claimed');
    expect(checklistLabel('github', false, 100)).toBe('GitHub not connected — ₹100 pending');
    expect(checklistLabel('mobile', false, 100)).toBe('Mobile number not verified — ₹100 pending');
    expect(checklistLabel('referral-code', true, 100)).toBe('Referral code applied — ₹100 claimed');
  });

  it('are English only — the CLAUDE.md language standard, enforced in CI elsewhere too', () => {
    for (const step of ['referral-code', 'email', 'mobile', 'github'] as const) {
      for (const claimed of [true, false]) {
        expect(checklistLabel(step, claimed, 100)).not.toMatch(/[ऀ-ॿ]/);
      }
    }
  });

  it('the headline names the amount, because the amount is the reason to keep reading', () => {
    expect(checklistHeadline(rows(['email']))).toBe('₹300 of free credit is still waiting for you');
  });
});

describe('🔒 the notice must not take money off the screen', () => {
  it('waits for the user while ANYTHING is unclaimed', () => {
    expect(noticeShouldWait(rows(), 'android')).toBe(true);
    expect(noticeShouldWait(rows(['email', 'mobile']), 'android')).toBe(true);
  });

  it('goes back to its three seconds once everything is claimed', () => {
    const all = rows(['referral-code', 'email', 'mobile', 'github']);
    expect(pendingRupees(all)).toBe(0);
    expect(noticeShouldWait(all, 'android')).toBe(false);
    // And the money section disappears entirely — otherwise somebody who finished weeks ago is
    // congratulated on every single launch, which is how a helpful thing becomes a nagging one.
    expect(shouldShowChecklist(all, 'android')).toBe(false);
  });

  it('shows nothing at all on the website — the bonus cannot be claimed there', () => {
    for (const p of ['web', 'ios', '', null, undefined]) {
      expect(shouldShowChecklist(rows(), p), String(p)).toBe(false);
      expect(noticeShouldWait(rows(), p), String(p)).toBe(false);
    }
  });

  it('shows nothing when the lookup returned nothing', () => {
    expect(shouldShowChecklist([], 'android')).toBe(false);
  });
});

describe('the one-time code box on the sign-in screen', () => {
  /** A storage that behaves, and one that throws on everything. */
  const working = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
    } as unknown as Storage;
  };
  const broken = () => ({
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  } as unknown as Storage);

  it('is offered on Android, to a signed-out visitor, once', () => {
    expect(shouldOfferReferralBox({ platform: 'android', alreadyOffered: false, signedIn: false })).toBe(true);
    expect(shouldOfferReferralBox({ platform: 'android', alreadyOffered: true, signedIn: false })).toBe(false);
    expect(shouldOfferReferralBox({ platform: 'android', alreadyOffered: false, signedIn: true })).toBe(false);
    expect(shouldOfferReferralBox({ platform: 'web', alreadyOffered: false, signedIn: false })).toBe(false);
  });

  it('remembers it was offered', () => {
    const s = working();
    expect(referralBoxAlreadyOffered(s)).toBe(false);
    markReferralBoxOffered(s);
    expect(referralBoxAlreadyOffered(s)).toBe(true);
  });

  it('🔒 A BROKEN STORAGE READS AS "ALREADY OFFERED" — the opposite of the testing notice, on purpose', () => {
    // The notice is information and showing it twice is harmless. This is a FORM on the sign-in
    // path, and a browser that cannot remember would offer it on every single launch, for ever.
    expect(referralBoxAlreadyOffered(broken())).toBe(true);
    // And nothing throws, on any path — the sign-in screen must never be broken by site data.
    expect(() => markReferralBoxOffered(broken())).not.toThrow();
    expect(() => holdReferralCode('ABCDEF', broken())).not.toThrow();
    expect(() => clearHeldReferralCode(broken())).not.toThrow();
    expect(heldReferralCode(broken())).toBeNull();
  });

  it('holds a code until there is an account, and forgets it afterwards', () => {
    const s = working();
    expect(heldReferralCode(s)).toBeNull();
    holdReferralCode('ABCDEF', s);
    expect(heldReferralCode(s)).toBe('ABCDEF');
    clearHeldReferralCode(s);
    expect(heldReferralCode(s)).toBeNull();
  });

  it('treats a blank held value as no code', () => {
    const s = working();
    holdReferralCode('   ', s);
    expect(heldReferralCode(s)).toBeNull();
  });
});
