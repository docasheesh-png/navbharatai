/**
 * THE PLATFORM FEE ON A WALLET RECHARGE.
 *
 * These tests exist because this is a MONEY path, and the two ways it can go wrong are opposite:
 * charging a fee where none was promised (the Play packs, a coupon), and charging none where the
 * gateway's cost then comes silently out of NavBharatAI (the old rupee-for-rupee credit).
 *
 * They also pin the invariant that makes the split safe to show a user before they pay:
 * `fee + credit === paid`, exactly, at every amount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_PLATFORM_FEE_PCT,
  MAX_PLATFORM_FEE_PCT,
  normalizeFeePct,
  splitPaymentAtPct,
  platformFeeNoticeAtPct,
} from '../src/lib/platformFee';
import { platformFeePct, splitPayment, platformFeeNotice } from '../src/server/lib/platformFee';
import { computeCreditedWallet, recordedPlatformFee, type WalletCreditTx } from '../src/server/lib/payments';
import { TOKENS_PER_RUPEE, VISHWAKARMA_PASS_PRICE_INR } from '../src/lib/walletPricing';

const T = '2026-09-10T00:00:00.000Z';
const EMPTY = { tokenBalance: 0, totalTokensPurchased: 0, totalMoneySpent: 0, remaining_balance: 0, total_balance: 0, walletLedger: [] };

describe('the rate', () => {
  it('is the admin-confirmed 2% when nothing is configured', () => {
    expect(DEFAULT_PLATFORM_FEE_PCT).toBe(2);
    expect(platformFeePct({} as NodeJS.ProcessEnv)).toBe(2);
  });

  it('an EMPTY value falls back to the default rather than meaning "no fee"', () => {
    // Number('') is 0. A blank field looks deliberately configured and would silently switch the fee
    // off — the same trap hostingCost.ts records.
    expect(platformFeePct({ PLATFORM_FEE_PCT: '' } as NodeJS.ProcessEnv)).toBe(DEFAULT_PLATFORM_FEE_PCT);
    expect(platformFeePct({ PLATFORM_FEE_PCT: '   ' } as NodeJS.ProcessEnv)).toBe(DEFAULT_PLATFORM_FEE_PCT);
  });

  it('an explicit 0 IS honoured — that is a real, supported setting', () => {
    expect(platformFeePct({ PLATFORM_FEE_PCT: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(splitPayment(500, { PLATFORM_FEE_PCT: '0' } as NodeJS.ProcessEnv)).toEqual({ paidInr: 500, feeInr: 0, creditInr: 500 });
  });

  it('an unreadable or out-of-range value is refused, never obeyed', () => {
    for (const bad of ['abc', 'NaN', '-1', String(MAX_PLATFORM_FEE_PCT + 1), '900']) {
      expect(normalizeFeePct(bad)).toBe(DEFAULT_PLATFORM_FEE_PCT);
    }
    expect(normalizeFeePct(undefined)).toBe(DEFAULT_PLATFORM_FEE_PCT);
    expect(normalizeFeePct(null)).toBe(DEFAULT_PLATFORM_FEE_PCT);
  });

  it('reads a valid configured rate, including a fractional one', () => {
    expect(platformFeePct({ PLATFORM_FEE_PCT: '2.5' } as NodeJS.ProcessEnv)).toBe(2.5);
    expect(platformFeePct({ PLATFORM_FEE_PCT: ' 3 ' } as NodeJS.ProcessEnv)).toBe(3);
  });
});

describe('the split', () => {
  it('takes 2% and credits the rest', () => {
    expect(splitPaymentAtPct(500, 2)).toEqual({ paidInr: 500, feeInr: 10, creditInr: 490 });
    expect(splitPaymentAtPct(100, 2)).toEqual({ paidInr: 100, feeInr: 2, creditInr: 98 });
  });

  it('fee + credit === paid EXACTLY, at every amount — the invariant the wallet depends on', () => {
    for (const paid of [1, 7, 9.99, 10, 33.33, 49, 99, 149, 250.55, 499, 1000, 12345.67, 999999]) {
      const s = splitPaymentAtPct(paid, DEFAULT_PLATFORM_FEE_PCT);
      expect(Math.round((s.feeInr + s.creditInr) * 100)).toBe(Math.round(paid * 100));
    }
  });

  it('never produces a negative credit, whatever it is handed', () => {
    for (const bad of [0, -5, NaN, Infinity, -Infinity]) {
      const s = splitPaymentAtPct(bad as number, 2);
      expect(s.creditInr).toBeGreaterThanOrEqual(0);
      expect(s.feeInr).toBeGreaterThanOrEqual(0);
    }
  });

  it('the fee can never exceed the payment', () => {
    const s = splitPaymentAtPct(1, MAX_PLATFORM_FEE_PCT);
    expect(s.feeInr).toBeLessThanOrEqual(s.paidInr);
    expect(s.creditInr).toBeGreaterThanOrEqual(0);
  });
});

describe('what the user is told', () => {
  it('states the credit and the fee, and never names a payment provider', () => {
    const notice = platformFeeNotice(500, { PLATFORM_FEE_PCT: '2' } as NodeJS.ProcessEnv);
    expect(notice).toContain('490.00');
    expect(notice).toContain('10.00');
    expect(notice).toContain('platform fee');
    for (const vendor of ['Cashfree', 'gateway', 'Google', 'Apple', 'UPI', 'Visa']) {
      expect(notice).not.toContain(vendor);
    }
  });

  it('says nothing about a fee when there is none', () => {
    expect(platformFeeNoticeAtPct(500, 0)).not.toContain('fee');
  });
});

describe('crediting the wallet', () => {
  it('a recharge credits the NET, and the ledger NAMES the fee', () => {
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 500, balanceAdded: 490, platformFeeInr: 10 };
    const { wallet } = computeCreditedWallet(EMPTY, tx, null, T);
    expect(wallet.remaining_balance).toBe(490);
    expect(wallet.tokenBalance).toBe(490 * TOKENS_PER_RUPEE);
    // totalMoneySpent answers "how much has this user paid us" — that is the GROSS.
    expect(wallet.totalMoneySpent).toBe(500);
    expect(String(wallet.walletLedger[0].description)).toContain('platform fee');
  });

  it('a vishwakarma order mints tokens from the NET, not the gross — the fee cannot be bypassed', () => {
    // The security note in payments.ts derives tokens from the VERIFIED paid amount rather than
    // balanceAdded, so a fee applied only to balanceAdded would have leaked straight past it.
    const paid = 150;
    const fee = 3;
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: paid, balanceAdded: paid - fee, isVishwakarmaOrder: true, buyPass: true, platformFeeInr: fee };
    const { wallet } = computeCreditedWallet(EMPTY, tx, null, T);
    expect(wallet.tokenBalance).toBe((paid - fee - VISHWAKARMA_PASS_PRICE_INR) * TOKENS_PER_RUPEE);
    expect(wallet.remaining_balance).toBe(paid - fee);
    expect(wallet.hasVishwakarmaPass).toBe(true);
  });

  it('a transaction with NO fee field credits in full — legacy rows and store packs are untouched', () => {
    // A pending order created before the fee existed was SOLD at rupee-for-rupee, and a Play pack is
    // priced with its fee already inside. Both must credit exactly what they promised.
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 99, balanceAdded: 99, isVishwakarmaOrder: true };
    const { wallet } = computeCreditedWallet(EMPTY, tx, null, T);
    expect(wallet.tokenBalance).toBe(99 * TOKENS_PER_RUPEE);
    expect(wallet.remaining_balance).toBe(99);
  });

  it('a corrupt fee can never produce a negative credit', () => {
    expect(recordedPlatformFee({ userId: 'u', amountPaid: 100, balanceAdded: 100, platformFeeInr: 9999 })).toBe(100);
    expect(recordedPlatformFee({ userId: 'u', amountPaid: 100, balanceAdded: 100, platformFeeInr: -50 })).toBe(0);
    expect(recordedPlatformFee({ userId: 'u', amountPaid: 100, balanceAdded: 100, platformFeeInr: NaN })).toBe(0);
  });
});

const paymentRoute = readFileSync(join(__dirname, '..', 'src/server/routes/payment.ts'), 'utf8');

describe('where the fee is and is NOT applied', () => {
  it('the Cashfree create-order records the split on the transaction', () => {
    expect(paymentRoute).toContain('const feeSplit = splitPayment(orderAmount)');
    expect(paymentRoute).toContain('balanceAdded: feeSplit.creditInr');
    expect(paymentRoute).toContain('platformFeeInr: feeSplit.feeInr');
  });

  it('a COUPON credits its full face value — a gift is not a payment', () => {
    // Anchored on the route REGISTRATION, not the first mention of the name: create-order's own
    // comments reference redeem-coupon, and slicing from those would drag its fee code in here.
    const at = paymentRoute.indexOf("app.post('/api/payment/redeem-coupon'");
    expect(at).toBeGreaterThan(0);
    const block = paymentRoute.slice(at, paymentRoute.indexOf("app.get('/api/payment/store/packs'"));
    expect(block).toContain('balanceAdded: value');
    expect(block).not.toContain('feeSplit');
    expect(block).not.toContain('platformFeeInr');
  });

  it('a STORE pack credits pack.creditInr and carries no fee at all', () => {
    const store = paymentRoute.slice(paymentRoute.indexOf('/api/payment/store/verify'));
    expect(store).toContain('balanceAdded: pack.creditInr');
    expect(store).not.toContain('platformFeeInr');
    expect(store).not.toContain('feeSplit');
  });
});

const billingPanel = readFileSync(join(__dirname, '..', 'src/components/panels/BillingPanel.tsx'), 'utf8');

describe('the purchase screen tells the user BEFORE they pay', () => {
  it('the calculator prints the credit AFTER the fee, from the shared split', () => {
    expect(billingPanel).toContain('splitPaymentAtPct(parseFloat(buyAmountInput) || 0, platformFeePct)');
    expect(billingPanel).toContain('rechargeSplit.creditInr');
    expect(billingPanel).toContain('platform fee');
    // The old promise: `amount × 100` under "at ₹1 = 100 tokens". It must not survive anywhere.
    expect(billingPanel).not.toContain('{(parseFloat(buyAmountInput) || 0) * 100}');
  });

  it('the Play pack block still promises the FULL credit, because it is still true there', () => {
    expect(billingPanel).toContain('credited the full credit amount shown, never less');
  });
});

const modals = readFileSync(join(__dirname, '..', 'src/components/panels/AppModals.tsx'), 'utf8');
// Comments are stripped before asserting a pattern is GONE: the doc comment that records why the old
// ₹50 price was wrong necessarily quotes it, and a naive search cannot tell the record from the bug.
const modalsCode = modals.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('the vishwakarma chooser shows the price the server will actually charge', () => {
  it('uses the ONE pass price, never the old ₹50/₹100 split that drifted from the server', () => {
    expect(modals).toContain('VISHWAKARMA_PASS_PRICE_INR');
    expect(modalsCode).not.toContain("vkMode === 'pro' ? 100 : 50");
  });

  it('estimates tokens from the amount left after BOTH the pass and the fee', () => {
    expect(modals).toContain('vkSplit.creditInr - vkPassInr');
    expect(modals).toContain('vkTotalPayableInr');
  });
});
