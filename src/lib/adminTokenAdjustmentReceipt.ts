/** Shared wire contract for an authenticated, read-only manual-adjustment receipt lookup. */
import { readTokenDelta } from './adminActionReason';
export const ADMIN_TOKEN_REASON_DIGEST_DOMAIN = 'navbharatai/admin-token-adjustment/reason/v1\0';

export interface AdminTokenAdjustmentReceipt {
  requestId: string;
  requestedUserId: string;
  /** Canonical wallet at the original operation, not necessarily the current canonical wallet. */
  walletId: string;
  delta: number;
  reasonDigest: string;
  previousBalance: number;
  newBalance: number;
  committedAt: string;
}
export type AdminTokenCurrentWallet = {
  ok: true;
  canonicalUserId: string;
  storedTokens: number | null;
  ownerVisibleTokens: number | null;
  weakEligibleTokens: number | null;
  paidSpendableTokens: number | null;
  paused: boolean;
  pauseStateKnown: boolean;
  mergeResolutionEnabled: boolean;
  refreshedAt: string;
} | { ok: false; refreshedAt: string; reason: string };
export interface AdminTokenAdjustmentReceiptResponse {
  ok: true;
  receipt: AdminTokenAdjustmentReceipt;
  currentWallet: AdminTokenCurrentWallet;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableNumber = (value: unknown): value is number | null => value === null || finite(value);
const uid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && !/[\/\u0000-\u001f\u007f]/.test(value);
const stamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 && Number.isFinite(Date.parse(value));

/** Check and copy allowed fields only; neither an error body nor a free-text reason enters UI state. */
export function readAdminTokenAdjustmentReceiptResponse(value: unknown): AdminTokenAdjustmentReceiptResponse | null {
  if (!record(value) || value.ok !== true || value.error !== undefined || !record(value.receipt) || !record(value.currentWallet)) return null;
  const r = value.receipt; const w = value.currentWallet;
  const delta = readTokenDelta(r.delta);
  if (typeof r.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(r.requestId)
    || !uid(r.requestedUserId) || !uid(r.walletId) || typeof r.delta !== 'number' || delta.ok === false
    || typeof r.reasonDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.reasonDigest)
    || !finite(r.previousBalance) || !finite(r.newBalance) || !stamp(r.committedAt) || !stamp(w.refreshedAt)) return null;
  const receipt: AdminTokenAdjustmentReceipt = { requestId: r.requestId, requestedUserId: r.requestedUserId,
    walletId: r.walletId, delta: r.delta as number, reasonDigest: r.reasonDigest, previousBalance: r.previousBalance,
    newBalance: r.newBalance, committedAt: r.committedAt };
  if (w.ok === false && typeof w.reason === 'string' && w.reason.length > 0 && w.reason.length <= 500) {
    return { ok: true, receipt, currentWallet: { ok: false, refreshedAt: w.refreshedAt, reason: w.reason } };
  }
  if (w.ok !== true || !uid(w.canonicalUserId) || !nullableNumber(w.storedTokens) || !nullableNumber(w.ownerVisibleTokens)
    || !nullableNumber(w.weakEligibleTokens) || !nullableNumber(w.paidSpendableTokens)
    || typeof w.paused !== 'boolean' || typeof w.pauseStateKnown !== 'boolean' || typeof w.mergeResolutionEnabled !== 'boolean') return null;
  return { ok: true, receipt, currentWallet: { ok: true, canonicalUserId: w.canonicalUserId,
    storedTokens: w.storedTokens, ownerVisibleTokens: w.ownerVisibleTokens, weakEligibleTokens: w.weakEligibleTokens,
    paidSpendableTokens: w.paidSpendableTokens, refreshedAt: w.refreshedAt,
    paused: w.paused, pauseStateKnown: w.pauseStateKnown, mergeResolutionEnabled: w.mergeResolutionEnabled } };
}
