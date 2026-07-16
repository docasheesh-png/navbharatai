import { describe, it, expect, beforeAll } from 'vitest';
import { mergeWallets, walletReceivedWelcome, realPurchasedTokens } from './accountMerge';

// Pin the welcome bonus so the arithmetic is deterministic regardless of env.
beforeAll(() => { process.env.WELCOME_BONUS_TOKENS = '50000'; });
const WELCOME = 50000;

/** Build a wallet doc the way the app does. `welcome` adds the welcome-bonus ledger entry so
 *  walletReceivedWelcome() detects it (as buildInitialWallet writes it). */
function wallet(opts: { purchased: number; used: number; welcome: boolean; pass?: boolean }): Record<string, any> {
  const ledger: any[] = [];
  if (opts.welcome) ledger.push({ type: 'purchase', amountCoinsOrTokens: WELCOME, moneySpent: 0, timestamp: '2026-01-01T00:00:00Z', description: `Welcome Bonus: ${WELCOME.toLocaleString()} AI Tokens Credited!` });
  return {
    userId: 'u', userEmail: 'a@b.com', userName: 'A',
    totalTokensPurchased: opts.purchased,   // includes the welcome grant if welcome=true
    totalTokensUsed: opts.used,
    tokenBalance: opts.purchased - opts.used,
    remaining_balance: (opts.purchased - opts.used) / 100,
    total_output_tokens_used: opts.used,
    total_money_spent: 0,
    hasVishwakarmaPass: !!opts.pass,
    walletLedger: ledger,
  };
}

describe('walletReceivedWelcome / realPurchasedTokens', () => {
  it('detects the welcome grant from the ledger', () => {
    expect(walletReceivedWelcome(wallet({ purchased: WELCOME, used: 0, welcome: true }))).toBe(true);
    expect(walletReceivedWelcome(wallet({ purchased: 10000, used: 0, welcome: false }))).toBe(false);
    expect(walletReceivedWelcome(null)).toBe(false);
  });
  it('excludes the welcome grant from real purchased tokens', () => {
    expect(realPurchasedTokens(wallet({ purchased: WELCOME + 10000, used: 0, welcome: true }), WELCOME)).toBe(10000);
    expect(realPurchasedTokens(wallet({ purchased: 10000, used: 0, welcome: false }), WELCOME)).toBe(10000);
  });
});

describe('mergeWallets — welcome bonus counts ONCE (no farming)', () => {
  it('two fresh welcome wallets merge to ONE welcome, not two', () => {
    const a = wallet({ purchased: WELCOME, used: 0, welcome: true }); // 50k
    const b = wallet({ purchased: WELCOME, used: 0, welcome: true }); // 50k
    const { wallet: m, audit } = mergeWallets(a, b, '2026-07-16T00:00:00Z');
    expect(m.tokenBalance).toBe(50000); // NOT 100000
    expect(audit.welcomeTokensGranted).toBe(WELCOME);
    expect(audit.bothHadWelcome).toBe(true);
  });

  it('a partially-spent welcome + a fresh welcome does not resurrect the spent half', () => {
    const a = wallet({ purchased: WELCOME, used: WELCOME, welcome: true }); // spent all 50k → 0
    const b = wallet({ purchased: WELCOME, used: 0, welcome: true });       // fresh 50k
    // one welcome (50k) − total used (50k) + 0 real = 0
    expect(mergeWallets(a, b, 'now').wallet.tokenBalance).toBe(0);
  });
});

describe("mergeWallets — the admin's edge case (paid ₹100 + old negative)", () => {
  it('a paid account + an OWN old overdrafted account = honest net (debt carries, cannot be escaped)', () => {
    // Paid: welcome 50k + bought ₹100 (10k tokens) = 60k purchased, used 0 → balance 60k.
    const paid = wallet({ purchased: WELCOME + 10000, used: 0, welcome: true });
    // Old: welcome 50k, overdrafted (used 60k) → balance −10k.
    const oldNeg = wallet({ purchased: WELCOME, used: 60000, welcome: true });
    // real purchased = 10k + 0 ; one welcome = 50k ; used = 0 + 60k → 10k + 50k − 60k = 0
    expect(mergeWallets(paid, oldNeg, 'now').wallet.tokenBalance).toBe(0);
  });

  it('a paid account + an OWN old ZERO account keeps the paid balance', () => {
    const paid = wallet({ purchased: WELCOME + 10000, used: 0, welcome: true }); // 60k
    const oldZero = wallet({ purchased: WELCOME, used: WELCOME, welcome: true }); // used its welcome exactly → 0
    expect(mergeWallets(paid, oldZero, 'now').wallet.tokenBalance).toBe(10000 + WELCOME - WELCOME); // 10k
  });

  it('debt can push the merged balance NEGATIVE (recorded honestly; the affordability gate then blocks)', () => {
    const small = wallet({ purchased: WELCOME, used: 0, welcome: true });        // 50k
    const bigDebt = wallet({ purchased: WELCOME, used: 120000, welcome: true }); // used 120k → −70k
    // real 0 + one welcome 50k − used 120k = −70k
    expect(mergeWallets(small, bigDebt, 'now').wallet.tokenBalance).toBe(-70000);
  });
});

describe('mergeWallets — real purchases all carry, and flags OR', () => {
  it('sums real purchases from both (no welcome on either)', () => {
    const a = wallet({ purchased: 20000, used: 0, welcome: false });
    const b = wallet({ purchased: 30000, used: 0, welcome: false });
    expect(mergeWallets(a, b, 'now').wallet.tokenBalance).toBe(50000);
  });
  it('carries the Vishwakarma Pass if EITHER had it, sums usage totals, and keeps `into` identity', () => {
    const a = wallet({ purchased: 10000, used: 5000, welcome: false, pass: false });
    const b = wallet({ purchased: 10000, used: 3000, welcome: false, pass: true });
    a.userEmail = 'keep@me.com';
    const { wallet: m } = mergeWallets(a, b, 'now');
    expect(m.hasVishwakarmaPass).toBe(true);
    expect(m.totalTokensUsed).toBe(8000);
    expect(m.userEmail).toBe('keep@me.com'); // `into` identity preserved
  });
  it('prepends an honest merge marker to the ledger and stays bounded', () => {
    const a = wallet({ purchased: 10000, used: 0, welcome: true });
    const b = wallet({ purchased: 10000, used: 0, welcome: true });
    const { wallet: m } = mergeWallets(a, b, '2026-07-16T00:00:00Z');
    expect(m.walletLedger[0].description).toMatch(/Accounts merged/);
    expect(m.walletLedger.length).toBeLessThanOrEqual(500);
  });
});
