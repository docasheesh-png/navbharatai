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
    const p = mirroredCreditPatch(wallet(1000, 10), 500, 'gift');
    expect(p.tokenBalance).toBe(1500);
    expect(p.remaining_balance).toBe(10 + 500 / TOKENS_PER_RUPEE);
    expect(p.total_balance).toBe(10 + 500 / TOKENS_PER_RUPEE);
  });

  it('🔒 PRESERVES a legitimate divergence — it never assigns one view from the other', () => {
    // The real case: a Pass buyer's ₹ view is credited the full net paid, while the token view has the
    // Pass price subtracted first. The two are SUPPOSED to differ, permanently.
    const passBuyer = wallet(0, 499);            // paid ₹499, all of it the Pass — zero tokens
    const p = mirroredCreditPatch(passBuyer, 1, 'gift'); // the "+1 token" adjustment that used to wipe ₹499
    expect(p.tokenBalance).toBe(1);
    expect(p.remaining_balance).toBeCloseTo(499 + 1 / TOKENS_PER_RUPEE, 10);
    expect(p.remaining_balance).toBeGreaterThan(499); // the old assignment gave 0.01
  });

  it('🔒 a DEDUCTION moves both views down together, and floors them together', () => {
    const p = mirroredCreditPatch(wallet(100, 1), -500, 'gift');
    expect(p.tokenBalance).toBe(0);
    // ₹ falls by the tokens that ACTUALLY moved (100), not the 500 that were asked for — so the two
    // views can never end up one at zero and the other negative.
    expect(p.remaining_balance).toBe(0);
  });

  it('a deduction never reduces the lifetime total — a refund is not an un-purchase', () => {
    const p = mirroredCreditPatch(wallet(1000, 10, 50), -200, 'gift');
    expect(p.total_balance).toBeUndefined();
  });

  it('survives a missing or junk wallet rather than writing NaN into a balance', () => {
    expect(mirroredCreditPatch(null, 100, 'gift').tokenBalance).toBe(100);
    expect(mirroredCreditPatch({}, 100, 'gift').remaining_balance).toBe(1);
    expect(mirroredCreditPatch({ tokenBalance: 'x', remaining_balance: null }, 50, 'gift').tokenBalance).toBe(50);
    expect(mirroredCreditPatch(wallet(10, 1), NaN, 'gift').tokenBalance).toBe(10);
  });

  it('rupeesToTokens uses the one platform rate', () => {
    expect(rupeesToTokens(25)).toBe(25 * TOKENS_PER_RUPEE);
    expect(rupeesToTokens(NaN)).toBe(0);
  });
});

describe('Q-670 — a wallet in overdraft is neither forgiven by a credit nor raised by a deduction', () => {
  const owing = { tokenBalance: -50_000, remaining_balance: -50_000 / TOKENS_PER_RUPEE, total_balance: 10 };

  it('a credit pays the debt down by exactly its amount — it does not jump the wallet to zero', () => {
    const p = mirroredCreditPatch(owing, 100, 'gift');
    expect(p.tokenBalance).toBe(-49_900);
    expect(p.remaining_balance).toBeCloseTo((-50_000 + 100) / TOKENS_PER_RUPEE, 6);
    expect(p.giftTokensRemaining).toBe(0); // a gift that paid debt leaves no gift behind
  });

  it('lifetime credit grows by what was credited, not by the debt it wiped', () => {
    const p = mirroredCreditPatch(owing, 100, 'paid');
    expect(p.total_balance).toBeCloseTo(10 + 100 / TOKENS_PER_RUPEE, 6);
  });

  it('a deduction on an overdrawn wallet changes nothing, and never RAISES it', () => {
    const p = mirroredCreditPatch(owing, -500, 'paid');
    expect(p.tokenBalance).toBe(-50_000);
    expect(p.remaining_balance).toBeCloseTo(owing.remaining_balance, 6);
    expect(p.total_balance).toBeUndefined();
  });

  it('a positive wallet still floors at zero on a large deduction', () => {
    const p = mirroredCreditPatch({ tokenBalance: 100, remaining_balance: 100 / TOKENS_PER_RUPEE }, -500, 'paid');
    expect(p.tokenBalance).toBe(0);
    expect(p.remaining_balance).toBe(0);
  });
});

