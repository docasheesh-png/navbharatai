import { describe, it, expect } from 'vitest';
import {
  appendLedgerEntry, buildWalletStatement, rowTokens,
  LEDGER_OPENING_FIELD, LEDGER_DROPPED_FIELD, MAX_WALLET_LEDGER_ENTRIES, TOKEN_CARRY_FIELD,
} from '../src/server/lib/walletStatement';
import { computeDebitedWallet, computeRolledUpDebit } from '../src/server/lib/walletDebit';

/**
 * EVERY PAISA ACCOUNTED FOR. The admin's ask, in one line of arithmetic:
 *
 *     opening balance  +  Σ (every ledger row)  =  tokenBalance
 *
 * Almost every test below is that equation under some condition that used to break it — chiefly the
 * 500-entry cap, which dropped the oldest rows with nothing recorded, so from the 501st entry a
 * user's visible history was simply less than their balance by an amount nobody could name.
 */

const wallet = (over: Record<string, unknown> = {}) => ({
  tokenBalance: 0, remaining_balance: 0, walletLedger: [], ...over,
});
const credit = (tokens: number, desc = 'Credit') => ({ type: 'purchase', amountCoinsOrTokens: tokens, description: desc, timestamp: '2026-09-15T00:00:00Z' });
const debit = (tokens: number, desc = 'Build') => ({ type: 'usage', amountCoinsOrTokens: -tokens, description: desc, timestamp: '2026-09-15T01:00:00Z' });

/**
 * A wallet that STARTS with money must represent that money — as an opening balance or as a credit
 * row. A test that gave a wallet ₹1,000 with an empty ledger and a zero opening was asserting a
 * broken wallet, and the reconciler correctly said so; that is how these three cases first failed.
 * `buildInitialWallet` writes the welcome row, which is why real wallets are sound from birth — see
 * the test at the end that pins exactly that.
 */
const opened = (tokens: number, over: Record<string, unknown> = {}) => wallet({
  tokenBalance: tokens,
  walletLedger: [credit(tokens, 'Welcome Bonus')],
  [LEDGER_OPENING_FIELD]: 0,
  ...over,
});

/** The invariant itself, as a function. Every scenario below ends here. */
const balances = (w: Record<string, unknown>) => {
  const s = buildWalletStatement(w);
  return s.verdict === 'balanced' && s.differenceTokens === 0;
};

describe('the invariant, on an ordinary wallet', () => {
  it('opening + credits − debits = balance', () => {
    const w = wallet({
      tokenBalance: 25_000,
      walletLedger: [credit(50_000, 'Welcome Bonus'), debit(20_000), debit(5_000)],
      [LEDGER_OPENING_FIELD]: 0,
    });
    const s = buildWalletStatement(w);
    expect(s.creditTokens).toBe(50_000);
    expect(s.debitTokens).toBe(25_000);
    expect(s.expectedTokens).toBe(25_000);
    expect(s.actualTokens).toBe(25_000);
    expect(s.verdict).toBe('balanced');
  });

  it('carries a running balance on every row, so the statement reads like a statement', () => {
    const s = buildWalletStatement(wallet({
      tokenBalance: 15_000,
      walletLedger: [credit(25_000), debit(10_000)],
      [LEDGER_OPENING_FIELD]: 0,
    }));
    expect(s.rows.map((r) => r.runningTokens)).toEqual([25_000, 15_000]);
    expect(s.rows.map((r) => r.runningRupees)).toEqual([250, 150]);
    expect(s.rows[1].kind).toBe('debit');
  });

  it('reports a genuine mismatch as OFF, with the difference in rupees', () => {
    const s = buildWalletStatement(wallet({
      tokenBalance: 9_000, // ₹10 has gone missing
      walletLedger: [credit(10_000)],
      [LEDGER_OPENING_FIELD]: 0,
    }));
    expect(s.verdict).toBe('off');
    expect(s.differenceRupees).toBe(10);
    expect(s.notes.join(' ')).toMatch(/difference of ₹10\.00/);
  });
});

