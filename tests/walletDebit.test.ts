import { describe, it, expect } from 'vitest';
import {
  computeDebitedWallet,
  debitWalletForBuild,
  MAX_WALLET_LEDGER_ENTRIES,
  TOKEN_CARRY_FIELD,
  type WalletDebitTx,
} from '../src/server/lib/walletDebit';
import { computeCreditedWallet, type WalletCreditTx, TOKENS_PER_RUPEE } from '../src/server/lib/payments';

const T = '2026-07-10T00:00:00.000Z';
const FUNDED = { tokenBalance: 10000, totalTokensUsed: 0, remaining_balance: 100, walletLedger: [] };
const tx = (over: Partial<WalletDebitTx> = {}): WalletDebitTx => ({
  billedInr: 25,
  buildRef: 'ws1_1000',
  description: 'NavBharatAI Pro v5.0 build',
  ...over,
});

describe('computeDebitedWallet — debit math (the missing half of the money path)', () => {
  it('debits billedInr×TOKENS_PER_RUPEE tokens and billedInr ₹, and bumps totalTokensUsed', () => {
    const { wallet, tokensDebited } = computeDebitedWallet(FUNDED, tx(), T);
    expect(tokensDebited).toBe(25 * TOKENS_PER_RUPEE); // 2500
    expect(wallet.tokenBalance).toBe(7500);
    expect(wallet.remaining_balance).toBe(75);
    expect(wallet.totalTokensUsed).toBe(2500);
    expect(wallet.walletLedger).toHaveLength(1);
    expect(wallet.walletLedger[0].type).toBe('usage');
    expect(wallet.walletLedger[0].amountCoinsOrTokens).toBe(-2500);
    expect(wallet.walletLedger[0].buildRef).toBe('ws1_1000');
  });

  it('OVERDRAFT: the balance may go negative (fail-open gate lets a running build finish)', () => {
    const { wallet, tokensDebited } = computeDebitedWallet(
      { ...FUNDED, tokenBalance: 100, remaining_balance: 1 },
      tx({ billedInr: 5 }),
      T,
    );
    expect(tokensDebited).toBe(500);
    expect(wallet.tokenBalance).toBe(-400); // honest debt — the next pre-flight gate blocks
    expect(wallet.remaining_balance).toBe(-4);
  });

  it('IDEMPOTENT: the same buildRef never charges twice', () => {
    const first = computeDebitedWallet(FUNDED, tx(), T);
    const second = computeDebitedWallet(first.wallet, tx(), T);
    expect(second.tokensDebited).toBe(0);
    expect(second.wallet.tokenBalance).toBe(7500); // unchanged
    expect(second.wallet.walletLedger).toHaveLength(1); // no duplicate entry
  });

  it('CONCURRENCY: debiting the RESULT of a prior debit ACCUMULATES (tx-retry contract)', () => {
    // Exactly what the Firestore transaction does on retry after a concurrent commit: re-read the
    // fresh wallet, re-apply the delta on top. Distinct builds must both land; balances must add up.
    const first = computeDebitedWallet(FUNDED, tx({ buildRef: 'b1' }), T).wallet;
    const second = computeDebitedWallet(first, tx({ buildRef: 'b2' }), T).wallet;
    expect(second.tokenBalance).toBe(5000); // 10000 − 2500 − 2500
    expect(second.remaining_balance).toBe(50);
    expect(second.totalTokensUsed).toBe(5000);
    expect(second.walletLedger).toHaveLength(2);
  });

  it('debit is the exact mirror of credit: buy then spend the same ₹ returns to the start', () => {
    const credit: WalletCreditTx = { userId: 'u1', amountPaid: 50, balanceAdded: 50, isVishwakarmaOrder: false };
    const bought = computeCreditedWallet({ tokenBalance: 0, remaining_balance: 0, walletLedger: [] }, credit, null, T).wallet;
    const { wallet } = computeDebitedWallet(bought, tx({ billedInr: 50 }), T);
    expect(wallet.tokenBalance).toBe(0);
    expect(wallet.remaining_balance).toBe(0);
  });

  it('rejects non-finite / non-positive amounts (wallet untouched, 0 debited)', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const { wallet, tokensDebited } = computeDebitedWallet(FUNDED, tx({ billedInr: bad }), T);
      expect(tokensDebited).toBe(0);
      expect(wallet.tokenBalance).toBe(10000);
    }
  });

  it('treats missing/NaN numeric fields as 0 (never produces NaN in a balance)', () => {
    const { wallet } = computeDebitedWallet({ tokenBalance: NaN }, tx({ billedInr: 1 }), T);
    expect(Number.isFinite(wallet.tokenBalance)).toBe(true);
    expect(wallet.tokenBalance).toBe(-100);
    expect(Number.isFinite(wallet.remaining_balance)).toBe(true);
  });

  it('rounds ₹ to the paisa so float drift never accumulates in remaining_balance', () => {
    const { wallet } = computeDebitedWallet(FUNDED, tx({ billedInr: 0.1 + 0.2 }), T); // 0.30000000000000004
    expect(wallet.remaining_balance).toBe(99.7);
  });

  it('bounds the ledger at MAX_WALLET_LEDGER_ENTRIES (doc-size protection; totals untouched)', () => {
    const bigLedger = Array.from({ length: MAX_WALLET_LEDGER_ENTRIES }, (_, i) => ({ type: 'usage', buildRef: `old_${i}` }));
    const { wallet } = computeDebitedWallet({ ...FUNDED, walletLedger: bigLedger }, tx(), T);
    expect(wallet.walletLedger).toHaveLength(MAX_WALLET_LEDGER_ENTRIES);
    expect(wallet.walletLedger[0].buildRef).toBe('old_1'); // oldest rolled off
    expect(wallet.walletLedger[MAX_WALLET_LEDGER_ENTRIES - 1].buildRef).toBe('ws1_1000'); // newest kept
    expect(wallet.tokenBalance).toBe(7500); // balance math unaffected by trimming
  });

  it('preserves unrelated existing wallet fields (full merge, not a reset)', () => {
    const existing = { ...FUNDED, hasVishwakarmaPass: true, someOtherField: 'keep-me' };
    const { wallet } = computeDebitedWallet(existing, tx(), T);
    expect(wallet.hasVishwakarmaPass).toBe(true);
    expect(wallet.someOtherField).toBe('keep-me');
  });
});

