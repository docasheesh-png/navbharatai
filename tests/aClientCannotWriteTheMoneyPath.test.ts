// Forensic audit 2026-10-04 (P0) — nothing a client can write decides how much a payment credits.
//
// The payment path read `promo_redemptions/promo_pending_<uid>` and credited 1,000 tokens instead of the
// paid amount, and the Firestore rules let any signed-in user create that document for ANY uid. The
// branch is removed and the rule refuses every client write; a credit is the verified paid amount.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeCreditedWallet, creditableTokens } from '../src/server/lib/payments';

const NOW = '2026-10-04T00:00:00.000Z';

describe('a credit is the paid amount, in both views of the balance', () => {
  it('₹500 paid: tokens and rupees move by the same amount', () => {
    const { wallet } = computeCreditedWallet({ tokenBalance: 0, remaining_balance: 0, walletLedger: [] }, { amountPaid: 500, balanceAdded: 500 } as never, NOW);
    expect(wallet.tokenBalance).toBe(creditableTokens(500));
    expect(wallet.remaining_balance).toBe(500);
  });

  it('the credit function takes no promo input at all', () => {
    expect(computeCreditedWallet.length).toBe(3);
  });
});

describe('the money path reads no client-writable document', () => {
  it('payments.ts no longer reads promo_redemptions', () => {
    const code = readFileSync('src/server/lib/payments.ts', 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/promo_redemptions|promo_pending/);
  });

  it('the rules refuse every client read and write of promo_redemptions', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const start = rules.indexOf('match /promo_redemptions/');
    const block = rules.slice(start, rules.indexOf('match /', start + 10));
    expect(block).toMatch(/allow read, write: if false;/);
    expect(block).not.toMatch(/allow create/);
  });
});
