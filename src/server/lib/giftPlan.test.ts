import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeEmailForGift, normalizePhoneForGift, giftMarkerCandidates, giftMarkerIdToWrite,
} from './giftIdentity';
import {
  giftPlanV2Enabled, unverifiedGiftTokens, verifiedGiftTotalTokens,
  decideSignupGrant, decidePhoneClaim, claimRefusalMessage,
} from './giftPlan';

const ON = { WALLET_GIFT_V2: 'on' } as NodeJS.ProcessEnv;

describe('normalizeEmailForGift — the free, instant multi-account hole', () => {
  it('collapses Gmail plus-aliases onto one identity', () => {
    const base = normalizeEmailForGift('me@gmail.com');
    expect(normalizeEmailForGift('me+1@gmail.com')).toBe(base);
    expect(normalizeEmailForGift('me+anything@gmail.com')).toBe(base);
    expect(normalizeEmailForGift('ME+2@GMAIL.COM')).toBe(base);
  });

  it('collapses Gmail dots, and folds googlemail.com onto gmail.com', () => {
    const base = normalizeEmailForGift('me@gmail.com');
    expect(normalizeEmailForGift('m.e@gmail.com')).toBe(base);
    expect(normalizeEmailForGift('m.e.@gmail.com')).toBe(base);
    expect(normalizeEmailForGift('me@googlemail.com')).toBe(base);
    expect(normalizeEmailForGift('m.e+tag@googlemail.com')).toBe(base);
  });

  it('strips plus-aliases on other providers too', () => {
    expect(normalizeEmailForGift('a+x@outlook.com')).toBe('a@outlook.com');
    expect(normalizeEmailForGift('a+x@company.co.in')).toBe('a@company.co.in');
  });

  it('does NOT strip dots outside Gmail — they are different real mailboxes there', () => {
    expect(normalizeEmailForGift('first.last@outlook.com')).toBe('first.last@outlook.com');
    expect(normalizeEmailForGift('first.last@company.co.in')).toBe('first.last@company.co.in');
    expect(normalizeEmailForGift('a.b@outlook.com')).not.toBe(normalizeEmailForGift('ab@outlook.com'));
  });

  it('never collapses distinct people onto one key through an oddity', () => {
    // A local part that is only a suffix must not become '' and swallow every such address.
    expect(normalizeEmailForGift('+tag@gmail.com')).not.toBe('@gmail.com');
    expect(normalizeEmailForGift('+a@gmail.com')).not.toBe(normalizeEmailForGift('+b@gmail.com'));
    // Malformed input is passed through, not forced into a shared shape.
    expect(normalizeEmailForGift('a@@b.com')).toBe('a@@b.com');
    expect(normalizeEmailForGift('nodomain')).toBe('nodomain');
    expect(normalizeEmailForGift('trailing@')).toBe('trailing@');
    expect(normalizeEmailForGift('')).toBe('');
    expect(normalizeEmailForGift(null)).toBe('');
    expect(normalizeEmailForGift(undefined)).toBe('');
  });

  it('keeps genuinely different people apart', () => {
    expect(normalizeEmailForGift('amit@gmail.com')).not.toBe(normalizeEmailForGift('sunita@gmail.com'));
    expect(normalizeEmailForGift('a@gmail.com')).not.toBe(normalizeEmailForGift('a@outlook.com'));
  });
});

describe('normalizePhoneForGift — one handset is one identity', () => {
  it('resolves the Indian forms of one number onto one identity', () => {
    const base = normalizePhoneForGift('+919876543210');
    expect(normalizePhoneForGift('9876543210')).toBe(base);
    expect(normalizePhoneForGift('09876543210')).toBe(base);
    expect(normalizePhoneForGift('+91 98765-43210')).toBe(base);
    expect(normalizePhoneForGift('(+91) 98765 43210')).toBe(base);
    expect(base).toBe('919876543210');
  });

  it('does not invent a country code for a foreign number', () => {
    // Guessing one would merge two genuinely different people and cost an honest user their gift.
    expect(normalizePhoneForGift('+14155552671')).toBe('14155552671');
    expect(normalizePhoneForGift('+442071838750')).toBe('442071838750');
  });

  it('keeps different numbers apart, and handles junk', () => {
    expect(normalizePhoneForGift('9876543210')).not.toBe(normalizePhoneForGift('9876543211'));
    expect(normalizePhoneForGift('')).toBe('');
    expect(normalizePhoneForGift(null)).toBe('');
    expect(normalizePhoneForGift('abc')).toBe('');
  });
});