describe('wiring — every wallet credit is transactional, and none of them assigns a view', () => {
  const admin = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
  const payment = readFileSync(join(process.cwd(), 'src/server/routes/payment.ts'), 'utf8');

  it('🔒 the admin adjustment no longer ASSIGNS the rupee view from the token view', () => {
    expect(admin).not.toContain('remaining_balance: TOKENS_PER_RUPEE > 0 ? newBalance / TOKENS_PER_RUPEE : 0');
    expect(admin).toContain("mirroredCreditPatch(w, delta, 'gift')"); // CHANGED 2026-09-13: the source is now required, and an admin grant is a gift
  });

  it('🔒 the admin adjustment runs inside a transaction', () => {
    const at = admin.indexOf("app.post('/api/admin/users/:userId/tokens'");
    expect(at).toBeGreaterThan(-1);
    // To the next route, not a fixed window: the reason check added before the transaction (admin panel
    // audit PR 1, 2026-10-04) moved it further down the handler.
    const block = admin.slice(at, admin.indexOf('\n  app.', at + 10));
    expect(block).toContain('runTransaction(');
    expect(block).toContain('await tx.get(walletRef)');
    expect(block).not.toContain('await updateDoc(walletRef');
  });

  it('🔒 the coupon credit runs inside a transaction AND moves the token view', () => {
    const at = payment.indexOf("app.post('/api/payment/redeem-coupon'");
    expect(at).toBeGreaterThan(-1);
    const block = payment.slice(at, payment.indexOf('app.post', at + 10));
    expect(block).toContain('runTransaction(');
    expect(block).toContain("mirroredCreditPatch(w, rupeesToTokens(value), 'gift')"); // CHANGED 2026-09-13: a coupon is a gift
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

describe('store purchases — one purchase token can only ever credit once', () => {
  const payment = readFileSync(join(process.cwd(), 'src/server/routes/payment.ts'), 'utf8');
  const block = (() => {
    const at = payment.indexOf("app.post('/api/payment/store/verify'");
    return at > -1 ? payment.slice(at) : payment.slice(payment.indexOf('verifyStorePurchase'));
  })();

  /**
   * 🔴 The receipt check used to live OUTSIDE the transaction, which reads as idempotent and is not.
   * The transaction touched only the WALLET, so two concurrent deliveries of the SAME token — the
   * store re-delivering on relaunch, the app retrying on a flaky network, both named in that route's
   * own comments as normal — could both pass the outside check. Firestore would see the clash on the
   * wallet alone, retry the loser, and the retry would re-read the already-credited balance and credit
   * the same purchase again. Reading the receipt IN-transaction puts it in the conflict set.
   */
  it('🔒 the receipt is read INSIDE the transaction, before the wallet', () => {
    const tx = block.indexOf('runTransaction(');
    expect(tx).toBeGreaterThan(-1);
    const body = block.slice(tx, tx + 1400);
    expect(body).toContain('await tx.get(txRef)');
    expect(body).toContain("already.data()?.paymentStatus === 'SUCCESS'");
    expect(body.indexOf('await tx.get(txRef)')).toBeLessThan(body.indexOf('await tx.get(walletRef)'));
  });

  it('a second delivery credits nothing and still answers honestly', () => {
    expect(block).toContain('if (wallet === null)');
    expect(block).toContain('alreadyProcessed: true');
  });

  it('the sibling Cashfree path still claims PENDING→SUCCESS atomically — it was already right', () => {
    const payments = readFileSync(join(process.cwd(), 'src/server/lib/payments.ts'), 'utf8');
    expect(payments).toContain("if (snap.data().paymentStatus === 'SUCCESS') return false;");
    expect(payments).toContain('if (!claimedNow) {');
  });

  it('🔒 and there is no simulator that could mint balance at all (Q-615 removed it)', () => {
    // SUPERSEDED: this used to check the simulator refused in production. The simulator itself is gone —
    // only Cashfree's own answer can mark an order paid (tests/aFakePaymentNeverCredits.test.ts).
    const payments = readFileSync(join(process.cwd(), 'src/server/lib/payments.ts'), 'utf8');
    expect(payments).not.toMatch(/isSimulator|SIMULATION|simulator credit/i);
    expect(payments).toContain('cashfreePaymentsAvailability()');
  });
});
