import { describe, it, expect } from 'vitest';
import {
  summarizeReferrals, selfPayoutTokens, LOOK_AT_THRESHOLD, type ReferralRow,
} from '../src/server/lib/referralAdminSummary';

/**
 * The admin's view of the referral scheme.
 *
 * Two things are being protected. The obvious one is arithmetic: a cost panel that is quietly wrong
 * is worse than none, because it is acted on. The less obvious one is RESTRAINT — this module
 * produces a list for a human to read, and every test below that says "worth a look" is also saying
 * "and nothing happens automatically".
 */

const row = (over: Partial<ReferralRow> & { userId: string }): ReferralRow => ({ ...over });

describe('the arithmetic', () => {
  it('counts participants, referred accounts and what each side was paid', () => {
    const rows: ReferralRow[] = [
      row({ userId: 'A', paidSteps: ['email', 'mobile'], earnedTokens: 7_500 }),
      row({ userId: 'B', paidSteps: ['referral-code', 'email', 'mobile', 'github'], referrerUserId: 'A' }),
      row({ userId: 'C', paidSteps: [], referrerUserId: 'A' }),
    ];
    const s = summarizeReferrals(rows);
    expect(s.participants).toBe(2);       // A and B have earned; C has not
    expect(s.referred).toBe(2);           // B and C applied A's code
    expect(s.referrerTokens).toBe(7_500);
    expect(selfPayoutTokens(rows, 10_000)).toBe(60_000);  // 2 + 4 + 0 steps × ₹100
  });

  it('survives rows that are missing everything, without inventing a number', () => {
    const s = summarizeReferrals([
      row({ userId: 'X' }),
      row({ userId: 'Y', paidSteps: 'not-a-list', earnedTokens: 'lots', referrerUserId: '   ' }),
    ]);
    expect(s.participants).toBe(0);
    expect(s.referred).toBe(0);
    expect(s.referrerTokens).toBe(0);
    expect(s.topReferrers).toEqual([]);
    expect(selfPayoutTokens([row({ userId: 'X' })], NaN)).toBe(0);
  });

  it('says when the figures are a LOWER BOUND, so nobody reads a capped scan as a total', () => {
    expect(summarizeReferrals([], true).capped).toBe(true);
    expect(summarizeReferrals([], false).capped).toBe(false);
  });

  it('orders referrers by how many friends they brought', () => {
    const rows: ReferralRow[] = [
      row({ userId: 'b1', referrerUserId: 'small' }),
      ...Array.from({ length: 5 }, (_, i) => row({ userId: `f${i}`, referrerUserId: 'big' })),
    ];
    expect(summarizeReferrals(rows).topReferrers[0].referrerUserId).toBe('big');
  });
});

describe('the pattern worth a look', () => {
  /** N friends, none of whom verified a mobile — the shape a factory-reset farm leaves. */
  const farm = (n: number, withMobile = 0): ReferralRow[] =>
    Array.from({ length: n }, (_, i) => row({
      userId: `f${i}`, referrerUserId: 'R',
      paidSteps: i < withMobile ? ['email', 'mobile'] : ['email', 'github'],
    }));

  it('flags many friends, none with a verified mobile', () => {
    const s = summarizeReferrals(farm(6));
    expect(s.topReferrers[0].worthALook).toBe(true);
    expect(s.topReferrers[0].friendsWithMobile).toBe(0);
  });

  it('does NOT flag a referrer whose friends verified — a popular user is not a farm', () => {
    const s = summarizeReferrals(farm(6, 1));
    expect(s.topReferrers[0].worthALook).toBe(false);
  });

  it('does not flag a handful of friends who simply have not finished yet', () => {
    // The honest user this could inconvenience: three friends, none of whom got round to the OTP.
    const s = summarizeReferrals(farm(LOOK_AT_THRESHOLD - 1));
    expect(s.topReferrers[0].worthALook).toBe(false);
  });

  it('🔒 produces a QUESTION, never a verdict — nothing here blocks, claws back or flags an account', () => {
    const s = summarizeReferrals(farm(20));
    const entry = s.topReferrers[0];
    // The only thing it can say is "look at this". There is no field that does anything.
    expect(Object.keys(entry).sort()).toEqual(
      ['earnedTokens', 'friends', 'friendsWithMobile', 'referrerUserId', 'worthALook'].sort(),
    );
    expect(JSON.stringify(s)).not.toMatch(/block|suspend|ban|clawback|revoke/i);
  });
});