describe('giftMarkerCandidates — a pepper change must never mint a second gift', () => {
  const OLD = process.env.GIFT_ID_PEPPER;
  afterEach(() => { if (OLD === undefined) delete process.env.GIFT_ID_PEPPER; else process.env.GIFT_ID_PEPPER = OLD; });

  it('always keeps the unpeppered id checkable, so old markers stay findable', () => {
    delete process.env.GIFT_ID_PEPPER;
    const bare = giftMarkerCandidates('phone', '919876543210');
    expect(bare).toHaveLength(1);

    process.env.GIFT_ID_PEPPER = 'a-secret';
    const peppered = giftMarkerCandidates('phone', '919876543210');
    expect(peppered).toHaveLength(2);
    // The pre-pepper id is still in the list — this is what stops a re-grant on the day a pepper is added.
    expect(peppered).toContain(bare[0]);
    // New markers are written under the peppered id.
    expect(peppered[0]).not.toBe(bare[0]);
    expect(giftMarkerIdToWrite('phone', '919876543210')).toBe(peppered[0]);
  });

  it('does not leak the raw identity into the stored id', () => {
    process.env.GIFT_ID_PEPPER = 'a-secret';
    for (const id of giftMarkerCandidates('phone', '919876543210')) {
      expect(id).not.toContain('9876543210');
    }
    expect(giftMarkerCandidates('email', 'me@gmail.com')[0]).not.toContain('me@gmail.com');
  });

  it('separates the two kinds, and yields nothing for an empty identity', () => {
    expect(giftMarkerCandidates('email', 'x@y.com')[0]).not.toBe(giftMarkerCandidates('phone', 'x@y.com')[0]);
    expect(giftMarkerCandidates('phone', '')).toEqual([]);
    expect(giftMarkerIdToWrite('phone', '')).toBe('');
  });
});

describe('the gift plan — amounts and the two doors', () => {
  it('is inert until the admin turns it on', () => {
    expect(giftPlanV2Enabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env: {} as NodeJS.ProcessEnv }))
      .toEqual({ tokens: 0, markEmail: false, markPhone: false, reason: 'disabled' });
    expect(decidePhoneClaim({ giftedSoFar: 0, phoneUsed: false, env: {} as NodeJS.ProcessEnv }).tokens).toBe(0);
  });

  it('pays ₹250 unverified and ₹500 verified', () => {
    expect(unverifiedGiftTokens({} as NodeJS.ProcessEnv)).toBe(25_000);
    expect(verifiedGiftTotalTokens({} as NodeJS.ProcessEnv)).toBe(50_000);
  });

  it('keeps the first rung at ₹250 — enough to FINISH a first app', () => {
    // Trimming this is the one change that buys a half-built first app, which costs more than fraud.
    expect(decideSignupGrant({ phoneVerified: false, emailUsed: false, phoneUsed: false, env: ON }).tokens).toBe(25_000);
  });

  it('both doors arrive at the same ₹500', () => {
    const viaPhone = decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env: ON });
    expect(viaPhone.tokens).toBe(50_000);
    expect(viaPhone.reason).toBe('verified-signup');

    const viaEmail = decideSignupGrant({ phoneVerified: false, emailUsed: false, phoneUsed: false, env: ON });
    const topUp = decidePhoneClaim({ giftedSoFar: viaEmail.tokens, phoneUsed: false, env: ON });
    expect(viaEmail.tokens + topUp.tokens).toBe(50_000);
    expect(topUp.reason).toBe('phone-claim');
  });

  it('is tunable without a deploy', () => {
    const env = { ...ON, GIFT_UNVERIFIED_TOKENS: '30000', GIFT_VERIFIED_TOTAL_TOKENS: '70000' } as NodeJS.ProcessEnv;
    expect(decideSignupGrant({ phoneVerified: false, emailUsed: false, phoneUsed: false, env }).tokens).toBe(30_000);
    expect(decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env }).tokens).toBe(70_000);
  });
});

