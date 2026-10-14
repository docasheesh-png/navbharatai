import { describe, it, expect } from 'vitest';
import { quickAmounts, QUICK_AMOUNTS_INR, selectedQuickAmount, tokensForPayment } from '../src/lib/walletQuickAmounts';
import { splitPaymentAtPct, DEFAULT_PLATFORM_FEE_PCT } from '../src/lib/platformFee';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';

/**
 * WHAT A QUICK AMOUNT PROMISES IS WHAT THE SERVER CREDITS.
 * The brief's mock-up said "₹100 = 10,000 tokens". On the web rail the platform fee comes off first, so
 * ₹100 credits 9,800 tokens at the default 2%. A chip that promised 10,000 would be a price shown before
 * payment that the ledger then contradicts. The chips therefore print tokens from the SAME pure split.
 */
describe('quick amounts', () => {
  it('are the suggested amounts only — nothing else is offered as a package, bonus or discount', () => {
    expect([...QUICK_AMOUNTS_INR]).toEqual([5, 10, 50, 100, 500]);
  });

  it('print the tokens the server will credit, after the platform fee', () => {
    const by = Object.fromEntries(quickAmounts(DEFAULT_PLATFORM_FEE_PCT).map((q) => [q.amountInr, q.tokens]));
    expect(by[100]).toBe(9800);
    expect(by[100]).not.toBe(10_000);
    for (const q of quickAmounts(DEFAULT_PLATFORM_FEE_PCT)) {
      expect(q.tokens).toBe(Math.round(splitPaymentAtPct(q.amountInr, DEFAULT_PLATFORM_FEE_PCT).creditInr * TOKENS_PER_RUPEE));
    }
  });

  it('follow the configured fee, and a 0% fee is rupee-for-rupee', () => {
    expect(tokensForPayment(100, 0)).toBe(10_000);
    expect(tokensForPayment(100, 5)).toBe(9_500);
  });

  it('a chip shows as selected only when the typed amount IS that chip', () => {
    expect(selectedQuickAmount('50')).toBe(50);
    expect(selectedQuickAmount('50.5')).toBeNull();
    expect(selectedQuickAmount('')).toBeNull();
    expect(selectedQuickAmount('abc')).toBeNull();
  });
});
