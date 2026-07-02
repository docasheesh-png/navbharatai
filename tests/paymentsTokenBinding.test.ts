import { describe, it, expect } from 'vitest';
import { creditableVishwakarmaTokens, VISHWAKARMA_PASS_PRICE_RUPEES, TOKENS_PER_RUPEE } from '../src/server/lib/payments';

describe('creditableVishwakarmaTokens — C4: tokens bound to the amount actually paid', () => {
  it('THE EXPLOIT: paying ₹1 mints only ₹1 worth of tokens, not a client-claimed million', () => {
    // Old bug: client sent {amount:1, tokenAmount:1_000_000} → 100M tokens for ₹1.
    // Now tokens derive from the ₹1 actually paid → 100 tokens. Client tokenAmount is irrelevant.
    expect(creditableVishwakarmaTokens(1, false)).toBe(1 * TOKENS_PER_RUPEE);
  });
  it('credits the full paid amount when no pass is bought', () => {
    expect(creditableVishwakarmaTokens(500, false)).toBe(50000);
  });
  it('subtracts the pass price before crediting tokens when buyPass is true', () => {
    // amount = tokenAmount₹ (50) + pass (100) = 150 → 50 × 100 = 5000 tokens
    expect(creditableVishwakarmaTokens(150, true)).toBe(50 * TOKENS_PER_RUPEE);
    // pass-only purchase (amount = 100, no tokens) → 0 tokens
    expect(creditableVishwakarmaTokens(VISHWAKARMA_PASS_PRICE_RUPEES, true)).toBe(0);
  });
  it('never returns negative (paid < pass price) or credits on non-positive/non-numeric input', () => {
    expect(creditableVishwakarmaTokens(50, true)).toBe(0);   // paid 50 < 100 pass → 0, not negative
    expect(creditableVishwakarmaTokens(0, false)).toBe(0);
    expect(creditableVishwakarmaTokens(-100, false)).toBe(0);
    // A truly non-numeric value → 0 (guard). Note: amountPaid is the SERVER-reconciled paid amount
    // (already verified against the real Cashfree charge), so a numeric string legitimately coerces —
    // it represents money actually paid, not a spoofable client field.
    expect(creditableVishwakarmaTokens('abc', false)).toBe(0);
    expect(creditableVishwakarmaTokens(undefined, false)).toBe(0);
    expect(creditableVishwakarmaTokens(NaN, true)).toBe(0);
  });
  it('rounds fractional rupees deterministically', () => {
    expect(creditableVishwakarmaTokens(1.005, false)).toBe(Math.round(1.005 * 100));
  });
});