describe('🔒 THE 500-ENTRY CAP — the defect this module exists for', () => {
  it('folds whatever rolls off into the opening balance', () => {
    const full = Array.from({ length: MAX_WALLET_LEDGER_ENTRIES }, () => debit(100));
    const w = wallet({ walletLedger: full, [LEDGER_OPENING_FIELD]: 0 });
    const r = appendLedgerEntry(w, debit(100));
    expect(r.ledger).toHaveLength(MAX_WALLET_LEDGER_ENTRIES);
    expect(r.openingTokens).toBe(-100); // the one that rolled off
    expect(r.droppedCount).toBe(1);
  });

  it('🔴 THE REAL SCENARIO: 600 real debits, and the books still balance exactly', () => {
    // Before the shared appender this was impossible — the first 100 rows vanished with nothing
    // recorded, so Σ(visible rows) was ₹100 short of the balance and no statement could explain it.
    let w: Record<string, unknown> = opened(100_000);
    for (let i = 0; i < 600; i++) {
      w = computeDebitedWallet(w, { billedInr: 1, buildRef: `b${i}`, description: 'Build' }, '2026-09-15T00:00:00Z').wallet;
    }
    expect((w.walletLedger as unknown[]).length).toBe(MAX_WALLET_LEDGER_ENTRIES);
    expect(w[LEDGER_DROPPED_FIELD]).toBe(101); // 600 debits + the welcome row, minus the 500 kept
    expect(w.tokenBalance).toBe(100_000 - 600 * 100);
    expect(balances(w), 'opening + Σ rows must equal the balance after 600 charges').toBe(true);
  });

  it('survives a mixed history of credits and debits past the cap', () => {
    let w: Record<string, unknown> = opened(0);
    for (let i = 0; i < 700; i++) {
      if (i % 3 === 0) {
        // A credit written the way the credit paths write one.
        const r = appendLedgerEntry(w, credit(500));
        w = { ...w, walletLedger: r.ledger, [LEDGER_OPENING_FIELD]: r.openingTokens, [LEDGER_DROPPED_FIELD]: r.droppedCount, tokenBalance: (w.tokenBalance as number) + 500 };
      } else {
        w = computeDebitedWallet(w, { billedInr: 1, buildRef: `m${i}`, description: 'Build' }, '2026-09-15T00:00:00Z').wallet;
      }
    }
    expect(balances(w)).toBe(true);
  });

  it('a ROLLUP bucket is replaced, never summed twice, and survives the cap', () => {
    let w: Record<string, unknown> = opened(100_000);
    // Fifty turns into one daily bucket — the row carries the RUNNING total, so a naive append would
    // count the bucket fifty times over.
    for (let i = 0; i < 50; i++) {
      w = computeRolledUpDebit(w, { billedInr: 1, rollupRef: 'ai_2026-09-15', description: 'AI assistants' }, '2026-09-15T00:00:00Z').wallet;
    }
    const rows = w.walletLedger as Array<{ rollupRef?: string }>;
    expect(rows.filter((r) => r.rollupRef === 'ai_2026-09-15')).toHaveLength(1);
    expect(w.tokenBalance).toBe(100_000 - 50 * 100);
    expect(balances(w)).toBe(true);
  });

  it('buckets across many days still balance past the cap', () => {
    let w: Record<string, unknown> = opened(1_000_000);
    for (let day = 0; day < 600; day++) {
      for (let turn = 0; turn < 2; turn++) {
        w = computeRolledUpDebit(w, { billedInr: 1, rollupRef: `ai_day${day}`, description: 'AI assistants' }, '2026-09-15T00:00:00Z').wallet;
      }
    }
    expect(w.tokenBalance).toBe(1_000_000 - 600 * 2 * 100);
    expect(balances(w)).toBe(true);
  });
});

describe('🔒 honesty about what cannot be known', () => {
  it('an account that predates opening balances is UNKNOWN, never a false mismatch', () => {
    // Its oldest rows are genuinely gone. Calling that a discrepancy would cry wolf on every old
    // account and teach the admin to ignore the one that matters.
    const s = buildWalletStatement({
      tokenBalance: 12_345,
      walletLedger: Array.from({ length: MAX_WALLET_LEDGER_ENTRIES }, () => debit(100)),
      // no LEDGER_OPENING_FIELD at all
    });
    expect(s.verdict).toBe('unknown');
    expect(s.openingIsAssumed).toBe(true);
    expect(s.notes.join(' ')).toMatch(/begins at the oldest entry still held/i);
  });

  it('a SHORT ledger with no opening field is still checkable — nothing has rolled off', () => {
    const s = buildWalletStatement({ tokenBalance: 10_000, walletLedger: [credit(10_000)] });
    expect(s.verdict).toBe('balanced');
    expect(s.openingIsAssumed).toBe(false);
  });

  it('says how many earlier entries are not shown', () => {
    const s = buildWalletStatement(wallet({
      tokenBalance: 500, walletLedger: [credit(500)],
      [LEDGER_OPENING_FIELD]: 0, [LEDGER_DROPPED_FIELD]: 120,
    }));
    expect(s.hiddenRows).toBe(120);
    expect(s.notes.join(' ')).toMatch(/120 earlier entries/);
  });

  it('explains the sub-token carry rather than leaving an unaccountable gap', () => {
    const s = buildWalletStatement(wallet({ tokenBalance: 0, [LEDGER_OPENING_FIELD]: 0, [TOKEN_CARRY_FIELD]: 0.4 }));
    expect(s.carryTokens).toBe(0.4);
    expect(s.notes.join(' ')).toMatch(/carried to your next charge/i);
  });

  it('REPORTS a disagreement between the two stored views, and never reconciles one away', () => {
    // A Pass buyer's two views differ by the Pass price, permanently and by design. An assignment
    // here is exactly the bug walletMirror.ts was written to end.
    const s = buildWalletStatement(wallet({
      tokenBalance: 10_000, remaining_balance: 150, walletLedger: [credit(10_000)], [LEDGER_OPENING_FIELD]: 0,
    }));
    expect(s.rupeeViewAgrees).toBe(false);
    expect(s.verdict).toBe('balanced');       // the TOKEN books still balance
    expect(s.notes.join(' ')).toMatch(/two stored views/i);
  });

  it('tolerates one token of paisa rounding between the views', () => {
    const s = buildWalletStatement(wallet({
      tokenBalance: 10_000, remaining_balance: 100.01, walletLedger: [credit(10_000)], [LEDGER_OPENING_FIELD]: 0,
    }));
    expect(s.rupeeViewAgrees).toBe(true);
  });

  it('never throws on a junk document, and never invents a number', () => {
    for (const junk of [null, undefined, {}, { walletLedger: 'nope' }, { walletLedger: [null, 42, {}] }]) {
      const s = buildWalletStatement(junk as never);
      expect(s.expectedTokens).toBe(0);
      expect(Number.isFinite(s.differenceTokens)).toBe(true);
    }
    expect(rowTokens(null)).toBe(0);
    expect(rowTokens({ amountCoinsOrTokens: 'lots' })).toBe(0);
  });
});

