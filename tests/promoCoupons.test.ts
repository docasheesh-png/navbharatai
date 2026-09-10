import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePromoCoupons, couponValueInr, promoCoupons, MAX_COUPON_VALUE_INR } from '../src/server/lib/promoCoupons';

describe('coupons are OFF unless the admin turns one on', () => {
  it('an unset table redeems nothing', () => {
    // The whole point of the change: the default is no free credit at all.
    expect(promoCoupons({} as NodeJS.ProcessEnv)).toEqual({});
    expect(parsePromoCoupons(undefined)).toEqual({});
    expect(parsePromoCoupons('')).toEqual({});
    expect(parsePromoCoupons('   ')).toEqual({});
  });

  it('the OLD hardcoded codes are gone from the payment route', () => {
    // FREE100 and WELCOME100 are the first two things anybody types into a promo box. If any of these
    // reappear in the source, the leak is back and only a deploy could close it again.
    // Asserted on the TABLE, not on the words: the code comment deliberately names the old codes so
    // the next reader knows what was removed and why, and a test that banned the mention would be
    // banning the explanation rather than the leak.
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/payment.ts'), 'utf8');
    expect(route).not.toContain('couponValues');
    for (const code of ['FREE100', 'WELCOME100', 'NAVBHARAT50', 'FESTIVE2026', 'SAKUNI25']) {
      expect(route).not.toContain(`'${code}':`);
    }
    expect(route).toContain('couponValueInr(code)');
  });
});

describe('parsePromoCoupons', () => {
  it('reads the format the admin actually types', () => {
    expect(parsePromoCoupons('DIWALI2026:100,PARTNER50:50')).toEqual({ DIWALI2026: 100, PARTNER50: 50 });
  });

  it('forgives spacing and case', () => {
    expect(parsePromoCoupons(' diwali2026 : 100 ')).toEqual({ DIWALI2026: 100 });
    expect(couponValueInr('diwali2026', { PROMO_COUPONS: 'DIWALI2026:100' } as NodeJS.ProcessEnv)).toBe(100);
  });

  it('🔒 REFUSES a value above the cap — the missing-decimal trap', () => {
    // `DIWALI:10000` where ₹100 was meant is one typo that would hand ₹10,000 to every redeemer.
    expect(parsePromoCoupons(`BIG:${MAX_COUPON_VALUE_INR + 1}`)).toEqual({});
    expect(parsePromoCoupons(`CAPOK:${MAX_COUPON_VALUE_INR}`)).toEqual({ CAPOK: MAX_COUPON_VALUE_INR });
  });

  it('DROPS anything unreadable instead of guessing a value', () => {
    // A junk entry gives away nothing. Treating it as 0, or as some default, would either look broken
    // or hand out money nobody authorised.
    expect(parsePromoCoupons('NOVALUE')).toEqual({});
    expect(parsePromoCoupons('BAD:abc')).toEqual({});
    expect(parsePromoCoupons('ZERO:0')).toEqual({});
    expect(parsePromoCoupons('NEG:-50')).toEqual({});
    expect(parsePromoCoupons('AB:10')).toEqual({});            // too short to be a code
    expect(parsePromoCoupons('HAS SPACE:10')).toEqual({});
  });

  it('keeps the good entries when one entry in the list is junk', () => {
    // One typo must not silently disable a promo that is genuinely running.
    expect(parsePromoCoupons('GOOD:100,BAD:abc,ALSOGOOD:50')).toEqual({ GOOD: 100, ALSOGOOD: 50 });
  });

  it('returns null for a code that is not on the table', () => {
    expect(couponValueInr('FREE100', { PROMO_COUPONS: 'DIWALI2026:100' } as NodeJS.ProcessEnv)).toBeNull();
    expect(couponValueInr('', {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('the live exchange rate is actually wired now', () => {
  it('server.ts refreshes it at boot AND on a schedule', () => {
    // It existed and was tested for months while never being called once in production, so every
    // build billed at the 85 fallback. This asserts the wire, which is the only part that was missing.
    const boot = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
    expect(boot).toContain("id: 'usd-inr-refresh'");
    expect(boot).toContain('void refreshFx();');
  });

  it('is NOT exclusive — every instance caches its own rate', () => {
    // An exclusive job would refresh one instance and leave the rest billing at 85: the same bug,
    // harder to see.
    const boot = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
    const job = boot.slice(boot.indexOf("id: 'usd-inr-refresh'"), boot.indexOf("id: 'usd-inr-refresh'") + 200);
    expect(job).not.toContain('exclusive');
  });
});
