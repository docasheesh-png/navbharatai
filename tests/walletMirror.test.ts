import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mirroredCreditPatch, rupeesToTokens } from '../src/server/lib/walletMirror';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';

/**
 * THE MONEY AUDIT'S CENTRAL INVARIANT: a credit is an amount of MONEY, expressed twice.
 *
 * The wallet holds one balance in two fields, and every bug this module exists to close came from a
 * writer that moved one of them. These tests pin the rule that makes that impossible to write again.
 */

describe('mirroredCreditPatch — both views, same money, always a delta', () => {
  const wallet = (tokens: number, inr: number, total = inr) =>
    ({ tokenBalance: tokens, remaining_balance: inr, total_balance: total });

  it('moves BOTH views by the same money on a credit', () => {
    const p = mirroredCreditPatch(wallet(1000, 10), 500);
    expect(p.tokenBalance).toBe(1500);
    expect(p.remaining_balance).toBe(10 + 500 / TOKENS_PER_RUPEE);
    expect(p.total_balance).toBe(10 + 500 / TOKENS_PER_RUPEE);
  });

  it('🔒 PRESERVES a legitimate divergence — it never assigns one view from the other', () => {
    // The real case: a Pass buyer's ₹ view is credited the full net paid, while the token view has the
    // Pass price subtracted first. The two are SUPPOSED to differ, permanently.
    const passBuyer = wallet(0, 499);            // paid ₹499, all of it the Pass — zero tokens
    const p = mirroredCreditPatch(passBuyer, 1); // the "+1 token" adjustment that used to wipe ₹499
    expect(p.tokenBalance).toBe(1);
    expect(p.remaining_balance).toBeCloseTo(499 + 1 / TOKENS_PER_RUPEE, 10);
    expect(p.remaining_balance).toBeGreaterThan(499); // the old assignment gave 0.01
  });

  it('🔒 a DEDUCTION moves both views down together, and floors them together', () => {
    const p = mirroredCreditPatch(wallet(100, 1), -500);
    expect(p.tokenBalance).toBe(0);
    // ₹ falls by the tokens that ACTUALLY moved (100), not the 500 that were asked for — so the two
    // views can never end up one at zero and the other negative.
    expect(p.remaining_balance).toBe(0);
  });

  it('a deduction never reduces the lifetime total — a refund is not an un-purchase', () => {
    const p = mirroredCreditPatch(wallet(1000, 10, 50), -200);
    expect(p.total_balance).toBeUndefined();
  });

  it('survives a missing or junk wallet rather than writing NaN into a balance', () => {
    expect(mirroredCreditPatch(null, 100).tokenBalance).toBe(100);
    expect(mirroredCreditPatch({}, 100).remaining_balance).toBe(1);
    expect(mirroredCreditPatch({ tokenBalance: 'x', remaining_balance: null }, 50).tokenBalance).toBe(50);
    expect(mirroredCreditPatch(wallet(10, 1), NaN).tokenBalance).toBe(10);
  });

  it('rupeesToTokens uses the one platform rate', () => {
    expect(rupeesToTokens(25)).toBe(25 * TOKENS_PER_RUPEE);
    expect(rupeesToTokens(NaN)).toBe(0);
  });
});

describe('wiring — every wallet credit is transactional, and none of them assigns a view', () => {
  const admin = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
  const payment = readFileSync(join(process.cwd(), 'src/server/routes/payment.ts'), 'utf8');

  it('🔒 the admin adjustment no longer ASSIGNS the rupee view from the token view', () => {
    expect(admin).not.toContain('remaining_balance: TOKENS_PER_RUPEE > 0 ? newBalance / TOKENS_PER_RUPEE : 0');
    expect(admin).toContain('mirroredCreditPatch(w, delta)');
  });

  it('🔒 the admin adjustment runs inside a transaction', () => {
    const at = admin.indexOf("app.post('/api/admin/users/:userId/tokens'");
    expect(at).toBeGreaterThan(-1);
    const block = admin.slice(at, at + 2200);
    expect(block).toContain('runTransaction(');
    expect(block).toContain('await tx.get(walletRef)');
    expect(block).not.toContain('await updateDoc(walletRef');
  });

  it('🔒 the coupon credit runs inside a transaction AND moves the token view', () => {
    const at = payment.indexOf("app.post('/api/payment/redeem-coupon'");
    expect(at).toBeGreaterThan(-1);
    const block = payment.slice(at, payment.indexOf('app.post', at + 10));
    expect(block).toContain('runTransaction(');
    expect(block).toContain('mirroredCreditPatch(w, rupeesToTokens(value))');
    // The old shape: a read, then a write of a balance computed before it.
    expect(block).not.toContain('await getDoc(walletRef)');
    expect(block).not.toContain('await updateDoc(walletRef');
  });

  it('the redemption is still claimed atomically — the double-redeem guard is untouched', () => {
    const at = payment.indexOf("app.post('/api/payment/redeem-coupon'");
    const block = payment.slice(at, payment.indexOf('app.post', at + 10));
    expect(block).toContain('if (snap.exists()) return false;');
  });
});