describe('the sub-token remainder is carried, not rounded away', () => {
  // The debit used to round UP. That charged the user up to ₹0.01 more than the build cost every time,
  // and — worse — the ceil went into `tokenBalance` while `remaining_balance` moved by the paisa-rounded
  // ₹, so the wallet's two views of the same money drifted apart on every build. Now the fraction is
  // carried to the next charge: nothing is given away, nothing is over-collected.

  it('charges only the whole tokens and remembers the rest', () => {
    const { wallet, tokensDebited } = computeDebitedWallet(FUNDED, tx({ billedInr: 25.004 }), T);
    expect(tokensDebited).toBe(2500);                  // 2500.4 owed → 2500 now
    expect(wallet[TOKEN_CARRY_FIELD]).toBeCloseTo(0.4, 6);
    expect(wallet.tokenBalance).toBe(7500);
  });

  it('the carry is spent by the next charge, so nothing is forgiven', () => {
    const first = computeDebitedWallet(FUNDED, tx({ billedInr: 25.004, buildRef: 'b1' }), T).wallet;
    const second = computeDebitedWallet(first, tx({ billedInr: 25.007, buildRef: 'b2' }), T);
    expect(second.tokensDebited).toBe(2501);           // 0.4 carried + 2500.7 = 2501.1
    expect(second.wallet[TOKEN_CARRY_FIELD]).toBeCloseTo(0.1, 6);
  });

  it('ten sub-token charges add up to exactly one token — no more, no less', () => {
    // Ceiling each of these would have billed 10 tokens for 1 token of real cost.
    let w: Record<string, any> = { ...FUNDED };
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const r = computeDebitedWallet(w, tx({ billedInr: 0.001, buildRef: `m${i}` }), T);
      w = r.wallet;
      total += r.tokensDebited;
    }
    expect(total).toBe(1);
    expect(w.tokenBalance).toBe(10000 - 1);
  });

  it('the ₹ and the tokens always move together — the drift that existed is impossible now', () => {
    // remaining_balance is DERIVED from the tokens actually debited, so the two balances cannot
    // disagree however awkward the amount.
    let w: Record<string, any> = { ...FUNDED };
    for (const [i, amount] of [25.004, 0.333, 11.117, 0.009, 3.5].entries()) {
      w = computeDebitedWallet(w, tx({ billedInr: amount, buildRef: `d${i}` }), T).wallet;
    }
    const tokensSpent = 10000 - w.tokenBalance;
    const rupeesSpent = Math.round((100 - w.remaining_balance) * 100) / 100;
    expect(rupeesSpent).toBeCloseTo(tokensSpent / TOKENS_PER_RUPEE, 6);
  });

  it('a charge smaller than one token reports applied — so the caller still persists the carry', () => {
    const r = computeDebitedWallet(FUNDED, tx({ billedInr: 0.004 }), T);
    expect(r.tokensDebited).toBe(0);
    expect(r.applied).toBe(true); // tokensDebited > 0 would have dropped the write and forgiven it
    expect(r.wallet[TOKEN_CARRY_FIELD]).toBeCloseTo(0.4, 6);
  });

  it('says so honestly in the ledger rather than showing a ₹0.00 line', () => {
    const { wallet } = computeDebitedWallet(FUNDED, tx({ billedInr: 0.004 }), T);
    expect(wallet.walletLedger[0].description).toContain('carried to your next charge');
  });

  it('a rejected or already-charged call is not applied and moves no carry', () => {
    expect(computeDebitedWallet(FUNDED, tx({ billedInr: 0 }), T).applied).toBe(false);
    const once = computeDebitedWallet(FUNDED, tx({ billedInr: 25.004 }), T).wallet;
    const twice = computeDebitedWallet(once, tx({ billedInr: 25.004 }), T);
    expect(twice.applied).toBe(false);
    expect(twice.wallet[TOKEN_CARRY_FIELD]).toBeCloseTo(0.4, 6); // unchanged, not doubled
  });

  it('a corrupt carry on the doc cannot become free credit or a surprise charge', () => {
    // Whatever ends up in the field, it is clamped to a real remainder before it touches the balance.
    for (const bad of [99, -5, NaN, 'lots' as unknown as number, undefined]) {
      const r = computeDebitedWallet({ ...FUNDED, [TOKEN_CARRY_FIELD]: bad }, tx({ billedInr: 1 }), T);
      expect(r.tokensDebited).toBeGreaterThanOrEqual(100);
      expect(r.tokensDebited).toBeLessThanOrEqual(101);
      expect(r.wallet[TOKEN_CARRY_FIELD]).toBeGreaterThanOrEqual(0);
      expect(r.wallet[TOKEN_CARRY_FIELD]).toBeLessThan(1);
    }
  });
});

describe('debitWalletForBuild — guard rails (no I/O paths)', () => {
  it('returns ok:false without touching anything when db is missing', async () => {
    const r = await debitWalletForBuild(null, 'u1', tx());
    expect(r.ok).toBe(false);
  });

  it('returns ok:false for a missing userId', async () => {
    const r = await debitWalletForBuild({}, '', tx());
    expect(r.ok).toBe(false);
  });

  it('returns ok:false for a non-debitable amount (0 / NaN / negative)', async () => {
    for (const bad of [0, NaN, -1]) {
      const r = await debitWalletForBuild({}, 'u1', tx({ billedInr: bad }));
      expect(r.ok).toBe(false);
    }
  });

  it('never throws when the transaction fails — returns ok:false with the error', async () => {
    // A db object that is not a real Firestore makes doc()/runTransaction throw internally.
    const r = await debitWalletForBuild({ not: 'a-firestore' }, 'u1', tx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe('string');
  });
});
