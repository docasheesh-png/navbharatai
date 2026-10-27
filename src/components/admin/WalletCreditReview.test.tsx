import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WalletCreditReview } from './WalletCreditReview';
import type { AdminWalletCreditReview } from '../../lib/adminWalletCreditReview';

const review: AdminWalletCreditReview = { ok: true, requestedUserId: 'source', canonicalUserId: 'canonical',
  identityChain: ['source', 'canonical'], mergeResolutionEnabled: false, paused: true, pauseStateKnown: true,
  storedTokens: 1200, storedInr: 12, ownerVisibleTokens: 0, ownerVisibleInr: 0, trackedGiftTokens: null,
  trackedAdminTokens: null, trackedOrdinaryGiftTokens: null, weakEligibleTokens: 0, paidSpendableTokens: 0,
  provenanceConsistent: false, pendingReservations: true, ledgerRows: [], retainedAdminRows: 0 };

describe('the admin can distinguish a hidden legacy wallet from a missing grant', () => {
  it('renders stored, visible, Weak and paid figures distinctly with honest provenance limits', () => {
    const html = renderToStaticMarkup(<WalletCreditReview review={review} />);
    for (const words of ['Stored canonical balance', 'Owner-visible balance', 'Canonical Weak-eligible tokens', 'Canonical paid-spendable tokens',
      'Unknown / not tracked', 'Merge resolution is disabled', 'Pending wallet reservations', 'not the unspent amount of an old grant',
      'does not prove that a grant never occurred', 'Do not add the old grant again']) expect(html).toContain(words);
    expect(html).not.toContain('<button'); expect(html).not.toContain('<input');
  });
  it('failed reads render unknown, not fabricated balance cards', () => {
    const html = renderToStaticMarkup(<WalletCreditReview review={{ ...review, ok: false, reason: 'Unavailable' }} />);
    expect(html).toContain('Unavailable'); expect(html).not.toContain('Stored canonical balance'); expect(html).not.toContain('₹0');
  });
  it('handles old-server payloads without breaking the account sheet', () => {
    expect(renderToStaticMarkup(<WalletCreditReview />)).toBe('');
  });
  it('the real account screen mounts the component and the knowledge base describes the same limits', () => {
    expect(readFileSync('src/components/AdminDashboard.tsx', 'utf8')).toContain('<WalletCreditReview review={account.creditReview} />');
    const kb = readFileSync('src/server/AppContext/AppKnowledgeBase.ts', 'utf8');
    expect(kb).toContain("id: 'admin-wallet-credit-review'"); expect(kb).toContain('never deposits the original gift again');
  });
});
