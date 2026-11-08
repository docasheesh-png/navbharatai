/** Read a durable operation, then refresh its current canonical wallet separately. No writes. */
import { createHash } from 'crypto';
import { doc, getDoc } from './serverDb';
import { WALLET_OPS, validRequestId, walletOpId } from './walletOps';
import { readAdminReason } from '../../lib/adminActionReason';
import { ADMIN_TOKEN_REASON_DIGEST_DOMAIN, readAdminTokenAdjustmentReceiptResponse,
  type AdminTokenAdjustmentReceiptResponse, type AdminTokenCurrentWallet } from '../../lib/adminTokenAdjustmentReceipt';
import { adminWalletCreditReview, type CreditReviewPolicy } from './adminWalletCreditReview';

export type AdminTokenReceiptLookup = { status: 'confirmed'; response: AdminTokenAdjustmentReceiptResponse }
  | { status: 'unknown'; reason: string };
const UNKNOWN = 'No verified committed receipt is available. The previous outcome remains unknown; do not replace its request ID or add the credit again.';

/** Exported DI boundary keeps the zero-write and bounded-read contract executable in synthetic tests. */
export async function readAdminTokenAdjustmentReceipt(
  requestId: string,
  deps: { readOperation: (id: string) => Promise<Record<string, unknown> | null>;
    readCurrent: (uid: string) => Promise<AdminTokenCurrentWallet>; now: () => string },
): Promise<AdminTokenReceiptLookup> {
  if (!validRequestId(requestId)) return { status: 'unknown', reason: UNKNOWN };
  try {
    const stored = await deps.readOperation(walletOpId('admin', 'admin-adjustment', requestId));
    if (!stored) return { status: 'unknown', reason: UNKNOWN };
    const reason = readAdminReason(stored.reason);
    if (!reason.ok || reason.reason !== stored.reason) return { status: 'unknown', reason: UNKNOWN };
    const receipt = { requestId, requestedUserId: stored.requestedUserId, walletId: stored.walletId,
      delta: stored.delta, previousBalance: stored.previousBalance, newBalance: stored.newBalance,
      committedAt: stored.createdAt,
      reasonDigest: createHash('sha256').update(ADMIN_TOKEN_REASON_DIGEST_DOMAIN + reason.reason).digest('hex') };
    const unavailable: AdminTokenCurrentWallet = { ok: false, refreshedAt: deps.now(), reason: 'The current canonical wallet could not be refreshed. An unread balance is not zero.' };
    // Validate immutable receipt fields BEFORE following any stored account identifier.
    const checked = readAdminTokenAdjustmentReceiptResponse({ ok: true, receipt, currentWallet: unavailable });
    if (!checked) return { status: 'unknown', reason: UNKNOWN };
    let currentWallet: AdminTokenCurrentWallet = unavailable;
    try { currentWallet = await deps.readCurrent(checked.receipt.requestedUserId); } catch { /* receipt remains proven, current balance unknown */ }
    const response = readAdminTokenAdjustmentReceiptResponse({ ...checked, currentWallet })
      ?? { ...checked, currentWallet: unavailable };
    return { status: 'confirmed', response };
  } catch { return { status: 'unknown', reason: UNKNOWN }; }
}

export async function adminTokenAdjustmentReceipt(db: unknown, requestId: string, policy: CreditReviewPolicy): Promise<AdminTokenReceiptLookup> {
  const now = () => new Date().toISOString();
  return readAdminTokenAdjustmentReceipt(requestId, {
    now,
    readOperation: async id => {
      const snap = await getDoc(doc(db as never, WALLET_OPS, id));
      return snap.exists() ? snap.data() as Record<string, unknown> : null;
    },
    readCurrent: async uid => {
      const review = await adminWalletCreditReview(db, uid, policy);
      const refreshedAt = now();
      if (!review.ok || !review.canonicalUserId) return { ok: false, refreshedAt,
        reason: 'The current canonical wallet could not be refreshed. An unread balance is not zero.' };
      return { ok: true, refreshedAt, canonicalUserId: review.canonicalUserId, storedTokens: review.storedTokens ?? null,
        ownerVisibleTokens: policy.pauseStateKnown ? review.ownerVisibleTokens ?? null : null,
        weakEligibleTokens: policy.pauseStateKnown ? review.weakEligibleTokens ?? null : null,
        paidSpendableTokens: review.paidSpendableTokens ?? null, ...policy };
    },
  });
}
