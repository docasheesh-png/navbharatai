import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  passEntitlementForPayment, isAcceptablePassPayment, MAX_PASS_PERIODS,
  professionalPassPriceInr, professionalPassDays,
} from '../src/server/professionals/professionalPaid';

// These tests exist because of a real, exploitable defect found while verifying the Professional Pass
// before switching it on for paying customers. The grant path read `passDays` straight out of the order
// document — and that document was filled from the CLIENT's own request body — while nothing anywhere
// compared the amount paid to the price we charge. So this order:
//
//     { amount: 1, productType: 'professional_pass', passDays: 36500 }
//
// bought a hundred-year unlimited pass for one rupee. The amount reconciliation did not catch it: it
// only checked that Cashfree charged what WE recorded, and what we recorded came from the client too.
//
// The entitlement is now derived from the paid amount and the server's price, and the client's
// `passDays` is ignored entirely. Nothing below may be relaxed without an explicit admin decision.

const PRICE = 99;
const DAYS = 30;

describe('the ₹1-for-a-hundred-years hole', () => {
  it('one rupee buys NOTHING, no matter what the client asked for', () => {
    const e = passEntitlementForPayment(1, PRICE, DAYS);
    expect(e.days).toBe(0);
    expect(e.periods).toBe(0);
  });

  it('the client cannot ask for days at all — the function only takes money', () => {
    // The signature is (amountPaid, price, daysPerPeriod). There is no client-supplied day count to
    // pass in; a ₹99 payment yields exactly one period whatever the caller wished for.
    expect(passEntitlementForPayment(99, PRICE, DAYS).days).toBe(30);
  });

  it('an underpaid pass order is refused before it ever reaches the gateway', () => {
    expect(isAcceptablePassPayment(1, PRICE, DAYS)).toBe(false);
    expect(isAcceptablePassPayment(98, PRICE, DAYS)).toBe(false);
    expect(isAcceptablePassPayment(0, PRICE, DAYS)).toBe(false);
    expect(isAcceptablePassPayment(-500, PRICE, DAYS)).toBe(false);
  });

  it('the exact price is accepted', () => {
    expect(isAcceptablePassPayment(99, PRICE, DAYS)).toBe(true);
    expect(passEntitlementForPayment(99, PRICE, DAYS)).toEqual({ days: 30, periods: 1, capped: false });
  });
});

describe('paying for more than one month', () => {
  it('buys whole months only — the remainder is not rounded up into a free month', () => {
    expect(passEntitlementForPayment(198, PRICE, DAYS)).toEqual({ days: 60, periods: 2, capped: false });
    expect(passEntitlementForPayment(297, PRICE, DAYS)).toEqual({ days: 90, periods: 3, capped: false });
    // ₹250 covers two months with ₹52 left over — two months, not three.
    expect(passEntitlementForPayment(250, PRICE, DAYS).periods).toBe(2);
  });

  it('caps an absurd single payment and flags it for a human', () => {
    // A single order buying decades is a fat-finger or a card-testing probe. Granting it automatically
    // and discovering it at chargeback time is the expensive outcome.
    const e = passEntitlementForPayment(99 * 500, PRICE, DAYS);
    expect(e.periods).toBe(MAX_PASS_PERIODS);
    expect(e.capped).toBe(true);
    expect(e.days).toBe(MAX_PASS_PERIODS * DAYS);
  });

  it('does not flag a large but sane payment', () => {
    expect(passEntitlementForPayment(99 * 12, PRICE, DAYS).capped).toBe(false);
  });
});

describe('money is compared in paise, so floats cannot cost a customer their pass', () => {
  it('a price that arrives as 98.99999999 still buys a month', () => {
    expect(passEntitlementForPayment(98.99999999, PRICE, DAYS).periods).toBe(1);
  });

  it('handles a fractional price', () => {
    expect(passEntitlementForPayment(49.5, 49.5, DAYS).periods).toBe(1);
    expect(passEntitlementForPayment(49.49, 49.5, DAYS).periods).toBe(0);
  });
});

describe('rubbish input never grants a pass', () => {
  it('refuses every non-amount', () => {
    for (const bad of [undefined, null, '', 'free', NaN, Infinity, -1, 0, {}, []]) {
      expect(passEntitlementForPayment(bad as unknown, PRICE, DAYS).days, String(bad)).toBe(0);
    }
  });

  it('refuses a broken price or period length instead of granting forever', () => {
    expect(passEntitlementForPayment(99, 0, DAYS).days).toBe(0);
    expect(passEntitlementForPayment(99, -99, DAYS).days).toBe(0);
    expect(passEntitlementForPayment(99, PRICE, 0).days).toBe(0);
    expect(passEntitlementForPayment(99, NaN, DAYS).days).toBe(0);
  });

  it('reads a numeric string, because that is what a JSON body often carries', () => {
    expect(passEntitlementForPayment('99', PRICE, DAYS).periods).toBe(1);
  });
});

describe('defaults come from the server config, never from a caller', () => {
  const saved = { price: process.env.PROFESSIONAL_PASS_PRICE_INR, days: process.env.PROFESSIONAL_PASS_DAYS };
  beforeEach(() => {
    delete process.env.PROFESSIONAL_PASS_PRICE_INR;
    delete process.env.PROFESSIONAL_PASS_DAYS;
  });
  afterEach(() => {
    if (saved.price === undefined) delete process.env.PROFESSIONAL_PASS_PRICE_INR;
    else process.env.PROFESSIONAL_PASS_PRICE_INR = saved.price;
    if (saved.days === undefined) delete process.env.PROFESSIONAL_PASS_DAYS;
    else process.env.PROFESSIONAL_PASS_DAYS = saved.days;
  });

  it('uses the configured price and period when none is passed', () => {
    expect(professionalPassPriceInr()).toBe(99);
    expect(professionalPassDays()).toBe(30);
    expect(passEntitlementForPayment(99)).toEqual({ days: 30, periods: 1, capped: false });
    expect(passEntitlementForPayment(1).days).toBe(0);
  });

  it('follows the admin re-pricing the pass from Cloud Run, with no deploy', () => {
    process.env.PROFESSIONAL_PASS_PRICE_INR = '149';
    process.env.PROFESSIONAL_PASS_DAYS = '30';
    expect(passEntitlementForPayment(99).days).toBe(0);   // the old price no longer buys a pass
    expect(passEntitlementForPayment(149).days).toBe(30);
  });
});
