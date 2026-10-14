// Go-live safety PR 5: append-only wallet_ledger, dual-written behind WALLET_LEDGER_V2_DUALWRITE (default off).
import { describe, it, expect } from 'vitest';
import { checkLedgerV2Chain, ledgerV2Enabled, ledgerV2Id, ledgerV2Row, withLedgerV2, WALLET_LEDGER_V2 } from '../src/server/lib/ledgerV2';
import { debitWalletForBuild } from '../src/server/lib/walletDebit';

const ON = { WALLET_LEDGER_V2_DUALWRITE: 'on' } as unknown as NodeJS.ProcessEnv;

describe('ledgerV2Row', () => {
  it('records the signed delta and the new rows only', () => {
    const before = { tokenBalance: 100, walletLedger: [{ a: 1 }] };
    const after = { tokenBalance: 60, walletLedger: [{ a: 1 }, { b: 2 }] };
    const r = ledgerV2Row('u', before, after, 'x', 't')!;
    expect(r).toMatchObject({ deltaTokens: -40, balanceBefore: 100, balanceAfter: 60, seq: 1, rows: [{ b: 2 }] });
  });
  it('nothing moved ⇒ no row', () => {
    expect(ledgerV2Row('u', { tokenBalance: 5, walletLedger: [] }, { tokenBalance: 5, walletLedger: [] }, 'x', 't')).toBeNull();
  });
  it('ids are deterministic per (wallet, seq)', () => {
    const r = ledgerV2Row('u', { tokenBalance: 0 }, { tokenBalance: 1 }, 'x', 't')!;
    expect(ledgerV2Id(r)).toBe(ledgerV2Id({ ...r, at: 'other' }));
  });
});

describe('withLedgerV2', () => {
  it('is a no-op while the flag is off (default)', () => {
    const writes: unknown[] = [];
    const out = withLedgerV2({ set: (r, d) => writes.push([r, d]) }, (c, i) => `${c}/${i}`, 'u', { tokenBalance: 1 }, { tokenBalance: 2 }, 's', {} as any);
    expect(ledgerV2Enabled({} as any)).toBe(false);
    expect(writes).toEqual([]);
    expect(out).toEqual({ tokenBalance: 2 });
  });
  it('queues one immutable row and stamps the seq when on', () => {
    const writes: any[] = [];
    const out = withLedgerV2({ set: (r, d) => writes.push([r, d]) }, (c, i) => `${c}/${i}`, 'u', { tokenBalance: 1, ledgerV2Seq: 4 }, { tokenBalance: 3 }, 's', ON);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toMatch(new RegExp(`^${WALLET_LEDGER_V2}/`));
    expect(writes[0][1]).toMatchObject({ seq: 5, deltaTokens: 2 });
    expect(out.ledgerV2Seq).toBe(5);
  });
});

describe('checkLedgerV2Chain (the invariant)', () => {
  const row = (seq: number, b: number, d: number) => ({ ownerId: 'u', seq, source: 's', deltaTokens: d, balanceBefore: b, balanceAfter: b + d, rows: [], at: 't' });
  it('a clean chain ending at the balance passes', () => {
    expect(checkLedgerV2Chain([row(2, 50, -10), row(1, 0, 50)], 40).ok).toBe(true);
  });
  it('a gap, a broken link or a wrong end balance fails', () => {
    expect(checkLedgerV2Chain([row(1, 0, 50), row(3, 50, -10)]).ok).toBe(false);
    expect(checkLedgerV2Chain([row(1, 0, 50), row(2, 49, -10)]).ok).toBe(false);
    expect(checkLedgerV2Chain([row(1, 0, 50)], 49).ok).toBe(false);
  });
});

describe('a real debit dual-writes in the same transaction', () => {
  it('build debit with the flag on writes wallet + one wallet_ledger row', async () => {
    const docs: Record<string, any> = { 'user_token_wallets/u1': { userId: 'u1', tokenBalance: 100_000, totalTokensUsed: 0, remaining_balance: 1000, walletLedger: [] } };
    const db = {
      doc: (p: string) => p,
      runTransaction: async (fn: any) => fn({
        get: async (ref: string) => ({ exists: !!docs[ref], data: () => docs[ref], id: ref, ref }),
        set: (ref: string, v: any) => { docs[ref] = v; },
        update: (ref: string, v: any) => { docs[ref] = { ...docs[ref], ...v }; },
        delete: (ref: string) => { delete docs[ref]; },
      }),
    } as any;
    process.env.WALLET_LEDGER_V2_DUALWRITE = 'on';
    try {
      const r = await debitWalletForBuild(db, 'u1', { billedInr: 5, buildRef: 'b1', description: 'build' } as any);
      expect(r.ok).toBe(true);
    } finally { delete process.env.WALLET_LEDGER_V2_DUALWRITE; }
    const rows = Object.keys(docs).filter((k) => k.startsWith(`${WALLET_LEDGER_V2}/`)).map((k) => docs[k]);
    expect(rows).toHaveLength(1);
    expect(checkLedgerV2Chain(rows, docs['user_token_wallets/u1'].tokenBalance).ok).toBe(true);
  });
});
