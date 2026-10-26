/** Manual admin credit is app-building credit, never proof of a real payment. */
import { doc, runTransaction } from './serverDb';
import { adminBuildRemaining } from './giftSpend';
import { walletMergeResolveEnabled } from './walletResolve';
import { mirroredCreditPatch, adminCreditActivationRefusal } from './walletMirror';
import { ledgerPatch } from './walletStatement';
import { WALLET_OPS, walletOpId, validRequestId } from './walletOps';

export class AdminTokenAdjustmentError extends Error {
  readonly status = 409;
}

export interface AdminTokenAdjustment {
  userId: string;
  delta: number;
  reason: string;
  requestId: string;
}

/** The request identity survives wallet merges; all identity reads and money writes are atomic. */
export async function adjustAdminBuildTokens(db: any, input: AdminTokenAdjustment, now: string) {
  if (!validRequestId(input.requestId)) throw new AdminTokenAdjustmentError('A valid adjustment request ID is required. Refresh the admin panel.');
  const opRef = doc(db, WALLET_OPS, walletOpId('admin', 'admin-adjustment', input.requestId));
  return runTransaction(db, async (tx: any) => {
    const op = await tx.get(opRef);
    if (op.exists()) {
      const saved = op.data();
      if (saved.requestedUserId !== input.userId || saved.delta !== input.delta || saved.reason !== input.reason) {
        throw new AdminTokenAdjustmentError('This request ID belongs to a different adjustment.');
      }
      return { previousBalance: saved.previousBalance as number, newBalance: saved.newBalance as number,
        walletId: saved.walletId as string, replayed: true };
    }
    let walletId = input.userId;
    const seen = new Set<string>();
    for (let hop = 0; hop < 6; hop++) {
      if (!walletId || walletId.includes('/') || seen.has(walletId)) throw new AdminTokenAdjustmentError('Wallet identity could not be resolved safely.');
      seen.add(walletId);
      const walletRef = doc(db, 'user_token_wallets', walletId);
      const fresh = await tx.get(walletRef);
      if (!fresh.exists()) return null;
      const w = fresh.data();
      if (w.mergedInto) {
        if (!walletMergeResolveEnabled()) throw new AdminTokenAdjustmentError('This account is merged; adjust its canonical wallet instead.');
        if (typeof w.mergedInto !== 'string') throw new AdminTokenAdjustmentError('Wallet identity could not be resolved safely.');
        walletId = w.mergedInto;
        continue;
      }
      const activationRefusal = adminCreditActivationRefusal(w);
      if (activationRefusal) throw new AdminTokenAdjustmentError(activationRefusal);
      const previousBalance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
      const patch = mirroredCreditPatch(w, input.delta, 'admin-build');
      const appliedDelta = patch.tokenBalance - previousBalance;
      tx.update(walletRef, {
        ...patch,
        ...ledgerPatch(w, {
          type: 'admin_adjustment', amountCoinsOrTokens: appliedDelta, moneySpent: 0,
          description: input.reason, reason: input.reason, timestamp: now,
          creditSource: 'admin-build', requestId: input.requestId,
          adminBuildTokensDelta: (patch.adminBuildTokensRemaining ?? 0) - adminBuildRemaining(w),
        }),
        updatedAt: now,
      });
      const outcome = { previousBalance, newBalance: patch.tokenBalance, walletId, replayed: false };
      tx.set(opRef, { ...outcome, requestedUserId: input.userId, delta: input.delta, reason: input.reason, createdAt: now });
      return outcome;
    }
    throw new AdminTokenAdjustmentError('Wallet identity exceeded the safe resolution limit.');
  });
}
