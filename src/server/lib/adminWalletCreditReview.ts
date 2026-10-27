/** Read-only canonical wallet diagnostics. Never infer an old grant's remaining amount. */
import { doc, runTransaction } from './serverDb';
import { maskWalletForView } from './freeProgram';
import { paidSpendableTokens, unavailableGiftTokens } from './giftSpend';
import type { AdminWalletCreditReview } from '../../lib/adminWalletCreditReview';

type Wallet = Record<string, unknown>;
export interface CreditReviewPolicy { paused: boolean; pauseStateKnown: boolean; mergeResolutionEnabled: boolean }
const number = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null;
const whole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const text = (s: unknown, max = 200): string => typeof s === 'string' ? s.slice(0, max) : '';
const time = (s: unknown): number | null => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('/');

/** The reader is deliberately transaction-bound: a concurrent merge cannot splice two wallet states. */
export async function readAdminWalletCreditReview(
  read: (uid: string) => Promise<Wallet | null>, requestedUserId: string, policy: CreditReviewPolicy,
): Promise<AdminWalletCreditReview> {
  const result: AdminWalletCreditReview = { ok: false, requestedUserId, canonicalUserId: null,
    identityChain: [], ...policy };
  let id: unknown = requestedUserId;
  let requested: Wallet | null = null;
  try {
    for (let hop = 0; hop < 6; hop++) {
      if (!validId(id) || result.identityChain.includes(id)) return { ...result, reason: 'Wallet identity is invalid or cyclic. No balance was inferred.' };
      result.identityChain.push(id);
      const wallet = await read(id);
      if (!wallet) return { ...result, reason: 'A wallet in this identity chain is missing. Missing is not a zero balance.' };
      if (!requested) requested = wallet;
      if (wallet.mergedInto) { id = wallet.mergedInto; continue; }
      const view = maskWalletForView(policy.mergeResolutionEnabled ? wallet : requested, policy.paused);
      const gift = wallet.giftTokensRemaining;
      const admin = wallet.adminBuildTokensRemaining ?? 0;
      const consistent = whole(wallet.tokenBalance) && whole(gift) && whole(admin)
        && gift <= wallet.tokenBalance && admin <= gift && number(wallet.remaining_balance) !== null;
      const ledger = Array.isArray(wallet.walletLedger) ? wallet.walletLedger : [];
      const adminRows = ledger.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object'
        && (r.type === 'admin_adjustment' || r.type === 'admin_reclassification' || r.creditSource === 'admin-build'
          || (number(r.adminBuildTokensDelta) !== null && r.adminBuildTokensDelta !== 0)));
      // Merges concatenate histories and prepend their marker, so array position is not chronology.
      // Undated rows remain explicitly unknown, after dated rows, in their retained order.
      const sorted = [...adminRows].sort((a, b) => {
        const left = time(a.timestamp); const right = time(b.timestamp);
        return left === null ? (right === null ? 0 : 1) : right === null ? -1 : right - left;
      });
      return {
        ...result, ok: true, canonicalUserId: id,
        storedTokens: number(wallet.tokenBalance), storedInr: number(wallet.remaining_balance),
        ownerVisibleTokens: number(view.tokenBalance), ownerVisibleInr: number(view.remaining_balance),
        trackedGiftTokens: number(gift), trackedAdminTokens: number(wallet.adminBuildTokensRemaining),
        provenanceConsistent: consistent,
        // Eligibility is a policy calculation, NOT evidence of a specific payment or historical gift.
        weakEligibleTokens: number(wallet.tokenBalance) === null ? null
          : Math.max(0, Number(wallet.tokenBalance) - unavailableGiftTokens(wallet, policy.paused, true)),
        paidSpendableTokens: number(wallet.tokenBalance) === null ? null : paidSpendableTokens(wallet),
        trackedOrdinaryGiftTokens: consistent ? Number(gift) - Number(admin) : null,
        pendingReservations: ledger.some(r => Array.isArray(r?.openHolds) && r.openHolds.length > 0),
        suspended: wallet.banned === true,
        retainedAdminRows: adminRows.length,
        retainedUndatedRows: adminRows.filter(r => time(r.timestamp) === null).length,
        ledgerRows: sorted.slice(0, 60).map(r => ({ type: text(r.type, 80), tokens: number(r.amountCoinsOrTokens),
          adminTokensDelta: number(r.adminBuildTokensDelta), at: time(r.timestamp) === null ? '' : text(r.timestamp, 80),
          description: text(r.description), creditSource: text(r.creditSource, 80), requestId: text(r.requestId, 128),
          buildRef: text(r.buildRef, 128), rollupRef: text(r.rollupRef, 128) })),
      };
    }
    return { ...result, reason: 'Wallet identity exceeds the safe resolution limit. No balance was inferred.' };
  } catch {
    return { ...result, reason: 'Wallet review is unavailable. An unread balance is not zero.' };
  }
}

export async function adminWalletCreditReview(db: unknown, uid: string, policy: CreditReviewPolicy): Promise<AdminWalletCreditReview> {
  try {
    return await runTransaction(db as never, async tx => readAdminWalletCreditReview(async id => {
      const snap = await tx.get(doc(db as never, 'user_token_wallets', id));
      return snap.exists() ? snap.data() as Wallet : null;
    }, uid, policy));
  } catch {
    return { ok: false, requestedUserId: uid, canonicalUserId: null, identityChain: [], ...policy,
      reason: 'Wallet review is unavailable. An unread balance is not zero.' };
  }
}