describe('the gift plan — every way one person could be paid twice', () => {
  it('THE ₹750 HOLE: one number cannot pay through both doors', () => {
    // Sign up by phone (₹500) → the number is spent.
    const first = decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env: ON });
    expect(first.tokens).toBe(50_000);
    expect(first.markPhone).toBe(true);

    // Open a SECOND account on a fresh email (₹250 — the email is genuinely new, so this is allowed)…
    const second = decideSignupGrant({ phoneVerified: false, emailUsed: false, phoneUsed: false, env: ON });
    expect(second.tokens).toBe(25_000);

    // …then verify it with the SAME number. This is the leak, and it must pay nothing.
    const claim = decidePhoneClaim({ giftedSoFar: second.tokens, phoneUsed: true, env: ON });
    expect(claim.tokens).toBe(0);
    expect(claim.reason).toBe('identity-used');
  });

  it('a verified sign-up spends the MAILBOX too, so the ₹250 tier cannot be taken again on it', () => {
    expect(decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env: ON }).markEmail).toBe(true);
  });

  it('a used mailbox gets ZERO, never a reduced amount', () => {
    const g = decideSignupGrant({ phoneVerified: false, emailUsed: true, phoneUsed: false, env: ON });
    expect(g.tokens).toBe(0);
    expect(g.reason).toBe('identity-used');
    expect(g.markEmail).toBe(false);
  });

  it('a used number blocks the full tier even when the mailbox is fresh', () => {
    const g = decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: true, env: ON });
    expect(g.tokens).toBe(0);
    expect(g.reason).toBe('identity-used');
  });

  it('claiming twice on one account pays only the first time', () => {
    const a = decidePhoneClaim({ giftedSoFar: 25_000, phoneUsed: false, env: ON });
    expect(a.tokens).toBe(25_000);
    // After the first claim the marker exists, so the second attempt is refused.
    expect(decidePhoneClaim({ giftedSoFar: 50_000, phoneUsed: true, env: ON }).tokens).toBe(0);
  });
});

describe('the gift plan — nothing is ever clawed back', () => {
  it('an old ladder account above the total gets zero MORE, and loses nothing', () => {
    // ₹650 under the retired weekly ladder.
    const claim = decidePhoneClaim({ giftedSoFar: 65_000, phoneUsed: false, env: ON });
    expect(claim.tokens).toBe(0);
    expect(claim.reason).toBe('already-at-total');
    // Crucially NOT negative — a top-up must never be able to subtract from a balance.
    expect(claim.tokens).toBeGreaterThanOrEqual(0);
  });

  it('an account exactly at the total is owed nothing', () => {
    expect(decidePhoneClaim({ giftedSoFar: 50_000, phoneUsed: false, env: ON }).tokens).toBe(0);
  });

  it('an account that somehow received nothing is topped to the full total', () => {
    expect(decidePhoneClaim({ giftedSoFar: 0, phoneUsed: false, env: ON }).tokens).toBe(50_000);
  });

  it('a corrupt gifted-so-far can never produce a bigger payout than the total', () => {
    for (const bad of [NaN, -1, -99_999, Infinity, -Infinity]) {
      const t = decidePhoneClaim({ giftedSoFar: bad as number, phoneUsed: false, env: ON }).tokens;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(50_000);
    }
  });
});

describe('a refused claim speaks to a real person', () => {
  it('never accuses, and never implies the account is in trouble', () => {
    const msg = claimRefusalMessage('identity-used');
    // Real, innocent cases hit this: one handset in a family, someone locked out of an older account.
    expect(msg).toMatch(/account works normally/i);
    expect(msg).not.toMatch(/fraud|abuse|blocked|suspend|violation|cheat/i);
  });

  it('has an honest line for every reason', () => {
    for (const r of ['identity-used', 'already-at-total', 'disabled'] as const) {
      expect(claimRefusalMessage(r).length).toBeGreaterThan(10);
    }
  });
});
