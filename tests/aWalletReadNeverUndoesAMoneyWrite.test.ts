/**
 * Audit 2026-10-11, F4: opening the wallet could undo a payment or a charge.
 *
 * `GET /api/wallet/:userId` filled an older wallet's missing fields by writing back the WHOLE document it had just
 * read — balance and ledger included — with `setDoc(walletRef, data, { merge: true })`, outside any transaction.
 * A debit or a payment credit that committed between that read and that write was silently overwritten with the
 * stale balance. The fix writes ONLY the missing fields, inside a transaction against a fresh read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { missingWalletFields } from '../src/server/lib/newWallet';

describe('missingWalletFields — only what is absent, never what exists', () => {
  it('an older wallet gets exactly its missing fields', () => {
    expect(missingWalletFields({ remaining_balance: 120, tokenBalance: 12_000 })).toEqual({
      totalTokensPurchased: 0, totalTokensUsed: 0, walletLedger: [],
    });
  });

  it('a complete wallet gets nothing at all', () => {
    expect(missingWalletFields({ tokenBalance: 5, totalTokensPurchased: 1, totalTokensUsed: 2, walletLedger: [] })).toEqual({});
  });

  it('a balance is never part of the patch, whatever its value', () => {
    for (const balance of [0, 1, -1, 999_999]) {
      const patch = missingWalletFields({ tokenBalance: balance, remaining_balance: balance });
      expect(patch).not.toHaveProperty('tokenBalance');
      expect(patch).not.toHaveProperty('remaining_balance');
    }
  });
});

describe('the wallet read path', () => {
  const route = readFileSync('src/server/routes/wallet.ts', 'utf8');
  const get = route.slice(route.indexOf("app.get('/api/wallet/:userId',"), route.indexOf("app.get('/api/wallet/:userId/", route.indexOf("app.get('/api/wallet/:userId',") + 10));

  it('fills missing fields inside a transaction, from a fresh read', () => {
    expect(get).toMatch(/runTransaction\(db, async \(tx\) => \{\s*const fresh = await tx\.get\(walletRef\);/);
    expect(get).toMatch(/const patch = missingWalletFields\(current\);/);
    expect(get).toMatch(/tx\.set\(walletRef, patch, \{ merge: true \}\)/);
  });

  it('never writes a whole wallet snapshot back (the bug, anywhere in server code)', () => {
    const files: string[] = ['server.ts'];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
    walk('src/server');
    const offenders = files.filter((f) => /setDoc\(\s*walletRef\s*,\s*data\s*,/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