describe('🔒 the reconciler only ever REPORTS', () => {
  it('does not modify the wallet it is handed', () => {
    // A reconciler that quietly adjusted a balance to make its own arithmetic work would be the most
    // dangerous code in this repo. The whole value of it is that its answer can be wrong and say so.
    const w = wallet({ tokenBalance: 999, walletLedger: [credit(10_000)], [LEDGER_OPENING_FIELD]: 0 });
    const before = JSON.stringify(w);
    buildWalletStatement(w);
    expect(JSON.stringify(w)).toBe(before);
  });
});

describe('🔒 a real wallet is sound from birth', () => {
  it('buildInitialWallet satisfies the invariant — the welcome row equals the opening balance', async () => {
    // This is what makes every scenario above realistic rather than contrived: a genuine new wallet
    // does not start with an unexplained balance, it starts with a credit row for it.
    const { buildInitialWallet } = await import('../src/server/lib/welcomeBonus');
    const w = buildInitialWallet({
      userId: 'u', email: 'u@example.com', name: 'U',
      welcomeTokens: 25_000, nowIso: '2026-09-15T00:00:00Z',
    });
    const s = buildWalletStatement(w);
    expect(s.creditTokens).toBe(25_000);
    expect(s.expectedTokens).toBe(25_000);
    expect(s.actualTokens).toBe(25_000);
    expect(s.verdict).toBe('balanced');
  });

  it('a wallet whose bonus was already spent starts empty and still balances', () => {
    const { } = {};
    const s = buildWalletStatement({ tokenBalance: 0, walletLedger: [] });
    expect(s.verdict).toBe('balanced');
  });
});

describe('🔴 a MERGED wallet still reconciles', () => {
  it('re-strikes the opening balance, so a merge does not invent a mismatch', async () => {
    /**
     * Found because accountMerge.ts was allowlisted out of the ledger-writer guard with a comment
     * claiming it already added both wallets' opening balances. It did not: it inherited `into`'s
     * and dropped `other`'s, so a merged wallet's books were off by the sum of the other wallet's
     * rows — a mismatch shown to a user whose money was perfectly correct.
     *
     * The allowlist entry was hiding a real bug, which is what an entry with an unverified reason
     * always risks doing.
     */
    const { mergeWallets } = await import('../src/server/lib/accountMerge');
    const now = '2026-09-15T00:00:00Z';

    const into = {
      userId: 'keep', tokenBalance: 30_000, remaining_balance: 300,
      totalTokensPurchased: 50_000, totalTokensUsed: 20_000,
      walletLedger: [credit(50_000, 'Welcome Bonus'), debit(20_000, 'Build')],
      [LEDGER_OPENING_FIELD]: 0,
    };
    const other = {
      userId: 'merge', tokenBalance: 15_000, remaining_balance: 150,
      totalTokensPurchased: 25_000, totalTokensUsed: 10_000,
      walletLedger: [credit(25_000, 'Welcome Bonus'), debit(10_000, 'Build')],
      [LEDGER_OPENING_FIELD]: 0,
    };

    const { wallet } = mergeWallets(into as never, other as never, now);
    const s = buildWalletStatement(wallet as Record<string, unknown>);
    expect(s.verdict, 'a merged wallet must reconcile, or it reports a fault that is not there').toBe('balanced');
    expect(s.differenceTokens).toBe(0);
    expect(s.actualTokens).toBe(Number(wallet.tokenBalance));
  });
});
