/** Explicit admin policy change for EXISTING tracked gifts. This is never a new deposit. */
import { createHash } from 'node:crypto';
import { doc, runTransaction } from './serverDb';
import { walletMergeResolveEnabled } from './walletResolve';
import { ledgerPatch } from './walletStatement';
import { WALLET_OPS, walletOpId, validRequestId } from './walletOps';
import { readAdminReason } from '../../lib/adminActionReason';
import type { AdminGiftReclassificationPreview } from '../../lib/adminGiftReclassification';

export class AdminGiftReclassificationError extends Error { readonly status = 409; }
const refuse = (message: string): never => { throw new AdminGiftReclassificationError(`${message} No balance or credit was changed.`); };
const validAmount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 10_000_000;
const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;

async function readCanonical(tx: any, db: any, userId: string) {
  const chain: string[] = [];
  let id = userId;
  for (let hop = 0; hop < 6; hop++) {
    if (!id || id.includes('/') || chain.includes(id)) refuse('Wallet identity could not be resolved safely.');
    chain.push(id);
    const ref = doc(db, 'user_token_wallets', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) refuse('The selected wallet does not exist.');
    const w = snap.data();
    if (!w.mergedInto) return { ref, w, id, chain };
    if (!walletMergeResolveEnabled()) refuse('This account is merged; select its canonical account.');
    if (typeof w.mergedInto !== 'string') refuse('Wallet identity could not be resolved safely.');
    id = w.mergedInto;
  }
  return refuse('Wallet identity exceeded the safe resolution limit.');
}

function previewFor(userId: string, amount: number, current: Awaited<ReturnType<typeof readCanonical>>): AdminGiftReclassificationPreview {
  const { w, id, chain } = current;
  if (!validAmount(amount)) refuse('Choose a positive whole-token amount, at most 10,000,000.');
  if (w.banned === true) refuse('The selected account is suspended.');
  // Do not use giftRemaining's legacy inference: this action requires an explicit maintained source field.
  if (w.giftTokensRemaining === undefined) refuse('Existing gift provenance is missing. This wallet needs account-specific review, not automatic reclassification.');
  const balance = w.tokenBalance; const gift = w.giftTokensRemaining; const admin = w.adminBuildTokensRemaining ?? 0;
  if (![balance, gift, admin].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
    || gift > balance || admin > gift || typeof w.remaining_balance !== 'number' || !Number.isFinite(w.remaining_balance)) {
    refuse('The stored balance or gift provenance is inconsistent and needs review.');
  }
  if (Array.isArray(w.walletLedger) && w.walletLedger.some((row: any) => Array.isArray(row?.openHolds) && row.openHolds.length > 0)) {
    refuse('Finish pending wallet reservations before reclassifying gifts.');
  }
  if (amount > gift - admin) refuse('The requested amount exceeds the available, tracked non-admin gift balance.');
  return {
    requestedUserId: userId, canonicalUserId: id, accountEmail: typeof w.userEmail === 'string' ? w.userEmail : null,
    amount, balanceTokens: balance, remainingInr: w.remaining_balance, giftTokens: gift, adminTokens: admin,
    availableGiftTokens: gift - admin, afterAdminTokens: admin + amount,
    fingerprint: createHash('sha256').update(JSON.stringify(stable({ requestedUserId: userId, amount, chain, wallet: w }))).digest('hex'),
  };
}

/** Read-only transaction; no op record or wallet write on Preview. */
export async function previewAdminGiftReclassification(db: any, userId: string, amount: number) {
  return runTransaction(db, async (tx: any) => previewFor(userId, amount, await readCanonical(tx, db, userId)));
}

export interface AdminGiftReclassificationInput { userId: string; amount: number; fingerprint: string; requestId: string; reason: string; }
export async function confirmAdminGiftReclassification(db: any, input: AdminGiftReclassificationInput, now: string) {
  if (!validRequestId(input.requestId)) refuse('Refresh the preview to obtain a valid request ID.');
  const reason = readAdminReason(input.reason);
  if (!reason.ok) return refuse(reason.error);
  const normalizedReason = reason.reason;
  if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) refuse('Refresh the preview before confirming.');
  const opRef = doc(db, WALLET_OPS, walletOpId('admin', 'admin-reclassification', input.requestId));
  return runTransaction(db, async (tx: any) => {
    const previous = await tx.get(opRef);
    if (previous.exists()) {
      const saved = previous.data();
      if (saved.requestedUserId !== input.userId || saved.amount !== input.amount || saved.fingerprint !== input.fingerprint || saved.reason !== normalizedReason) {
        refuse('This request ID belongs to a different reclassification.');
      }
      return { ...saved.outcome, replayed: true };
    }
    const current = await readCanonical(tx, db, input.userId);
    const preview = previewFor(input.userId, input.amount, current);
    if (preview.fingerprint !== input.fingerprint) refuse('This account or its wallet changed since the preview. Refresh and review it again.');
    const outcome = { canonicalUserId: current.id, reclassifiedTokens: input.amount, balanceTokens: preview.balanceTokens,
      remainingInr: preview.remainingInr, adminTokens: preview.afterAdminTokens, replayed: false };
    // No mirroredCreditPatch: total balance, ₹ mirrors, gift amount, purchased counters and carry are UNCHANGED.
    tx.update(current.ref, {
      adminBuildTokensRemaining: preview.afterAdminTokens,
      ...ledgerPatch(current.w, {
        type: 'admin_reclassification', amountCoinsOrTokens: 0, moneySpent: 0, timestamp: now,
        adminBuildTokensDelta: input.amount, requestId: input.requestId,
        description: `${input.amount.toLocaleString('en-IN')} existing gift tokens reclassified for Weak builds; no new credit. ${normalizedReason}`,
        reason: normalizedReason, creditSource: 'existing-gift-reclassification',
      }),
      updatedAt: now,
    });
    tx.set(opRef, { kind: 'admin-reclassification', requestedUserId: input.userId, canonicalUserId: current.id,
      amount: input.amount, fingerprint: input.fingerprint, reason: normalizedReason, createdAt: now, outcome });
    return outcome;
  });
}
