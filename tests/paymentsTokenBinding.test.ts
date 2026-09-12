import { describe, it, expect } from 'vitest';
import { creditableTokens, TOKENS_PER_RUPEE } from '../src/server/lib/payments';

/**
 * C4 — tokens are bound to the amount actually paid. The invariant OUTLIVED its occasion.
 *
 * It was written for the Vishwakarma entry-pass order, whose paid amount was `tokens₹ + pass₹`, and the
 * bug was that the credit came from a CLIENT-supplied `tokenAmount`: `{amount: 1, tokenAmount: 1000000}`
 * paid ₹1 and minted 100M tokens. The pass was deleted on 2026-09-12 and the helper no longer knows
 * anything about it — but the rule it enforces is the one that stops that exploit, so it is still here,
 * still tested, and now covers the single credit path every purchase takes.
 */
describe('creditableTokens — tokens derive from the amount actually paid', () => {
  it('THE EXPLOIT: paying ₹1 mints only ₹1 worth of tokens, whatever a client claimed', () => {
    expect(creditableTokens(1)).toBe(1 * TOKENS_PER_RUPEE);
  });

  it('credits the full net paid amount', () => {
    expect(creditableTokens(500)).toBe(50000);
    expect(creditableTokens(99)).toBe(9900);
  });

  it('never credits on non-positive or non-numeric input', () => {
    expect(creditableTokens(0)).toBe(0);
    expect(creditableTokens(-100)).toBe(0);
    // A numeric STRING legitimately coerces: amountPaid is the SERVER-reconciled figure, already
    // verified against the real charge, so it represents money actually paid — not a spoofable field.
    expect(creditableTokens('250')).toBe(25000);
    expect(creditableTokens('abc')).toBe(0);
    expect(creditableTokens(undefined)).toBe(0);
    expect(creditableTokens(null)).toBe(0);
    expect(creditableTokens(NaN)).toBe(0);
    expect(creditableTokens(Infinity)).toBe(0);
  });

  it('rounds fractional rupees deterministically', () => {
    expect(creditableTokens(1.005)).toBe(Math.round(1.005 * 100));
    expect(creditableTokens(0.001)).toBe(0);
  });

  it('🔒 the pass price is GONE from the money model, not merely unused', async () => {
    // The helper cannot subtract a pass any more because it takes no such argument. Asserted through
    // the module's public surface so a re-introduced pass constant fails here rather than in a bill.
    const mod = await import('../src/server/lib/payments');
    expect(Object.keys(mod)).not.toContain('VISHWAKARMA_PASS_PRICE_RUPEES');
    expect(Object.keys(mod)).not.toContain('creditableVishwakarmaTokens');
  });
});
